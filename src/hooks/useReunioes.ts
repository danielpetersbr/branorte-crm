import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Adm de Reunião — CRUD das reuniões. Cada reunião tem uma PAUTA (lista de itens
// com checkbox pra marcar durante a reunião) e um RESUMO (texto pós-reunião).
// ============================================================================

export type ReuniaoStatus = 'planejada' | 'em_andamento' | 'concluida'

export interface PautaItem {
  id: string
  texto: string
  feito: boolean
  responsavel?: string
}

export interface Gravacao {
  id: string
  url: string
  path: string
  duracao_seg: number
  created_at: string
  transcricao?: string
}

export interface Reuniao {
  id: string
  titulo: string
  data_reuniao: string
  status: ReuniaoStatus
  pauta: PautaItem[]
  tarefas: PautaItem[]
  resumo: string
  gravacoes: Gravacao[]
  created_by: string | null
  created_at: string
  updated_at: string
}

const KEY = ['reunioes']

function normalize(r: Record<string, unknown>): Reuniao {
  return {
    id: String(r.id),
    titulo: (r.titulo as string) || 'Reunião',
    data_reuniao: r.data_reuniao as string,
    status: (r.status as ReuniaoStatus) || 'planejada',
    pauta: Array.isArray(r.pauta) ? (r.pauta as PautaItem[]) : [],
    tarefas: Array.isArray(r.tarefas) ? (r.tarefas as PautaItem[]) : [],
    resumo: (r.resumo as string) || '',
    gravacoes: Array.isArray(r.gravacoes) ? (r.gravacoes as Gravacao[]) : [],
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function useReunioes() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Reuniao[]> => {
      const { data, error } = await supabase
        .from('reunioes')
        .select('*')
        .order('data_reuniao', { ascending: false })
      if (error) throw error
      return (data ?? []).map(normalize)
    },
    staleTime: 30_000,
  })
}

export function useCriarReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { titulo: string; data_reuniao: string }): Promise<Reuniao> => {
      const { data: auth } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('reunioes')
        .insert({ titulo: input.titulo, data_reuniao: input.data_reuniao, created_by: auth?.user?.id ?? null })
        .select('*')
        .single()
      if (error) throw error
      return normalize(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useAtualizarReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<Pick<Reuniao, 'titulo' | 'data_reuniao' | 'status' | 'pauta' | 'tarefas' | 'resumo' | 'gravacoes'>>): Promise<void> => {
      const { id, ...patch } = input
      const { error } = await supabase.from('reunioes').update(patch).eq('id', id)
      if (error) throw error
    },
    // Otimista: aplica a mudança no cache na hora (checkbox/resumo respondem instantâneo).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Reuniao[]>(KEY)
      qc.setQueryData<Reuniao[]>(KEY, (old) => (old ?? []).map(r => r.id === input.id ? { ...r, ...input } as Reuniao : r))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useExcluirReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('reunioes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
