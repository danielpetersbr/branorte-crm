import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeFromPreset } from './useDashboardEtiquetas'
import type { DashboardPreset } from './useDashboard'

export interface CicloVenda {
  chegada_1a_etq_horas: number | null; n_chegada: number
  lead_orcamento_dias: number | null;  n_orcamento: number
  orcamento_vendido_dias: number | null; n_orc_vendido: number
}

// Ciclo de venda = mediana de tempo entre etapas, com TIMESTAMPS REAIS:
// - lead → 1ª etiqueta: wa_etiqueta_movimentos.detectado_em (não o label_changed_at único)
// - lead → orçamento: orcamentos_gerados.created_at
// - orçamento → vendido: mesma coorte (orçou E vendeu)
export function useCicloVenda(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['dashboard-ciclo-venda-v1', preset],
    queryFn: async (): Promise<CicloVenda> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_ciclo_venda', {
        p_from: from.toISOString(), p_to: to.toISOString(),
      })
      if (error) throw error
      const x = (data ?? {}) as Partial<CicloVenda>
      return {
        chegada_1a_etq_horas: x.chegada_1a_etq_horas ?? null, n_chegada: x.n_chegada ?? 0,
        lead_orcamento_dias: x.lead_orcamento_dias ?? null,   n_orcamento: x.n_orcamento ?? 0,
        orcamento_vendido_dias: x.orcamento_vendido_dias ?? null, n_orc_vendido: x.n_orc_vendido ?? 0,
      }
    },
    staleTime: 60_000, refetchInterval: 60_000, placeholderData: prev => prev, retry: 2,
  })
}
