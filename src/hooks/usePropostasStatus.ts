import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Propostas montadas no builder cruzadas com o ESTÁGIO ATUAL da etiqueta WhatsApp do
// cliente (estado de agora). Responde "quais orçamentos foram enviados e estão com
// atendimento aberto, ainda não vendido" (= dinheiro na mesa) e "quem montou mais
// proposta em cada estágio do funil". Janela = propostas MONTADAS no período; a
// categoria é o estágio atual, independente do período. Daniel (testes) fora.

export type PropCategoria =
  | 'orcamento' | 'quente' | 'lead_quente' | 'novo' | 'sem_etiqueta'
  | 'vendido' | 'perdido' | 'outros'

export interface PropostasStatus {
  porCategoria: { categoria: PropCategoria; n: number; brl: number }[]
  porCatVendedor: { categoria: PropCategoria; vendedor: string; n: number; brl: number }[]
  aberto: { n: number; brl: number }   // não vendido/perdido = orcamento+lead_quente+quente+novo+sem_etiqueta
  vendido: { n: number; brl: number }
}

// Categorias que contam como "proposta em aberto" (negócio vivo, não fechado/perdido).
export const CATS_ABERTO: PropCategoria[] = ['orcamento', 'lead_quente', 'quente', 'novo', 'sem_etiqueta']

function desdeFromPreset(preset: DashboardPreset): string | null {
  const now = new Date()
  const d = (back: number) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'hoje') { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'ontem') return d(1)
  if (preset === '7d') return d(6)
  if (preset === '30d') return d(29)
  if (preset === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return null
}

interface RawRow { categoria: PropCategoria; n: number; brl: number }
interface RawVendRow extends RawRow { vendedor: string }

export function usePropostasStatus(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['propostas-status-v1', preset],
    queryFn: async (): Promise<PropostasStatus> => {
      const desde = desdeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_propostas_status', { p_from: desde, p_to: null })
      if (error) throw error
      const obj = (data ?? {}) as { por_categoria?: RawRow[]; por_cat_vendedor?: RawVendRow[] }
      const porCategoria = (obj.por_categoria ?? []).map(r => ({ categoria: r.categoria, n: Number(r.n) || 0, brl: Number(r.brl) || 0 }))
      const porCatVendedor = (obj.por_cat_vendedor ?? []).map(r => ({ categoria: r.categoria, vendedor: r.vendedor, n: Number(r.n) || 0, brl: Number(r.brl) || 0 }))
      const soma = (cats: PropCategoria[]) => porCategoria.filter(c => cats.includes(c.categoria))
        .reduce((a, c) => ({ n: a.n + c.n, brl: a.brl + c.brl }), { n: 0, brl: 0 })
      return { porCategoria, porCatVendedor, aberto: soma(CATS_ABERTO), vendido: soma(['vendido']) }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
