import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todasAsLinhas } from '@/lib/rpc-paginado'
import { indexarEtiquetasOrcamentos, opcoesEtiquetasOrcamentos, vendedorEtiqueta, type EtiquetaOrcamentoWa, type ChatOrcamentoWa } from '@/lib/orcamentos-etiquetas'
import { useAuth } from './useAuth'

export function useOrcamentosEtiquetas(vendedor: string) {
  const userId = useAuth().session?.user.id
  const vendedorWa = vendedorEtiqueta(vendedor)
  return useQuery({
    queryKey: ['orcamentos-etiquetas-wa', userId, vendedorWa],
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const [catalogo, chats] = await Promise.all([
        todasAsLinhas<EtiquetaOrcamentoWa>(async (de, ate) => {
          let q = supabase.from('wascript_etiquetas')
            .select('vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado', { count: 'exact' })
            .order('id').range(de, ate).abortSignal(signal)
          if (vendedorWa) q = q.eq('vendedor_nome', vendedorWa)
          const { data, error, count } = await q
          if (error) throw error
          return { linhas: (data ?? []) as EtiquetaOrcamentoWa[], total: count }
        }, 500),
        todasAsLinhas<ChatOrcamentoWa>(async (de, ate) => {
          let q = supabase.from('wa_chat_labels')
            .select('vendedor_nome,phone,label_ids', { count: 'exact' })
            .order('vendedor_nome').order('phone').range(de, ate).abortSignal(signal)
          if (vendedorWa) q = q.eq('vendedor_nome', vendedorWa)
          const { data, error, count } = await q
          if (error) throw error
          return { linhas: (data ?? []) as ChatOrcamentoWa[], total: count }
        }, 500),
      ])
      return { catalogo, indice: indexarEtiquetasOrcamentos(catalogo, chats), opcoes: opcoesEtiquetasOrcamentos(catalogo) }
    },
  })
}
