import { useStats } from '@/hooks/useStats'
import { Card, CardContent } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { Users, UserCheck, UserX, MapPin } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7', '#f0fdf4']

export function Dashboard() {
  const { data, isLoading } = useStats()

  if (isLoading || !data) return <PageLoading />

  const { stats, byState, byVendor } = data

  const kpis = [
    { label: 'Total Contatos', value: stats.total, icon: Users, color: 'text-brand-600 bg-brand-50' },
    { label: 'Atribuidos', value: stats.assigned, icon: UserCheck, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Sem Vendedor', value: stats.unassigned, icon: UserX, color: 'text-amber-600 bg-amber-50' },
    { label: 'Estados', value: stats.states, icon: MapPin, color: 'text-blue-600 bg-blue-50' },
  ]

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">Visao geral dos contatos Branorte</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${k.color}`}>
                <k.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(k.value)}</p>
                <p className="text-xs text-text-muted">{k.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* By State */}
        <Card>
          <CardContent>
            <h2 className="font-semibold text-text-primary mb-4">Top Estados</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byState.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v: number) => formatNumber(v)} />
                  <YAxis type="category" dataKey="state" width={30} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => formatNumber(v)} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {byState.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* By Vendor */}
        <Card>
          <CardContent>
            <h2 className="font-semibold text-text-primary mb-4">Contatos por Vendedor</h2>
            <div className="space-y-3">
              {byVendor.map(v => {
                const pct = stats.assigned > 0 ? Math.round((v.count / stats.assigned) * 100) : 0
                return (
                  <div key={v.vendor_id} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center">
                      <span className="text-xs font-bold text-brand-700">{v.vendor_name.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-text-primary truncate">{v.vendor_name}</span>
                        <span className="text-sm text-text-secondary">{formatNumber(v.count)}</span>
                      </div>
                      <div className="h-2 bg-surface-tertiary rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
