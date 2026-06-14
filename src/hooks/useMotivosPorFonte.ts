import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Motivos de fechamento/perda por CRIATIVO e por ORIGEM — pra saber qual anúncio/canal
// traz mais "não respondeu mais", "não tem interesse", "não fabricamos" etc. e dar pra
// ordenar do pior pro melhor. Fonte: RPC dashboard_motivos_por_fonte.

export type MotivoKey =
  | 'perdido'
  | 'm_nunca_respondeu' | 'm_nao_respondeu_mais' | 'm_sem_interesse' | 'm_so_preco'
  | 'm_fora_orcamento' | 'm_nao_fabricamos' | 'm_concorrente' | 'm_transportadora'
  | 'm_suporte' | 'm_outros'

export interface MotivoFonte {
  codigo?: string | null
  nome?: string | null
  origem?: string | null
  total: number
  perdido: number
  m_nunca_respondeu: number
  m_nao_respondeu_mais: number
  m_sem_interesse: number
  m_so_preco: number
  m_fora_orcamento: number
  m_nao_fabricamos: number
  m_concorrente: number
  m_transportadora: number
  m_suporte: number
  m_outros: number
}

export interface MotivosPorFonte {
  por_criativo: MotivoFonte[]
  por_origem: MotivoFonte[]
}

// Rótulos dos motivos, na ordem de exibição (Todos perdidos primeiro).
export const MOTIVO_LABELS: { key: MotivoKey; label: string }[] = [
  { key: 'perdido',              label: 'Todos perdidos' },
  { key: 'm_nunca_respondeu',    label: 'Nunca respondeu' },
  { key: 'm_nao_respondeu_mais', label: 'Não respondeu mais' },
  { key: 'm_sem_interesse',      label: 'Não tem interesse' },
  { key: 'm_nao_fabricamos',     label: 'Não fabricamos' },
  { key: 'm_so_preco',           label: 'Só base de preço' },
  { key: 'm_fora_orcamento',     label: 'Fora do orçamento' },
  { key: 'm_concorrente',        label: 'Comprou concorrente' },
  { key: 'm_transportadora',     label: 'Transportadora' },
  { key: 'm_suporte',            label: 'Suporte técnico' },
  { key: 'm_outros',             label: 'Outros assuntos' },
]

function rangeFromPreset(preset: DashboardPreset): { from: string; to: string } {
  const now = new Date()
  const sod = (back: number) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(0, 0, 0, 0); return x }
  const eod = new Date(now); eod.setHours(23, 59, 59, 999)
  if (preset === 'hoje') { const x = new Date(now); x.setHours(0, 0, 0, 0); return { from: x.toISOString(), to: eod.toISOString() } }
  if (preset === 'ontem') { const y = new Date(now); y.setDate(y.getDate() - 1); const s = new Date(y); s.setHours(0, 0, 0, 0); const e = new Date(y); e.setHours(23, 59, 59, 999); return { from: s.toISOString(), to: e.toISOString() } }
  if (preset === '7d') return { from: sod(6).toISOString(), to: eod.toISOString() }
  if (preset === '30d') return { from: sod(29).toISOString(), to: eod.toISOString() }
  if (preset === 'mes') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: eod.toISOString() }
  return { from: sod(89).toISOString(), to: eod.toISOString() } // Tudo = 90d (etiqueta é sinal recente)
}

export function useMotivosPorFonte(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['motivos-por-fonte-v1', preset],
    queryFn: async (): Promise<MotivosPorFonte> => {
      const { from, to } = rangeFromPreset(preset)
      const { data, error } = await supabase.rpc('dashboard_motivos_por_fonte', { p_from: from, p_to: to })
      if (error) throw error
      const d = (data ?? {}) as Partial<MotivosPorFonte>
      return { por_criativo: d.por_criativo ?? [], por_origem: d.por_origem ?? [] }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
