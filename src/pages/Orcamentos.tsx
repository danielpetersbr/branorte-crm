import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOrcamentoStats } from '@/hooks/useOrcamentoStats'
import { useVendors } from '@/hooks/useVendors'
import { usePipelineVendedor } from '@/hooks/usePipelineVendedor'
import { Card, CardContent } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { FileText, TrendingUp, Calendar, BarChart2, Trophy, Handshake, Hourglass, XCircle, Snowflake } from 'lucide-react'
import { OrcamentosLista } from '@/pages/OrcamentosLista'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const BRAND_COLORS = [
  '#15803d', '#16a34a', '#22c55e', '#4ade80', '#86efac',
  '#166534', '#14532d', '#065f46', '#047857', '#059669',
  '#10b981', '#34d399', '#6ee7b7',
]

export function Orcamentos() {
  const [viewMode, setViewMode] = useState<'year' | 'month'>('year')
  const loc = useLocation()
  const tab: 'painel' | 'lista' = loc.pathname.startsWith('/orcamentos/lista') ? 'lista' : 'painel'

  const { data, isLoading } = useOrcamentoStats()
  const { data: vendorsList } = useVendors({ incluirInativos: true })
  const { data: pipeline } = usePipelineVendedor()

  const vendorChartData = useMemo(() => {
    if (!data?.vendorStats) return []
    const nameById = new Map((vendorsList ?? []).map(v => [v.id, v.name]))
    return data.vendorStats
      .map(v => ({
        name: v.vendor_id == null ? 'Sem vendedor' : (nameById.get(v.vendor_id) ?? '—'),
        count: v.count,
        unassigned: v.vendor_id == null,
      }))
      .sort((a, b) => b.count - a.count)
  }, [data?.vendorStats, vendorsList])

  if (isLoading || !data) return <PageLoading />

  const { total, yearStats, monthStats, hasMonthData } = data

  const busiestYear = yearStats.length > 0
    ? yearStats.reduce((a, b) => a.count > b.count ? a : b)
    : null

  const last2Years = yearStats.slice(-2)
  const yoyRaw = last2Years.length === 2 && last2Years[0].count > 0
    ? (last2Years[1].count - last2Years[0].count) / last2Years[0].count * 100
    : null
  const yoy = yoyRaw !== null ? yoyRaw.toFixed(1) : null

  const chartData = viewMode === 'year' ? yearStats : monthStats
  const xKey = viewMode === 'year' ? 'year' : 'label'

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Orçamentos</h1>
          <p className="text-sm text-text-secondary mt-1">
            Inventário do drive de rede Z:\1 - Comercial\3 - Orçamento — {formatNumber(total)} arquivos únicos
          </p>
        </div>

        {tab === 'painel' && hasMonthData && (
          <div className="flex rounded-lg border border-surface-border overflow-hidden">
            <button
              onClick={() => setViewMode('year')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'year'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-text-secondary hover:bg-surface-tertiary'
              }`}
            >
              Anual
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === 'month'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-text-secondary hover:bg-surface-tertiary'
              }`}
            >
              Mensal
            </button>
          </div>
        )}
      </div>

      {tab === 'lista' && <OrcamentosLista />}
      {tab === 'painel' && (
      <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
              <FileText className="h-6 w-6 text-brand-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(total)}</p>
              <p className="text-xs text-text-muted">Total Orçamentos</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <Calendar className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{busiestYear?.year ?? '—'}</p>
              <p className="text-xs text-text-muted">Ano Mais Ativo</p>
              {busiestYear && (
                <p className="text-xs text-emerald-600 mt-0.5">{formatNumber(busiestYear.count)} orç.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className={`text-2xl font-bold ${
                yoy === null ? 'text-text-primary'
                  : parseFloat(yoy) >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {yoy === null ? '—' : `${parseFloat(yoy) >= 0 ? '+' : ''}${yoy}%`}
              </p>
              <p className="text-xs text-text-muted">Variação Anual</p>
              {last2Years.length === 2 && (
                <p className="text-xs text-text-muted mt-0.5">{last2Years[0].year} → {last2Years[1].year}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <BarChart2 className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{yearStats.length}</p>
              <p className="text-xs text-text-muted">Anos Registrados</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline pessoal do vendedor (ou agregado pra admin) */}
      {pipeline && (
        <Card>
          <CardContent>
            <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
              <h2 className="font-semibold text-text-primary">
                {pipeline.scope === 'meu' ? 'Meu pipeline' : 'Pipeline geral'}
              </h2>
              <span className="text-xs text-text-muted">
                {pipeline.scope === 'meu'
                  ? 'Apenas seus orçamentos · clique pra filtrar a lista'
                  : 'Todos os vendedores · clique pra filtrar a lista'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Link
                to="/orcamentos/lista"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('branorte:orcamentos-filtros')
                    const f = raw ? JSON.parse(raw) : {}
                    localStorage.setItem('branorte:orcamentos-filtros', JSON.stringify({ ...f, statusVendedor: 'VENDIDO', page: 0 }))
                  } catch { /* noop */ }
                }}
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 hover:shadow-md transition-all dark:bg-emerald-900/20 dark:border-emerald-800/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Vendido</p>
                </div>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{formatNumber(pipeline.vendido)}</p>
                {pipeline.vendidoEsteMes > 0 && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">+{pipeline.vendidoEsteMes} este mês</p>
                )}
              </Link>

              <Link
                to="/orcamentos/lista"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('branorte:orcamentos-filtros')
                    const f = raw ? JSON.parse(raw) : {}
                    localStorage.setItem('branorte:orcamentos-filtros', JSON.stringify({ ...f, statusVendedor: 'NEGOCIANDO', page: 0 }))
                  } catch { /* noop */ }
                }}
                className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 hover:shadow-md transition-all dark:bg-yellow-900/20 dark:border-yellow-800/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Handshake className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <p className="text-[11px] uppercase tracking-wide text-yellow-700 dark:text-yellow-300">Negociando</p>
                </div>
                <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{formatNumber(pipeline.negociando)}</p>
              </Link>

              <Link
                to="/orcamentos/lista"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('branorte:orcamentos-filtros')
                    const f = raw ? JSON.parse(raw) : {}
                    localStorage.setItem('branorte:orcamentos-filtros', JSON.stringify({ ...f, statusVendedor: 'INTERESSE-FUTURO', page: 0 }))
                  } catch { /* noop */ }
                }}
                className="rounded-lg border border-sky-200 bg-sky-50 p-3 hover:shadow-md transition-all dark:bg-sky-900/20 dark:border-sky-800/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Hourglass className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <p className="text-[11px] uppercase tracking-wide text-sky-700 dark:text-sky-300">Interesse futuro</p>
                </div>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{formatNumber(pipeline.interesseFuturo)}</p>
              </Link>

              <Link
                to="/orcamentos/lista"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('branorte:orcamentos-filtros')
                    const f = raw ? JSON.parse(raw) : {}
                    localStorage.setItem('branorte:orcamentos-filtros', JSON.stringify({ ...f, statusVendedor: 'PERDIDO', page: 0 }))
                  } catch { /* noop */ }
                }}
                className="rounded-lg border border-red-200 bg-red-50 p-3 hover:shadow-md transition-all dark:bg-red-900/20 dark:border-red-800/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <p className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-300">Perdido</p>
                </div>
                <p className="text-2xl font-bold text-red-700 dark:text-red-300">{formatNumber(pipeline.perdido)}</p>
              </Link>

              <Link
                to="/orcamentos/lista"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('branorte:orcamentos-filtros')
                    const f = raw ? JSON.parse(raw) : {}
                    localStorage.setItem('branorte:orcamentos-filtros', JSON.stringify({ ...f, followUp: 'vencido', sort: 'follow_up', page: 0 }))
                  } catch { /* noop */ }
                }}
                className="rounded-lg border border-orange-200 bg-orange-50 p-3 hover:shadow-md transition-all dark:bg-orange-900/20 dark:border-orange-800/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Snowflake className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  <p className="text-[11px] uppercase tracking-wide text-orange-700 dark:text-orange-300">Frios pra retomar</p>
                </div>
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{formatNumber(pipeline.frios)}</p>
                <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5">+14 dias sem contato</p>
              </Link>

              <div className="rounded-lg border border-surface-border bg-surface-tertiary p-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-4 w-4 text-text-muted" />
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">
                    {pipeline.scope === 'meu' ? 'Meus totais' : 'Atribuídos'}
                  </p>
                </div>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(pipeline.totalAtribuido)}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{formatNumber(pipeline.semStatus)} sem status</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main chart */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="font-semibold text-text-primary">
              Orçamentos por {viewMode === 'year' ? 'Ano' : 'Mês'}
            </h2>
            {viewMode === 'month' && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">
                Mês baseado em data de modificação do arquivo
              </span>
            )}
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 4, left: 0, bottom: viewMode === 'month' ? 60 : 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey={xKey}
                  tick={{ fontSize: 12 }}
                  angle={viewMode === 'month' ? -45 : 0}
                  textAnchor={viewMode === 'month' ? 'end' : 'middle'}
                  interval={viewMode === 'month' ? 2 : 0}
                />
                <YAxis tickFormatter={(v: number) => formatNumber(v)} width={55} />
                <Tooltip
                  formatter={(v: number) => [formatNumber(v), 'Orçamentos']}
                  labelFormatter={(label) => `${viewMode === 'year' ? 'Ano' : 'Mês'}: ${label}`}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={BRAND_COLORS[i % BRAND_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Vendor chart */}
      {vendorChartData.length > 0 && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="font-semibold text-text-primary">Orçamentos por Vendedor</h2>
              <span className="text-xs text-text-muted">
                Extraído do .txt (Pedro enviou para o cliente…) — vazio = não identificado
              </span>
            </div>
            <div style={{ height: Math.max(280, vendorChartData.length * 32 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={vendorChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v: number) => formatNumber(v)} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
                  <Tooltip
                    formatter={(v: number) => [formatNumber(v), 'Orçamentos']}
                    labelFormatter={(label) => `Vendedor: ${label}`}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {vendorChartData.map((row, i) => (
                      <Cell
                        key={i}
                        fill={row.unassigned ? '#9ca3af' : BRAND_COLORS[i % BRAND_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Year breakdown table */}
      <Card>
        <CardContent>
          <h2 className="font-semibold text-text-primary mb-4">Detalhe por Ano</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left py-2 pr-6 font-medium text-text-secondary w-20">Ano</th>
                  <th className="text-right py-2 pr-6 font-medium text-text-secondary">Orçamentos</th>
                  <th className="text-right py-2 pr-6 font-medium text-text-secondary hidden sm:table-cell">Variação</th>
                  <th className="text-right py-2 font-medium text-text-secondary">% do Total</th>
                </tr>
              </thead>
              <tbody>
                {[...yearStats].reverse().map((y, idx, arr) => {
                  const prev = arr[idx + 1]
                  const change = prev && prev.count > 0
                    ? ((y.count - prev.count) / prev.count * 100)
                    : null
                  const pct = total > 0 ? (y.count / total * 100) : 0
                  return (
                    <tr key={y.year} className="border-b border-surface-border last:border-0 hover:bg-surface-tertiary transition-colors">
                      <td className="py-2.5 pr-6 font-semibold text-text-primary">{y.year}</td>
                      <td className="py-2.5 pr-6 text-right text-text-primary tabular-nums">{formatNumber(y.count)}</td>
                      <td className="py-2.5 pr-6 text-right hidden sm:table-cell">
                        {change !== null ? (
                          <span className={`text-xs font-medium ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 bg-surface-tertiary rounded-full w-20 overflow-hidden hidden sm:block">
                            <div
                              className="h-full bg-brand-500 rounded-full transition-all"
                              style={{ width: `${Math.min(pct * 4, 100)}%` }}
                            />
                          </div>
                          <span className="text-text-secondary text-xs w-10 text-right tabular-nums">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  )
}
