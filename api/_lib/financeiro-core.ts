// Núcleo do Financeiro · Recebíveis.
//
// FONTE ÚNICA = controle.branorte.com (Supabase kfucuvwrnwrkshxpsmyq).
// Lá vivem pedidos_venda, order_installments (parcelas) e receipts (recebimentos,
// com receipt_url = comprovante no bucket público `comprovantes`).
//
// Por que ler daqui e não do espelho: `mirror_pedidos_venda.valor_pago` está
// ZERADO nos 450 pedidos e `status_pagamento` é 'PENDENTE' em 100% deles — as
// colunas nunca foram preenchidas. O dinheiro recebido de verdade (R$ 1,18 mi em
// 72 recebimentos) só existe em `receipts`, que nunca foi espelhado. Somar o
// espelho é somar zero. Medido em 06/08/2026.
//
// Por que passar pelo servidor e não ler do navegador: a anon key do controle é
// PÚBLICA e a RLS de lá é permissiva. Filtrar por vendedor no React seria
// decorativo — qualquer vendedor logado alcançaria a base inteira pelo console.
// O recorte por vendedor é decidido AQUI, a partir do JWT do CRM.

import { createClient } from '@supabase/supabase-js'

export const CONTROLE_URL =
  process.env.CONTROLE_SUPABASE_URL || 'https://kfucuvwrnwrkshxpsmyq.supabase.co'

// anon key PÚBLICA do controle (role=anon, exp 2075) — já exposta no bundle de
// controle.branorte.com e em api/controle-criar-pedido.ts. Não é segredo.
const CONTROLE_PUBLIC_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'

export const CONTROLE_KEY =
  process.env.CONTROLE_SERVICE_KEY || process.env.CONTROLE_ANON_KEY || CONTROLE_PUBLIC_ANON

const CRM_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const CRM_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// ─────────────────────────────────────────────────────────────────────────────
// Tipos (espelham as colunas reais do controle)
// ─────────────────────────────────────────────────────────────────────────────

export interface PedidoRaw {
  id: string
  pedido_numero: string | null
  cliente: string | null
  vendedor: string | null
  vendedor_2: string | null
  valor_total: number | null
  ajuste_valor: number | null
  status: string | null
  forma_pagamento: string | null
  data_venda: string | null
  payment_plan_json: { total?: number | string } | null
}

export interface ParcelaRaw {
  id: string
  order_id: string
  installment_no: number
  total_installments: number
  due_date: string
  amount: number
  description: string
  status: string | null
  canceled: boolean | null
  cancellation_reason: string | null
  boleto_enviado: boolean | null
  boleto_enviado_em: string | null
}

export interface ReceiptRaw {
  id: string
  order_id: string
  installment_id: string | null
  amount: number
  paid_at: string
  payment_method: string
  notes: string | null
  receipt_url: string | null
}

/** Conferência do comprovante. Mora no CRM (fin_conferencias) — o controle não tem isso. */
export type StatusConferencia = 'AGUARDANDO' | 'APROVADO' | 'REJEITADO'

export interface ConferenciaRaw {
  receipt_id: string
  status: StatusConferencia
  motivo: string | null
  conferido_por_nome: string | null
  conferido_em: string | null
}

/** Status derivado da parcela. Derivado, não lido — ver nota em statusParcela(). */
export type StatusParcela =
  | 'CANCELADA'
  | 'PAGO'
  | 'AGUARDANDO_CONFERENCIA'
  | 'AGUARDANDO_COMPROVANTE'
  | 'PARCIAL'
  | 'VENCIDO'
  | 'VENCE_HOJE'
  | 'BOLETO_ENVIADO'
  | 'PENDENTE'

export type StatusPedido =
  | 'CANCELADO'
  | 'SEM_PLANO'
  | 'QUITADO'
  | 'REGULARIZADO'
  | 'VENCIDO'
  | 'AGUARDANDO_CONFERENCIA'
  | 'PARCIAL'
  | 'EM_DIA'

export interface Parcela {
  id: string
  numero: number
  totalParcelas: number
  descricao: string
  vencimento: string
  valor: number
  recebido: number
  saldo: number
  status: StatusParcela
  /** status gravado no controle — exposto pra comparação, NÃO usado no cálculo */
  statusControle: string | null
  boletoEnviado: boolean
  boletoEnviadoEm: string | null
  cancelada: boolean
  motivoCancelamento: string | null
  diasAtraso: number
  /** entrou dinheiro mas algum recebimento veio sem arquivo anexado */
  aguardandoComprovante: boolean
  /** tem comprovante anexado esperando o gestor/financeiro conferir */
  aguardandoConferencia: boolean
  /** algum comprovante foi rejeitado — o valor dele não conta como recebido */
  temRejeitado: boolean
  recebimentos: Recebimento[]
}

export interface Recebimento {
  id: string
  valor: number
  pagoEm: string
  meio: string
  observacao: string | null
  comprovanteUrl: string | null
  /** AGUARDANDO enquanto ninguém conferiu (inclusive nos lançamentos antigos). */
  conferencia: StatusConferencia
  motivoRejeicao: string | null
  conferidoPor: string | null
  conferidoEm: string | null
}

export interface PedidoFinanceiro {
  id: string
  pedidoNumero: string | null
  cliente: string | null
  vendedor: string | null
  formaPagamento: string | null
  dataVenda: string | null
  valorTotal: number
  recebido: number
  aReceber: number
  vencido: number
  proximoVencimento: string | null
  qtdParcelas: number
  parcelasVencidas: number
  boletosPendentes: number
  pagamentosSemComprovante: number
  comprovantesAConferir: number
  comprovantesRejeitados: number
  status: StatusPedido
  /** soma das parcelas ≠ valor do pedido (item 1 do spec) */
  divergenciaPlano: number
  somaParcelas: number
  /** em que etapa da fábrica está — ver lerProducao() */
  producao: Producao
  /** nenhum recebimento lançado: a fila que o vendedor precisa zerar */
  semLancamento: boolean
  /** pedido antigo dado como pago sem comprovante — ver fin_regularizacoes */
  regularizacao: Regularizacao | null
  /** o cliente confirmou o recebimento (marca do vendedor) */
  entrega: Entrega | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Produção — em que etapa o equipamento está na fábrica.
//
// Vem do app Controle de Produção (projeto yyfosrvlpsaycjnxcnkj), tabela
// `producao_cards`, via a view `vw_producao_status` — que expõe SÓ pedido_id,
// status e data. Sem nome de cliente, sem valor: é o mínimo pra dizer "ainda
// está aqui" ou "já carregou", e por isso a anon key basta.
//
// ⚠️ NÃO usar `mirror_producao_pedidos` do CRM: ela sincroniza todo dia, mas os
// 500 pedidos estão parados em "EM PROJETO" — é o espelho de um kanban antigo
// que ninguém move. Conferido em 03/09/2026.
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCAO_URL =
  process.env.PRODUCAO_SUPABASE_URL || 'https://yyfosrvlpsaycjnxcnkj.supabase.co'

// anon key PÚBLICA do controle-producao (role=anon, exp 2099) — já exposta no
// bundle de controledeproducao.mbranorte.com.br. Não é segredo.
const PRODUCAO_PUBLIC_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5Zm9zcnZscHNheWNqbnhjbmtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDk2NzEsImV4cCI6MjA5OTg4NTY3MX0.P1Qkii4H-IymxTDeIR4iApOrcRCdlm5Cy9eYr7YQ4Yo'

const PRODUCAO_KEY = process.env.PRODUCAO_ANON_KEY || PRODUCAO_PUBLIC_ANON

/** Onde o equipamento está, do ponto de vista de quem cobra. */
export type EtapaFabrica =
  | 'ANTES_DO_CHAO'   // PPCP, ordem de produção, projeto
  | 'FABRICANDO'      // solda, montagem
  | 'PRONTO'          // expedição, organizando transporte
  | 'CARREGADO'       // entregue — saiu da fábrica
  | 'CANCELADO'
  | 'SEM_CARD'        // pedido sem card de produção: 29% da carteira em 09/2026

const ETAPA_POR_STATUS: Record<string, EtapaFabrica> = {
  PPCP: 'ANTES_DO_CHAO',
  ORDEM_PRODUCAO: 'ANTES_DO_CHAO',
  PROJETOS_PADROES: 'ANTES_DO_CHAO',
  EM_PROJETO: 'ANTES_DO_CHAO',
  PROJETO_CONCLUIDO: 'ANTES_DO_CHAO',
  SOLDA: 'FABRICANDO',
  MONTAGEM: 'FABRICANDO',
  EXPEDICAO: 'PRONTO',
  ORGANIZANDO_TRANSPORTE: 'PRONTO',
  ENTREGUE: 'CARREGADO',
  CANCELADO: 'CANCELADO',
}

export interface ProducaoRaw {
  pedido_id: string
  status: string
  atualizado_em: string | null
}

export interface Producao {
  etapa: EtapaFabrica
  /** status cru do kanban, pra tooltip e pra não esconder informação */
  statusCru: string | null
  /** quando o card entrou nessa etapa (updated_at do card) */
  desde: string | null
}

export const SEM_PRODUCAO: Producao = { etapa: 'SEM_CARD', statusCru: null, desde: null }

/**
 * Lê a etapa de fábrica de todos os pedidos. Uma chamada só — a view é pequena
 * (≈500 linhas) e o join é feito aqui por pedido_id.
 *
 * Cards criados à mão no kanban têm pedido_id tipo "MANUAL-1770667896654": não
 * casam com nenhum pedido de venda e simplesmente não entram no mapa.
 *
 * Falha aqui NÃO derruba o financeiro: sem produção, todo pedido vira SEM_CARD
 * e a tela continua servindo pra cobrar. Era assim antes desta feature existir.
 */
export async function lerProducao(): Promise<Map<string, Producao>> {
  const mapa = new Map<string, Producao>()
  try {
    const url = `${PRODUCAO_URL}/rest/v1/vw_producao_status?select=pedido_id,status,atualizado_em&limit=5000`
    const resp = await fetch(url, {
      headers: { apikey: PRODUCAO_KEY, Authorization: `Bearer ${PRODUCAO_KEY}` },
    })
    if (!resp.ok) return mapa
    const linhas = (await resp.json()) as ProducaoRaw[]
    for (const l of linhas) {
      if (!l.pedido_id) continue
      const etapa = ETAPA_POR_STATUS[l.status] ?? 'ANTES_DO_CHAO'
      const anterior = mapa.get(l.pedido_id)
      // Um pedido pode ter mais de um card (equipamentos separados). Quem manda
      // é o card MENOS adiantado: se uma peça ainda está na solda, o pedido não
      // carregou. Cancelado não conta como atraso de ninguém.
      if (!anterior || (PESO_ETAPA[etapa] < PESO_ETAPA[anterior.etapa] && etapa !== 'CANCELADO')) {
        mapa.set(l.pedido_id, { etapa, statusCru: l.status, desde: l.atualizado_em })
      }
    }
  } catch {
    /* produção fora do ar não pode derrubar a cobrança */
  }
  return mapa
}

const PESO_ETAPA: Record<EtapaFabrica, number> = {
  ANTES_DO_CHAO: 0, FABRICANDO: 1, PRONTO: 2, CARREGADO: 3, CANCELADO: 4, SEM_CARD: 5,
}

/** Etapas em que o equipamento ainda está dentro da Branorte. */
export const NA_FABRICA = new Set<EtapaFabrica>(['ANTES_DO_CHAO', 'FABRICANDO', 'PRONTO'])

// ─────────────────────────────────────────────────────────────────────────────
// Marcas do CRM sobre o pedido: regularização histórica e entrega ao cliente.
// ─────────────────────────────────────────────────────────────────────────────

export type StatusRegularizacao = 'PROPOSTA' | 'CONFIRMADA' | 'RECUSADA'

export interface Regularizacao {
  status: StatusRegularizacao
  motivo: string | null
  propostoPor: string | null
  propostoEm: string | null
  decididoPor: string | null
  decididoEm: string | null
  motivoRecusa: string | null
}

export interface Entrega {
  entregueEm: string
  observacao: string | null
  confirmadoPor: string | null
}

export interface MarcasPedido {
  regularizacao: Regularizacao | null
  entrega: Entrega | null
}

export const SEM_MARCAS: MarcasPedido = { regularizacao: null, entrega: null }

/**
 * Lê fin_regularizacoes e fin_entregas de uma vez. Sem filtro por pedido: as
 * duas tabelas são pequenas (uma linha por pedido marcado) e o join sai aqui.
 */
export async function lerMarcas(): Promise<Map<string, MarcasPedido>> {
  const mapa = new Map<string, MarcasPedido>()
  const pegar = (id: string): MarcasPedido => {
    let m = mapa.get(id)
    if (!m) { m = { regularizacao: null, entrega: null }; mapa.set(id, m) }
    return m
  }
  try {
    const crm = crmAdmin()
    const [regs, ents] = await Promise.all([
      crm.from('fin_regularizacoes')
        .select('order_id, status, motivo, proposto_por_nome, proposto_em, decidido_por_nome, decidido_em, motivo_recusa'),
      crm.from('fin_entregas').select('order_id, entregue_em, observacao, confirmado_por_nome'),
    ])
    for (const r of regs.data ?? []) {
      pegar(r.order_id as string).regularizacao = {
        status: r.status as StatusRegularizacao,
        motivo: (r.motivo as string) ?? null,
        propostoPor: (r.proposto_por_nome as string) ?? null,
        propostoEm: (r.proposto_em as string) ?? null,
        decididoPor: (r.decidido_por_nome as string) ?? null,
        decididoEm: (r.decidido_em as string) ?? null,
        motivoRecusa: (r.motivo_recusa as string) ?? null,
      }
    }
    for (const e of ents.data ?? []) {
      pegar(e.order_id as string).entrega = {
        entregueEm: e.entregue_em as string,
        observacao: (e.observacao as string) ?? null,
        confirmadoPor: (e.confirmado_por_nome as string) ?? null,
      }
    }
  } catch {
    /* marca é enfeite em cima da cobrança: se falhar, a tela segue funcionando */
  }
  return mapa
}

export interface Kpis {
  totalVendido: number
  totalRecebido: number
  totalAReceber: number
  totalVencido: number
  /** saiu da fábrica e ainda tem saldo — o que mais aperta o caixa */
  carregadoAReceber: number
  pedidosCarregadosEmAberto: number
  /** ainda está aqui dentro */
  naFabricaAReceber: number
  pedidosNaFabrica: number
  /** entregue sem um centavo lançado — a fila do mutirão */
  pedidosCarregadosSemLancamento: number
  valorCarregadoSemLancamento: number
  pedidosSemCard: number
  /** mutirão: pedidos antigos dados como pagos, e o que espera o gestor */
  pedidosRegularizados: number
  valorRegularizado: number
  regularizacoesAConfirmar: number
  pedidosQuitados: number
  pedidosParciais: number
  pedidosSemPlano: number
  pedidosComVencido: number
  pedidosAguardandoConferencia: number
  boletosPendentes: number
  pagamentosSemComprovante: number
  comprovantesAConferir: number
  comprovantesRejeitados: number
  planosDivergentes: number
}

const CENT = 0.01

// ─────────────────────────────────────────────────────────────────────────────
// Regras puras
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valor devido do pedido. Mantém a regra que já estava em useControleFinanceiro:
 * o total do plano de pagamento manda; valor_total é o fallback; ajuste soma.
 */
export function devidoDe(p: Pick<PedidoRaw, 'payment_plan_json' | 'valor_total' | 'ajuste_valor'>): number {
  const raw = p.payment_plan_json?.total
  const pt = raw != null ? Number(raw) : 0
  const base = pt > 0 ? pt : Number(p.valor_total) || 0
  return base + (Number(p.ajuste_valor) || 0)
}

export function diffDias(de: string, ate: string): number {
  const a = Date.parse(de + 'T00:00:00Z')
  const b = Date.parse(ate + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/** O que os recebimentos que cobrem a parcela dizem sobre a comprovação. */
export interface Cobertura {
  /** soma dos recebimentos NÃO rejeitados */
  recebido: number
  /** algum recebimento que conta entrou sem arquivo anexado */
  algumSemComprovante: boolean
  /** algum recebimento que conta ainda não foi aprovado por alguém */
  algumNaoAprovado: boolean
}

/**
 * Status da parcela DERIVADO do dinheiro, da data e da comprovação — nunca lido
 * de order_installments.status.
 *
 * Motivo de derivar: o campo do controle é gravado por trigger/edge e envelhece.
 * Em 06/08/2026 havia 96 parcelas marcadas VENCIDO mas 977 PENDENTE, várias com
 * vencimento já passado — a data é a verdade, o campo não. `statusControle` fica
 * exposto no retorno pra quem quiser comparar.
 *
 * REGRA PRINCIPAL (item 2 do spec): preencher valor recebido NÃO quita. Só vira
 * PAGO quando o dinheiro cobre a parcela E todo recebimento que a cobre tem
 * comprovante anexado E foi aprovado na conferência. Sem isso a parcela para em
 * AGUARDANDO_COMPROVANTE ou AGUARDANDO_CONFERENCIA — nunca em PAGO.
 *
 * Precedência: cancelada > (coberta: comprovante > conferência > pago) >
 * parcial > vencido > vence hoje > boleto > pendente.
 */
export function statusParcela(
  p: Pick<ParcelaRaw, 'amount' | 'due_date' | 'canceled' | 'boleto_enviado'>,
  cob: Cobertura,
  hoje: string,
): StatusParcela {
  if (p.canceled) return 'CANCELADA'
  const valor = Number(p.amount) || 0

  if (valor > 0 && cob.recebido >= valor - CENT) {
    if (cob.algumSemComprovante) return 'AGUARDANDO_COMPROVANTE'
    if (cob.algumNaoAprovado) return 'AGUARDANDO_CONFERENCIA'
    return 'PAGO'
  }
  if (cob.recebido > CENT) return 'PARCIAL'

  const d = diffDias(hoje, p.due_date)
  if (d < 0) return 'VENCIDO'
  if (d === 0) return 'VENCE_HOJE'
  if (p.boleto_enviado) return 'BOLETO_ENVIADO'
  return 'PENDENTE'
}

/**
 * Agrega um pedido com suas parcelas e recebimentos. Puro — `hoje` é injetado.
 *
 * `conferencias` mapeia receipt_id -> conferência (vem do CRM, tabela
 * fin_conferencias). Recebimento sem linha ali é tratado como AGUARDANDO: é o
 * caso dos 72 lançamentos que já existiam antes desta tela, que por isso NÃO
 * viram "quitado" sozinhos (item 17: não marcar pedido antigo como quitado sem
 * confirmação).
 */
export function agregarPedido(
  pedido: PedidoRaw,
  parcelasRaw: ParcelaRaw[],
  receiptsRaw: ReceiptRaw[],
  hoje: string,
  conferencias: Map<string, ConferenciaRaw> = new Map(),
  producao: Producao = SEM_PRODUCAO,
  marcas: MarcasPedido = SEM_MARCAS,
): PedidoFinanceiro & { parcelas: Parcela[] } {
  const valorTotal = devidoDe(pedido)

  const conf = (r: ReceiptRaw): StatusConferencia => conferencias.get(r.id)?.status ?? 'AGUARDANDO'
  // Comprovante rejeitado = pagamento não identificado. Não é dinheiro em caixa.
  const conta = (r: ReceiptRaw): boolean => conf(r) !== 'REJEITADO'
  const soma = (rs: ReceiptRaw[]): number =>
    rs.filter(conta).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  // Recebimentos por parcela. Os que vêm sem installment_id são avulsos:
  // contam no total do pedido, mas não amortizam parcela nenhuma.
  const porParcela = new Map<string, ReceiptRaw[]>()
  for (const r of receiptsRaw) {
    if (!r.installment_id) continue
    const arr = porParcela.get(r.installment_id)
    if (arr) arr.push(r)
    else porParcela.set(r.installment_id, [r])
  }

  const parcelas: Parcela[] = parcelasRaw
    .slice()
    .sort((a, b) => a.installment_no - b.installment_no)
    .map(p => {
      const recs = porParcela.get(p.id) ?? []
      const validos = recs.filter(conta)
      const cob: Cobertura = {
        recebido: soma(recs),
        algumSemComprovante: validos.some(r => !r.receipt_url),
        algumNaoAprovado: validos.some(r => conf(r) !== 'APROVADO'),
      }
      const valor = Number(p.amount) || 0
      const st = statusParcela(p, cob, hoje)
      const atraso = diffDias(p.due_date, hoje)
      return {
        id: p.id,
        numero: p.installment_no,
        totalParcelas: p.total_installments,
        descricao: p.description,
        vencimento: p.due_date,
        valor,
        recebido: cob.recebido,
        saldo: Math.max(0, valor - cob.recebido),
        status: st,
        statusControle: p.status,
        boletoEnviado: !!p.boleto_enviado,
        boletoEnviadoEm: p.boleto_enviado_em,
        cancelada: !!p.canceled,
        motivoCancelamento: p.cancellation_reason,
        diasAtraso: st === 'VENCIDO' ? Math.max(0, atraso) : 0,
        aguardandoComprovante: cob.recebido > CENT && cob.algumSemComprovante,
        aguardandoConferencia: validos.some(r => !!r.receipt_url && conf(r) === 'AGUARDANDO'),
        temRejeitado: recs.some(r => conf(r) === 'REJEITADO'),
        recebimentos: recs.map(r => {
          const c = conferencias.get(r.id)
          return {
            id: r.id,
            valor: Number(r.amount) || 0,
            pagoEm: r.paid_at,
            meio: r.payment_method,
            observacao: r.notes,
            comprovanteUrl: r.receipt_url,
            conferencia: c?.status ?? 'AGUARDANDO',
            motivoRejeicao: c?.motivo ?? null,
            conferidoPor: c?.conferido_por_nome ?? null,
            conferidoEm: c?.conferido_em ?? null,
          }
        }),
      }
    })

  const ativas = parcelas.filter(p => !p.cancelada)
  // Recebido do PEDIDO soma todos os receipts que contam, inclusive os avulsos.
  const recebido = soma(receiptsRaw)
  const somaParcelas = ativas.reduce((s, p) => s + p.valor, 0)
  const vencido = ativas
    .filter(p => p.status === 'VENCIDO')
    .reduce((s, p) => s + p.saldo, 0)

  const proximas = ativas
    .filter(p => p.saldo > CENT && diffDias(hoje, p.vencimento) >= 0)
    .map(p => p.vencimento)
    .sort()

  const cancelado = (pedido.status || '').toUpperCase() === 'CANCELADO'
  const coberto = valorTotal > 0 && recebido >= valorTotal - CENT
  const temVencida = ativas.some(p => p.status === 'VENCIDO')
  // QUITADO exige comprovação: dinheiro cobrindo o pedido E nenhuma parcela
  // presa em "aguardando comprovante/conferência".
  const pendenteComprovacao = ativas.some(p => p.aguardandoComprovante || p.aguardandoConferencia)

  // Regularização CONFIRMADA é terminal e vem antes de tudo, menos cancelamento:
  // é o gestor dizendo "esse aqui já estava pago antes do sistema existir".
  // Fica com nome próprio pra nunca se confundir com QUITADO, que tem comprovante.
  const regularizado = marcas.regularizacao?.status === 'CONFIRMADA'

  const status: StatusPedido = cancelado
    ? 'CANCELADO'
    : regularizado
      ? 'REGULARIZADO'
      : ativas.length === 0
        ? 'SEM_PLANO'
        : coberto
          ? (pendenteComprovacao ? 'AGUARDANDO_CONFERENCIA' : 'QUITADO')
          : temVencida
            ? 'VENCIDO'
            : recebido > CENT
              ? 'PARCIAL'
              : 'EM_DIA'

  return {
    id: pedido.id,
    pedidoNumero: pedido.pedido_numero,
    cliente: pedido.cliente,
    vendedor: pedido.vendedor,
    formaPagamento: pedido.forma_pagamento,
    dataVenda: pedido.data_venda,
    valorTotal,
    recebido,
    aReceber: Math.max(0, valorTotal - recebido),
    vencido,
    proximoVencimento: proximas[0] ?? null,
    qtdParcelas: ativas.length,
    parcelasVencidas: ativas.filter(p => p.status === 'VENCIDO').length,
    boletosPendentes: ativas.filter(p => !p.boletoEnviado && p.saldo > CENT).length,
    pagamentosSemComprovante: parcelas.filter(p => p.aguardandoComprovante).length,
    comprovantesAConferir: parcelas.filter(p => p.aguardandoConferencia).length,
    comprovantesRejeitados: parcelas.filter(p => p.temRejeitado).length,
    status,
    somaParcelas,
    divergenciaPlano: ativas.length > 0 ? somaParcelas - valorTotal : 0,
    producao,
    // "Nada lançado" é sobre o dinheiro, não sobre a parcela: pedido sem plano
    // e sem recebimento também entra na fila de quem precisa registrar. Pedido
    // já regularizado sai da fila — foi resolvido, mesmo que sem receipt.
    semLancamento: receiptsRaw.length === 0 && !regularizado,
    regularizacao: marcas.regularizacao,
    entrega: marcas.entrega,
    parcelas,
  }
}

export function resumoKpis(rows: PedidoFinanceiro[]): Kpis {
  const k: Kpis = {
    totalVendido: 0, totalRecebido: 0, totalAReceber: 0, totalVencido: 0,
    pedidosQuitados: 0, pedidosParciais: 0, pedidosSemPlano: 0, pedidosComVencido: 0,
    pedidosAguardandoConferencia: 0, boletosPendentes: 0, pagamentosSemComprovante: 0,
    comprovantesAConferir: 0, comprovantesRejeitados: 0, planosDivergentes: 0,
    carregadoAReceber: 0, pedidosCarregadosEmAberto: 0,
    naFabricaAReceber: 0, pedidosNaFabrica: 0,
    pedidosCarregadosSemLancamento: 0, valorCarregadoSemLancamento: 0, pedidosSemCard: 0,
    pedidosRegularizados: 0, valorRegularizado: 0, regularizacoesAConfirmar: 0,
  }
  for (const r of rows) {
    if (r.status === 'CANCELADO') continue

    // Pedido regularizado sai da COBRANÇA (não é dívida viva) mas continua no
    // vendido — o faturamento aconteceu. Fica contado à parte pra ninguém
    // confundir "regularizado no mutirão" com "recebido com comprovante".
    if (r.status === 'REGULARIZADO') {
      k.totalVendido += r.valorTotal
      k.totalRecebido += r.recebido
      k.pedidosRegularizados++
      k.valorRegularizado += Math.max(0, r.valorTotal - r.recebido)
      continue
    }

    const emAberto = r.aReceber > CENT
    if (r.producao.etapa === 'CARREGADO') {
      if (emAberto) { k.carregadoAReceber += r.aReceber; k.pedidosCarregadosEmAberto++ }
      if (r.semLancamento) {
        k.pedidosCarregadosSemLancamento++
        k.valorCarregadoSemLancamento += r.valorTotal
      }
    } else if (NA_FABRICA.has(r.producao.etapa)) {
      if (emAberto) { k.naFabricaAReceber += r.aReceber; k.pedidosNaFabrica++ }
    } else if (r.producao.etapa === 'SEM_CARD') {
      k.pedidosSemCard++
    }
    k.totalVendido += r.valorTotal
    k.totalRecebido += r.recebido
    k.totalAReceber += r.aReceber
    k.totalVencido += r.vencido
    k.boletosPendentes += r.boletosPendentes
    k.pagamentosSemComprovante += r.pagamentosSemComprovante
    k.comprovantesAConferir += r.comprovantesAConferir
    k.comprovantesRejeitados += r.comprovantesRejeitados
    if (r.status === 'QUITADO') k.pedidosQuitados++
    if (r.status === 'PARCIAL') k.pedidosParciais++
    if (r.status === 'SEM_PLANO') k.pedidosSemPlano++
    if (r.status === 'VENCIDO') k.pedidosComVencido++
    if (r.status === 'AGUARDANDO_CONFERENCIA') k.pedidosAguardandoConferencia++
    if (Math.abs(r.divergenciaPlano) > CENT) k.planosDivergentes++
    if (r.regularizacao?.status === 'PROPOSTA') k.regularizacoesAConfirmar++
  }
  return k
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate de acesso — decide o RECORTE no servidor
// ─────────────────────────────────────────────────────────────────────────────

/** null em `vendedores` = enxerga tudo (gestor/financeiro). */
export interface Escopo {
  userId: string
  role: string
  displayName: string | null
  vendedores: string[] | null
}

/** Papéis que enxergam a base inteira. `financeiro` é o perfil futuro do spec. */
const PAPEIS_GESTORES = new Set(['admin', 'financeiro'])

export type GateErro =
  | { status: 401; error: 'no_auth' | 'invalid_jwt' }
  | { status: 403; error: 'not_approved' | 'sem_escopo' }
  | { status: 500; error: 'env_missing' }

/**
 * Valida o JWT do CRM e resolve o recorte.
 *
 * Regra (nesta ordem):
 *   admin | financeiro          -> vê tudo
 *   qualquer papel com vendor_id -> vê só os pedidos do próprio vendedor
 *   sem vendor_id                -> 403
 *
 * O segundo caso é o que resolve o Patrick: papel `mapa`, mas com vendor_id
 * apontado ele passa a ver o financeiro dos 12 pedidos dele.
 */
export async function resolverEscopo(authHeader: string | undefined): Promise<Escopo | GateErro> {
  if (!CRM_URL || !CRM_SVC) return { status: 500, error: 'env_missing' }

  const jwt = (authHeader || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { status: 401, error: 'no_auth' }

  const crm = createClient(CRM_URL, CRM_SVC, { auth: { persistSession: false } })
  const { data: u, error: authErr } = await crm.auth.getUser(jwt)
  if (authErr || !u?.user) return { status: 401, error: 'invalid_jwt' }

  const { data: prof } = await crm
    .from('user_profiles')
    .select('role, approved_at, display_name, vendor_id')
    .eq('id', u.user.id)
    .maybeSingle()

  if (!prof || !prof.approved_at || prof.role === 'pending' || prof.role === 'rejected') {
    return { status: 403, error: 'not_approved' }
  }

  const base = { userId: u.user.id, role: prof.role as string, displayName: prof.display_name as string | null }

  if (PAPEIS_GESTORES.has(prof.role as string)) return { ...base, vendedores: null }

  if (!prof.vendor_id) return { status: 403, error: 'sem_escopo' }

  const { data: v } = await crm.from('vendors').select('name').eq('id', prof.vendor_id).maybeSingle()
  const nome = (v?.name as string | undefined)?.trim().toUpperCase()
  if (!nome) return { status: 403, error: 'sem_escopo' }

  return { ...base, vendedores: [nome] }
}

export function ehGateErro(x: Escopo | GateErro): x is GateErro {
  return 'status' in x
}

/**
 * O pedido pertence ao escopo? Casa por NOME, em maiúsculas — é assim que
 * pedidos_venda.vendedor se relaciona com vendors.name (verificado: 9 de 11
 * nomes casam; PATRICK e DANIEL dependem do vendor_id ser apontado).
 * Considera `vendedor_2` (venda em dupla) como pertencimento também.
 */
export function pedidoNoEscopo(p: Pick<PedidoRaw, 'vendedor' | 'vendedor_2'>, esc: Escopo): boolean {
  if (esc.vendedores === null) return true
  const v1 = (p.vendedor || '').trim().toUpperCase()
  const v2 = (p.vendedor_2 || '').trim().toUpperCase()
  return esc.vendedores.includes(v1) || (!!v2 && esc.vendedores.includes(v2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura do controle
// ─────────────────────────────────────────────────────────────────────────────

/** Pagina o REST do controle até o fim (o default do PostgREST corta em 1000). */
export async function lerControle<T>(recurso: string, colunas: string, filtro = ''): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const url = `${CONTROLE_URL}/rest/v1/${recurso}?select=${encodeURIComponent(colunas)}${filtro}&limit=${PAGE}&offset=${offset}`
    const resp = await fetch(url, {
      headers: { apikey: CONTROLE_KEY, Authorization: `Bearer ${CONTROLE_KEY}` },
    })
    if (!resp.ok) throw new Error(`controle ${recurso} ${resp.status}: ${await resp.text()}`)
    const lote = (await resp.json()) as T[]
    out.push(...lote)
    if (lote.length < PAGE) return out
  }
}

export const COLS_PEDIDO =
  'id,pedido_numero,cliente,vendedor,vendedor_2,valor_total,ajuste_valor,status,forma_pagamento,data_venda,payment_plan_json'
export const COLS_PARCELA =
  'id,order_id,installment_no,total_installments,due_date,amount,description,status,canceled,cancellation_reason,boleto_enviado,boleto_enviado_em'
export const COLS_RECEIPT =
  'id,order_id,installment_id,amount,paid_at,payment_method,notes,receipt_url'

/** Data de hoje em São Paulo (o vencimento é uma data civil, não um instante). */
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Só gestor/financeiro confere comprovante, edita plano e reabre parcela (item 6). */
export function ehGestor(role: string): boolean {
  return PAPEIS_GESTORES.has(role)
}

/**
 * Quem pode ALTERAR ou EXCLUIR um recebimento já lançado.
 *
 * Item 6 do spec: o vendedor "não deve excluir pagamentos já confirmados nem
 * alterar valores confirmados sem autorização". Então:
 *
 *   gestor/financeiro          -> sempre
 *   vendedor, AGUARDANDO       -> sim (é o erro de digitação dele, recém-lançado)
 *   vendedor, REJEITADO        -> sim (é o que ele tem que consertar)
 *   vendedor, APROVADO         -> NÃO — dinheiro conferido só o gestor mexe
 */
export function podeAlterarRecebimento(
  role: string,
  conferencia: StatusConferencia,
): { ok: true } | { ok: false; motivo: string } {
  if (ehGestor(role)) return { ok: true }
  if (conferencia === 'APROVADO') {
    return { ok: false, motivo: 'Este pagamento já foi conferido e aprovado. Só o gestor pode alterar ou excluir.' }
  }
  return { ok: true }
}

/** Cliente do CRM com service_role — usado pela camada de gestão (tabelas fin_*). */
export function crmAdmin() {
  return createClient(CRM_URL, CRM_SVC, { auth: { persistSession: false } })
}

/** Carrega as conferências do CRM para os pedidos informados. */
export async function lerConferencias(orderIds: string[]): Promise<Map<string, ConferenciaRaw>> {
  const m = new Map<string, ConferenciaRaw>()
  if (orderIds.length === 0) return m
  const crm = crmAdmin()
  const LOTE = 300 // evita URL gigante no filtro `in`
  for (let i = 0; i < orderIds.length; i += LOTE) {
    const { data, error } = await crm
      .from('fin_conferencias')
      .select('receipt_id, status, motivo, conferido_por_nome, conferido_em')
      .in('order_id', orderIds.slice(i, i + LOTE))
    if (error) throw new Error(`fin_conferencias: ${error.message}`)
    for (const c of (data ?? []) as ConferenciaRaw[]) m.set(c.receipt_id, c)
  }
  return m
}

/** Grava uma linha de auditoria. Nunca derruba a ação principal se falhar. */
export async function auditar(reg: {
  order_id: string
  installment_id?: string | null
  receipt_id?: string | null
  acao: string
  antes?: unknown
  depois?: unknown
  motivo?: string | null
  ator: string
  ator_nome: string | null
  ator_papel: string
}): Promise<void> {
  try {
    await crmAdmin().from('fin_auditoria').insert({
      order_id: reg.order_id,
      installment_id: reg.installment_id ?? null,
      receipt_id: reg.receipt_id ?? null,
      acao: reg.acao,
      antes: reg.antes ?? null,
      depois: reg.depois ?? null,
      motivo: reg.motivo ?? null,
      ator: reg.ator,
      ator_nome: reg.ator_nome,
      ator_papel: reg.ator_papel,
    })
  } catch (e) {
    // auditoria é registro, não guarda: não pode impedir o trabalho de acontecer.
    // Mas tem que APARECER no log — engolir calado já escondeu um 42P10 aqui.
    console.error('[financeiro] falha ao auditar:', (e as Error).message)
  }
}

/**
 * Notifica sem duplicar (item 11). `chave` deduplica por destinatário — o índice
 * único no banco é quem garante, não uma checagem em memória.
 */
export async function notificar(n: {
  destinatarios: string[]
  tipo: string
  titulo: string
  corpo?: string | null
  order_id?: string | null
  installment_id?: string | null
  chave: string
}): Promise<void> {
  if (n.destinatarios.length === 0) return
  try {
    const { error } = await crmAdmin().from('fin_notificacoes').upsert(
      n.destinatarios.map(d => ({
        destinatario: d,
        tipo: n.tipo,
        titulo: n.titulo,
        corpo: n.corpo ?? null,
        order_id: n.order_id ?? null,
        installment_id: n.installment_id ?? null,
        chave_dedupe: n.chave,
      })),
      { onConflict: 'destinatario,chave_dedupe', ignoreDuplicates: true },
    )
    // supabase-js NÃO lança: devolve `error`. Sem checar isso o upsert falha mudo
    // (foi assim que o 42P10 do índice parcial passou batido no primeiro teste).
    if (error) throw new Error(error.message)
  } catch (e) {
    console.error('[financeiro] falha ao notificar:', (e as Error).message)
  }
}

/** Quem são os gestores (para notificar). */
export async function idsDosGestores(): Promise<string[]> {
  const { data } = await crmAdmin()
    .from('user_profiles')
    .select('id')
    .in('role', ['admin', 'financeiro'])
    .not('approved_at', 'is', null)
  return (data ?? []).map(r => r.id as string)
}

/** Quem é o usuário do CRM dono daquele nome de vendedor (para notificar). */
export async function idsDoVendedor(nomeVendedor: string | null): Promise<string[]> {
  if (!nomeVendedor) return []
  const crm = crmAdmin()
  const { data: vs } = await crm.from('vendors').select('id, name')
  const alvo = (vs ?? []).find(v => String(v.name).trim().toUpperCase() === nomeVendedor.trim().toUpperCase())
  if (!alvo) return []
  const { data } = await crm
    .from('user_profiles')
    .select('id')
    .eq('vendor_id', alvo.id)
    .not('approved_at', 'is', null)
  return (data ?? []).map(r => r.id as string)
}

export function agrupar<T>(itens: T[], chave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of itens) {
    const k = chave(it)
    const arr = m.get(k)
    if (arr) arr.push(it)
    else m.set(k, [it])
  }
  return m
}
