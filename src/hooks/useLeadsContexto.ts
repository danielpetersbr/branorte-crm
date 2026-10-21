import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'
import { rangeForPreset, type DashboardPreset } from './useDashboard'

/**
 * Contexto do tile "Leads" (21/10/2026, auditoria pedida pelo Daniel: "as 53 hoje… mas chegou 72").
 * O tile conta cliente NOVO que virou linha no CRM; o "Hoje" de /atendimentos conta quem mandou mensagem (inclui cliente
 * antigo). A RPC dashboard_leads_contexto dá, na mesma janela:
 *   voltaram = cliente que já estava no CRM antes do período e conversou no período;
 *   comAna   = conversa nova que a Ana abriu no período e ainda atende, sem linha no CRM (entra quando ela repassar).
 */
export interface LeadsContexto { voltaram: number; comAna: number }

export function useLeadsContexto(preset: DashboardPreset) {
  return useQuery({
    queryKey: ['dashboard-leads-contexto-v1', preset],
    queryFn: async (): Promise<LeadsContexto | null> => {
      const { data, error } = await (supabase as any).rpc('dashboard_leads_contexto', paramsRpcPeriodo(rangeForPreset(preset, new Date())))
      if (error) throw error
      if (!data) return null
      const d = data as Record<string, unknown>
      return { voltaram: Number(d.voltaram) || 0, comAna: Number(d.com_ana) || 0 }
    },
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
