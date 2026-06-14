import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Leads "órfãos" / zumbis no funil: etiqueta NOVO LEAD parada há mais de N dias,
// por vendedor (quem recebeu lead novo e não trabalhou). Janela é por IDADE da
// etiqueta, não pelo filtro de período do dashboard. Daniel (testes) fora na RPC.
export interface OrfaosPorVendedor {
  total: number
  por_vendedor: { vendedor: string; n: number }[]
}

export function useOrfaosPorVendedor(dias = 7) {
  return useQuery({
    queryKey: ['orfaos-vendedor-v1', dias],
    queryFn: async (): Promise<OrfaosPorVendedor> => {
      const { data, error } = await supabase.rpc('dashboard_orfaos_por_vendedor', { p_dias: dias })
      if (error) throw error
      const d = (data ?? {}) as Partial<OrfaosPorVendedor>
      return { total: d.total ?? 0, por_vendedor: d.por_vendedor ?? [] }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
