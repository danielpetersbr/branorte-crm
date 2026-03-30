import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Note } from '@/types'

export function useNotes(contactId: number | null) {
  return useQuery({
    queryKey: ['notes', contactId],
    queryFn: async () => {
      if (!contactId) return []
      const { data, error } = await supabase
        .from('notes')
        .select('*, vendors(name)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Note[]
    },
    enabled: !!contactId,
  })
}

export function useAddNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactId, vendorId, content }: { contactId: number; vendorId: string; content: string }) => {
      const { error } = await supabase.from('notes').insert({
        contact_id: contactId,
        vendor_id: vendorId,
        content,
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', vars.contactId] })
    },
  })
}
