import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Painel por vendedor: funil de etiquetas do WhatsApp + motivos de perda, por vendedor.
// Fonte: RPC dashboard_painel_vendedores (junta atendimentos -> wa_chat_labels ->
// wascript_etiquetas -> categoria). Chaveado pelo vendedor_nome da etiqueta.

export interface VendedorPainel {
  vendedor: string
  contatos: number
  novo: number          // prospecção / lead novo
  follow_up: number
  quente: number        // quente + lead_quente
  orcamento: number     // etiqueta ORÇAMENTO ENVIADO
  vendido: number
  perdido: number
  // motivos de perda
  m_nao_respondeu: number
  m_sem_interesse: number
  m_concorrente: number
  m_so_preco: number
  m_fora_orcamento: number
  m_nao_fabricamos: number
  m_outros: number
}

// '' (Tudo) = últimos 90 dias (igual useDashboardEtiquetas — etiqueta é sinal recente).
function rangeFromPreset(preset: DashboardPreset): { from: Date; to: Date } {
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
