import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Sessões do quiz/configurador do site (controle.branorte.com/quiz.html).
// Gravadas pelo endpoint /api/quiz/track (branorte-auditoria) via upsert por session_id.
// ultimo_passo: 0 iniciou · 1 nome · 2 whatsapp · 3 objetivo · 4 qualificou · 5 concluiu · 6 enviado ao vendedor
export interface FunilSessao {
  id: string
  session_id: string
  nome: string | null
  telefone: string | null
  uf: string | null
  objetivo: string | null // 'fabrica' | 'equipamento'
  animal: string | null
  manejo: string | null
  quantidade: string | null
  uso: string | null
  equip: string | null
  porte: string | null
  ultimo_passo: number
  etapa: string
  concluiu: boolean
  vendedor: string | null
  origem: string | null
  created_at: string
  updated_at: string
}

export type FunilTab = 'todos' | 'enviado' | 'concluiu' | 'parou'
export interface FunilFilters {
  search: string
  tab: FunilTab
  page: number
}

const PAGE_SIZE = 50
const KEY = ['funil-site'] as const

export function useFunilSiteList(filters: FunilFilters) {
  return useQuery({
    queryKey: [...KEY, 'list', filters],
    queryFn: async (): Promise<{ rows: FunilSessao[]; total: number }> => {
      let q = supabase
        .from('funil_site_sessoes')
        .select('*', { count: 'exact' })
        .order('updated_at', { ascending: false, nullsFirst: false })

      if (filters.search) {
        const esc = filters.search.replace(/[%_]/g, (c) => `\\${c}`)
        q = q.or(`nome.ilike.%${esc}%,telefone.ilike.%${esc}%`)
      }
      if (filters.tab === 'enviado') q = q.gte('ultimo_passo', 6)
      else if (filters.tab === 'concluiu') q = q.gte('ultimo_passo', 5)
      else if (filters.tab === 'parou') q = q.lt('ultimo_passo', 5)

      const from = filters.page * PAGE_SIZE
      q = q.range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await q
      if (error) throw error
      return { rows: (data ?? []) as FunilSessao[], total: count ?? 0 }
    },
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export const FUNNEL_STAGES = [
  { key: 'iniciou', label: 'Iniciaram', passo: 0 },
  { key: 'nome', label: 'Deram o nome', passo: 1 },
  { key: 'objetivo', label: 'Escolheram o que quer', passo: 2 },
  { key: 'qualificou', label: 'Qualificaram', passo: 3 },
  { key: 'contato', label: 'Deram o WhatsApp', passo: 4 },
  { key: 'concluiu', label: 'Concluíram', passo: 5 },
  { key: 'enviado', label: 'Foram pro vendedor', passo: 6 },
] as const

export interface FunnelStage {
  key: string
  label: string
  passo: number
  count: number
}

export function useFunilSiteFunil() {
  return useQuery({
    queryKey: [...KEY, 'funil'],
    queryFn: async (): Promise<FunnelStage[]> => {
      const results = await Promise.all(
        FUNNEL_STAGES.map((s) =>
          supabase
            .from('funil_site_sessoes')
            .select('*', { count: 'exact', head: true })
            .gte('ultimo_passo', s.passo),
        ),
      )
      return FUNNEL_STAGES.map((s, i) => ({ ...s, count: results[i].count ?? 0 }))
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export { PAGE_SIZE as FUNIL_PAGE_SIZE }
