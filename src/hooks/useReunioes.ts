import { useMemo } from 'react'
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
  // Token do link público de feedback (/reuniao/<token>). Nasce null: só é
  // gerado quando o gestor pede o link pela primeira vez.
  feedback_token: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ReuniaoFeedback {
  id: string
  reuniao_id: string
  nome: string
  tipo: string | null
  comentario: string
  lido: boolean
  created_at: string
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
    feedback_token: (r.feedback_token as string) ?? null,
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
    // Sem retry (o padrão do React Query), um token expirado no meio de uma
    // reunião de 1h30 fazia o update voltar 401, o onError desfazer a alteração
    // no cache e NADA aparecer na tela — a pauta marcada simplesmente sumia.
    retry: 3,
    retryDelay: (n) => Math.min(2000 * 2 ** n, 15_000),
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

// Escritas em `gravacoes` NÃO passam mais pelo update genérico. O array era
// montado no browser (ler do cache → concatenar → mandar inteiro): qualquer
// refetch que voltasse entre o ler e o escrever levava junto o bloco anterior.
// Foi assim que a reunião de 12/08/2026 perdeu o bloco -00 (subiu pro Storage,
// nunca entrou na linha). Agora o Postgres remonta o array numa statement só e
// devolve a lista final — que vira a verdade do cache.
export function useGravacoes() {
  const qc = useQueryClient()
  return useMemo(() => {
    const chamar = async (fn: string, args: Record<string, unknown>, reuniaoId: string): Promise<Gravacao[]> => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      const lista = (Array.isArray(data) ? data : []) as Gravacao[]
      qc.setQueryData<Reuniao[]>(KEY, (old) => (old ?? []).map(r => r.id === reuniaoId ? { ...r, gravacoes: lista } : r))
      return lista
    }
    return {
      add: (reuniaoId: string, g: Gravacao) =>
        chamar('reuniao_add_gravacao', { p_id: reuniaoId, p_gravacao: g }, reuniaoId),
      setTranscricao: (reuniaoId: string, gravId: string, texto: string) =>
        chamar('reuniao_set_transcricao', { p_id: reuniaoId, p_grav_id: gravId, p_texto: texto }, reuniaoId),
      remove: (reuniaoId: string, gravId: string) =>
        chamar('reuniao_remove_gravacao', { p_id: reuniaoId, p_grav_id: gravId }, reuniaoId),
    }
  }, [qc])
}

export function useExcluirReuniao() {
  const qc = useQueryClient()
  return useMutation({
    // Apagava só a linha e deixava o áudio no Storage pra sempre — sobrou pelo
    // menos um arquivo de 19/07/2026 assim. O Storage vai PRIMEIRO: se ele
    // falhar, a reunião continua ali pra tentar de novo, em vez de virar áudio
    // órfão que ninguém mais consegue localizar.
    mutationFn: async (input: { id: string; paths: string[] }): Promise<void> => {
      if (input.paths.length > 0) {
        const { error: sErr } = await supabase.storage.from('reunioes-audio').remove(input.paths)
        if (sErr) throw new Error(`não deu pra apagar o áudio no Storage: ${sErr.message}`)
      }
      const { error } = await supabase.from('reunioes').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ============================================================================
// Link público de feedback (/reuniao/<token>) — o gestor manda pro vendedor
// depois da reunião e recebe as sugestões aqui dentro.
// ============================================================================

function novoToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

// Gera o token na PRIMEIRA vez que o link é pedido e devolve o que já existe nas
// seguintes — o link mandado no grupo semana passada não pode virar 404 porque
// alguém clicou em "copiar" de novo. O `is null` no update resolve a corrida de
// duas abas pedindo junto: quem perde relê o token do vencedor em vez de
// derrubá-lo.
export function useGarantirLinkFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data: atual, error: e1 } = await supabase.from('reunioes').select('feedback_token').eq('id', id).single()
      if (e1) throw e1
      if (atual?.feedback_token) return atual.feedback_token as string

      const token = novoToken()
      const { data, error } = await supabase
        .from('reunioes')
        .update({ feedback_token: token })
        .eq('id', id)
        .is('feedback_token', null)
        .select('feedback_token')
      if (error) throw error
      if (data && data.length > 0) return data[0].feedback_token as string

      const { data: depois, error: e2 } = await supabase.from('reunioes').select('feedback_token').eq('id', id).single()
      if (e2) throw e2
      return (depois?.feedback_token as string) ?? token
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

const FEEDBACK_KEY = (id: string) => ['reuniao-feedbacks', id]

export function useReuniaoFeedbacks(reuniaoId: string) {
  return useQuery({
    queryKey: FEEDBACK_KEY(reuniaoId),
    queryFn: async (): Promise<ReuniaoFeedback[]> => {
      const { data, error } = await supabase
        .from('reuniao_feedbacks')
        .select('*')
        .eq('reuniao_id', reuniaoId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ReuniaoFeedback[]
    },
    staleTime: 15_000,
  })
}

// Contagem por reunião pros cards da lista — sem isto o gestor só descobre que
// chegou sugestão abrindo reunião por reunião. A tabela é pequena (uma linha por
// comentário), então uma leitura só e a soma no browser bastam.
export function useFeedbackContagem() {
  return useQuery({
    queryKey: ['reuniao-feedbacks-contagem'],
    queryFn: async (): Promise<Record<string, { total: number; novos: number }>> => {
      const { data, error } = await supabase.from('reuniao_feedbacks').select('reuniao_id, lido')
      if (error) throw error
      const mapa: Record<string, { total: number; novos: number }> = {}
      for (const f of (data ?? []) as { reuniao_id: string; lido: boolean }[]) {
        const m = mapa[f.reuniao_id] ?? (mapa[f.reuniao_id] = { total: 0, novos: 0 })
        m.total++
        if (!f.lido) m.novos++
      }
      return mapa
    },
    staleTime: 30_000,
  })
}

export function useMarcarFeedbackLido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; reuniaoId: string; lido: boolean }): Promise<void> => {
      const { error } = await supabase.from('reuniao_feedbacks').update({ lido: input.lido }).eq('id', input.id)
      if (error) throw error
    },
    onMutate: async (input) => {
      const key = FEEDBACK_KEY(input.reuniaoId)
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ReuniaoFeedback[]>(key)
      qc.setQueryData<ReuniaoFeedback[]>(key, (old) => (old ?? []).map(f => f.id === input.id ? { ...f, lido: input.lido } : f))
      return { prev, key }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev) },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: FEEDBACK_KEY(v.reuniaoId) })
      qc.invalidateQueries({ queryKey: ['reuniao-feedbacks-contagem'] })
    },
  })
}

export function useExcluirFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; reuniaoId: string }): Promise<void> => {
      const { error } = await supabase.from('reuniao_feedbacks').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: FEEDBACK_KEY(v.reuniaoId) })
      qc.invalidateQueries({ queryKey: ['reuniao-feedbacks-contagem'] })
    },
  })
}
