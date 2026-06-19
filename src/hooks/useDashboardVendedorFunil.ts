import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Funil por vendedor (RPC public.dashboard_vendedor_funil).
// Atribuição = dono do WhatsApp (wa_chat_labels.vendedor_nome).
// "Qualificado" = qualificado pela IA (regra do bot) OU recebeu etiqueta de
// vendedor (novo lead / follow up / vendido / interesse futuro / lead quente).
export interface VendedorFunilRow {
  vendedor: string
  leads: number
  qualif_ia: number        // qualificado pela IA do bot
  qualif_vendedor: number  // recebeu etiqueta de avanço do vendedor
  qualificado: number      // IA OU vendedor (dedup por lead)
  sem_etiqueta: number
  prospeccao: number
  novo_lead: number
  follow_up: number
  lead_quente: number
  orcamento: number
  vendido: number
  perdido: number
}

interface VendedorFunilResp {
  por_vendedor: VendedorFunilRow[]
}

function rangeFromPreset(preset: DashboardPreset): { from: Date; to: Date } {
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  if (preset === 'hoje') return { from: startOfDay(now), to: endOfDay(now) }
  if (preset === 'ontem') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { from: startOfDay(y), to: endOfDay(y) }
  }
  if (preset === '7d') {
    const f = new Date(now); f.setDate(f.getDate() - 6)
    return { from: startOfDay(f), to: endOfDay(now) }
  }
  if (preset === '30d') {
    const f = new Date(now); f.setDate(f.getDate() - 29)
    return { from: startOfDay(f), to: endOfDay(now) }
  }
  if (preset === 'mes') {
    return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(now) }
  }
  // '' = últimos 90 dias
  const f = new Date(now); f.setDate(f.getDate() - 89)
  return { from: startOfDay(f), to: endOfDay(now) }
}

export function useDashboardVendedorFunil(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['dashboard-vendedor-funil-v1', preset],
    queryFn: async (): Promise<VendedorFunilRow[]> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_vendedor_funil', {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error) throw error
      const r = (data ?? {}) as Partial<VendedorFunilResp>
      return r.por_vendedor ?? []
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    // Opcional: se falhar, a seção simplesmente não aparece (já tem guard).
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
  })
}
