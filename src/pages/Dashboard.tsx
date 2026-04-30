import { useEffect, useState } from 'react'
import { useDashboard, type DashboardPreset } from '@/hooks/useDashboard'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown } from 'lucide-react'

const PRESET_LABELS: { value: DashboardPreset; label: string }[] = [
  { value: '',     label: 'Tudo' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: 'mes',  label: 'Este mês' },
]

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

const COLORS = {
  accent: 'hsl(152 60% 40%)',
  accentSoft: 'hsl(152 60% 40% / 0.15)',
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
  const [preset, setPreset] = usePresetFilter()
  const { data, isLoading, error } = useDashboard({ preset })

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
      {/* Header + filtros */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Dashboard</h1>
          <p className="text-xs text-ink-faint mt-0.5">
            {fmtN(data.totalLeads)} leads
            {preset && (
              <span className="text-accent"> · filtro: {PRESET_LABELS.find(p => p.value === preset)?.label}</span>
            )}
            <span className="text-ink-faint"> · atualiza a cada 60s</span>
          </p>
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
        {/* 1. FUNIL DE QUALIFICAÇÃO — refeito como funil visual real */}
        <Card>
          <CardHeader
            title="Funil de qualificação"
            subtitle={`Baseado em ${fmtN(data.leadsBotNovo)} leads que entraram via webhook do bot`}
          />
          <FunilVisual etapas={data.funil} />
        </Card>

        {/* 2. LEADS POR DIA — area chart com 2 series */}
        <Card>
          <CardHeader
            title="Leads por dia"
            subtitle={data.leadsPorDia.length > 0 ? `${data.leadsPorDia.length} dias com atividade` : 'Sem dados'}
          />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.leadsPorDia} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.info} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.info} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradQualif" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 10, fill: COLORS.inkFaint }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: string) => v.slice(8, 10) + '/' + v.slice(5, 7)}
                  interval="preserveStartEnd"
                  minTickGap={30}
                />
                <YAxis tick={{ fontSize: 10, fill: COLORS.inkFaint }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number, n: string) => [fmtN(v), n === 'total' ? 'Total' : 'Qualificados']) as never}
                  labelFormatter={((l: string) => new Date(l + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })) as never}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={COLORS.info}
                  strokeWidth={2}
                  fill="url(#gradTotal)"
                />
                <Area
                  type="monotone"
                  dataKey="qualificados"
                  stroke={COLORS.accent}
                  strokeWidth={2}
                  fill="url(#gradQualif)"
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 3. CTR POR CRIATIVO — lista compacta com mini-barras */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Performance por criativo"
            subtitle="Volume × % de qualificados"
            right={
              <div className="flex gap-3 text-[10px] text-ink-faint">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" /> Qualificou</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-surface-2 border border-border" /> Não qualificou</span>
              </div>
            }
          />
          <CriativosList criativos={data.porCriativo} />
        </Card>

        {/* 4. CONVERSÃO POR ORIGEM — refeito */}
        <Card>
          <CardHeader
            title="Conversão por canal"
            subtitle="Volume e % qualificados (exclui leads sem origem)"
          />
          <OrigemList origens={data.porOrigem} />
        </Card>

        {/* 5. POR VENDEDOR */}
        <Card>
          <CardHeader
            title="Distribuição por vendedor"
            subtitle="Volume e qualificados"
          />
          <VendedorList vendedores={data.porVendedor.slice(0, 10)} />
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
                <Bar dataKey="vender" name="Vender" stackId="a" fill={COLORS.accent} barSize={36} />
                <Bar dataKey="consumo" name="Consumo" stackId="a" fill={COLORS.info} barSize={36} />
                <Bar dataKey="ambos" name="Ambos" stackId="a" fill={COLORS.warn} radius={[3, 3, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 8. DIA X HORA HEATMAP */}
        <Card>
          <CardHeader
            title="Quando chegam os leads"
            subtitle="Mapa dia × hora"
          />
          <div className="overflow-x-auto pb-2">
            <DiaHoraHeatmap data={data.diaXHora} />
          </div>
        </Card>
      </div>

      {/* GRID FULL WIDTH */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 9. UF */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Distribuição geográfica"
            subtitle={`${fmtN(data.porUf.reduce((s, u) => s + u.total, 0))} leads · ${data.porUf.filter(u => u.isBrasil).length} estados BR · ${data.porUf.filter(u => !u.isBrasil).length} países`}
          />
          <UfList items={data.porUf} />
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

// Funil visual com formato real (largura proporcional + drop-off entre etapas)
function FunilVisual({ etapas }: { etapas: { etapa: string; valor: number; pctTopo: number; pctAnterior: number }[] }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 1)
  return (
    <div className="space-y-1.5">
      {etapas.map((e, i) => {
        const widthPct = topo > 0 ? (e.valor / topo) * 100 : 0
        const dropOff = i > 0 ? 100 - e.pctAnterior : 0
        const isOk = i === 0 || e.pctAnterior >= 70
        const isWarn = i > 0 && e.pctAnterior >= 30 && e.pctAnterior < 70
        const isBad = i > 0 && e.pctAnterior < 30
        return (
          <div key={e.etapa}>
            {i > 0 && (
              <div className="flex items-center justify-end gap-1 pr-2 mb-0.5">
                <ArrowDown className="h-3 w-3 text-ink-faint" />
                <span className={`text-[10px] tabular-nums ${
                  isOk ? 'text-accent' : isWarn ? 'text-warning' : 'text-danger'
                }`}>
                  {e.pctAnterior.toFixed(0)}% conv · -{dropOff.toFixed(0)}%
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-[140px] text-[11px] text-ink-muted shrink-0">{e.etapa}</div>
              <div className="flex-1 h-7 bg-surface-2 rounded-md relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 transition-all flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.max(widthPct, 4)}%`,
                    background: i === 0
                      ? COLORS.accent
                      : isBad
                        ? 'hsl(0 70% 55% / 0.7)'
                        : isWarn
                          ? 'hsl(38 90% 55% / 0.75)'
                          : `hsl(152 60% ${42 + i * 3}%)`,
                  }}
                >
                  {widthPct > 15 && (
                    <span className="text-[10px] font-mono text-white tabular-nums">
                      {e.valor}
                    </span>
                  )}
                </div>
                {widthPct <= 15 && (
                  <span
                    className="absolute inset-y-0 flex items-center text-[10px] font-mono text-ink tabular-nums"
                    style={{ left: `calc(${Math.max(widthPct, 4)}% + 4px)` }}
                  >
                    {e.valor}
                  </span>
                )}
              </div>
              <div className="w-[42px] text-right text-[11px] font-mono text-ink-faint tabular-nums shrink-0">
                {e.pctTopo.toFixed(0)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Lista compacta de criativos com mini-barra split (qualificados / nao qualificados)
function CriativosList({ criativos }: { criativos: { codigo: string; nome: string; total: number; qualificados: number; ctr: number }[] }) {
  if (!criativos.length) {
    return <p className="text-sm text-ink-faint">Nenhum criativo registrado.</p>
  }
  const maxTotal = Math.max(...criativos.map(c => c.total))
  // Ordena por CTR decrescente, com tie-break por volume
  const sorted = [...criativos].sort((a, b) => {
    if (b.ctr !== a.ctr) return b.ctr - a.ctr
    return b.total - a.total
  })
  return (
    <div className="space-y-2">
      {sorted.map(c => {
        const widthPct = (c.total / maxTotal) * 100
        const qualifPct = c.total > 0 ? (c.qualificados / c.total) * 100 : 0
        const ctrColor = c.ctr >= 15 ? 'text-accent' : c.ctr >= 5 ? 'text-warning' : c.total > 5 ? 'text-danger' : 'text-ink-faint'
        return (
          <div key={c.codigo} className="grid grid-cols-[100px_1fr_60px_70px] items-center gap-3 text-[11px]">
            <div className="font-mono text-ink-faint truncate">{c.codigo}</div>
            <div className="min-w-0">
              <div className="text-ink truncate mb-1">{c.nome}</div>
              <div className="h-2 bg-surface-2 rounded-sm relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
                <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifPct}%` }} />
                <div className="absolute inset-y-0 right-0 bg-info/40" style={{ width: `${100 - qualifPct}%` }} />
              </div>
            </div>
            <div className="text-right text-ink font-mono tabular-nums">{c.total}</div>
            <div className={`text-right font-mono tabular-nums ${ctrColor}`}>
              {c.ctr.toFixed(1)}% CTR
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Lista de origens com barras + CTR colorido
function OrigemList({ origens }: { origens: { origem: string; total: number; qualificados: number; ctr: number }[] }) {
  if (!origens.length) {
    return <p className="text-sm text-ink-faint">Sem leads com origem registrada.</p>
  }
  const maxTotal = Math.max(...origens.map(o => o.total))
  return (
    <div className="space-y-3">
      {origens.map(o => {
        const widthPct = (o.total / maxTotal) * 100
        const qualifWidth = o.total > 0 ? (o.qualificados / o.total) * 100 : 0
        const ctrColor = o.ctr >= 10 ? 'text-accent' : o.ctr >= 3 ? 'text-warning' : 'text-danger'
        return (
          <div key={o.origem}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12px] text-ink font-medium">{o.origem}</span>
              <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                <span className="text-ink-muted">{o.qualificados}/{o.total}</span>
                <span className={ctrColor}>{o.ctr.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-3 bg-surface-2 rounded-md relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
              <div className="absolute inset-y-0 left-0 bg-info/40" style={{ width: '100%' }} />
              <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifWidth}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Lista de vendedores com barra + qualificados
function VendedorList({ vendedores }: { vendedores: { vendedor: string; total: number; qualificados: number }[] }) {
  if (!vendedores.length) return <p className="text-sm text-ink-faint">Sem vendedores.</p>
  const max = Math.max(...vendedores.map(v => v.total))
  return (
    <div className="space-y-2">
      {vendedores.map(v => {
        const widthPct = (v.total / max) * 100
        const qualifWidth = v.total > 0 ? (v.qualificados / v.total) * 100 : 0
        const isUnassigned = v.vendedor === 'Sem vendedor'
        return (
          <div key={v.vendedor} className="grid grid-cols-[140px_1fr_60px] items-center gap-3 text-[11px]">
            <div className={`truncate ${isUnassigned ? 'text-ink-faint italic' : 'text-ink'}`}>
              {v.vendedor}
            </div>
            <div className="h-3 bg-surface-2 rounded-md relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
              <div className="absolute inset-y-0 left-0" style={{ width: '100%', background: isUnassigned ? COLORS.inkFaint : COLORS.info, opacity: 0.35 }} />
              <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifWidth}%` }} />
            </div>
            <div className="text-right font-mono tabular-nums text-ink">{v.total}</div>
          </div>
        )
      })}
    </div>
  )
}

// Lista de estados/paises em 2 colunas com mini-barra + % + nome completo
function UfList({ items }: { items: { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }[] }) {
  if (!items.length) return <p className="text-sm text-ink-faint">Sem leads geolocalizados.</p>
  const max = Math.max(...items.map(i => i.total))
  const brasil = items.filter(i => i.isBrasil)
  const intl = items.filter(i => !i.isBrasil)

  const Row = ({ item }: { item: typeof items[number] }) => {
    const widthPct = (item.total / max) * 100
    const isTop = item.total === max
    return (
      <div className="grid grid-cols-[36px_1fr_56px_44px] items-center gap-2 text-[11px] py-1">
        <span className="font-mono text-ink-faint">{item.uf}</span>
        <div className="min-w-0">
          <div className="text-ink truncate mb-1">{item.nome}</div>
          <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(widthPct, 3)}%`,
                background: item.isBrasil
                  ? (isTop ? 'hsl(152 60% 45%)' : `hsl(152 60% ${40 + (1 - widthPct / 100) * 15}%)`)
                  : 'hsl(217 91% 60%)',
              }}
            />
          </div>
        </div>
        <span className="text-right font-mono tabular-nums text-ink">{item.total}</span>
        <span className="text-right font-mono tabular-nums text-ink-faint">{item.pct.toFixed(1)}%</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {brasil.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-widest text-ink-faint">Brasil</span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] text-ink-faint tabular-nums">{brasil.length} estados</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0.5">
            {brasil.map(b => <Row key={b.uf} item={b} />)}
          </div>
        </div>
      )}
      {intl.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-widest text-info">Internacional</span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] text-ink-faint tabular-nums">{intl.length} países</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0.5">
            {intl.map(i => <Row key={i.uf} item={i} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// Heatmap dia × hora
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
    <div className="text-[10px]">
      <div className="flex">
        <div className="w-9 shrink-0" />
        {hours.map(h => (
          <div key={h} className="flex-1 min-w-[18px] text-center text-ink-faint tabular-nums">
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
