import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Funil com "Qualificou" = qualificado pela IA OU etiqueta de avanço do vendedor
// (e "Engajou" = respondeu à IA OU vendedor já etiquetou) — mantém o funil
// monotônico. Respeita o período (preset) do Dashboard.
export interface FunilUnion {
  entrou: number
  engajou: number
  qualificou: number
  qualif_ia: number
}

function windowFromPreset(preset: DashboardPreset): { from: string | null; to: string | null } {
  if (!preset) return { from: null, to: null } // '' = tudo
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const tomorrow = startOfDay(now); tomorrow.setDate(tomorrow.getDate() + 1)
  if (preset === 'hoje') return { from: startOfDay(now).toISOString(), to: tomorrow.toISOString() }
  if (preset === 'ontem') {
    const y = startOfDay(now); y.setDate(y.getDate() - 1)
    return { from: y.toISOString(), to: startOfDay(now).toISOString() }
  }
  if (preset === '7d') { const f = startOfDay(now); f.setDate(f.getDate() - 6); return { from: f.toISOString(), to: tomorrow.toISOString() } }
  if (preset === '30d') { const f = startOfDay(now); f.setDate(f.getDate() - 29); return { from: f.toISOString(), to: tomorrow.toISOString() } }
  if (preset === 'mes') return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(), to: tomorrow.toISOString() }
  return { from: null, to: null }
}

export function useFunilUnion(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['funil-union-v1', preset],
    queryFn: async (): Promise<FunilUnion> => {
      const { from, to } = windowFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_funil_union', { p_from: from, p_to: to })
      if (error) throw error
      const r = (data ?? {}) as Partial<FunilUnion>
      return {
        entrou: Number(r.entrou) || 0,
        engajou: Number(r.engajou) || 0,
        qualificou: Number(r.qualificou) || 0,
        qualif_ia: Number(r.qualif_ia) || 0,
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
  })
}
