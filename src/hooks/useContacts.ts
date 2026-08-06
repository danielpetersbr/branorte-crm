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

      /*
       * A LISTA manda; o count é acessório.
       *
       * `contatos_page_count` é a RPC lenta do par (COUNT exato sobre ~208k
       * linhas, com JOIN na matview e ILIKE): ela é a candidata natural a
       * estourar statement timeout enquanto a página volta inteira. Jogar aqui
       * transformava "não sei quantos são" em "não consegui carregar nada" — os
       * 50 contatos vinham, eram descartados, e a tela dizia que a busca falhou.
       *
       * `total: null` = total desconhecido. Quem renderiza degrada a paginação
       * (some o "de N", "Próxima" segue enquanto a página vier cheia) em vez de
       * perder a lista.
       */
      const contacts = ((pageRes.data ?? []) as ContactComWa[]).map(r => ({
        ...r,
        // `etiquetas` é jsonb e vem null quando o contato não tem WhatsApp.
        // Normaliza aqui pra quem renderiza poder fazer .map/.filter direto.
        etiquetas: (Array.isArray(r.etiquetas) ? r.etiquetas : []) as WaEtiquetaAplicada[],
      }))

      // Contagem EXATA (a antiga era `count: 'estimated'`, que devolvia ~126k
      // onde havia 208k e cortava a paginação bem antes do fim da lista).
      return { contacts, total: countRes.error ? null : Number(countRes.data ?? 0) }
    },
    placeholderData: (prev) => prev,

    /*
     * Esta tela mostra dado que muda SOZINHO: a etiqueta que o vendedor põe no
     * WhatsApp dele entra na mv_wa_contato_resumo pelo cron (1 em 1 min), sem
     * ninguém clicar em nada. O default do app é `refetchOnWindowFocus: false`
     * (App.tsx), então quem deixasse a aba aberta ficava vendo o retrato do
     * primeiro carregamento até dar F5 — foi exatamente o "não atualizou a
     * etiqueta que ele colocou".
     *
     * Sobrescrito SÓ aqui, não no default global: as outras telas continuam
     * como estavam.
     */
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,   // aba escondida não consulta à toa
    staleTime: 30_000,
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
    mutationFn: async ({ id, ...updates }: {
      id: string
      status?: string
      vendor_id?: string | null
      notes?: string
      /* name/city entraram pra edicao na linha da /contatos. A RLS ja permite:
         contacts_vendor_update libera `vendor_id = current_vendor_id() OR
         vendor_id IS NULL`, e o WITH CHECK identico impede o vendedor de passar
         o contato pra outro. Nao precisou de policy nova. */
      name?: string | null
      city?: string | null
    }) => {
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
