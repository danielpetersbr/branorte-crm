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

// Quais motores um equipamento consegue de fato selecionar.
// Um motor é alcançável por (a) numero de polos que alguma fonte de preço/função pede,
// ou (b) ser apontado direto por catalogo_items.motor_id.
// Fontes: precos_branorte.motor_polos/_2, transportador_funcoes.polos,
//         catalogo_items.motor_padrao_polos e catalogo_items.motor_id.
export interface AlcanceMotores {
  polos: number[]
  motorIds: number[]
}

// Teto do supabase-js. Se uma consulta voltar no teto ela pode estar truncada,
// e um conjunto truncado geraria contagem de orfaos ERRADA - entao falhamos alto
// em vez de mostrar numero mentiroso. catalogo_items tem >1000 linhas no total,
// por isso as consultas dele vao filtradas por coluna nao-nula.
const LIMITE_LINHAS = 1000

export function useAlcanceMotores() {
  return useQuery({
    queryKey: ['motores-alcance'],
    queryFn: async (): Promise<AlcanceMotores> => {
      const [precos, transp, itensPolos, itensMotorId] = await Promise.all([
        supabase.from('precos_branorte').select('motor_polos, motor_polos_2').limit(LIMITE_LINHAS),
        supabase.from('transportador_funcoes').select('polos').limit(LIMITE_LINHAS),
        supabase.from('catalogo_items').select('motor_padrao_polos')
          .not('motor_padrao_polos', 'is', null).limit(LIMITE_LINHAS),
        supabase.from('catalogo_items').select('motor_id')
          .not('motor_id', 'is', null).limit(LIMITE_LINHAS),
      ])

      for (const r of [precos, transp, itensPolos, itensMotorId]) {
        if (r.error) throw r.error
        if ((r.data?.length ?? 0) >= LIMITE_LINHAS) {
          throw new Error('Consulta de alcance possivelmente truncada - contagem nao confiavel')
        }
      }

      const polos = new Set<number>()
      for (const r of precos.data ?? []) {
        if (r.motor_polos != null) polos.add(Number(r.motor_polos))
        if (r.motor_polos_2 != null) polos.add(Number(r.motor_polos_2))
      }
      for (const r of transp.data ?? []) {
        if (r.polos != null) polos.add(Number(r.polos))
      }
      for (const r of itensPolos.data ?? []) {
        if (r.motor_padrao_polos != null) polos.add(Number(r.motor_padrao_polos))
      }

      const motorIds = new Set<number>()
      for (const r of itensMotorId.data ?? []) {
        if (r.motor_id != null) motorIds.add(Number(r.motor_id))
      }

      return { polos: [...polos], motorIds: [...motorIds] }
    },
    staleTime: 5 * 60 * 1000,
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
