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

/** Status derivado da parcela. Derivado, não lido — ver nota em statusParcela(). */
export type StatusParcela =
  | 'CANCELADA'
  | 'PAGO'
  | 'PARCIAL'
  | 'VENCIDO'
  | 'VENCE_HOJE'
  | 'BOLETO_ENVIADO'
  | 'PENDENTE'

export type StatusPedido =
  | 'CANCELADO'
  | 'SEM_PLANO'
  | 'QUITADO'
  | 'VENCIDO'
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
  /** recebeu dinheiro mas nenhum recebimento tem comprovante anexado */
  aguardandoComprovante: boolean
  recebimentos: Recebimento[]
}

export interface Recebimento {
  id: string
  valor: number
  pagoEm: string
  meio: string
  observacao: string | null
  comprovanteUrl: string | null
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
  status: StatusPedido
  /** soma das parcelas ≠ valor do pedido (item 1 do spec) */
  divergenciaPlano: number
  somaParcelas: number
}

export interface Kpis {
  totalVendido: number
  totalRecebido: number
  totalAReceber: number
  totalVencido: number
  pedidosQuitados: number
  pedidosParciais: number
  pedidosSemPlano: number
  pedidosComVencido: number
  boletosPendentes: number
  pagamentosSemComprovante: number
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

/**
 * Status da parcela DERIVADO do dinheiro e da data — nunca lido de
 * order_installments.status.
 *
 * Motivo: o campo do controle é gravado por trigger/edge e envelhece. Em
 * 06/08/2026 havia 96 parcelas marcadas VENCIDO mas 977 PENDENTE, várias delas
 * com vencimento já passado — a data é a verdade, o campo não. `statusControle`
 * fica exposto no retorno pra quem quiser comparar.
 *
 * Precedência: cancelada > pago > parcial > vencido > vence hoje > boleto > pendente.
 */
export function statusParcela(
  p: Pick<ParcelaRaw, 'amount' | 'due_date' | 'canceled' | 'boleto_enviado'>,
  recebido: number,
  hoje: string,
): StatusParcela {
  if (p.canceled) return 'CANCELADA'
  const valor = Number(p.amount) || 0
  if (recebido >= valor - CENT && valor > 0) return 'PAGO'
  if (recebido > CENT) return 'PARCIAL'
  const d = diffDias(hoje, p.due_date)
  if (d < 0) return 'VENCIDO'
  if (d === 0) return 'VENCE_HOJE'
  if (p.boleto_enviado) return 'BOLETO_ENVIADO'
  return 'PENDENTE'
}

/** Agrega um pedido com suas parcelas e recebimentos. Puro — `hoje` é injetado. */
export function agregarPedido(
  pedido: PedidoRaw,
  parcelasRaw: ParcelaRaw[],
  receiptsRaw: ReceiptRaw[],
  hoje: string,
): PedidoFinanceiro & { parcelas: Parcela[] } {
  const valorTotal = devidoDe(pedido)

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
      const recebido = recs.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const valor = Number(p.amount) || 0
      const st = statusParcela(p, recebido, hoje)
      const atraso = diffDias(p.due_date, hoje)
      return {
        id: p.id,
        numero: p.installment_no,
        totalParcelas: p.total_installments,
        descricao: p.description,
        vencimento: p.due_date,
        valor,
        recebido,
        saldo: Math.max(0, valor - recebido),
        status: st,
        statusControle: p.status,
        boletoEnviado: !!p.boleto_enviado,
        boletoEnviadoEm: p.boleto_enviado_em,
        cancelada: !!p.canceled,
        motivoCancelamento: p.cancellation_reason,
        diasAtraso: st === 'VENCIDO' ? Math.max(0, atraso) : 0,
        aguardandoComprovante: recebido > CENT && !recs.some(r => !!r.receipt_url),
        recebimentos: recs.map(r => ({
          id: r.id,
          valor: Number(r.amount) || 0,
          pagoEm: r.paid_at,
          meio: r.payment_method,
          observacao: r.notes,
          comprovanteUrl: r.receipt_url,
        })),
      }
    })

  const ativas = parcelas.filter(p => !p.cancelada)
  // Recebido do PEDIDO soma todos os receipts, inclusive os avulsos.
  const recebido = receiptsRaw.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const somaParcelas = ativas.reduce((s, p) => s + p.valor, 0)
  const vencido = ativas
    .filter(p => p.status === 'VENCIDO')
    .reduce((s, p) => s + p.saldo, 0)

  const proximas = ativas
    .filter(p => p.saldo > CENT && diffDias(hoje, p.vencimento) >= 0)
    .map(p => p.vencimento)
    .sort()

  const cancelado = (pedido.status || '').toUpperCase() === 'CANCELADO'
  const quitado = valorTotal > 0 && recebido >= valorTotal - CENT
  const temVencida = ativas.some(p => p.status === 'VENCIDO')

  const status: StatusPedido = cancelado
    ? 'CANCELADO'
    : ativas.length === 0
      ? 'SEM_PLANO'
      : quitado
        ? 'QUITADO'
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
    status,
    somaParcelas,
    divergenciaPlano: ativas.length > 0 ? somaParcelas - valorTotal : 0,
    parcelas,
  }
}

export function resumoKpis(rows: PedidoFinanceiro[]): Kpis {
  const k: Kpis = {
    totalVendido: 0, totalRecebido: 0, totalAReceber: 0, totalVencido: 0,
    pedidosQuitados: 0, pedidosParciais: 0, pedidosSemPlano: 0, pedidosComVencido: 0,
    boletosPendentes: 0, pagamentosSemComprovante: 0, planosDivergentes: 0,
  }
  for (const r of rows) {
    if (r.status === 'CANCELADO') continue
    k.totalVendido += r.valorTotal
    k.totalRecebido += r.recebido
    k.totalAReceber += r.aReceber
    k.totalVencido += r.vencido
    k.boletosPendentes += r.boletosPendentes
    k.pagamentosSemComprovante += r.pagamentosSemComprovante
    if (r.status === 'QUITADO') k.pedidosQuitados++
    if (r.status === 'PARCIAL') k.pedidosParciais++
    if (r.status === 'SEM_PLANO') k.pedidosSemPlano++
    if (r.status === 'VENCIDO') k.pedidosComVencido++
    if (Math.abs(r.divergenciaPlano) > CENT) k.planosDivergentes++
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
