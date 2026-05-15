import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface TransportadorFuncao {
  id: number
  nome: string
  nome_curto: string | null
  polos: 4 | 6
  ativo: boolean
  ordem: number
  created_at: string
  updated_at: string
}

export function useTransportadorFuncoes() {
  return useQuery({
    queryKey: ['transportador-funcoes'],
    queryFn: async (): Promise<TransportadorFuncao[]> => {
      const { data, error } = await supabase
        .from('transportador_funcoes')
        .select('*')
        .eq('ativo', true)
        .order('ordem')
        .order('nome')
      if (error) throw error
      return (data ?? []) as TransportadorFuncao[]
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useCriarTransportadorFuncao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { nome: string; nome_curto?: string | null; polos: 4 | 6 }) => {
      const { data, error } = await supabase
        .from('transportador_funcoes')
        .insert({
          nome: input.nome.trim(),
          nome_curto: input.nome_curto?.trim() || null,
          polos: input.polos,
          ativo: true,
          ordem: 100,
        })
        .select()
        .single()
      if (error) throw error
      return data as TransportadorFuncao
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transportador-funcoes'] }),
  })
}

export function useAtualizarTransportadorFuncao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Pick<TransportadorFuncao, 'nome' | 'nome_curto' | 'polos' | 'ordem' | 'ativo'>> }) => {
      const { error } = await supabase.from('transportador_funcoes').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transportador-funcoes'] }),
  })
}

export function useDeletarTransportadorFuncao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      // Soft-delete: marca ativo=false. Preserva integridade pra orçamentos antigos
      // que podem ter referenciado essa função no nome do item.
      const { error } = await supabase.from('transportador_funcoes').update({ ativo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transportador-funcoes'] }),
  })
}
