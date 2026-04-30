import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface FunilStage {
  vendedor: string
  responsavel_user_id: string | null
  total_leads: number
  sem_resposta: number
  ia_atendendo: number
  aguardando_vendedor: number
  vendedor_atendendo: number
  orcamento_enviado: number
  vendido: number
  conversao_pct: number
}

/**
 * Funil de cada vendedor nos últimos N dias.
 * Default 30 dias. Use 7 pra "esta semana", 90 pra trimestre.
 */
export function useFunilPorVendedor(periodoDias = 30) {
  return useQuery({
    queryKey: ['funil-por-vendedor', periodoDias],
    queryFn: async (): Promise<FunilStage[]> => {
      const { data, error } = await supabase.rpc('funil_por_vendedor', {
        p_periodo_dias: periodoDias,
      })
      if (error) throw error
      return (data ?? []).map((r: FunilStage) => ({
        ...r,
        // garantir number (postgres pode retornar string)
        total_leads: Number(r.total_leads),
        sem_resposta: Number(r.sem_resposta),
        ia_atendendo: Number(r.ia_atendendo),
        aguardando_vendedor: Number(r.aguardando_vendedor),
        vendedor_atendendo: Number(r.vendedor_atendendo),
        orcamento_enviado: Number(r.orcamento_enviado),
        vendido: Number(r.vendido),
        conversao_pct: Math.min(Number(r.conversao_pct), 100), // cap em 100%
      }))
    },
    staleTime: 60_000,
  })
}
