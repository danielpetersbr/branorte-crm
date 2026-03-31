import { useState } from 'react'
import { useOrcamentoStats } from '@/hooks/useOrcamentoStats'
import { useVendors } from '@/hooks/useVendors'
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

export function Orcamentos() {
  const [vendorFilter, setVendorFilter] = useState('todos')
  const [viewMode, setViewMode] = useState<'year' | 'month'>('year')

  const { data: vendors } = useVendors()
  const { data, isLoading } = useOrcamentoStats(vendorFilter)

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
          <p className="text-sm text-text-secondary mt-1">Volume histórico de orçamentos enviados</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Vendor filter */}
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            className="text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="todos">Todos os vendedores</option>
            {(vendors ?? []).map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          {/* View mode toggle — only show when monthly data is available */}
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

      {/* Main chart */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="font-semibold text-text-primary">
              Orçamentos por {viewMode === 'year' ? 'Ano' : 'Mês'}
            </h2>
            {!hasMonthData && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">
                Visão mensal disponível após executar update_dates.py
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
