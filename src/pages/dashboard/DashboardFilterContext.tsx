import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DashboardPreset } from '@/hooks/useDashboard'

/** "custom:2026-08-01:2026-08-18" */
export function isCustomPreset(p: DashboardPreset): boolean {
  return typeof p === 'string' && p.startsWith('custom:')
}
export function customDates(p: DashboardPreset): { from: string; to: string } {
  if (!isCustomPreset(p)) return { from: '', to: '' }
  const [, from = '', to = ''] = (p as string).split(':')
  return { from, to }
}

export const PRESETS_PRIMARIOS: { value: DashboardPreset; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: 'mes',  label: 'Este mês' },
]

/** Ficam atrás de "Mais períodos" — competiam por atenção no topo sem merecer. */
export const PRESETS_SECUNDARIOS: { value: DashboardPreset; label: string }[] = [
  { value: 'ontem', label: 'Ontem' },
  { value: '',      label: 'Tudo' },
]

const TODOS = [...PRESETS_PRIMARIOS, ...PRESETS_SECUNDARIOS]

function ddmm(iso: string): string {
  const [, m, d] = (iso || '').split('-')
  return d && m ? `${d}/${m}` : iso
}

export function labelDoPreset(p: DashboardPreset): string {
  if (isCustomPreset(p)) {
    const { from, to } = customDates(p)
    return `${ddmm(from)}–${ddmm(to)}`
  }
  return TODOS.find(x => x.value === p)?.label ?? 'Tudo'
}

/**
 * Preset persistido. Default 30d na 1ª visita — "Tudo" dilui o sinal recente e
 * distorce a conversão. Escolha deliberada salva (inclusive "Tudo" = '') vale.
 *
 * A chave `dashboard-preset` NÃO pode ser renomeada: Analytics.tsx lê a mesma.
 */
export function usePresetFilter(): [DashboardPreset, (p: DashboardPreset) => void] {
  const [preset, setPreset] = useState<DashboardPreset>(() => {
    if (typeof window === 'undefined') return '30d'
    const stored = localStorage.getItem('dashboard-preset')
    return stored !== null ? (stored as DashboardPreset) : '30d'
  })
  useEffect(() => {
    try { localStorage.setItem('dashboard-preset', preset) } catch { /* quota */ }
  }, [preset])
  return [preset, setPreset]
}

type Ctx = {
  preset: DashboardPreset
  setPreset: (p: DashboardPreset) => void
  /** "30 dias", "18/08", "Tudo" — para carimbar em JanelaBadge tipo="periodo" */
  periodoLabel: string
  /** false quando preset === '' — aí não existe "período anterior" pra comparar */
  temPeriodo: boolean
}

const FilterCtx = createContext<Ctx | null>(null)

export function DashboardFilterProvider({
  preset, setPreset, children,
}: { preset: DashboardPreset; setPreset: (p: DashboardPreset) => void; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({
    preset,
    setPreset,
    periodoLabel: labelDoPreset(preset),
    temPeriodo: !!preset,
  }), [preset, setPreset])
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>
}

export function useJanela(): Ctx {
  const c = useContext(FilterCtx)
  if (!c) throw new Error('useJanela precisa estar dentro de <DashboardFilterProvider>')
  return c
}
