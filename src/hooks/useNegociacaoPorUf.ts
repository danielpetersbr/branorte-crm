import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Leads em NEGOCIAÇÃO (etiqueta follow-up / quente / lead quente / orçamento) por
// estado — pra ver em qual região do país o pipeline está esquentando. UF derivada
// do DDD do telefone na RPC. Janela por estado atual da etiqueta, não por período.
export interface NegociacaoUf {
  uf: string
  total: number
}

export function useNegociacaoPorUf() {
  return useQuery({
    queryKey: ['negociacao-uf-v1'],
    queryFn: async (): Promise<NegociacaoUf[]> => {
      const { data, error } = await supabase.rpc('dashboard_negociacao_por_uf')
      if (error) throw error
      return (data ?? []) as NegociacaoUf[]
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
