import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Métricas extras do Dashboard (RPC public.dashboard_extra), janela fixa 30 dias
// para as séries. aberto/negociação/avaliação/atendimentos são snapshots.
export interface DashboardExtra {
  orcamentos_por_dia: { dia: string; total: number }[]
  fechados_por_dia: { dia: string; total: number }[]   // não usado na UI (sinal poluído por sync)
  avaliacao: { media: number; total: number; por_nota: { nota: number; qtd: number }[] }
  aberto: { total: number; prospeccao: number; novo_lead: number; follow_up: number; lead_quente: number; em_negociacao: number }
  negociacao: { follow_up: number; lead_quente: number; em_negociacao: number; com_orcamento: number; valor: number; valor_followup: number; com_orcamento_followup: number }
  atendimentos: { hoje: number; ontem: number }
}

export function useDashboardExtra() {
  return useQuery({
    queryKey: ['dashboard-extra-v1'],
    queryFn: async (): Promise<DashboardExtra> => {
      const to = new Date()
      const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0)
      const toExcl = new Date(to); toExcl.setDate(toExcl.getDate() + 1); toExcl.setHours(0, 0, 0, 0)
      const { data, error } = await supabase.rpc('dashboard_extra', {
        p_from: from.toISOString(),
        p_to: toExcl.toISOString(),
      })
      if (error) throw error
      const r = (data ?? {}) as Partial<DashboardExtra>
      const av = r.avaliacao ?? { media: 0, total: 0, por_nota: [] }
      return {
        orcamentos_por_dia: r.orcamentos_por_dia ?? [],
        fechados_por_dia: r.fechados_por_dia ?? [],
        avaliacao: { media: Number(av.media) || 0, total: Number(av.total) || 0, por_nota: (av.por_nota ?? []).map(p => ({ nota: Number(p.nota), qtd: Number(p.qtd) })) },
        aberto: r.aberto ?? { total: 0, prospeccao: 0, novo_lead: 0, follow_up: 0, lead_quente: 0, em_negociacao: 0 },
        negociacao: r.negociacao ?? { follow_up: 0, lead_quente: 0, em_negociacao: 0, com_orcamento: 0, valor: 0, valor_followup: 0, com_orcamento_followup: 0 },
        atendimentos: r.atendimentos ?? { hoje: 0, ontem: 0 },
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
  })
}
