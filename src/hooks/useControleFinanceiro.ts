import { useQuery } from '@tanstack/react-query'
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

export type StatusPedido = 'CANCELADO' | 'SEM_PLANO' | 'QUITADO' | 'VENCIDO' | 'PARCIAL' | 'EM_DIA'

export type StatusParcela =
  | 'CANCELADA' | 'PAGO' | 'PARCIAL' | 'VENCIDO' | 'VENCE_HOJE' | 'BOLETO_ENVIADO' | 'PENDENTE'

export interface Recebimento {
  id: string
  valor: number
  pagoEm: string
  meio: string
  observacao: string | null
  comprovanteUrl: string | null
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
  status: StatusPedido
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

export interface FinanceiroResposta {
  hoje: string
  escopo: { role: string; vendedores: string[] | null }
  kpis: Kpis
  pedidos: PedidoFinanceiro[]
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
      const r = await chamar<{ hoje: string; pedido: PedidoDetalhe }>(`?pedido_id=${encodeURIComponent(pedidoId!)}`)
      return r.pedido
    },
    enabled: !!pedidoId,
    staleTime: 30_000,
  })
}
