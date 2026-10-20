import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TIMES_DEF, type AtividadeTime } from '@/lib/dashboard-times'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'
import { rangeForPreset, type DashboardPreset } from './useDashboard'
import { useAuth } from './useAuth'

export function useDashboardTimes(preset: DashboardPreset) {
  const userId = useAuth().session?.user.id
  return useQuery({
    queryKey: ['dashboard-times-atividade', userId, preset],
    enabled: !!userId,
    queryFn: async ({ signal }): Promise<AtividadeTime[]> => {
      const { data, error } = await supabase.rpc('dashboard_times_atividade', {
        ...paramsRpcPeriodo(rangeForPreset(preset, new Date())),
        p_times: TIMES_DEF,
      }).abortSignal(signal)
      if (error) throw error
      const rows = (data ?? []) as AtividadeTime[]
      // Ausência de um time é resposta incompleta, não atividade zero.
      if (TIMES_DEF.some(t => !rows.some(r => r.time_nome === t.nome))) {
        throw new Error('Não foi possível carregar a atividade de todos os times.')
      }
      return rows
    },
    staleTime: 45_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}
