import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Sun, Moon, FilePlus2, ChevronDown, Check } from 'lucide-react'
import { RangeCalendar } from '@/components/RangeCalendar'
import { useDarkMode } from '@/hooks/useDarkMode'
import type { DashboardPreset } from '@/hooks/useDashboard'
import {
  PRESETS_PRIMARIOS, PRESETS_SECUNDARIOS, isCustomPreset, customDates, labelDoPreset,
} from './DashboardFilterContext'
import { TABS, type TabId } from './tabs'
import { n } from './ui/format'

function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function agoraHHMM(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Cabeçalho + navegação das 5 áreas.
 *
 * Antes eram 8 botões de período disputando a mesma linha com "Novo orçamento"
 * e o toggle de tema. Agora: 4 períodos que cobrem 95% do uso ficam à vista,
 * o resto (Ontem, Tudo, Personalizado) entra em "Mais períodos".
 */
export function DashboardHeader({
  preset, setPreset, tab, setTab, totalLeads, atualizadoEm, atualizando, onAtualizar,
}: {
  preset: DashboardPreset
  setPreset: (p: DashboardPreset) => void
  tab: TabId
  setTab: (t: TabId) => void
  totalLeads?: number
  atualizadoEm?: number
  atualizando?: boolean
  onAtualizar: () => void
}) {
  const [dark, toggleDark] = useDarkMode()
  const [maisAberto, setMaisAberto] = useState(false)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const maisRef = useRef<HTMLDivElement>(null)

  // Fecha o popover no clique fora e no Esc — sem isso ele ficava aberto por
  // cima do conteúdo, que é metade da reclamação de "banner cobrindo tela".
  useEffect(() => {
    if (!maisAberto) return
    const clique = (e: MouseEvent) => {
      if (maisRef.current && !maisRef.current.contains(e.target as Node)) setMaisAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaisAberto(false) }
    document.addEventListener('mousedown', clique)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', clique); document.removeEventListener('keydown', esc) }
  }, [maisAberto])

  const custom = isCustomPreset(preset)
  const periodoLabel = labelDoPreset(preset)
  const secundarioAtivo = custom || PRESETS_SECUNDARIOS.some(p => p.value === preset)

  return (
    <header className="bg-bg">
      {/* ── Linha 1: identidade + ações ───────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-kpi-sm text-ink">Dashboard</h1>
          <p className="text-label text-ink-faint mt-0.5">
            {periodoLabel}
            {totalLeads != null && <> · {n(totalLeads)} leads no período</>}
            {' · '}
            <span className="tabular-nums">atualizado {agoraHHMM(atualizadoEm)}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onAtualizar}
            title="Atualizar agora"
            aria-label="Atualizar dados agora"
            className="grid h-11 w-11 md:h-9 md:w-9 place-items-center rounded-lg border border-border bg-surface text-ink-muted hover:text-ink hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RefreshCw className={`h-4 w-4 ${atualizando ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleDark}
            title={dark ? 'Tema claro' : 'Tema escuro'}
            aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="grid h-11 w-11 md:h-9 md:w-9 place-items-center rounded-lg border border-border bg-surface text-ink-muted hover:text-ink hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          <Link
            to="/orcamentos/montar"
            className="inline-flex h-11 md:h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-label font-semibold text-accent-fg hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Novo orçamento</span>
            <span className="sm:hidden">Orçamento</span>
          </Link>
        </div>
      </div>

      {/* ── Linha 2: abas + período ───────────────────────────────────── */}
      {/* Empilha no celular. Em 360px os dois na mesma linha destruíam a
          navegação: o seletor de período ocupava 297px dos 332 e as abas —
          que precisam de 382px — encolhiam até 21px, sobrando um "V|" cortado.
          Como o tablist é overflow-x-auto, ele aceitava sumir sem reclamar. */}
      <div className="mt-4 flex flex-col items-stretch gap-3 border-b border-border md:flex-row md:items-end md:justify-between md:gap-4">
        {/* Abas. overflow-x-auto SÓ aqui dentro — a página nunca rola na horizontal. */}
        <nav
          className="-mb-px flex gap-1 overflow-x-auto scrollbar-none"
          role="tablist"
          aria-label="Áreas do dashboard"
        >
          {TABS.map(t => {
            const ativa = t.id === tab
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={ativa}
                aria-controls={`painel-${t.id}`}
                id={`aba-${t.id}`}
                title={t.pergunta}
                onClick={() => setTab(t.id)}
                className={[
                  'shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-label transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset rounded-t-sm',
                  ativa
                    ? 'border-accent text-ink font-semibold'
                    : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong',
                ].join(' ')}
              >
                {t.label}
              </button>
            )
          })}
        </nav>

        <div className="relative flex shrink-0 items-center gap-1 pb-2" ref={maisRef}>
          {PRESETS_PRIMARIOS.map(p => (
            <button
              key={String(p.value)}
              type="button"
              onClick={() => setPreset(p.value)}
              aria-pressed={preset === p.value}
              className={[
                'h-11 md:h-8 rounded-lg px-2.5 text-micro transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                preset === p.value
                  ? 'bg-ink text-bg font-semibold'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setMaisAberto(v => !v)}
            aria-expanded={maisAberto}
            aria-haspopup="dialog"
            className={[
              'inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-micro transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              secundarioAtivo
                ? 'bg-ink text-bg font-semibold'
                : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
            ].join(' ')}
          >
            {secundarioAtivo ? periodoLabel : 'Mais'}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {maisAberto && (
            <div
              role="dialog"
              aria-label="Mais períodos"
              className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1 w-[300px] rounded-xl border border-border bg-surface p-3 shadow-lg"
            >
              <div className="flex flex-col gap-0.5">
                {PRESETS_SECUNDARIOS.map(p => (
                  <button
                    key={String(p.value)}
                    type="button"
                    onClick={() => { setPreset(p.value); setMaisAberto(false) }}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-label text-ink-muted hover:bg-surface-2 hover:text-ink"
                  >
                    {p.label}
                    {preset === p.value && <Check className="h-4 w-4 text-accent" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <div className="mt-2 border-t border-border pt-2">
                <div className="mb-1.5 text-micro font-semibold text-ink-muted">Personalizado</div>
                <RangeCalendar
                  from={custom ? customDates(preset).from : de}
                  to={custom ? customDates(preset).to : ate}
                  max={hojeISO()}
                  onChange={(f, t) => {
                    setDe(f); setAte(t)
                    if (f && t) { setPreset(`custom:${f}:${t}` as DashboardPreset); setMaisAberto(false) }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
