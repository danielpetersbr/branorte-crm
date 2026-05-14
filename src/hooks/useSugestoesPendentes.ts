import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface SugestaoPendente {
  id: number
  nome_curto: string
  categoria: string
  valor: number
  motor_padrao_cv: number | null
  motor_padrao_polos: number | null
  motor_id: number | null
  specs: string[]
  descricao: string | null
  status: 'pending' | 'approved' | 'rejected'
  criado_por: string | null
  criado_por_email: string | null
  orcamento_origem_numero: string | null
  catalogo_item_id: number | null
  motivo_rejeicao: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

// Lista sugestoes pendentes (default) ou inclui todas se incluirRevisadas=true
export function useSugestoesPendentes(incluirRevisadas = false) {
  return useQuery({
    queryKey: ['sugestoes-pendentes', incluirRevisadas],
    queryFn: async (): Promise<SugestaoPendente[]> => {
      let q = supabase
        .from('catalogo_items_pendentes')
        .select('*')
        .order('created_at', { ascending: false })
      if (!incluirRevisadas) {
        q = q.eq('status', 'pending')
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as SugestaoPendente[]
    },
    staleTime: 30 * 1000,  // 30s — revalida ao mudar de aba
  })
}

// Aprova: chama RPC que copia pra catalogo_items + marca status='approved'
export function useAprovarSugestao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<number> => {
      const { data, error } = await supabase.rpc('aprovar_item_pendente', { p_pendente_id: id })
      if (error) throw error
      return data as number  // id do item criado em catalogo_items
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sugestoes-pendentes'] })
      qc.invalidateQueries({ queryKey: ['catalogo-items'] })
      qc.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

export function useRejeitarSugestao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: number; motivo: string }) => {
      const { error } = await supabase
        .from('catalogo_items_pendentes')
        .update({
          status: 'rejected',
          motivo_rejeicao: motivo,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sugestoes-pendentes'] })
    },
  })
}

export function useContadorSugestoesPendentes() {
  return useQuery({
    queryKey: ['sugestoes-pendentes-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('catalogo_items_pendentes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (error) throw error
      return count ?? 0
    },
    staleTime: 60 * 1000,
  })
}
