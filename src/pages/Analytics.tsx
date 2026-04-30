import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset } from '@/hooks/useDashboard'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowLeft } from 'lucide-react'

const PRESET_LABELS: { value: DashboardPreset; label: string }[] = [
  { value: '',     label: 'Tudo' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: 'mes',  label: 'Este mês' },
]

const COLORS = {
  accent: 'hsl(152 60% 40%)',
  warn: 'hsl(38 92% 50%)',
  info: 'hsl(217 91% 60%)',
  ink: 'hsl(240 5% 45%)',
  inkFaint: 'hsl(240 4% 65%)',
  border: 'hsl(240 6% 90%)',
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function fmtN(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n)
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[13px] font-semibold text-ink tracking-tight">{title}</h3>
      {subtitle && <p className="text-[11px] text-ink-faint mt-0.5">{subtitle}</p>}
    </div>
  )
}

function usePresetFilter(): [DashboardPreset, (p: DashboardPreset) => void] {
  const [preset, setPreset] = useState<DashboardPreset>(() => {
    if (typeof window === 'undefined') return ''
    return (localStorage.getItem('dashboard-preset') as DashboardPreset) || ''
  })
  useEffect(() => {
    localStorage.setItem('dashboard-preset', preset)
  }, [preset])
  return [preset, setPreset]
}

export function Analytics() {
  const [preset, setPreset] = usePresetFilter()
  const { data, isLoading } = useDashboard({ preset })

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="h-72 bg-surface-2 rounded-xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/" className="text-[12px] text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft className="h-3 w-3" /> Voltar ao dashboard
          </Link>
          <h1 className="text-3xl font-semibold text-ink tracking-tight">Análise detalhada</h1>
          <p className="text-xs text-ink-faint mt-1">Cortes de mercado, sazonalidade e qualidade dos dados</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_LABELS.map(p => {
            const active = preset === p.value
            return (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={
                  'h-8 px-3 rounded-md text-[12px] font-medium border transition-colors ' +
                  (active
                    ? 'bg-accent-bg text-accent border-accent/30'
                    : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')
                }
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Animal x Finalidade */}
      <Card>
        <CardHeader title="Animal × Finalidade" subtitle="Mix de mercado — só leads que escolheram animal no bot" />
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.porAnimalFinalidade} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="animal" tick={{ fontSize: 11, fill: COLORS.ink }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                formatter={((v: number) => [fmtN(v), '']) as never}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Bar dataKey="vender" name="Vender" stackId="a" fill={COLORS.accent} barSize={48} />
              <Bar dataKey="consumo" name="Consumo" stackId="a" fill={COLORS.info} barSize={48} />
              <Bar dataKey="ambos" name="Ambos" stackId="a" fill={COLORS.warn} radius={[3, 3, 0, 0]} barSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Heatmap dia x hora */}
      <Card>
        <CardHeader title="Quando chegam os leads" subtitle="Heatmap dia da semana × hora — define escala de plantão" />
        <div className="overflow-x-auto pb-2">
          <DiaHoraHeatmap data={data.diaXHora} />
        </div>
      </Card>

      {/* Qualidade */}
      <Card>
        <CardHeader title="Qualidade dos leads" subtitle="% de leads que preencheram todos os campos do bot" />
        <div className="flex items-center gap-8">
          <div className="relative">
            <svg width="160" height="160" viewBox="0 0 180 180">
              <circle cx="90" cy="90" r="72" stroke="hsl(var(--surface-2))" strokeWidth="14" fill="none" />
              <circle
                cx="90"
                cy="90"
                r="72"
                stroke={COLORS.accent}
                strokeWidth="14"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(data.qualidade.pctCompleto / 100) * 452} 452`}
                transform="rotate(-90 90 90)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-ink tabular-nums">{data.qualidade.pctCompleto.toFixed(0)}%</span>
              <span className="text-[10px] text-ink-faint mt-1 uppercase tracking-widest">Completos</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 flex-1">
            <div>
              <p className="text-2xl font-semibold text-accent tabular-nums">{fmtN(data.qualidade.completos)}</p>
              <p className="text-[11px] text-ink-faint">Completos (5+ campos)</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-warning tabular-nums">{fmtN(data.qualidade.parciais)}</p>
              <p className="text-[11px] text-ink-faint">Parciais</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink-faint tabular-nums">{fmtN(data.qualidade.vazios)}</p>
              <p className="text-[11px] text-ink-faint">Vazios (0 campos)</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function DiaHoraHeatmap({ data }: { data: { weekday: number; hour: number; valor: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.valor))
  const grid: Record<number, Record<number, number>> = {}
  for (const d of data) {
    grid[d.weekday] = grid[d.weekday] ?? {}
    grid[d.weekday][d.hour] = d.valor
  }
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const days = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="text-[10px] min-w-[700px]">
      <div className="flex">
        <div className="w-9 shrink-0" />
        {hours.map(h => (
          <div key={h} className="flex-1 min-w-[24px] text-center text-ink-faint tabular-nums">
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
      </div>
      {days.map(wd => (
        <div key={wd} className="flex items-center gap-0.5 mt-0.5">
          <div className="w-9 shrink-0 text-ink-muted font-medium">{WEEKDAY_SHORT[wd]}</div>
          {hours.map(h => {
            const v = grid[wd]?.[h] ?? 0
            const intensity = v === 0 ? 0 : 0.15 + (v / max) * 0.85
            return (
              <div
                key={h}
                title={`${WEEKDAY_SHORT[wd]} ${h}h — ${v} leads`}
                className="flex-1 min-w-[24px] aspect-square rounded-[2px] border border-border/30"
                style={{
                  background: v === 0 ? 'hsl(var(--surface-2))' : `hsl(152 60% 40% / ${intensity})`,
                }}
              />
            )
          })}
        </div>
      ))}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-ink-faint">
        <span>Menos</span>
        {[0, 0.25, 0.5, 0.75, 1].map(i => (
          <div key={i} className="w-4 h-3 rounded-[2px] border border-border/30" style={{ background: i === 0 ? 'hsl(var(--surface-2))' : `hsl(152 60% 40% / ${0.15 + i * 0.85})` }} />
        ))}
        <span>Mais</span>
      </div>
    </div>
  )
}
