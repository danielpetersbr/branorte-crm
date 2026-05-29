import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const { count: total } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
      const { count: assigned } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).not('vendor_id', 'is', null)
      const unassigned = (total ?? 0) - (assigned ?? 0)

      // By vendor
      const { data: vendorRows } = await supabase.from('vendors').select('id, name')
      const byVendor: { vendor_name: string; vendor_id: string; count: number }[] = []
      for (const v of vendorRows ?? []) {
        const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('vendor_id', v.id)
        if ((count ?? 0) > 0) {
          byVendor.push({ vendor_name: v.name, vendor_id: v.id, count: count ?? 0 })
        }
      }
      byVendor.sort((a, b) => b.count - a.count)

      // By state
      const { data: stateRows } = await supabase.from('contacts').select('state')
      const stateCounts: Record<string, number> = {}
      for (const r of stateRows ?? []) {
        const s = (r as any).state
        if (s) stateCounts[s] = (stateCounts[s] ?? 0) + 1
      }
      const byState = Object.entries(stateCounts)
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count)

      return {
        stats: { total: total ?? 0, assigned: assigned ?? 0, unassigned, states: byState.length },
        byState,
        byVendor,
      }
    },
    staleTime: 60_000,
  })
}
