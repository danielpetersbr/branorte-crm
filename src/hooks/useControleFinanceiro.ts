import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ───────────────────────────────────────────────────────────────────────────
// Financeiro · Recebíveis.
//
// Lê de /api/financeiro, que por sua vez lê AO VIVO do controle.branorte.com.
//
// Antes lia `mirror_pedidos_venda` direto e derivava "a receber" de
// valor_total − valor_pago. O problema: `valor_pago` está ZERADO nos 450
// pedidos e `status_pagamento` é 'PENDENTE' em 100% deles — as colunas nunca
// foram preenchidas. O dinheiro recebido de verdade vive em `receipts` no
// controle (R$ 1,18 mi em 72 recebimentos), que nunca foi espelhado. Por isso
// o card "Recebido" mostrava R$ 0.
//
// O recorte por vendedor é feito NO SERVIDOR. Não dá pra fazer aqui: a anon
// key do controle é pública, então filtro no cliente seria decorativo.
// ───────────────────────────────────────────────────────────────────────────

export type StatusPedido =
  | 'CANCELADO' | 'SEM_PLANO' | 'QUITADO' | 'REGULARIZADO' | 'VENCIDO'
  | 'AGUARDANDO_CONFERENCIA' | 'PARCIAL' | 'EM_DIA'

/** Onde o equipamento está na fábrica. Vem de producao_cards (Controle de Produção). */
export type EtapaFabrica =
  | 'ANTES_DO_CHAO' | 'FABRICANDO' | 'PRONTO' | 'CARREGADO' | 'CANCELADO' | 'SEM_CARD'

export interface Producao {
  etapa: EtapaFabrica
  statusCru: string | null
  desde: string | null
}

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

export type StatusParcela =
  | 'CANCELADA' | 'PAGO' | 'AGUARDANDO_CONFERENCIA' | 'AGUARDANDO_COMPROVANTE'
  | 'PARCIAL' | 'VENCIDO' | 'VENCE_HOJE' | 'BOLETO_ENVIADO' | 'PENDENTE'

export type StatusConferencia = 'AGUARDANDO' | 'APROVADO' | 'REJEITADO'

export interface Recebimento {
  id: string
  valor: number
  pagoEm: string
  meio: string
  observacao: string | null
  comprovanteUrl: string | null
  conferencia: StatusConferencia
  motivoRejeicao: string | null
  conferidoPor: string | null
  conferidoEm: string | null
}

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
  statusControle: string | null
  boletoEnviado: boolean
  boletoEnviadoEm: string | null
  cancelada: boolean
  motivoCancelamento: string | null
  diasAtraso: number
  aguardandoComprovante: boolean
  aguardandoConferencia: boolean
  temRejeitado: boolean
  recebimentos: Recebimento[]
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
  divergenciaPlano: number
  somaParcelas: number
  producao: Producao
  semLancamento: boolean
  regularizacao: Regularizacao | null
  entrega: Entrega | null
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
  pedidosAguardandoConferencia: number
  boletosPendentes: number
  pagamentosSemComprovante: number
  comprovantesAConferir: number
  comprovantesRejeitados: number
  planosDivergentes: number
  carregadoAReceber: number
  pedidosCarregadosEmAberto: number
  naFabricaAReceber: number
  pedidosNaFabrica: number
  pedidosCarregadosSemLancamento: number
  valorCarregadoSemLancamento: number
  pedidosSemCard: number
  pedidosRegularizados: number
  valorRegularizado: number
  regularizacoesAConfirmar: number
}

export interface ResumoVendedor {
  vendedor: string
  pedidos: number
  vendido: number
  recebido: number
  aReceber: number
  vencido: number
  parcelasVencidas: number
  semComprovante: number
  aConferir: number
  boletosPendentes: number
  semPlano: number
  divergentes: number
  carregadoAReceber: number
  semLancamento: number
}

export interface Escopo { role: string; vendedores: string[] | null; gestor: boolean }

export interface FinanceiroResposta {
  hoje: string
  escopo: Escopo
  kpis: Kpis
  pedidos: PedidoFinanceiro[]
  vendedores: ResumoVendedor[] | null
}

export interface EventoAuditoria {
  id: number
  acao: string
  motivo: string | null
  ator_nome: string | null
  ator_papel: string | null
  created_at: string
}

/** Erro com a mensagem que a tela deve mostrar (o endpoint manda `detail`). */
export class FinanceiroErro extends Error {
  constructor(public codigo: string, mensagem: string) { super(mensagem) }
}

async function chamar<T>(qs: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new FinanceiroErro('no_auth', 'Sessão expirada — faça login novamente.')

  const resp = await fetch(`/api/financeiro${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || !json.ok) {
    const codigo = json.error || `http_${resp.status}`
    const msg =
      json.detail ||
      (codigo === 'controle_indisponivel' ? 'Não consegui falar com o controle.branorte.com agora.'
        : codigo === 'fora_do_escopo' ? 'Esse pedido não é seu.'
        : codigo === 'not_approved' ? 'Seu usuário ainda não foi aprovado.'
        : `Falha ao carregar o financeiro (${codigo}).`)
    throw new FinanceiroErro(codigo, msg)
  }
  return json as T
}

export function useControleFinanceiro() {
  return useQuery({
    queryKey: ['controle-financeiro'],
    queryFn: () => chamar<FinanceiroResposta>(''),
    staleTime: 60_000,
    retry: (n, err) => !(err instanceof FinanceiroErro && ['no_auth', 'sem_escopo', 'not_approved'].includes(err.codigo)) && n < 2,
  })
}

export interface PedidoDetalhe extends PedidoFinanceiro {
  parcelas: Parcela[]
}

export function useControleFinanceiroPedido(pedidoId: string | null) {
  return useQuery({
    queryKey: ['controle-financeiro', 'pedido', pedidoId],
    queryFn: async () => {
      const r = await chamar<{ hoje: string; escopo: Escopo; pedido: PedidoDetalhe; historico: EventoAuditoria[] }>(
        `?pedido_id=${encodeURIComponent(pedidoId!)}`)
      return r
    },
    enabled: !!pedidoId,
    staleTime: 15_000,
  })
}

// ── Ações (escrita) ─────────────────────────────────────────────────────────

export interface ArquivoUpload { nome: string; tipo: string; base64: string }

export type AcaoFinanceiro =
  | { acao: 'lancar_pagamento'; order_id: string; installment_id: string | null; valor: number
      pago_em: string; meio: string; observacao?: string; arquivo?: ArquivoUpload }
  | { acao: 'anexar_comprovante'; order_id: string; receipt_id: string; arquivo: ArquivoUpload }
  | { acao: 'confirmar_boleto'; order_id: string; installment_id: string; meio: string
      observacao?: string; arquivo?: ArquivoUpload }
  | { acao: 'conferir'; order_id: string; receipt_id: string; status: 'APROVADO' | 'REJEITADO'; motivo?: string }
  | { acao: 'editar_pagamento'; order_id: string; receipt_id: string; valor?: number
      pago_em?: string; meio?: string; observacao?: string; motivo?: string }
  | { acao: 'excluir_pagamento'; order_id: string; receipt_id: string; motivo?: string }
  | { acao: 'propor_regularizacao'; order_id: string; motivo: string }
  | { acao: 'decidir_regularizacao'; order_id: string; status: 'CONFIRMADA' | 'RECUSADA'; motivo?: string }
  | { acao: 'confirmar_entrega'; order_id: string; entregue_em: string; observacao?: string }

/**
 * Teto REAL de upload: a Vercel corta o corpo da requisição em 4,5 MB, e base64
 * ainda engorda o arquivo em ~33%. A tela dizia "até 8 MB" e a foto de celular
 * simplesmente falhava. Aqui o limite é honesto — e imagem grande é reduzida
 * antes de sair do navegador, então na prática o vendedor não esbarra nele.
 */
export const LIMITE_UPLOAD_BYTES = 3 * 1024 * 1024

const LADO_MAXIMO = 2000    // px: legível pra ler um comprovante, leve pra subir
const ALVO_COMPRESSAO = 900 * 1024

/** Reduz foto grande no próprio navegador. PDF passa direto — não dá pra redimensionar. */
async function comprimirImagem(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= ALVO_COMPRESSAO) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.82))
    // Se comprimir não ajudou (já era JPEG otimizado), fica com o original.
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file   // navegador sem createImageBitmap: segue com o arquivo original
  }
}

/** Lê um File como base64, do jeito que o endpoint espera — comprimindo antes se for foto. */
export async function lerArquivo(file: File): Promise<ArquivoUpload> {
  const pronto = await comprimirImagem(file)
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    fr.onload = () => resolve({
      nome: pronto.name,
      tipo: pronto.type,
      base64: String(fr.result).replace(/^data:[^,]+,/, ''),
    })
    fr.readAsDataURL(pronto)
  })
}

export function useAcaoFinanceiro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: AcaoFinanceiro) => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new FinanceiroErro('no_auth', 'Sessão expirada — faça login novamente.')

      const resp = await fetch('/api/financeiro-acao', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.ok) {
        throw new FinanceiroErro(json.error || `http_${resp.status}`, json.detail || json.error || 'A ação falhou.')
      }
      return json as { ok: true; receipt_id?: string; comprovante_url?: string }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['controle-financeiro'] }) },
  })
}
