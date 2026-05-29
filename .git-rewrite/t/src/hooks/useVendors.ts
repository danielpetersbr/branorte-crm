import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types'

/**
 * Vendors ativos (default). Lucas marcado ativo=false pra não aparecer nos
 * dropdowns de atribuição, mas histórico de orçamentos linkados a ele permanece.
 */
export function useVendors(opts: { incluirInativos?: boolean } = {}) {
  return useQuery({
    queryKey: ['vendors', opts.incluirInativos ? 'all' : 'ativos'],
    queryFn: async () => {
      let q = supabase.from('vendors').select('*').order('name')
      if (!opts.incluirInativos) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw error
      return data as Vendor[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
