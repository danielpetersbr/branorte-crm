import { useState } from 'react'
import { useOrcamentoStats } from '@/hooks/useOrcamentoStats'
import { Card, CardContent } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { FileText, TrendingUp, Calendar, BarChart2 } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const BRAND_COLORS = [
  '#15803d', '#16a34a', '#22c55e', '#4ade80', '#86efac',
  '#166534', '#14532d', '#065f46', '#047857', '#059669',
  '#10b981', '#34d399', '#6ee7b7',
]

// Cores e legendas amigáveis pra cada status do kanban-de-pasta da Branorte.
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'Em-andamento':         { label: 'Em andamento',           color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'Em-producao':          { label: 'Em produção',            color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Pronto-carregamento':  { label: 'Pronto p/ carregamento', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  'Enviado':              { label: 'Enviado',                color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'Contrato-fechado':     { label: 'Contrato fechado',       color: 'bg-green-50 text-green-700 border-green-200' },
  'Desistiu':             { label: 'Desistiu',               color: 'bg-gray-50 text-gray-600 border-gray-200' },
  'Perdido-concorrente':  { label: 'Perdido p/ concorrente', color: 'bg-red-50 text-red-700 border-red-200' },
  'Proforma':             { label: 'Proforma',               color: 'bg-violet-50 text-violet-700 border-violet-200' },
  'Em-andamento-silos':   { label: 'Em andamento (silos)',   color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'Historico':            { label: 'Histórico (2012-2018)',  color: 'bg-stone-50 text-stone-600 border-stone-200' },
}

export function Orcamentos() {
  const [viewMode, setViewMode] = useState<'year' | 'month'>('year')

  const { data, isLoading } = useOrcamentoStats()

  if (isLoading || !data) return <PageLoading />

  const { total, yearStats, monthStats, statusStats, hasMonthData } = data

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

        <div className="flex items-center gap-3 flex-wrap">
          {hasMonthData && (
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
      </div>

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

      {/* Status breakdown (kanban-de-pasta) */}
      {statusStats.length > 0 && (
        <Card>
          <CardContent>
            <div className="flex items-baseline justify-between mb-4 gap-2 flex-wrap">
              <h2 className="font-semibold text-text-primary">Pipeline (kanban-de-pasta)</h2>
              <span className="text-xs text-text-muted">
                Status derivado da subpasta no drive Z:\
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {statusStats.map(s => {
                const meta = STATUS_LABELS[s.status] ?? { label: s.status, color: 'bg-gray-50 text-gray-700 border-gray-200' }
                const pct = total > 0 ? (s.count / total * 100) : 0
                return (
                  <div key={s.status} className={`rounded-lg border ${meta.color} p-3`}>
                    <p className="text-[11px] uppercase tracking-wide opacity-80">{meta.label}</p>
                    <p className="text-2xl font-bold mt-1">{formatNumber(s.count)}</p>
                    <p className="text-[11px] opacity-70 mt-0.5">{pct.toFixed(1)}% do total</p>
                  </div>
                )
              })}
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
    </div>
  )
}
