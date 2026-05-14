import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface PrecoBranorte {
  id: number
  categoria: string
  subcategoria: string | null
  codigo: string | null
  modelo: string | null
  descricao: string
  capacidade: string | null
  potencia: string | null
  motor_cv: number | null
  motor_polos: number | null
  valor_equipamento: number | null
  valor_com_motor_trif: number | null
  valor_com_motor_mono: number | null
  valor_com_motorredutor: number | null
  dimensoes: string | null
  observacoes: string | null
  origem_aba: string | null
  ordem: number
  ativo: boolean
  created_at: string
  updated_at: string
}

export function usePrecosBranorte() {
  return useQuery({
    queryKey: ['precos-branorte'],
    queryFn: async (): Promise<PrecoBranorte[]> => {
      const { data, error } = await supabase
        .from('precos_branorte')
        .select('*')
        .eq('ativo', true)
        .order('categoria')
        .order('subcategoria', { nullsFirst: true })
        .order('ordem')
      if (error) throw error
      return (data ?? []) as PrecoBranorte[]
    },
    staleTime: 60 * 1000,
  })
}

export function useUpdatePrecoBranorte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<PrecoBranorte> }) => {
      const { error } = await supabase
        .from('precos_branorte')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['precos-branorte'] }),
  })
}
