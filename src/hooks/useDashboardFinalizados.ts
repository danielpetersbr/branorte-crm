import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeForPreset, type DashboardPreset } from './useDashboard'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'

// Atendimentos FINALIZADOS no período, por motivo = a etiqueta de encerramento que foi colocada no WhatsApp (21/10/2026, Daniel).
// RPC dashboard_finalizados lê o resumo dash_fechamentos_dia (supabase/migrations/20261021130000_dashboard_finalizados.sql):
// só troca de etiqueta de verdade, cada conversa pela primeira vez que chegou na etiqueta de encerramento.

export interface MotivoFinalizado { motivo: string; total: number; ana: number }
export interface Finalizados { total: number; ana: number; porMotivo: MotivoFinalizado[]; lidoAte: string | null }

const num = (v: unknown) => Number(v) || 0

export function useDashboardFinalizados(preset: DashboardPreset) {
  return useQuery({
    queryKey: ['dashboard-finalizados-v1', preset],
    queryFn: async (): Promise<Finalizados | null> => {
      const { data, error } = await supabase.rpc('dashboard_finalizados', paramsRpcPeriodo(rangeForPreset(preset, new Date())))
      if (error) throw error
      if (!data) return null
      const d = data as Record<string, unknown>
      return {
        total: num(d.total),
        ana: num(d.ana),
        porMotivo: ((d.por_motivo ?? []) as Record<string, unknown>[])
          .map(r => ({ motivo: String(r.motivo ?? ''), total: num(r.total), ana: num(r.ana) }))
          .filter(r => r.motivo && r.total > 0),
        lidoAte: typeof d.lido_ate === 'string' ? d.lido_ate : null,
      }
    },
    // o resumo é alimentado a cada 2 min
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
