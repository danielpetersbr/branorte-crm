import { useDashboard } from '@/hooks/useDashboard'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2 } from 'lucide-react'

const COLORS = {
  accent: 'hsl(152 60% 40%)',
  warn: 'hsl(38 92% 50%)',
  danger: 'hsl(0 72% 51%)',
  info: 'hsl(217 91% 60%)',
  ink: 'hsl(240 5% 45%)',
  inkFaint: 'hsl(240 4% 65%)',
  border: 'hsl(240 6% 90%)',
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-5 ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-ink-faint mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

function fmtN(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n)
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function Dashboard() {
  const { data, isLoading, error } = useDashboard()

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-surface-2 rounded-lg animate-pulse" />)}
        </div>
        <div className="h-72 bg-surface-2 rounded-lg animate-pulse" />
        <div className="h-72 bg-surface-2 rounded-lg animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="border border-danger/30 bg-danger-bg rounded-lg p-4 text-sm text-danger">
          Erro ao carregar dados do dashboard.
        </div>
      </div>
    )
  }

  const heroKpis = [
    { label: 'Total de leads', value: data.totalLeads, icon: Users, color: 'text-ink', tone: 'neutral' as const, sub: `${data.comTelefone} com telefone` },
    { label: 'Hoje', value: data.hoje, icon: TrendingUp, color: 'text-info', tone: 'info' as const, sub: 'leads novos' },
    { label: 'Quentes', value: data.quentes, icon: Flame, color: 'text-danger', tone: 'danger' as const, sub: 'querem comprar agora' },
    { label: 'Qualificados', value: data.qualificados, icon: CheckCircle2, color: 'text-accent', tone: 'success' as const, sub: 'preencheram tudo' },
  ]

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Dashboard</h1>
          <p className="text-xs text-ink-faint mt-0.5">{fmtN(data.totalLeads)} leads · atualiza a cada 60s</p>
        </div>
      </div>

      {/* HERO KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {heroKpis.map(k => (
          <div key={k.label} className="bg-surface border border-border rounded-lg p-4 relative overflow-hidden">
            {k.tone !== 'neutral' && (
              <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                k.tone === 'danger' ? 'bg-danger' : k.tone === 'success' ? 'bg-accent' : 'bg-info'
              }`} />
            )}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-ink-faint">{k.label}</p>
                <p className="text-3xl font-semibold text-ink mt-1.5 tabular-nums">{fmtN(k.value)}</p>
                <p className="text-[11px] text-ink-faint mt-1">{k.sub}</p>
              </div>
              <k.icon className={`h-4 w-4 ${k.color}`} />
            </div>
          </div>
        ))}
      </div>

      {/* GRID 2 COL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. FUNIL */}
        <Card>
          <CardHeader
            title="Funil de qualificação"
            subtitle="Onde os leads desistem do bot"
          />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funil} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="etapa"
                  width={130}
                  tick={{ fontSize: 11, fill: COLORS.ink }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number, _n: unknown, p: { payload?: { pct?: number } }) => [`${fmtN(v)} (${(p.payload?.pct ?? 0).toFixed(1)}%)`, 'Leads']) as never}
                  cursor={{ fill: 'hsl(var(--surface-2))' }}
                />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]} barSize={20}>
                  {data.funil.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? COLORS.accent : `hsla(152, 60%, ${40 + i * 4}%, ${1 - i * 0.05})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 2. LEADS POR DIA */}
        <Card>
          <CardHeader
            title="Leads por dia"
            subtitle="Últimos 30 dias"
          />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.leadsPorDia} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: COLORS.inkFaint }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: string) => v.slice(8, 10) + '/' + v.slice(5, 7)}
                  interval={4}
                />
                <YAxis tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number) => [fmtN(v), 'Leads']) as never}
                  labelFormatter={((l: string) => new Date(l).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })) as never}
                />
                <Line
                  type="monotone"
                  dataKey="leads"
                  stroke={COLORS.accent}
                  strokeWidth={2}
                  dot={{ r: 2, fill: COLORS.accent }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 3. POR CRIATIVO */}
        <Card>
          <CardHeader
            title="CTR por criativo"
            subtitle="Volume vs % qualificados — Top 10"
          />
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.porCriativo.map(c => ({
                  ...c,
                  label: `${c.codigo} ${c.nome.length > 18 ? c.nome.slice(0, 16) + '…' : c.nome}`,
                }))}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={170}
                  tick={{ fontSize: 11, fill: COLORS.ink }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number, n: string) => n === 'total' ? [fmtN(v), 'Leads'] : [fmtN(v), 'Qualificados']) as never}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="total" name="Leads" fill={COLORS.info} radius={[0, 3, 3, 0]} barSize={10} />
                <Bar dataKey="qualificados" name="Qualificados" fill={COLORS.accent} radius={[0, 3, 3, 0]} barSize={10} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* lista CTR % */}
          <div className="mt-3 space-y-1 text-[11px]">
            {data.porCriativo.slice(0, 5).map(c => (
              <div key={c.codigo} className="flex justify-between text-ink-muted">
                <span className="font-mono">{c.codigo}</span>
                <span className={c.ctr >= 10 ? 'text-accent' : c.ctr === 0 ? 'text-danger' : 'text-warning'}>
                  CTR {c.ctr.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* 4. POR ORIGEM */}
        <Card>
          <CardHeader
            title="Conversão por origem"
            subtitle="Qual canal traz lead que qualifica"
          />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porOrigem} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="origem" tick={{ fontSize: 11, fill: COLORS.ink }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number) => [fmtN(v), '']) as never}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="total" name="Total" fill={COLORS.info} radius={[3, 3, 0, 0]} barSize={28} />
                <Bar dataKey="qualificados" name="Qualificados" fill={COLORS.accent} radius={[3, 3, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 5. POR VENDEDOR */}
        <Card>
          <CardHeader
            title="Distribuição por vendedor"
            subtitle="Quantos leads cada um recebeu"
          />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porVendedor.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="vendedor"
                  width={110}
                  tick={{ fontSize: 11, fill: COLORS.ink }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number) => [fmtN(v), 'Leads']) as never}
                  cursor={{ fill: 'hsl(var(--surface-2))' }}
                />
                <Bar dataKey="total" radius={[0, 3, 3, 0]} barSize={16}>
                  {data.porVendedor.slice(0, 12).map((v, i) => (
                    <Cell key={i} fill={v.vendedor === 'Sem vendedor' ? COLORS.inkFaint : COLORS.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 6. MOMENTO DE COMPRA */}
        <Card>
          <CardHeader
            title="Momento de compra"
            subtitle="Urgência do pipeline"
          />
          <div className="h-[280px] flex items-center">
            <div className="flex-1 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.porMomento}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={88}
                    paddingAngle={2}
                    dataKey="valor"
                    nameKey="momento"
                  >
                    {data.porMomento.map((m, i) => (
                      <Cell key={i} fill={m.cor} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                    formatter={((v: number) => [fmtN(v), '']) as never}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 pr-4 min-w-[140px]">
              {data.porMomento.map(m => {
                const total = data.porMomento.reduce((s, x) => s + x.valor, 0)
                const pct = total > 0 ? (m.valor / total) * 100 : 0
                return (
                  <div key={m.momento} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: m.cor }} />
                    <span className="text-ink flex-1 truncate">{m.momento}</span>
                    <span className="font-mono text-ink-faint tabular-nums">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
              {data.porMomento.length === 0 && <p className="text-[11px] text-ink-faint">Sem dados</p>}
            </div>
          </div>
        </Card>

        {/* 7. ANIMAL X FINALIDADE */}
        <Card>
          <CardHeader
            title="Animal × Finalidade"
            subtitle="Mix de mercado"
          />
          <div className="h-[280px]">
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
                <Bar dataKey="vender" name="Vender" stackId="a" fill={COLORS.accent} radius={[0, 0, 0, 0]} barSize={36} />
                <Bar dataKey="consumo" name="Consumo" stackId="a" fill={COLORS.info} radius={[0, 0, 0, 0]} barSize={36} />
                <Bar dataKey="ambos" name="Ambos" stackId="a" fill={COLORS.warn} radius={[3, 3, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 8. DIA X HORA HEATMAP */}
        <Card>
          <CardHeader
            title="Quando chegam os leads"
            subtitle="Mapa dia da semana × hora"
          />
          <div className="overflow-x-auto pb-2">
            <DiaHoraHeatmap data={data.diaXHora} />
          </div>
        </Card>
      </div>

      {/* GRID FULL WIDTH */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 9. UF — Top 15 */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Distribuição por estado"
            subtitle={`Top 15 estados / países (${fmtN(data.porUf.reduce((s, u) => s + u.total, 0))} leads geolocalizados)`}
          />
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porUf} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="uf"
                  width={50}
                  tick={{ fontSize: 11, fill: COLORS.ink, fontFamily: 'Geist Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number) => [fmtN(v), 'Leads']) as never}
                  cursor={{ fill: 'hsl(var(--surface-2))' }}
                />
                <Bar dataKey="total" radius={[0, 3, 3, 0]} barSize={14}>
                  {data.porUf.map((u, i) => (
                    <Cell key={i} fill={u.uf === 'SEM' || u.uf === 'INTL' ? COLORS.inkFaint : `hsl(152 60% ${40 + i * 2}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 10. SCORE QUALIDADE GAUGE */}
        <Card>
          <CardHeader
            title="Qualidade dos leads"
            subtitle="% que preencheram tudo"
          />
          <div className="flex flex-col items-center justify-center h-[280px]">
            <div className="relative">
              <svg width="180" height="180" viewBox="0 0 180 180">
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
            <div className="grid grid-cols-3 gap-3 w-full mt-4 text-center">
              <div>
                <p className="text-base font-semibold text-accent tabular-nums">{fmtN(data.qualidade.completos)}</p>
                <p className="text-[10px] text-ink-faint">Completos</p>
              </div>
              <div>
                <p className="text-base font-semibold text-warning tabular-nums">{fmtN(data.qualidade.parciais)}</p>
                <p className="text-[10px] text-ink-faint">Parciais</p>
              </div>
              <div>
                <p className="text-base font-semibold text-ink-faint tabular-nums">{fmtN(data.qualidade.vazios)}</p>
                <p className="text-[10px] text-ink-faint">Vazios</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

// Heatmap dia × hora (componente interno) ----------------------------------
function DiaHoraHeatmap({ data }: { data: { weekday: number; hour: number; valor: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.valor))

  // Agrupa por weekday
  const grid: Record<number, Record<number, number>> = {}
  for (const d of data) {
    grid[d.weekday] = grid[d.weekday] ?? {}
    grid[d.weekday][d.hour] = d.valor
  }

  // Mostra 24h, mas pula horas vazias se quiser. Aqui mostra todas.
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const days = [0, 1, 2, 3, 4, 5, 6] // Dom-Sáb

  return (
    <div className="text-[10px]">
      {/* Header de horas */}
      <div className="flex">
        <div className="w-9 shrink-0" />
        {hours.map(h => (
          <div key={h} className="flex-1 min-w-[18px] text-center text-ink-faint tabular-nums">
            {h % 3 === 0 ? h : ''}
          </div>
        ))}
      </div>
      {/* Linhas */}
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
                className="flex-1 min-w-[18px] aspect-square rounded-[2px] border border-border/30"
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
