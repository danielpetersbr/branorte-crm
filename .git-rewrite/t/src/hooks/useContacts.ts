import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Contact, ContactFilters } from '@/types'

const PAGE_SIZE = 50

export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: ['contacts', filters],
    queryFn: async () => {
      const sortKey = filters.sort || 'recente'
      const sortMap: Record<string, { col: string; asc: boolean; nullsFirst?: boolean }> = {
        recente:           { col: 'created_at',     asc: false },
        antigo:            { col: 'created_at',     asc: true },
        nome_az:           { col: 'name',           asc: true,  nullsFirst: false },
        nome_za:           { col: 'name',           asc: false, nullsFirst: false },
        orcamento_recente: { col: 'data_orcamento', asc: false, nullsFirst: false },
        orcamento_antigo:  { col: 'data_orcamento', asc: true,  nullsFirst: false },
        estado_az:         { col: 'state',          asc: true,  nullsFirst: false },
      }
      const so = sortMap[sortKey] ?? sortMap.recente
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order(so.col, { ascending: so.asc, nullsFirst: so.nullsFirst ?? !so.asc })

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
        // Cruza com orcamentos_files: pega contact_ids que têm orçamento neste ano
        // (eventualmente filtrando por mês via mtime_iso). Mais preciso do que parsear
        // origin — o origin no banco é só "Orcamento AAAA" sem o número.
        let orcQ = supabase
          .from('orcamentos_files')
          .select('contact_id')
          .eq('ano', Number(filters.orcamento_ano))
          .not('contact_id', 'is', null)
          .limit(10000)
        if (filters.orcamento_mes) {
          const m = Number(filters.orcamento_mes)
          const month = String(m).padStart(2, '0')
          const yr = Number(filters.orcamento_ano)
          const nextYr = m === 12 ? yr + 1 : yr
          const nextM = m === 12 ? '01' : String(m + 1).padStart(2, '0')
          orcQ = orcQ
            .gte('mtime_iso', `${yr}-${month}-01T00:00:00Z`)
            .lt('mtime_iso', `${nextYr}-${nextM}-01T00:00:00Z`)
        }
        const { data: orcRows, error: orcErr } = await orcQ
        if (orcErr) throw orcErr
        const idsSet = new Set<string>()
        for (const r of (orcRows ?? []) as { contact_id: string | null }[]) {
          if (r.contact_id) idsSet.add(r.contact_id)
        }
        const ids = Array.from(idsSet)
        if (ids.length === 0) {
          return { contacts: [], total: 0 }
        }
        query = query.in('id', ids)
      } else if (filters.orcamento) {
        // Toggle sem ano: catch tanto "Orcamento AAAA" (origin antigo) quanto
        // "Orçamento (auto-link)" / "Orçamento (auto-link bucket)" (stubs criados
        // ao linkar 100% dos orçamentos a contatos).
        query = query.or('origin.ilike.Orcamento%,origin.ilike.Orçamento%')
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
