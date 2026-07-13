import { useState } from 'react'
import { Filter, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { ufFromTelefone } from '@/lib/ddd-uf'
import {
  useFunilSiteList,
  useFunilSiteFunil,
  FUNIL_PAGE_SIZE,
  type FunilSessao,
  type FunilTab,
} from '@/hooks/useFunilSite'

const PASSO_LABEL = [
  'Iniciou',
  'Deu o nome',
  'Escolheu o que quer',
  'Qualificou',
  'Deu o WhatsApp',
  'Concluiu',
  'Enviado ao vendedor',
]

const AV_COLORS = ['#2f9e63', '#c2711f', '#b23b5e', '#2a72b8', '#7a53c0', '#0f7d84', '#b0902a', '#8a4b2f']

function initials(nome: string | null): string {
  if (!nome) return '?'
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}
function avatarColor(nome: string | null): string {
  const n = nome ?? ''
  let s = 0
  for (let i = 0; i < n.length; i++) s += n.charCodeAt(i)
  return AV_COLORS[s % AV_COLORS.length]
}
function fmtFone(tel: string | null): string {
  if (!tel) return '—'
  let d = tel.replace(/\D/g, '')
  if (d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return tel
  const dd = d.slice(0, 2)
  const rest = d.slice(2)
  return rest.length === 9
    ? `(${dd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    : `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
}
function relTime(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const dias = Math.floor(h / 24)
  if (dias < 7) return `há ${dias} d`
  return new Date(iso).toLocaleDateString('pt-BR')
}
function interesse(s: FunilSessao): { titulo: string; detalhe: string } {
  if (s.objetivo === 'fabrica') {
    const partes = [s.animal, s.manejo, s.quantidade, s.uso].filter(Boolean)
    return { titulo: 'Fábrica de ração', detalhe: partes.join(' · ') || 'ainda qualificando' }
  }
  if (s.objetivo === 'equipamento') {
    const partes = [s.equip, s.porte, s.uso].filter(Boolean)
    return { titulo: 'Equipamento', detalhe: partes.join(' · ') || 'ainda qualificando' }
  }
  return { titulo: '—', detalhe: 'ainda não escolheu' }
}
function StatusBadge({ s }: { s: FunilSessao }) {
  if (s.ultimo_passo >= 6)
    return <span className="inline-flex items-center gap-1 rounded-full bg-accent-bg text-accent text-xs font-semibold px-2.5 py-1 whitespace-nowrap">→ {s.vendedor || 'vendedor'}</span>
  if (s.ultimo_passo >= 5)
    return <span className="inline-flex items-center rounded-full bg-accent-bg text-accent text-xs font-semibold px-2.5 py-1">Concluiu</span>
  if (s.ultimo_passo >= 4)
    return <span className="inline-flex items-center rounded-full bg-info-bg text-info text-xs font-semibold px-2.5 py-1">Só contato</span>
  return <span className="inline-flex items-center rounded-full bg-warning-bg text-warning text-xs font-semibold px-2.5 py-1">Abandonou</span>
}

const TABS: { key: FunilTab; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'enviado', label: 'Foram p/ vendedor' },
  { key: 'concluiu', label: 'Concluíram' },
  { key: 'parou', label: 'Abandonaram' },
]

export function FunilSite() {
  const [filters, setFilters] = useState<{ search: string; tab: FunilTab; page: number }>({ search: '', tab: 'todos', page: 0 })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useFunilSiteList(filters)
  const { data: funil } = useFunilSiteFunil()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / FUNIL_PAGE_SIZE))

  const iniciaram = funil?.find((s) => s.passo === 0)?.count ?? 0
  const contato = funil?.find((s) => s.passo === 4)?.count ?? 0
  const concluiram = funil?.find((s) => s.passo === 5)?.count ?? 0
  const enviados = funil?.find((s) => s.passo === 6)?.count ?? 0
  const pct = (n: number) => (iniciaram > 0 ? Math.round((n / iniciaram) * 100) : 0)
  const funMax = funil && funil.length ? funil[0].count || 1 : 1

  const applySearch = () => setFilters((f) => ({ ...f, search: searchInput.trim(), page: 0 }))

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Filter className="h-6 w-6 text-accent" /> Funil do Site
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          Quem entrou pelo site/anúncio, respondeu o quiz da Ana e virou lead pro vendedor.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Iniciaram o quiz</p>
          <p className="text-2xl font-bold text-ink mt-1 tabular-nums">{iniciaram.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Deixaram contato</p>
          <p className="text-2xl font-bold text-ink mt-1 tabular-nums">{contato.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-ink-faint mt-1"><span className="text-accent font-semibold">{pct(contato)}%</span> do total</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-ink-faint uppercase tracking-wide">Concluíram</p>
          <p className="text-2xl font-bold text-ink mt-1 tabular-nums">{concluiram.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-ink-faint mt-1"><span className="text-accent font-semibold">{pct(concluiram)}%</span> do total</p>
        </div>
        <div className="border border-accent/30 rounded-lg p-4" style={{ background: 'hsl(var(--accent-bg))' }}>
          <p className="text-xs font-medium text-accent/80 uppercase tracking-wide">Foram pro vendedor</p>
          <p className="text-2xl font-bold text-accent mt-1 tabular-nums">{enviados.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-ink-faint mt-1"><span className="text-accent font-semibold">{pct(enviados)}%</span> viraram atendimento</p>
        </div>
      </div>

      {/* Funil */}
      <div className="bg-surface border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Até onde cada um preenche</h2>
        <p className="text-xs text-ink-faint mb-4">A barra é a % de quem chegou naquele passo.</p>
        <div className="space-y-2.5">
          {(funil ?? []).map((s, i) => {
            const prev = i > 0 ? (funil?.[i - 1].count ?? s.count) : s.count
            const drop = prev - s.count
            const dropP = i > 0 && prev > 0 ? Math.round((drop / prev) * 100) : 0
            const w = Math.round((s.count / funMax) * 100)
            return (
              <div key={s.key} className="grid grid-cols-[130px_1fr_auto] sm:grid-cols-[160px_1fr_auto] items-center gap-3">
                <span className="text-xs sm:text-sm text-ink-muted truncate">{s.label}</span>
                <div className="h-7 bg-surface-2 rounded-md overflow-hidden">
                  <div
                    className="h-full rounded-md bg-accent flex items-center pl-2 text-[11px] font-bold tabular-nums transition-all"
                    style={{ width: `${Math.max(w, 6)}%`, color: '#04130b' }}
                  >
                    {pct(s.count)}%
                  </div>
                </div>
                <div className="text-right min-w-[74px]">
                  <span className="text-sm font-semibold text-ink tabular-nums">{s.count.toLocaleString('pt-BR')}</span>
                  {i > 0 && (
                    <span className={`block text-[11px] font-medium ${drop > 0 ? 'text-danger' : 'text-ink-faint'}`}>
                      {drop > 0 ? `−${drop.toLocaleString('pt-BR')} (−${dropP}%)` : '—'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-ink">Leads do funil</h2>
          <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setFilters((f) => ({ ...f, tab: t.key, page: 0 }))}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                  filters.tab === t.key ? 'bg-accent text-[#04130b]' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="h-4 w-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="Buscar por nome ou telefone…"
              className="w-full bg-bg border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">Lead</th>
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">WhatsApp</th>
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-3 py-3">UF</th>
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">Interesse</th>
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">Até onde chegou</th>
                <th className="text-left text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-right text-[11px] font-semibold text-ink-faint uppercase tracking-wide px-4 py-3">Quando</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted text-sm">Carregando…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted text-sm">Nenhum lead ainda. Assim que o quiz for publicado, eles aparecem aqui.</td></tr>
              )}
              {rows.map((s) => {
                const it = interesse(s)
                const passo = Math.min(Math.max(s.ultimo_passo, 0), 6)
                return (
                  <tr key={s.id} className="border-t border-border hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0" style={{ background: avatarColor(s.nome) }}>
                          {initials(s.nome)}
                        </div>
                        <span className="text-sm font-medium text-ink">{s.nome || '(sem nome)'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-muted font-mono whitespace-nowrap">{fmtFone(s.telefone)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center justify-center rounded bg-info-bg text-info text-[11px] font-bold px-1.5 py-1 min-w-[26px]">
                        {ufFromTelefone(s.telefone)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-ink block">{it.titulo}</span>
                      <span className="text-xs text-ink-faint">{it.detalhe}</span>
                    </td>
                    <td className="px-4 py-3 min-w-[150px]">
                      <span className="text-xs font-medium text-ink-muted">{PASSO_LABEL[passo]}</span>
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden mt-1.5">
                        <div className={`h-full rounded-full ${passo >= 5 ? 'bg-accent' : passo >= 2 ? 'bg-info' : 'bg-warning'}`} style={{ width: `${Math.round((passo / 6) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge s={s} /></td>
                    <td className="px-4 py-3 text-right text-xs text-ink-faint whitespace-nowrap">{relTime(s.updated_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
          <p className="text-xs text-ink-faint">{total.toLocaleString('pt-BR')} lead{total !== 1 ? 's' : ''}</p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button disabled={filters.page === 0} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))} className="p-1.5 rounded-md border border-border text-ink-muted disabled:opacity-40 hover:bg-surface-2">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-ink-muted tabular-nums">{filters.page + 1} / {totalPages}</span>
              <button disabled={filters.page >= totalPages - 1} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))} className="p-1.5 rounded-md border border-border text-ink-muted disabled:opacity-40 hover:bg-surface-2">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
