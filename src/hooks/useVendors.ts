import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/types'

export function useVendors() {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name')
      if (error) throw error
      return data as Vendor[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
