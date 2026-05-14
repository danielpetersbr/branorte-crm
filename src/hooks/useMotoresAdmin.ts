import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface MotorAdmin {
  id: number
  cv: number
  polos: number
  voltagem: 'monofasico' | 'trifasico'
  modelo: string | null
  valor: number
  ativo: boolean
  ocorrencias: number
  created_at: string
  updated_at: string
}

export interface MotorRedutorAdmin {
  id: number
  modelo: string
  cv_compativel: string[]
  cv_min: number
  cv_max: number
  valor: number
  ativo: boolean
  ordem: number
}

// Lista TODOS os motores (ativos + inativos) para gerenciamento
export function useMotoresAdmin() {
  return useQuery({
    queryKey: ['motores-admin'],
    queryFn: async (): Promise<MotorAdmin[]> => {
      const { data, error } = await supabase
        .from('catalogo_motores')
        .select('*')
        .order('voltagem')
        .order('polos')
        .order('cv')
      if (error) throw error
      return (data ?? []) as MotorAdmin[]
    },
    staleTime: 30 * 1000,
  })
}

export function useMotoresRedutorAdmin() {
  return useQuery({
    queryKey: ['motorredutor-admin'],
    queryFn: async (): Promise<MotorRedutorAdmin[]> => {
      const { data, error } = await supabase
        .from('catalogo_motorredutor')
        .select('*')
        .order('ordem')
      if (error) throw error
      return (data ?? []) as MotorRedutorAdmin[]
    },
    staleTime: 30 * 1000,
  })
}

export function useUpdateMotor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<MotorAdmin> }) => {
      const { error } = await supabase
        .from('catalogo_motores')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['motores-admin'] })
      qc.invalidateQueries({ queryKey: ['catalogo-motores'] })  // re-fetch no Montar
    },
  })
}

export function useUpdateMotorRedutor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<MotorRedutorAdmin> }) => {
      const { error } = await supabase
        .from('catalogo_motorredutor')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['motorredutor-admin'] })
    },
  })
}
