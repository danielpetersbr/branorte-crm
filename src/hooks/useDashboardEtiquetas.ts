import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Categorias semânticas espelhadas em public.etiqueta_categoria()
export type EtiquetaCategoria =
  | 'novo' | 'quente' | 'lead_quente' | 'orcamento' | 'vendido' | 'perdido' | 'interno' | 'outros'

export interface DashboardEtiquetas {
  leads_total: number
  leads_com_etiqueta: number
  por_categoria: Partial<Record<EtiquetaCategoria, number>>
  por_etiqueta: { nome: string; nome_original: string; categoria: EtiquetaCategoria; total: number }[]
  por_vendedor: {
    vendedor: string
    total_leads: number
    com_orcamento: number
    vendido: number
    em_andamento: number
  }[]
  sem_orc_vendedores: string[]
  por_criativo: {
    codigo: string
    nome: string | null
    total: number
    vendido: number
    orcamento: number
    quente: number
    perdido: number
    nao_fabricamos: number
  }[]
}

function rangeFromPreset(preset: DashboardPreset): { from: Date; to: Date } {
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
  const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x }
  if (preset === 'hoje')  return { from: startOfDay(now), to: endOfDay(now) }
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
  // '' = últimos 90 dias (RPC precisa de range válido)
  const f = new Date(now); f.setDate(f.getDate() - 89)
  return { from: startOfDay(f), to: endOfDay(now) }
}

export function useDashboardEtiquetas(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['dashboard-etiquetas-v1', preset],
    queryFn: async (): Promise<DashboardEtiquetas> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_etiquetas_resumo', {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error) throw error
      const r = (data ?? {}) as Partial<DashboardEtiquetas>
      return {
        leads_total: r.leads_total ?? 0,
        leads_com_etiqueta: r.leads_com_etiqueta ?? 0,
        por_categoria: r.por_categoria ?? {},
        por_etiqueta: r.por_etiqueta ?? [],
        por_vendedor: r.por_vendedor ?? [],
        sem_orc_vendedores: r.sem_orc_vendedores ?? [],
        por_criativo: r.por_criativo ?? [],
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
  })
}

// Labels visuais por categoria
export const CATEGORIA_LABEL: Record<EtiquetaCategoria, { label: string; emoji: string; tone: string }> = {
  novo:        { label: 'Novo lead',        emoji: '🆕', tone: 'info' },
  quente:      { label: 'Em andamento',     emoji: '🔄', tone: 'warning' },
  lead_quente: { label: 'Lead quente',      emoji: '🔥', tone: 'danger' },
  orcamento:   { label: 'Orçamento enviado', emoji: '📄', tone: 'accent' },
  vendido:     { label: 'Vendido',          emoji: '✅', tone: 'success' },
  perdido:     { label: 'Perdido',          emoji: '💀', tone: 'neutral' },
  interno:     { label: 'Interno/Outros',   emoji: '·',  tone: 'neutral' },
  outros:      { label: 'Outros',           emoji: '·',  tone: 'neutral' },
}
