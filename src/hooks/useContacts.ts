import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Contact, ContactFilters } from '@/types'

const PAGE_SIZE = 50

export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: ['contacts', filters],
    queryFn: async () => {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`)
      }
      if (filters.estado) query = query.eq('state', filters.estado)
      if (filters.vendor_id === 'unassigned') {
        query = query.is('vendor_id', null)
      } else if (filters.vendor_id) {
        query = query.eq('vendor_id', filters.vendor_id)
      }
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.orcamento_ano) {
        query = query.like('origin', `Orcamento ${filters.orcamento_ano}-%`)
        if (filters.orcamento_mes) {
          const m = Number(filters.orcamento_mes)
          const month = String(m).padStart(2, '0')
          const yr = Number(filters.orcamento_ano)
          const nextMonth = m === 12 ? `${yr + 1}-01-01` : `${yr}-${String(m + 1).padStart(2, '0')}-01`
          query = query.gte('data_orcamento', `${yr}-${month}-01`).lt('data_orcamento', nextMonth)
        }
      } else if (filters.orcamento) {
        query = query.like('origin', 'Orcamento%')
      }
      if (filters.temperatura) query = query.like('notes', `%"temp":"${filters.temperatura}"%`)

      const from = filters.page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      query = query.range(from, to)

      const { data, error, count } = await query
      if (error) throw error
      return { contacts: (data ?? []) as Contact[], total: count ?? 0 }
    },
    placeholderData: (prev) => prev,
  })
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: ['contact', id],
    queryFn: async () => {
      if (!id) return null
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Contact
    },
    enabled: !!id,
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; vendor_id?: string | null; notes?: string }) => {
      const { error } = await supabase
        .from('contacts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactIds, vendorId }: { contactIds: string[]; vendorId: string }) => {
      const { error } = await supabase
        .from('contacts')
        .update({ vendor_id: vendorId, updated_at: new Date().toISOString() })
        .in('id', contactIds)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}
