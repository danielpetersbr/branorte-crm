import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface ContactOrcamentoSummary {
  id: number
  ano: number
  numero: string
  status_kanban: string
  mtime_iso: string | null
  path_principal: string
  cliente: string
  equipamento: string | null
}

/**
 * Pra um conjunto de contact_ids visíveis na tela, traz todos os orçamentos
 * de cada um (cruzando `orcamentos_files.contact_id`). Resultado é um Map
 * pra lookup O(1) na renderização.
 *
 * Limitação: o link contact_id ↔ contacts.id foi feito por match de nome
 * (case-insensitive) e cobre 50,5% da base. Contatos não-linkados retornam
 * Map vazio — caller deve cair no fallback do origin.
 */
export function useContactsOrcamentos(contactIds: string[]) {
  // Sort pra cache key estável independente de ordem de entrada.
  const stableKey = [...contactIds].sort().join(',')
  return useQuery({
    queryKey: ['contacts-orcamentos', stableKey],
    queryFn: async () => {
      if (contactIds.length === 0) return new Map<string, ContactOrcamentoSummary[]>()
      const { data, error } = await supabase
        .from('orcamentos_files')
        .select('id, contact_id, ano, numero, status_kanban, mtime_iso, path_principal, cliente, equipamento')
        .in('contact_id', contactIds)
        .order('ano', { ascending: false })
        .order('numero', { ascending: false })
      if (error) throw error
      const map = new Map<string, ContactOrcamentoSummary[]>()
      for (const r of (data ?? []) as Array<ContactOrcamentoSummary & { contact_id: string }>) {
        if (!r.contact_id) continue
        const arr = map.get(r.contact_id) ?? []
        arr.push({
          id: r.id,
          ano: r.ano,
          numero: r.numero,
          status_kanban: r.status_kanban,
          mtime_iso: r.mtime_iso,
          path_principal: r.path_principal,
          cliente: r.cliente,
          equipamento: r.equipamento,
        })
        map.set(r.contact_id, arr)
      }
      return map
    },
    enabled: contactIds.length > 0,
    staleTime: 60_000,
  })
}
