import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  REUNIOES_KEY as KEY, REUNIOES_MUTATION_KEY, REUNIOES_MUTATION_SCOPE,
  aplicarAtualizacaoReuniao, reverterAtualizacaoReuniao, inserirReuniaoNoCache,
  invalidarReunioesAposEscritas, excluirReuniaoComAudios, type AtualizacaoReuniao,
} from '@/lib/reunioes-updates'
export type { AtualizacaoReuniao } from '@/lib/reunioes-updates'

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

interface SlideBase {
  id: string
  title: string
  eyebrow?: string
}

export type ApresentacaoSlide =
  | (SlideBase & { type: 'cover'; subtitle?: string; dateLabel?: string; highlight?: string })
  | (SlideBase & { type: 'calls'; total: number; teamTarget: number; individualTarget: number; metCount: number; sellerCount: number; sellers: { name: string; count: number }[]; takeaway?: string })
  | (SlideBase & { type: 'sales'; monthTotal: number; beforeWeek: number; weekTotal: number; goal: number; effectiveSales: number; aboveTenK: number; individualTarget: number; metCount: number; sellerCount: number; takeaway?: string })
  | (SlideBase & { type: 'teams'; teams: { name: string; total: number; goal?: number; members: { name: string; value: number }[] }[]; globalOnly?: { name: string; value: number }[]; takeaway?: string })
  | (SlideBase & { type: 'agenda'; totalMinutes: number; items: { title: string; minutes: number; detail?: string }[] })
  | (SlideBase & { type: 'video'; prompt?: string; videoPath: string; youtubeId?: string; chapterLabel?: string; source?: string })
  | (SlideBase & { type: 'funnel'; scope?: string; stages: { name: string; count: number; stalled: number }[]; won: number; lost: number; note?: string; noteShort?: string; actions?: string[] })

export interface ApresentacaoManifesto {
  version: 2
  slides: ApresentacaoSlide[]
  pptx?: string | null
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
  apresentacao_manifesto: ApresentacaoManifesto | null
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

function normalizeManifesto(value: unknown): ApresentacaoManifesto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const tipos = new Set(['cover', 'calls', 'sales', 'teams', 'agenda', 'video', 'funnel'])
  const slides = Array.isArray(raw.slides)
    ? raw.slides.filter((slide): slide is ApresentacaoSlide =>
      !!slide && typeof slide === 'object' &&
      typeof slide.id === 'string' && typeof slide.title === 'string' && tipos.has(slide.type))
      .map(slide => slide.type === 'video' ? {
        ...slide,
        youtubeId: typeof slide.youtubeId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(slide.youtubeId) ? slide.youtubeId : undefined,
        chapterLabel: typeof slide.chapterLabel === 'string' ? slide.chapterLabel : undefined,
      } : slide)
    : []
  return {
    version: 2,
    slides,
    pptx: typeof raw.pptx === 'string' ? raw.pptx : null,
  }
}

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
    apresentacao_manifesto: normalizeManifesto(r.apresentacao_manifesto),
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }
}

export function useReunioes() {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }): Promise<Reuniao[]> => {
      const { data, error } = await supabase
        .from('reunioes')
        .select('*')
        .order('data_reuniao', { ascending: false })
        .abortSignal(signal)
      if (error) throw error
      return (data ?? []).map(normalize)
    },
    staleTime: 30_000,
  })
}

export function useCriarReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: REUNIOES_MUTATION_KEY,
    scope: REUNIOES_MUTATION_SCOPE,
    onMutate: () => qc.cancelQueries({ queryKey: KEY }),
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
    onSuccess: (criada) => { qc.setQueryData<Reuniao[]>(KEY, old => inserirReuniaoNoCache(old, criada)) },
    onSettled: () => invalidarReunioesAposEscritas(qc),
  })
}

export function useAtualizarReuniao(onSaveError?: (input: AtualizacaoReuniao) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: REUNIOES_MUTATION_KEY,
    // onMutate continua imediato; apenas as escritas no servidor ficam em fila.
    scope: REUNIOES_MUTATION_SCOPE,
    // Sem retry (o padrão do React Query), um token expirado no meio de uma
    // reunião de 1h30 fazia o update voltar 401, o onError desfazer a alteração
    // no cache e NADA aparecer na tela — a pauta marcada simplesmente sumia.
    retry: 3,
    retryDelay: (n) => Math.min(2000 * 2 ** n, 15_000),
    mutationFn: async (input: AtualizacaoReuniao): Promise<void> => {
      const { id, ...patch } = input
      const { error } = await supabase.from('reunioes').update(patch).eq('id', id).select('id').single()
      if (error) throw error
    },
    // Otimista: aplica a mudança no cache na hora (checkbox/resumo respondem instantâneo).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Reuniao[]>(KEY)?.find(r => r.id === input.id)
      qc.setQueryData<Reuniao[]>(KEY, old => aplicarAtualizacaoReuniao(old, input))
      return { prev }
    },
    onError: (_e, input, ctx) => {
      qc.setQueryData<Reuniao[]>(KEY, old => reverterAtualizacaoReuniao(old, ctx?.prev, input))
      // Callbacks da mutation recebem TODAS as falhas; isError do observer só
      // acompanha a última chamada, que pode já ter salvo outro campo.
      onSaveError?.(input)
      const nomes: Record<string, string> = {
        titulo: 'o título', data_reuniao: 'a data', status: 'o status', pauta: 'a pauta',
        tarefas: 'as tarefas', resumo: 'o resumo', apresentacao_manifesto: 'a apresentação',
      }
      const campos = Object.keys(input).filter(campo => campo !== 'id').map(campo => nomes[campo] ?? campo)
      toast.error(`Não foi possível salvar ${campos.join(', ') || 'a reunião'}. Confira e tente novamente.`, { duration: 10_000 })
    },
    onSettled: () => invalidarReunioesAposEscritas(qc),
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
  const { mutateAsync } = useMutation({
    mutationKey: REUNIOES_MUTATION_KEY,
    scope: REUNIOES_MUTATION_SCOPE,
    onMutate: () => qc.cancelQueries({ queryKey: KEY }),
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown>; reuniaoId: string }) => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return (Array.isArray(data) ? data : []) as Gravacao[]
    },
    onSuccess: (lista, { reuniaoId }) => {
      qc.setQueryData<Reuniao[]>(KEY, old => old?.map(r => r.id === reuniaoId ? { ...r, gravacoes: lista } : r))
    },
    onSettled: () => invalidarReunioesAposEscritas(qc),
  })
  return useMemo(() => {
    const chamar = (fn: string, args: Record<string, unknown>, reuniaoId: string) => mutateAsync({ fn, args, reuniaoId })
    return {
      add: (reuniaoId: string, g: Gravacao) =>
        chamar('reuniao_add_gravacao', { p_id: reuniaoId, p_gravacao: g }, reuniaoId),
      setTranscricao: (reuniaoId: string, gravId: string, texto: string) =>
        chamar('reuniao_set_transcricao', { p_id: reuniaoId, p_grav_id: gravId, p_texto: texto }, reuniaoId),
      remove: (reuniaoId: string, gravId: string) =>
        chamar('reuniao_remove_gravacao', { p_id: reuniaoId, p_grav_id: gravId }, reuniaoId),
    }
  }, [mutateAsync])
}

export function useExcluirReuniao() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: REUNIOES_MUTATION_KEY,
    scope: REUNIOES_MUTATION_SCOPE,
    onMutate: () => qc.cancelQueries({ queryKey: KEY }),
    // Confirme a exclusão da linha antes de destruir os arquivos. Se o banco
    // recusar a operação, os áudios continuam acessíveis na reunião existente.
    mutationFn: (input: { id: string; paths: string[] }) => excluirReuniaoComAudios(
      async () => {
        const { error } = await supabase.from('reunioes').delete().eq('id', input.id).select('id').single()
        if (error) throw error
      },
      async () => {
        if (!input.paths.length) return
        const { error } = await supabase.storage.from('reunioes-audio').remove(input.paths)
        if (error) throw new Error(error.message)
      },
    ),
    onSuccess: (_resultado, input) => { qc.setQueryData<Reuniao[]>(KEY, old => old?.filter(r => r.id !== input.id)) },
    onSettled: () => invalidarReunioesAposEscritas(qc),
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
    mutationKey: REUNIOES_MUTATION_KEY,
    scope: REUNIOES_MUTATION_SCOPE,
    onMutate: () => qc.cancelQueries({ queryKey: KEY }),
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
    onSuccess: (token, id) => {
      qc.setQueryData<Reuniao[]>(KEY, old => old?.map(r => r.id === id ? { ...r, feedback_token: token } : r))
    },
    onSettled: () => invalidarReunioesAposEscritas(qc),
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
