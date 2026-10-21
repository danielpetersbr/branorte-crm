import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Série "Qualificados" da Evolução diária (21/10/2026, auditoria): a mesma régua do card Qualificados e da etapa Qualificou do
 * funil (dashboard_funil_union — a Ana passou pro vendedor, o robô qualificou ou o vendedor pôs etiqueta de avanço), por dia de
 * Brasília. Antes a série usava a régua antiga do robô e mostrava 20 num dia em que o funil dizia 41.
 */
export interface QualificadosDia { dia: string; entrou: number; qualificou: number }

export function useQualificadosPorDia(j: { from: string; to: string | null }) {
  return useQuery({
    queryKey: ['dashboard-qualificados-por-dia-v1', j.from, j.to],
    queryFn: async (): Promise<QualificadosDia[]> => {
      const { data, error } = await (supabase as any).rpc('dashboard_qualificados_por_dia', { p_from: j.from, p_to: j.to })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map(r => ({
        dia: String(r.dia).slice(0, 10),
        entrou: Number(r.entrou) || 0,
        qualificou: Number(r.qualificou) || 0,
      }))
    },
    staleTime: 2 * 60_000,
    refetchInterval: 3 * 60_000,
    retry: 1,
  })
}
