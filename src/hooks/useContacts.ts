import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PAGE_SIZE, type Contact, type ContactFilters } from '@/types'
import type { WaEtiquetaAplicada, WaResumoCampos } from '@/hooks/useWaResumo'

/**
 * Linha de `contatos_page`: as 31 colunas de `contacts` + o resumo do WhatsApp
 * (etiquetas, último contato, quem falou) já embutido, via LEFT JOIN com a
 * matview. Como os campos de WA vêm na própria linha, a tela NÃO precisa de uma
 * segunda chamada (`wa_resumo_por_telefone`) pra pintar as colunas.
 *
 * Atenção ao `ultimo_contato`: em `Contact` ele é campo-fantasma (não existe na
 * tabela); aqui ele vem da matview e significa "última mensagem no WhatsApp".
 */
export type ContactComWa = Contact & WaResumoCampos

/** Args compartilhados por `contatos_page` e `contatos_page_count`.
 *  O count PRECISA receber `p_sort`: ordenar por último contato liga o JOIN com
 *  a matview na RPC, o que muda o universo contado (só quem tem WhatsApp). */
function rpcArgs(filters: ContactFilters) {
  return {
    p_search:             filters.search || null,
    p_estado:             filters.estado || null,
    // 'unassigned' é entendido pela RPC (vendor_id IS NULL); '' = qualquer um.
    p_vendor_id:          filters.vendor_id || null,
    p_status:             filters.status || null,
    p_orcamento_ano:      filters.orcamento_ano ? Number(filters.orcamento_ano) : null,
    p_orcamento_mes:      filters.orcamento_mes ? Number(filters.orcamento_mes) : null,
    // A RPC ignora `p_orcamento` quando há ano — mesma precedência do código
    // antigo (`if ano ... else if orcamento`), então dá pra mandar os dois.
    p_orcamento:          !!filters.orcamento,
    p_temperatura:        filters.temperatura || null,
    p_com_whatsapp:       !!filters.com_whatsapp,
    p_etiqueta:           filters.etiqueta || null,
    p_esperando_resposta: !!filters.esperando_resposta,
    p_sort:               filters.sort || 'recente',
  }
}

export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: ['contacts', filters],
    queryFn: async () => {
      const args = rpcArgs(filters)
      // Página e contagem em paralelo: são duas RPCs independentes e a contagem
      // é a mais lenta das duas (~150ms no pior caso medido).
      const [pageRes, countRes] = await Promise.all([
        supabase.rpc('contatos_page', {
          ...args,
          p_limit: PAGE_SIZE,
          p_offset: filters.page * PAGE_SIZE,
        }),
        supabase.rpc('contatos_page_count', args),
      ])
      if (pageRes.error) throw pageRes.error
      if (countRes.error) throw countRes.error

      const contacts = ((pageRes.data ?? []) as ContactComWa[]).map(r => ({
        ...r,
        // `etiquetas` é jsonb e vem null quando o contato não tem WhatsApp.
        // Normaliza aqui pra quem renderiza poder fazer .map/.filter direto.
        etiquetas: (Array.isArray(r.etiquetas) ? r.etiquetas : []) as WaEtiquetaAplicada[],
      }))

      // Contagem EXATA (a antiga era `count: 'estimated'`, que devolvia ~126k
      // onde havia 208k e cortava a paginação bem antes do fim da lista).
      return { contacts, total: Number(countRes.data ?? 0) }
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
