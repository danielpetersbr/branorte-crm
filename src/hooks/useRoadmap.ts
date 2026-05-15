import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type RoadmapTipo = 'bug' | 'sugestao' | 'melhoria'
export type RoadmapStatus = 'novo' | 'analisando' | 'resolvido' | 'rejeitado'
export type RoadmapPrioridade = 'baixa' | 'media' | 'alta' | 'critica'

export interface RoadmapFeedback {
  id: number
  tipo: RoadmapTipo
  titulo: string
  descricao: string | null
  url_origem: string | null
  screenshot_url: string | null
  status: RoadmapStatus
  prioridade: RoadmapPrioridade
  criado_por: string | null
  criado_por_nome: string | null
  notas_admin: string | null
  created_at: string
  updated_at: string
}

const BUCKET = 'roadmap-screenshots'

// Cria feedback novo. Faz upload do screenshot ANTES (se houver) pra ter a URL pronta.
export function useCriarFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      tipo: RoadmapTipo
      titulo: string
      descricao: string
      url_origem: string
      screenshot?: File | null
      criado_por: string | null
      criado_por_nome: string | null
    }): Promise<RoadmapFeedback> => {
      let screenshot_url: string | null = null
      if (input.screenshot) {
        const ts = Date.now()
        const ext = (input.screenshot.name.split('.').pop() || input.screenshot.type.split('/').pop() || 'png').toLowerCase()
        const path = `${ts}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, input.screenshot, { upsert: false, contentType: input.screenshot.type || undefined })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
        screenshot_url = pub.publicUrl
      }
      // Insere via endpoint Vercel /api/feedback (bypassa RLS com service role).
      // RLS bloqueia INSERT direto pelo cliente — endpoint valida JWT antes.
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) throw new Error('nao_logado')

      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tipo: input.tipo,
          titulo: input.titulo.trim(),
          descricao: input.descricao.trim() || null,
          url_origem: input.url_origem || null,
          screenshot_url,
        }),
      })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`)
      return j.feedback as RoadmapFeedback
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roadmap-feedback'] }),
  })
}

// Lista pro painel admin. RLS bloqueia non-admin (so ve os proprios feedbacks).
export function useFeedbacks(filtroStatus?: RoadmapStatus | 'todos') {
  return useQuery({
    queryKey: ['roadmap-feedback', filtroStatus ?? 'todos'],
    queryFn: async (): Promise<RoadmapFeedback[]> => {
      let q = supabase.from('roadmap_feedback').select('*').order('created_at', { ascending: false })
      if (filtroStatus && filtroStatus !== 'todos') q = q.eq('status', filtroStatus)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as RoadmapFeedback[]
    },
    staleTime: 30_000,
  })
}

export function useAtualizarFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<RoadmapFeedback> }) => {
      const { error } = await supabase.from('roadmap_feedback').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roadmap-feedback'] }),
  })
}

// Contagens por status pro badge do botao admin
export function useFeedbackCounts() {
  return useQuery({
    queryKey: ['roadmap-feedback-counts'],
    queryFn: async () => {
      const [novosRes, analisandoRes] = await Promise.all([
        supabase.from('roadmap_feedback').select('id', { count: 'exact', head: true }).eq('status', 'novo'),
        supabase.from('roadmap_feedback').select('id', { count: 'exact', head: true }).eq('status', 'analisando'),
      ])
      return {
        novos: novosRes.count ?? 0,
        analisando: analisandoRes.count ?? 0,
      }
    },
    staleTime: 30_000,
  })
}
