import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'

/**
 * Peças comuns às páginas de anúncios (/anuncios e /anuncios/criativos): o período (o mesmo localStorage das duas,
 * então trocar numa vale na outra) e as abas do topo.
 */

export type PeriodoAnuncio = 'hoje' | 'ontem' | '7d' | 'mes' | 'mes_passado' | '90d' | 'custom'
export const PERIODOS_ANUNCIO: { v: Exclude<PeriodoAnuncio, 'custom'>; l: string }[] = [
  { v: 'hoje', l: 'Hoje' }, { v: 'ontem', l: 'Ontem' }, { v: '7d', l: '7 dias' }, { v: 'mes', l: 'Este mês' },
  { v: 'mes_passado', l: 'Mês passado' }, { v: '90d', l: '90 dias' },
]
export interface PeriodoPersonalizado { de: string; ate: string }

export const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaLocal = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d) }
const ddmm = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

export function intervaloAnuncio(p: PeriodoAnuncio, custom?: PeriodoPersonalizado, agora = new Date()): { from: Date; to: Date } {
  const y = agora.getFullYear(), m = agora.getMonth(), d = agora.getDate()
  const amanha = new Date(y, m, d + 1)
  if (p === 'custom' && custom) {
    const de = diaLocal(custom.de), ate = diaLocal(custom.ate)
    const [a, b] = de <= ate ? [de, ate] : [ate, de]
    return { from: a, to: new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1) }
  }
  if (p === 'hoje') return { from: new Date(y, m, d), to: amanha }
  if (p === 'ontem') return { from: new Date(y, m, d - 1), to: new Date(y, m, d) }
  if (p === '7d') return { from: new Date(y, m, d - 6), to: amanha }
  if (p === 'mes_passado') return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) }
  if (p === '90d') return { from: new Date(y, m, d - 89), to: amanha }
  return { from: new Date(y, m, 1), to: amanha }
}

/** Período escolhido + datas, guardado no navegador (mesmas chaves da /anuncios). */
export function usePeriodoAnuncio() {
  const [periodo, setPeriodo] = useState<PeriodoAnuncio>(() => {
    try { const v = localStorage.getItem('anuncios-periodo'); return (PERIODOS_ANUNCIO.some(p => p.v === v) || v === 'custom' ? v : 'mes') as PeriodoAnuncio } catch { return 'mes' }
  })
  const [custom, setCustom] = useState<PeriodoPersonalizado>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('anuncios-personalizado') ?? 'null')
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.de) && /^\d{4}-\d{2}-\d{2}$/.test(v.ate)) return v as PeriodoPersonalizado
    } catch { /* sem storage */ }
    const h = new Date()
    return { de: isoDia(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6)), ate: isoDia(h) }
  })
  const escolher = (p: PeriodoAnuncio) => { setPeriodo(p); try { localStorage.setItem('anuncios-periodo', p) } catch { /* sem storage */ } }
  const mudarCustom = (c: PeriodoPersonalizado) => { setCustom(c); try { localStorage.setItem('anuncios-personalizado', JSON.stringify(c)) } catch { /* sem storage */ } }
  const iv = intervaloAnuncio(periodo, custom)
  const rotulo = periodo === 'custom' ? `${ddmm(custom.de)} a ${ddmm(custom.ate)}` : PERIODOS_ANUNCIO.find(x => x.v === periodo)?.l ?? ''
  return { periodo, escolher, custom, mudarCustom, ...iv, rotulo }
}

export function SeletorPeriodo({ p }: { p: ReturnType<typeof usePeriodoAnuncio> }) {
  const cls = (ativo: boolean) => `inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 py-1 text-micro md:min-h-0 ${ativo ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
        {PERIODOS_ANUNCIO.map(x => (
          <button key={x.v} type="button" onClick={() => p.escolher(x.v)} aria-pressed={p.periodo === x.v} className={cls(p.periodo === x.v)}>{x.l}</button>
        ))}
        <button type="button" onClick={() => p.escolher('custom')} aria-pressed={p.periodo === 'custom'} className={cls(p.periodo === 'custom')}>
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{p.periodo === 'custom' ? p.rotulo : 'Personalizado'}
        </button>
      </div>
      {p.periodo === 'custom' && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-micro text-ink-muted">
          <label className="inline-flex items-center gap-1">de
            <input type="date" value={p.custom.de} max={p.custom.ate} onChange={e => e.target.value && p.mudarCustom({ ...p.custom, de: e.target.value })}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-micro text-ink" />
          </label>
          <label className="inline-flex items-center gap-1">até
            <input type="date" value={p.custom.ate} min={p.custom.de} max={isoDia(new Date())} onChange={e => e.target.value && p.mudarCustom({ ...p.custom, ate: e.target.value })}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-micro text-ink" />
          </label>
        </div>
      )}
    </div>
  )
}

/** Abas do topo das páginas de anúncios. */
export function AbasAnuncios() {
  const abas = [
    { to: '/anuncios', l: 'Visão geral', end: true },
    { to: '/anuncios/criativos', l: 'Criativos do Meta', end: true },
    { to: '/anuncios/criativos?aba=google', l: 'Google' },
  ]
  const loc = useLocation()
  const atual = loc.pathname + loc.search
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Páginas de anúncios">
      {abas.map(a => {
        const google = loc.search.includes('aba=google')
        const ativo = a.to === '/anuncios' ? loc.pathname === '/anuncios'
          : a.to.includes('aba=google') ? loc.pathname === '/anuncios/criativos' && google
          : loc.pathname === '/anuncios/criativos' && !google
        return (
          <NavLink key={a.to} to={a.to} end={a.end} aria-current={ativo ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-body ${ativo ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            {a.l}
          </NavLink>
        )
      })}
    </nav>
  )
}
