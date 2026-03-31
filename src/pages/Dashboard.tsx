import { useStats } from '@/hooks/useStats'
import { Card, CardContent } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { Users, UserCheck, UserX, MapPin, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts'

const STATE_COLORS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7', '#f0fdf4']

export function Dashboard() {
  const { data, isLoading } = useStats()

  if (isLoading || !data) return <PageLoading />

  const { stats, byState, byVendor } = data

  const assignedPct = stats.total > 0 ? ((stats.assigned / stats.total) * 100).toFixed(1) : '0'
  const unassignedPct = stats.total > 0 ? ((stats.unassigned / stats.total) * 100).toFixed(1) : '0'
  const isUnassignedCritical = stats.total > 0 && stats.unassigned / stats.total > 0.5

  const kpis = [
    {
      label: 'Total Contatos',
      value: stats.total,
      icon: Users,
      color: 'text-brand-600 bg-brand-50',
      sub: null,
    },
    {
      label: 'Atribuidos',
      value: stats.assigned,
      icon: UserCheck,
      color: 'text-emerald-600 bg-emerald-50',
      sub: { text: `${assignedPct}% do total`, className: 'text-emerald-600' },
    },
    {
      label: 'Sem Vendedor',
      value: stats.unassigned,
      icon: UserX,
      color: isUnassignedCritical ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50',
      sub: { text: `${unassignedPct}% do total`, className: isUnassignedCritical ? 'text-red-600 font-semibold' : 'text-amber-600' },
    },
    {
      label: 'Estados',
      value: stats.states,
      icon: MapPin,
      color: 'text-blue-600 bg-blue-50',
      sub: null,
    },
  ]

  const pieData = [
    { name: 'Atribuidos', value: stats.assigned, fill: '#22c55e' },
    { name: 'Sem Vendedor', value: stats.unassigned, fill: isUnassignedCritical ? '#ef4444' : '#f59e0b' },
  ]

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">Visao geral dos contatos Branorte</p>
      </div>

      {/* Alert banner */}
      {isUnassignedCritical && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700 font-medium">
            <span className="font-bold">{unassignedPct}% dos contatos</span> estao sem vendedor atribuido —{' '}
            {formatNumber(stats.unassigned)} contatos precisam de atencao.
          </p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${k.color}`}>
                <k.icon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-text-primary">{formatNumber(k.value)}</p>
                <p className="text-xs text-text-muted">{k.label}</p>
                {k.sub && (
                  <p className={`text-xs mt-0.5 ${k.sub.className}`}>{k.sub.text}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* By State */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent>
              <h2 className="font-semibold text-text-primary mb-4">Top Estados</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byState.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v: number) => formatNumber(v)} />
                    <YAxis type="category" dataKey="state" width={30} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => [formatNumber(v), 'Contatos']} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {byState.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={STATE_COLORS[i % STATE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Atribuicao donut */}
        <Card>
          <CardContent>
            <h2 className="font-semibold text-text-primary mb-4">Atribuicao</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [formatNumber(v), '']} />
                  <Legend iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Atribuidos</span>
                <span className="font-semibold text-emerald-600">{assignedPct}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Sem vendedor</span>
                <span className={`font-semibold ${isUnassignedCritical ? 'text-red-600' : 'text-amber-600'}`}>{unassignedPct}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* By Vendor */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-text-primary">Contatos por Vendedor</h2>
            <span className="text-xs text-text-muted">% do total de contatos</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
            {byVendor.map(v => {
              const pct = stats.total > 0 ? (v.count / stats.total) * 100 : 0
              return (
                <div key={v.vendor_id} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-brand-700">{v.vendor_name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-primary truncate">{v.vendor_name}</span>
                      <span className="text-xs text-text-secondary ml-2 shrink-0">{formatNumber(v.count)} · {pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-surface-tertiary rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.min(pct * 5, 100)}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
