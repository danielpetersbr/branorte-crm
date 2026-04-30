import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset, type FunilEtapa, type LeadAging, type SlaVendedor, type LeadEmRisco } from '@/hooks/useDashboard'
import {
  Area, AreaChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown, ArrowUp, ArrowUpRight, AlertTriangle, Target, BarChart3, Phone, MessageSquare, Clock, ExternalLink } from 'lucide-react'

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
  danger: 'hsl(0 72% 51%)',
  info: 'hsl(217 91% 60%)',
  ink: 'hsl(240 5% 45%)',
  inkFaint: 'hsl(240 4% 65%)',
  border: 'hsl(240 6% 90%)',
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

function fmtN(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n)
}

function fmtBRL(v: number): string {
  if (v >= 1_000_000) return 'R$ ' + (v / 1_000_000).toFixed(1).replace('.', ',') + 'M'
  if (v >= 1_000) return 'R$ ' + (v / 1_000).toFixed(0) + 'k'
  return 'R$ ' + v.toFixed(0)
}

function fmtHoras(h: number): string {
  if (h < 1) return Math.round(h * 60) + 'min'
  if (h < 24) return h.toFixed(1).replace('.', ',') + 'h'
  return Math.floor(h / 24) + 'd' + Math.round(h % 24) + 'h'
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-ink tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-ink-faint mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Dashboard() {
  const [preset, setPreset] = usePresetFilter()
  const { data, isLoading, error } = useDashboard({ preset })

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-32 bg-surface-2 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-72 bg-surface-2 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="border border-danger/30 bg-danger-bg rounded-xl p-4 text-sm text-danger">
          Erro ao carregar dados do dashboard.
        </div>
      </div>
    )
  }

  const heroKpis = [
    { label: 'Total de leads', kpi: data.kpiTotal, icon: Users, color: COLORS.ink, sub: 'no período' },
    { label: 'Hoje',           kpi: data.kpiHoje, icon: TrendingUp, color: COLORS.info, sub: 'leads novos' },
    { label: 'Quentes',        kpi: data.kpiQuentes, icon: Flame, color: COLORS.danger, sub: 'querem comprar agora' },
    { label: 'Qualificados',   kpi: data.kpiQualificados, icon: CheckCircle2, color: COLORS.accent, sub: 'preencheram tudo' },
  ]

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1700px]">
      {/* Header + filtros */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink tracking-tight">Dashboard</h1>
          <p className="text-xs text-ink-faint mt-1">
            {fmtN(data.totalLeads)} leads
            {preset && (
              <span className="text-accent"> · filtro: {PRESET_LABELS.find(p => p.value === preset)?.label}</span>
            )}
            <span className="text-ink-faint"> · atualiza a cada 60s</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/analytics"
            className="text-[12px] text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            Análise detalhada
            <ExternalLink className="h-3 w-3" />
          </Link>
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
      </div>

      {/* HERO KPIs com sparkline + delta */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {heroKpis.map(k => (
          <KpiHero key={k.label} {...k} />
        ))}
      </div>

      {/* FORECAST + LEADS EM RISCO (linha critica) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ForecastCard f={data.forecast} />
        <LeadsEmRiscoCard leads={data.leadsEmRisco} className="lg:col-span-2" />
      </div>

      {/* FUNIL DO BOT (hero, span-2) + LEAD AGING */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Funil de qualificação (bot)"
            subtitle={`${fmtN(data.leadsBotNovo)} leads que entraram via webhook`}
          />
          <FunilHero etapas={data.funil} />
        </Card>
        <Card>
          <CardHeader
            title="Funil real (pós-bot)"
            subtitle="Qualificou → vendedor → orçamento → fechou"
          />
          <FunilCompacto etapas={data.funilReal} />
        </Card>
      </div>

      {/* LEAD AGING + LEADS POR DIA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader
            title="Lead aging"
            subtitle="Leads ativos sem resposta há..."
          />
          <LeadAgingPanel data={data.leadAging} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Leads por dia"
            subtitle={data.leadsPorDia.length > 0 ? `${data.leadsPorDia.length} dias com atividade` : 'Sem dados'}
          />
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.leadsPorDia} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.info} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.info} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
                  formatter={((v: number, n: string) => [fmtN(v), n === 'total' ? 'Total' : 'Qualificados']) as never}
                  labelFormatter={((l: string) => new Date(l + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' })) as never}
                />
                <Area type="monotone" dataKey="total" stroke={COLORS.info} strokeWidth={2} fill="url(#gT)" />
                <Area type="monotone" dataKey="qualificados" stroke={COLORS.accent} strokeWidth={2} fill="url(#gQ)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* PERFORMANCE COMERCIAL — Win rate por vendedor */}
      <Card>
        <CardHeader
          title="Performance por vendedor"
          subtitle="Volume · qualificados · chegou no vendedor · orçamentos · fechados · win rate"
        />
        <SlaTable rows={data.slaPorVendedor} />
      </Card>

      {/* CRIATIVO + ORIGEM */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader
            title="Performance por criativo"
            subtitle="Volume × % qualificados — top 10"
            right={
              <div className="flex gap-3 text-[10px] text-ink-faint">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" /> Qualif</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-info/40" /> Não qualif</span>
              </div>
            }
          />
          <CriativosList criativos={data.porCriativo} />
        </Card>

        <Card>
          <CardHeader title="Conversão por canal" subtitle="Volume e % qualificados" />
          <OrigemList origens={data.porOrigem} />
        </Card>
      </div>

      {/* MOMENTO + GEOGRAFIA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader title="Momento de compra" subtitle="Urgência do pipeline" />
          <DonutMomento data={data.porMomento} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Distribuição geográfica"
            subtitle={`${fmtN(data.porUf.reduce((s, u) => s + u.total, 0))} leads · ${data.porUf.filter(u => u.isBrasil).length} estados BR · ${data.porUf.filter(u => !u.isBrasil).length} países`}
          />
          <UfList items={data.porUf} />
        </Card>
      </div>
    </div>
  )
}

// ============================================================================
// COMPONENTES
// ============================================================================

function KpiHero({ label, kpi, icon: Icon, color, sub }: {
  label: string;
  kpi: { valor: number; deltaPct: number; sparkline: number[] };
  icon: typeof Users;
  color: string;
  sub: string;
}) {
  const showDelta = Math.abs(kpi.deltaPct) > 0.5
  const positivo = kpi.deltaPct > 0
  const sparkData = kpi.sparkline.map((v, i) => ({ i, v }))
  const gid = `spark-${label.replace(/\s+/g, '')}`
  return (
    <div className="bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong relative overflow-hidden">
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-faint font-medium">{label}</p>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </div>
      <p className="text-[40px] leading-[1.1] font-semibold tracking-tight tabular-nums" style={{ color }}>
        {fmtN(kpi.valor)}
      </p>
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[11px] text-ink-faint">{sub}</p>
        {showDelta && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
            positivo ? 'text-accent' : 'text-danger'
          }`}>
            {positivo ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(kpi.deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
      {/* Sparkline */}
      <div className="absolute bottom-0 left-0 right-0 h-10 opacity-60 pointer-events-none">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Funil hero — drop-off em vermelho destacado entre etapas
function FunilHero({ etapas }: { etapas: FunilEtapa[] }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 1)
  return (
    <div className="space-y-1">
      {etapas.map((e, i) => {
        const widthPct = topo > 0 ? (e.valor / topo) * 100 : 0
        const isOk = i === 0 || e.pctAnterior >= 70
        const isWarn = i > 0 && e.pctAnterior >= 30 && e.pctAnterior < 70
        const isBad = i > 0 && e.pctAnterior < 30
        const dropOff = i > 0 ? 100 - e.pctAnterior : 0
        return (
          <div key={e.etapa}>
            {i > 0 && e.perdidos > 0 && (
              <div className="flex items-center gap-2 my-1">
                <div className="w-[160px] shrink-0" />
                <div className={`flex-1 flex items-center gap-2 px-2 py-0.5 rounded-md ${
                  isBad ? 'bg-danger-bg text-danger' : isWarn ? 'bg-warning-bg text-warning' : 'bg-accent-bg text-accent'
                }`}>
                  <ArrowDown className="h-3 w-3 shrink-0" />
                  <span className="text-[11px] font-medium tabular-nums">
                    {e.pctAnterior.toFixed(0)}% conv · -{dropOff.toFixed(0)}% · {fmtN(e.perdidos)} leads perdidos
                  </span>
                </div>
                <div className="w-[60px]" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-[160px] text-[12px] text-ink shrink-0">{e.etapa}</div>
              <div className="flex-1 h-10 bg-surface-2 rounded-md relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 transition-all flex items-center pl-3"
                  style={{
                    width: `${Math.max(widthPct, 4)}%`,
                    background: i === 0
                      ? COLORS.accent
                      : isBad
                        ? 'hsl(0 70% 55% / 0.85)'
                        : isWarn
                          ? 'hsl(38 90% 55% / 0.85)'
                          : `hsl(152 60% ${44 + i * 2}%)`,
                  }}
                >
                  <span className="text-[12px] font-mono text-white tabular-nums font-semibold">
                    {fmtN(e.valor)}
                  </span>
                </div>
              </div>
              <div className="w-[60px] text-right text-[12px] font-mono text-ink-muted tabular-nums shrink-0">
                {e.pctTopo.toFixed(0)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Funil compacto pra "funil real" pos-bot
function FunilCompacto({ etapas }: { etapas: FunilEtapa[] }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 1)
  return (
    <div className="space-y-2">
      {etapas.map((e, i) => {
        const widthPct = topo > 0 ? (e.valor / topo) * 100 : 0
        const isOk = i === 0 || e.pctAnterior >= 50
        const isBad = i > 0 && e.pctAnterior < 20
        return (
          <div key={e.etapa}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] text-ink">{e.etapa}</span>
              <span className="text-[11px] font-mono tabular-nums">
                <span className="text-ink">{fmtN(e.valor)}</span>
                {i > 0 && (
                  <span className={`ml-2 ${isBad ? 'text-danger' : isOk ? 'text-accent' : 'text-warning'}`}>
                    {e.pctAnterior.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(widthPct, 2)}%`,
                  background: i === 0 ? COLORS.accent : isBad ? COLORS.danger : `hsl(152 60% ${44 + i * 4}%)`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Lead Aging Panel
function LeadAgingPanel({ data }: { data: LeadAging[] }) {
  const totalLeads = data.reduce((s, x) => s + x.leads, 0)
  const totalValor = data.reduce((s, x) => s + x.valor, 0)
  if (totalLeads === 0) {
    return <p className="text-sm text-ink-faint py-8 text-center">Nenhum lead parado. ✨</p>
  }
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-border pb-3">
        <span className="text-[11px] uppercase tracking-widest text-ink-faint">Total parado</span>
        <div className="text-right">
          <p className="text-2xl font-semibold text-ink tabular-nums leading-none">{fmtN(totalLeads)}</p>
          {totalValor > 0 && (
            <p className="text-[11px] text-warning tabular-nums mt-1">{fmtBRL(totalValor)} em risco</p>
          )}
        </div>
      </div>
      {data.map(d => {
        const pct = totalLeads > 0 ? (d.leads / totalLeads) * 100 : 0
        const isCritical = d.faixa === '+30d' || d.faixa === '7d-30d'
        return (
          <div key={d.faixa}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] flex items-center gap-2">
                <Clock className={`h-3 w-3 ${isCritical ? 'text-danger' : 'text-ink-faint'}`} />
                <span className={isCritical ? 'text-ink font-medium' : 'text-ink-muted'}>{d.faixa}</span>
              </span>
              <span className="text-[11px] font-mono tabular-nums">
                <span className="text-ink">{fmtN(d.leads)}</span>
                {d.valor > 0 && <span className="text-ink-faint ml-2">{fmtBRL(d.valor)}</span>}
              </span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  background: isCritical ? COLORS.danger : COLORS.warn,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Forecast vs Meta
function ForecastCard({ f }: { f: { vendidoMes: number; pedidosMes: number; diaDoMes: number; diasNoMes: number; ritmoDia: number; projecao: number; meta: number; pctMeta: number; pctProjecao: number } }) {
  const faltam = Math.max(0, f.meta - f.vendidoMes)
  const diasRestantes = f.diasNoMes - f.diaDoMes
  const necessarioPorDia = diasRestantes > 0 ? faltam / diasRestantes : 0
  const noRitmo = f.projecao >= f.meta
  return (
    <Card>
      <CardHeader
        title="Forecast vs Meta"
        subtitle={`Mês corrente · dia ${f.diaDoMes}/${f.diasNoMes}`}
      />
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] uppercase tracking-widest text-ink-faint">Vendido</span>
            <span className="text-2xl font-semibold text-ink tabular-nums">{fmtBRL(f.vendidoMes)}</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(f.pctMeta, 100)}%`,
                background: noRitmo ? COLORS.accent : f.pctMeta >= 50 ? COLORS.warn : COLORS.danger,
              }}
            />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-[10px] text-ink-faint">{f.pedidosMes} pedidos</span>
            <span className="text-[10px] font-mono text-ink-faint tabular-nums">
              {f.pctMeta.toFixed(1)}% / {fmtBRL(f.meta)}
            </span>
          </div>
        </div>

        <div className="border-t border-border pt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-faint">Projeção mês</p>
            <p className={`text-base font-semibold tabular-nums mt-1 ${noRitmo ? 'text-accent' : 'text-warning'}`}>
              {fmtBRL(f.projecao)}
            </p>
            <p className="text-[10px] text-ink-faint mt-0.5">{f.pctProjecao.toFixed(0)}% da meta</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-ink-faint">Faltam</p>
            <p className="text-base font-semibold text-ink tabular-nums mt-1">{fmtBRL(faltam)}</p>
            {diasRestantes > 0 && (
              <p className="text-[10px] text-ink-faint mt-0.5">{fmtBRL(necessarioPorDia)}/dia</p>
            )}
          </div>
        </div>

        {!noRitmo && faltam > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-warning-bg text-warning">
            <Target className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="text-[11px] leading-tight">
              No ritmo atual ({fmtBRL(f.ritmoDia)}/dia), vai ficar a {fmtBRL(f.meta - f.projecao)} da meta.
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

// Leads em risco (top 5-8)
function LeadsEmRiscoCard({ leads, className = '' }: { leads: LeadEmRisco[]; className?: string }) {
  const valorTotal = leads.reduce((s, l) => s + (l.valor ?? 0), 0)
  return (
    <Card className={className}>
      <CardHeader
        title="Leads em risco"
        subtitle={`${leads.length} leads quentes/com orçamento sem resposta há +24h`}
        right={
          valorTotal > 0 ? (
            <div className="flex items-center gap-1.5 text-[11px] text-danger">
              <AlertTriangle className="h-3 w-3" />
              <span className="font-mono tabular-nums">{fmtBRL(valorTotal)} em risco</span>
            </div>
          ) : null
        }
      />
      {leads.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 text-center">Nenhum lead em risco no momento.</p>
      ) : (
        <div className="divide-y divide-border">
          {leads.map(l => (
            <div key={l.id} className="py-2 flex items-center gap-3 hover:bg-surface-2/50 -mx-2 px-2 rounded-md transition-colors">
              <span className="h-2 w-2 rounded-full bg-danger animate-pulse shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-ink truncate">
                    {l.nome ?? <span className="italic text-ink-faint">sem nome</span>}
                  </span>
                  {l.momento === 'Agora' && (
                    <span className="text-[9px] uppercase tracking-widest bg-danger-bg text-danger px-1.5 py-0.5 rounded">Quente</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-ink-faint mt-0.5">
                  {l.telefone && <span className="font-mono inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{l.telefone}</span>}
                  {l.vendedor && <span className="inline-flex items-center gap-1"><Users className="h-2.5 w-2.5" />{l.vendedor}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-danger font-mono tabular-nums">{fmtHoras(l.horasSemResposta)}</p>
                {l.valor != null && l.valor > 0 && (
                  <p className="text-[10px] text-ink-muted font-mono tabular-nums">{fmtBRL(l.valor)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// Tabela SLA / Win rate
function SlaTable({ rows }: { rows: SlaVendedor[] }) {
  if (!rows.length) return <p className="text-sm text-ink-faint">Sem vendedores.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-ink-faint border-b border-border">
            <th className="text-left font-medium py-2 pr-2">Vendedor</th>
            <th className="text-right font-medium py-2 px-2">Leads</th>
            <th className="text-right font-medium py-2 px-2">Qualif</th>
            <th className="text-right font-medium py-2 px-2">Pendentes</th>
            <th className="text-right font-medium py-2 px-2">Idade média</th>
            <th className="text-right font-medium py-2 px-2">Orç</th>
            <th className="text-right font-medium py-2 px-2">Vendidos</th>
            <th className="text-right font-medium py-2 pl-2">Win rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(v => {
            const wrColor = v.winRate >= 5 ? 'text-accent' : v.winRate >= 1 ? 'text-warning' : 'text-ink-faint'
            const idadeColor = v.idadeMediaHoras >= 48 ? 'text-danger' : v.idadeMediaHoras >= 24 ? 'text-warning' : 'text-ink-muted'
            const pendColor = v.pendentes >= 5 ? 'text-danger font-semibold' : v.pendentes > 0 ? 'text-warning' : 'text-ink-faint'
            return (
              <tr key={v.vendedor} className="hover:bg-surface-2/50 transition-colors">
                <td className="py-2 pr-2 text-ink">{v.vendedor}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink">{v.totalLeads}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink-muted">{v.qualificados}</td>
                <td className={`py-2 px-2 text-right font-mono tabular-nums ${pendColor}`}>{v.pendentes}</td>
                <td className={`py-2 px-2 text-right font-mono tabular-nums ${idadeColor}`}>
                  {v.idadeMediaHoras > 0 ? fmtHoras(v.idadeMediaHoras) : '—'}
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink-muted">{v.orcamentos}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink">{v.vendidos}</td>
                <td className={`py-2 pl-2 text-right font-mono tabular-nums ${wrColor}`}>
                  {v.winRate.toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Donut momento com numero central
function DonutMomento({ data }: { data: { momento: string; valor: number; cor: string }[] }) {
  const total = data.reduce((s, x) => s + x.valor, 0)
  return (
    <div className="h-[280px] flex items-center">
      <div className="flex-1 h-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={92}
              paddingAngle={2}
              dataKey="valor"
              nameKey="momento"
            >
              {data.map((m, i) => <Cell key={i} fill={m.cor} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12 }}
              formatter={((v: number) => [fmtN(v), '']) as never}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-semibold text-ink tabular-nums leading-none">{fmtN(total)}</span>
          <span className="text-[10px] text-ink-faint mt-1 uppercase tracking-widest">leads ativos</span>
        </div>
      </div>
      <div className="space-y-2.5 pr-2 min-w-[150px]">
        {data.map(m => {
          const pct = total > 0 ? (m.valor / total) * 100 : 0
          return (
            <div key={m.momento} className="flex items-center gap-2 text-[11px]">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: m.cor }} />
              <span className="text-ink flex-1 truncate">{m.momento}</span>
              <span className="font-mono text-ink-faint tabular-nums">{pct.toFixed(0)}%</span>
            </div>
          )
        })}
        {data.length === 0 && <p className="text-[11px] text-ink-faint">Sem dados</p>}
      </div>
    </div>
  )
}

// Lista compacta de criativos
function CriativosList({ criativos }: { criativos: { codigo: string; nome: string; total: number; qualificados: number; ctr: number }[] }) {
  if (!criativos.length) return <p className="text-sm text-ink-faint">Nenhum criativo registrado.</p>
  const maxTotal = Math.max(...criativos.map(c => c.total))
  const sorted = [...criativos].sort((a, b) => b.ctr - a.ctr || b.total - a.total)
  return (
    <div className="space-y-2">
      {sorted.map(c => {
        const widthPct = (c.total / maxTotal) * 100
        const qualifPct = c.total > 0 ? (c.qualificados / c.total) * 100 : 0
        const ctrColor = c.ctr >= 15 ? 'text-accent' : c.ctr >= 5 ? 'text-warning' : c.total > 5 ? 'text-danger' : 'text-ink-faint'
        return (
          <div key={c.codigo} className="grid grid-cols-[90px_1fr_50px_70px] items-center gap-3 text-[11px] py-1 hover:bg-surface-2/40 rounded -mx-1 px-1 transition-colors">
            <div className="font-mono text-ink-faint truncate">{c.codigo}</div>
            <div className="min-w-0">
              <div className="text-ink truncate mb-1">{c.nome}</div>
              <div className="h-2 bg-surface-2 rounded-sm relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
                <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifPct}%` }} />
                <div className="absolute inset-y-0 right-0 bg-info/40" style={{ width: `${100 - qualifPct}%` }} />
              </div>
            </div>
            <div className="text-right text-ink font-mono tabular-nums">{c.total}</div>
            <div className={`text-right font-mono tabular-nums ${ctrColor}`}>{c.ctr.toFixed(1)}%</div>
          </div>
        )
      })}
    </div>
  )
}

// Lista de origens
function OrigemList({ origens }: { origens: { origem: string; total: number; qualificados: number; ctr: number }[] }) {
  if (!origens.length) return <p className="text-sm text-ink-faint">Sem leads com origem registrada.</p>
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

// Lista de UFs em 2 colunas
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
