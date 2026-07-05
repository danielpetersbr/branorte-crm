import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Ficha completa do cliente — cadastro estruturado que complementa o claim da
// carteira do vendedor (aba "Meus" da /prospeccao). Lê/escreve direto na
// tabela public.contacts (colunas aditivas da migração da ficha).
// ============================================================================

export interface FichaContato {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  origin: string | null
  cpf_cnpj: string | null
  empresa: string | null
  endereco: string | null
  animal: string | null
  capacidade: string | null
  cabecas: string | null
  o_que_precisa: string | null
  galpao: string | null
  finalidade: string | null
  quando_investir: string | null
  valor_negociacao: number | null
  proximo_followup: string | null
  forma_pagamento: string | null
  data_orcamento: string | null
  descricao_orcamento: string | null
  notes: string | null
}

const FICHA_COLS =
  'id, name, phone, email, city, state, origin, cpf_cnpj, empresa, endereco, ' +
  'animal, capacidade, cabecas, o_que_precisa, galpao, finalidade, quando_investir, ' +
  'valor_negociacao, proximo_followup, forma_pagamento, data_orcamento, descricao_orcamento, notes'

export function useFichaContato(contactId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['ficha-contato', contactId],
    queryFn: async (): Promise<FichaContato> => {
      const { data, error } = await supabase
        .from('contacts')
        .select(FICHA_COLS)
        .eq('id', contactId!)
        .single()
      if (error) throw error
      return data as unknown as FichaContato
    },
    enabled: enabled && !!contactId,
    staleTime: 15_000,
  })
}

export type FichaPatch = Partial<Omit<FichaContato, 'id' | 'origin' | 'data_orcamento' | 'descricao_orcamento' | 'notes'>>

export function useSalvarFichaContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { contactId: string; patch: FichaPatch }) => {
      const { error } = await supabase
        .from('contacts')
        .update({
          ...args.patch,
          ficha_atualizada_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', args.contactId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ficha-contato'] })
      qc.invalidateQueries({ queryKey: ['prospeccao'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}
