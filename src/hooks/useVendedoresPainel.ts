import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseCustomRange, type DashboardPreset } from './useDashboard'

// Painel por vendedor: funil de etiquetas do WhatsApp + motivos de perda, por vendedor.
// Fonte: RPC dashboard_painel_vendedores (junta atendimentos -> wa_chat_labels ->
// wascript_etiquetas -> categoria). Chaveado pelo vendedor_nome da etiqueta.

export interface VendedorPainel {
  vendedor: string
  contatos: number
  // funil na ordem da Branorte: prospecção → novo → follow-up (negociação) → quente
  prospeccao: number    // PROSPECCAO / tentativa — vendedor sondando se quer algo Branorte
  novo: number          // NOVO LEAD — confirmou interesse
  follow_up: number     // já é negociação
  quente: number        // LEAD QUENTE / aguardando (exclui prospecção e follow-up)
  orcamento: number     // etiqueta ORÇAMENTO ENVIADO
  vendido: number
  perdido: number
  // motivos de perda — completos (somam o total 'perdido')
  m_nunca_respondeu: number      // nunca engajou
  m_nao_respondeu_mais: number   // sumiu no meio da conversa
  m_sem_interesse: number
  m_so_preco: number
  m_fora_orcamento: number
  m_nao_fabricamos: number       // lead errado: pediu o que a Branorte não faz
  m_concorrente: number
  m_transportadora: number       // lead errado: transportadora, não cliente
  m_suporte: number              // lead errado: suporte técnico, não venda
  m_outros: number
}

// '' (Tudo) = últimos 90 dias (igual useDashboardEtiquetas — etiqueta é sinal recente).
function rangeFromPreset(preset: DashboardPreset): { from: Date; to: Date } {
  const _custom = parseCustomRange(preset)
  if (_custom) return _custom
  const now = new Date()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  if (preset === 'hoje') return { from: sod(now), to: eod(now) }
  if (preset === 'ontem') { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: sod(y), to: eod(y) } }
  if (preset === '7d') { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: sod(f), to: eod(now) } }
  if (preset === '30d') { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: sod(f), to: eod(now) } }
  if (preset === 'mes') return { from: sod(new Date(now.getFullYear(), now.getMonth(), 1)), to: eod(now) }
  const f = new Date(now); f.setDate(f.getDate() - 89)
  return { from: sod(f), to: eod(now) }
}

export function useVendedoresPainel(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['vendedores-painel-v1', preset],
    queryFn: async (): Promise<VendedorPainel[]> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_painel_vendedores', {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error) throw error
      return (data ?? []) as VendedorPainel[]
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
