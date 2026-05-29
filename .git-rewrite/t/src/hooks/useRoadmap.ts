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
      // Le screenshot como base64 (RLS de storage.objects bloqueia upload direto
      // do cliente, entao envia pro endpoint Vercel que sobe via service role).
      let screenshot_base64: string | null = null
      let screenshot_mime: string | null = null
      if (input.screenshot) {
        screenshot_mime = input.screenshot.type || 'image/png'
        screenshot_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error || new Error('read_failed'))
          reader.readAsDataURL(input.screenshot!)
        })
      }

      // Insere via endpoint Vercel /api/feedback (bypassa RLS com service role).
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
          screenshot_base64,
          screenshot_mime,
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
