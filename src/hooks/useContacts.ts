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
    // `p_orcamento` = TEM arquivo vinculado em orcamentos_files.
    // Até 18/08/2026 isto filtrava `origin ILIKE 'Orcamento%'` — a origem da
    // importação, não o orçamento. O ano continua sendo um recorte à parte e
    // pode ir junto.
    p_orcamento:          !!filters.orcamento,
    // NÃO tem orçamento nenhum. É o que faz o filtro "sem vendedor e sem
    // orçamento" ser respondível numa consulta só.
    p_sem_orcamento:      !!filters.sem_orcamento,
    p_temperatura:        filters.temperatura || null,
    p_com_whatsapp:       !!filters.com_whatsapp,
    p_etiqueta:           filters.etiqueta || null,
    p_esperando_resposta: !!filters.esperando_resposta,
    p_sort:               filters.sort || 'recente',
    p_faixa:              filters.faixa || null,
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
      /* name/city entraram pra edicao na linha da /contatos.
         ATENCAO: `contacts_vendor_update` NAO e mais `vendor_id = current_vendor_id()
         OR vendor_id IS NULL` (o comentario antigo aqui descrevia a policy velha e
         estava mentindo). Hoje ela exige, pro contato sem dono,
         `contato_no_pool(id) AND NOT contato_tem_claim_de_outro(id)` — e 10.235 dos
         173.725 sem dono estao FORA do pool (ter orcamento e justamente o que tira). */
      name?: string | null
      city?: string | null
    }) => {
      /*
       * `.select('id')` NAO e decoracao — e o unico jeito de saber se a linha existiu.
       *
       * Quando a RLS nao casa nenhuma linha, o UPDATE nao e um erro: o PostgREST
       * devolve 204 com `error = null`. O `if (error) throw` nunca disparava, o
       * `falhou[id]` da tela (Contacts.tsx:361/367) nunca acendia, e o vendedor via o
       * campo simplesmente VOLTAR ao valor antigo — sem X vermelho, sem aviso. Ele
       * concluia que "a tela nao salva". Pior no filtro "Sem vendedor (todos)": sob o
       * sort padrao, as 50 linhas da primeira pagina sao todas bloqueadas.
       */
      const { data, error } = await supabase
        .from('contacts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('Este contato nao e seu — use "Pegar pra mim" antes de editar.')
      }
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
      /*
       * Mesmo silencio do useUpdateContact, so que aqui o fracasso e PARCIAL: dos N
       * selecionados a RLS pode casar so alguns, e sem `.select()` o 204 dizia "todos
       * atribuidos". Quem selecionava 50 e via 12 mudarem de dono achava que a tela
       * tinha bugado. Compara o que voltou com o que foi pedido e conta a diferenca.
       */
      const { data, error } = await supabase
        .from('contacts')
        .update({ vendor_id: vendorId, updated_at: new Date().toISOString() })
        .in('id', contactIds)
        .select('id')
      if (error) throw error
      const aplicados = data?.length ?? 0
      if (aplicados < contactIds.length) {
        const fora = contactIds.length - aplicados
        throw new Error(
          `${aplicados} de ${contactIds.length} atribuidos. ${fora} ficaram de fora ` +
          `(ja tem dono, tem orcamento ou estao reservados por outro vendedor).`
        )
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}
