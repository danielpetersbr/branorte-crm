import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset, type FunilEtapa, type SlaVendedor } from '@/hooks/useDashboard'
import { useDashboardEtiquetas, CATEGORIA_LABEL, type EtiquetaCategoria } from '@/hooks/useDashboardEtiquetas'
import {
  Area, AreaChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown, ArrowUp, Hand, FilePlus2 } from 'lucide-react'

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
  const { data: etq } = useDashboardEtiquetas(preset)

  // Funil IA com os 2 últimos passos vindos das etiquetas WA (real),
  // não mais dos campos mortos `orcamento_enviado` e `status_real='fechou'`.
  // Mantém Entrou, Engajou, Qualificou, Passou pro vendedor (dos campos da IA).
  const funilIaMerged = useMemo<FunilEtapa[]>(() => {
    if (!data?.funil || !etq) return data?.funil ?? []
    // Os 4 primeiros passos seguem do hook original
    const base = data.funil.slice(0, 4)
    const topo = base[0]?.valor || 1
    const orcamento = etq.por_categoria.orcamento ?? 0
    const vendido = etq.por_categoria.vendido ?? 0
    const prevOrc = base[3]?.valor || 1
    const novos: FunilEtapa[] = [
      {
        etapa: 'Orçamento enviado',
        valor: orcamento,
        pctTopo: (orcamento / topo) * 100,
        pctAnterior: (orcamento / prevOrc) * 100,
        perdidos: Math.max(0, prevOrc - orcamento),
      },
      {
        etapa: 'Vendido',
        valor: vendido,
        pctTopo: (vendido / topo) * 100,
        pctAnterior: orcamento > 0 ? (vendido / orcamento) * 100 : 0,
        perdidos: Math.max(0, orcamento - vendido),
      },
    ]
    return [...base, ...novos]
  }, [data?.funil, etq])

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

  // Delta so faz sentido quando ha filtro de periodo (compara com periodo anterior)
  const showDelta = !!preset
  const periodoLabel = preset
    ? PRESET_LABELS.find(p => p.value === preset)?.label ?? 'período'
    : 'no total'

  const heroKpis = [
    { label: preset ? 'Leads no período' : 'Total de leads', kpi: data.kpiTotal, icon: Users, color: COLORS.ink, sub: preset ? periodoLabel.toLowerCase() : 'desde o início' },
    { label: 'Hoje',              kpi: data.kpiHoje, icon: TrendingUp, color: COLORS.info, sub: 'leads novos' },
    { label: 'Não respondeu',    kpi: data.kpiNaoRespondeu, icon: Users, color: COLORS.warning, sub: 'não engajou com a IA' },
    { label: 'Em andamento',     kpi: data.kpiEmAndamento, icon: TrendingUp, color: 'hsl(200 70% 55%)', sub: 'conversando com a IA' },
    { label: 'Quentes',          kpi: data.kpiQuentes, icon: Flame, color: COLORS.danger, sub: 'potencial cliente' },
    { label: 'Qualificados',     kpi: data.kpiQualificados, icon: CheckCircle2, color: COLORS.accent, sub: 'querem produto Branorte' },
    { label: 'Com vendedor',     kpi: data.kpiBotao, icon: Hand, color: 'hsl(280 65% 60%)', sub: 'vendedor atribuído' },
  ]

  return (
    <div className="p-3 lg:p-6 space-y-3 lg:space-y-5 max-w-[1700px]">
      {/* Header + filtros */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-ink tracking-tight">Dashboard</h1>
          <p className="text-[11px] lg:text-xs text-ink-faint mt-0.5 lg:mt-1">
            {fmtN(data.totalLeads)} leads
            {preset && (
              <span className="text-accent"> · {PRESET_LABELS.find(p => p.value === preset)?.label}</span>
            )}
            <span className="text-ink-faint"> · atualiza 60s</span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            to="/orcamentos/montar"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-accent text-white text-[13px] font-bold hover:bg-accent/90 shadow-sm transition-all"
            title="Iniciar novo orçamento personalizado"
          >
            <FilePlus2 className="h-4 w-4" />
            Novo orçamento
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {heroKpis.map(k => (
          <KpiHero key={k.label} {...k} showDelta={showDelta} />
        ))}
      </div>

      {/* FUNIL DO BOT (hero) + FUNIL POS-BOT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Funil de qualificação (IA → Vendedor)"
            subtitle={`${fmtN(data.totalLeads)} leads · IA qualifica · vendedor confirma via etiqueta WA`}
          />
          <FunilHero etapas={funilIaMerged} />
        </Card>
        <Card>
          <CardHeader
            title="Funil de vendas (pós-qualificação)"
            subtitle="Qualificou → vendedor → orçamento → fechou"
          />
          <FunilCompacto etapas={data.funilReal} />
        </Card>
      </div>

      {/* LEADS POR DIA */}
      <div className="grid grid-cols-1 gap-5">
        <Card>
          <CardHeader
            title="Leads por dia"
            subtitle={data.leadsPorDia.length > 0 ? `${data.leadsPorDia.length} dias com atividade` : 'Sem dados'}
          />
          <div className="h-[300px]">
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

      {/* PERFORMANCE COMERCIAL — Distribuicao por vendedor */}
      <Card>
        <CardHeader
          title="Distribuição por vendedor"
          subtitle="Quantos leads cada vendedor recebeu e quantos qualificaram"
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

      {/* ETIQUETAS WA (vendedores) */}
      {etq && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Mapa de etiquetas WhatsApp"
                subtitle={`${fmtN(etq.leads_com_etiqueta)} de ${fmtN(etq.leads_total)} leads classificados pelos vendedores`}
              />
              <MapaEtiquetas etq={etq} />
            </Card>
            <Card>
              <CardHeader
                title="Vendedores sem ORC ENVIADO"
                subtitle="Têm leads no período mas não etiquetaram nenhum orçamento — cobrar"
              />
              <VendedoresSemOrc etq={etq} />
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5">
            <Card>
              <CardHeader
                title="Criativo × Etiqueta final"
                subtitle="Qual anúncio vira venda vs. 'NÃO FABRICAMOS' — auditoria de qualidade"
              />
              <CriativoEtiqueta etq={etq} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================================
// COMPONENTES
// ============================================================================

function KpiHero({ label, kpi, icon: Icon, color, sub, showDelta: showDeltaProp = true }: {
  label: string;
  kpi: { valor: number; deltaPct: number; sparkline: number[] };
  icon: typeof Users;
  color: string;
  sub: string;
  showDelta?: boolean;
}) {
  const showDelta = showDeltaProp && Math.abs(kpi.deltaPct) > 0.5
  const positivo = kpi.deltaPct > 0
  const sparkData = kpi.sparkline.map((v, i) => ({ i, v }))
  const gid = `spark-${label.replace(/\s+/g, '')}`
  return (
    <div className="bg-surface border border-border rounded-xl p-3 sm:p-5 transition-colors hover:border-border-strong relative overflow-hidden">
      <div className="flex items-start justify-between mb-0.5">
        <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.08em] text-ink-faint font-medium leading-tight">{label}</p>
        <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" style={{ color }} />
      </div>
      <p className="text-[26px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight tabular-nums" style={{ color }}>
        {fmtN(kpi.valor)}
      </p>
      <div className="flex items-center justify-between mt-0.5 sm:mt-1.5">
        <p className="text-[10px] sm:text-[11px] text-ink-faint leading-tight">{sub}</p>
        {showDelta && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-[11px] font-medium tabular-nums ${
            positivo ? 'text-accent' : 'text-danger'
          }`}>
            {positivo ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(kpi.deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
      {/* Sparkline */}
      <div className="absolute bottom-0 left-0 right-0 h-7 sm:h-10 opacity-60 pointer-events-none">
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
  if (etapas[0].valor === 0) {
    return (
      <div className="text-center py-8 text-[12px] text-ink-faint">
        Nenhum lead qualificado ainda no período.
      </div>
    )
  }
  return (
    <div className="space-y-3">
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

// Tabela vendedores (simplificada — so volume e qualificacao)
function SlaTable({ rows }: { rows: SlaVendedor[] }) {
  if (!rows.length) return <p className="text-sm text-ink-faint">Sem vendedores.</p>
  const maxLeads = Math.max(...rows.map(r => r.totalLeads))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-ink-faint border-b border-border">
            <th className="text-left font-medium py-2 pr-2">Vendedor</th>
            <th className="text-left font-medium py-2 px-2 w-[40%]">Distribuição</th>
            <th className="text-right font-medium py-2 px-2">Leads</th>
            <th className="text-right font-medium py-2 px-2">Qualif</th>
            <th className="text-right font-medium py-2 pl-2">% Qualif</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(v => {
            const widthPct = maxLeads > 0 ? (v.totalLeads / maxLeads) * 100 : 0
            const qualifPct = v.totalLeads > 0 ? (v.qualificados / v.totalLeads) * 100 : 0
            const ctrColor = qualifPct >= 15 ? 'text-accent' : qualifPct >= 5 ? 'text-warning' : 'text-ink-faint'
            return (
              <tr key={v.vendedor} className="hover:bg-surface-2/50 transition-colors">
                <td className="py-2 pr-2 text-ink">{v.vendedor}</td>
                <td className="py-2 px-2">
                  <div className="h-2 bg-surface-2 rounded-full relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
                    <div className="absolute inset-y-0 left-0 bg-info/40" style={{ width: '100%' }} />
                    <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifPct}%` }} />
                  </div>
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink">{v.totalLeads}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink-muted">{v.qualificados}</td>
                <td className={`py-2 pl-2 text-right font-mono tabular-nums ${ctrColor}`}>
                  {qualifPct.toFixed(1)}%
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
          <span className="text-[10px] text-ink-faint mt-1 uppercase tracking-widest">leads no período</span>
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
  // Oculta canais de WhatsApp por número (ruído — vendedores individuais).
  // Mantém origens de campanha (Meta ADS, Google, Instagram, etc).
  const filtered = origens.filter(o => !/whatsapp\s*\d{3,}/i.test(o.origem))
  if (!filtered.length) return <p className="text-sm text-ink-faint">Sem leads com origem registrada.</p>
  const maxTotal = Math.max(...filtered.map(o => o.total))
  return (
    <div className="space-y-3">
      {filtered.map(o => {
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

// ============================================================================
// ETIQUETAS WA — componentes
// ============================================================================

const CAT_COLOR: Record<EtiquetaCategoria, string> = {
  novo:        'hsl(217 91% 60%)',  // azul
  quente:      'hsl(38 92% 50%)',   // amarelo
  lead_quente: 'hsl(0 72% 51%)',    // vermelho
  orcamento:   'hsl(280 65% 60%)',  // roxo
  vendido:     'hsl(152 60% 40%)',  // verde
  perdido:     'hsl(0 0% 45%)',     // cinza escuro
  interno:     'hsl(0 0% 65%)',     // cinza claro
  outros:      'hsl(0 0% 65%)',
}

function MapaEtiquetas({ etq }: { etq: ReturnType<typeof useDashboardEtiquetas>['data'] }) {
  if (!etq) return null
  const total = etq.leads_com_etiqueta || 1
  // Ordem do funil (mais valioso → menos valioso)
  const ordem: EtiquetaCategoria[] = ['vendido', 'orcamento', 'lead_quente', 'quente', 'novo', 'perdido', 'interno', 'outros']
  const catEntries = ordem
    .map(c => ({ cat: c, total: etq.por_categoria[c] ?? 0 }))
    .filter(e => e.total > 0)

  return (
    <div className="space-y-4">
      {/* Stacked bar por categoria */}
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-2 border border-border/50">
        {catEntries.map(e => (
          <div
            key={e.cat}
            className="h-full"
            style={{ width: `${(e.total / total) * 100}%`, backgroundColor: CAT_COLOR[e.cat] }}
            title={`${CATEGORIA_LABEL[e.cat].label}: ${e.total} (${Math.round((e.total / total) * 100)}%)`}
          />
        ))}
      </div>
      {/* Legenda por categoria */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {catEntries.map(e => (
          <div key={e.cat} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CAT_COLOR[e.cat] }} />
            <span className="text-ink-muted">{CATEGORIA_LABEL[e.cat].emoji} {CATEGORIA_LABEL[e.cat].label}</span>
            <span className="font-mono tabular-nums text-ink">{e.total}</span>
            <span className="text-ink-faint tabular-nums">({Math.round((e.total / total) * 100)}%)</span>
          </div>
        ))}
      </div>
      {/* Top etiquetas (dedup por nome normalizado) */}
      <div className="pt-3 border-t border-border/40">
        <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">Top etiquetas</p>
        <div className="space-y-1.5">
          {(() => {
            // Dedup variações de grafia (PROSPECCAO vs PROSPECÇÃO)
            const map = new Map<string, { nome: string; categoria: EtiquetaCategoria; total: number }>()
            for (const e of etq.por_etiqueta) {
              const cur = map.get(e.nome)
              if (cur) cur.total += e.total
              else map.set(e.nome, { nome: e.nome, categoria: e.categoria, total: e.total })
            }
            const top = Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10)
            const maxT = Math.max(...top.map(e => e.total), 1)
            return top.map(e => (
              <div key={e.nome} className="flex items-center gap-2 text-[12px]">
                <span className="w-44 truncate text-ink" title={e.nome}>{e.nome}</span>
                <div className="flex-1 h-2 bg-surface-2 rounded overflow-hidden">
                  <div className="h-full" style={{ width: `${(e.total / maxT) * 100}%`, backgroundColor: CAT_COLOR[e.categoria] }} />
                </div>
                <span className="w-10 text-right text-ink-muted font-mono tabular-nums">{e.total}</span>
              </div>
            ))
          })()}
        </div>
      </div>
    </div>
  )
}

function VendedoresSemOrc({ etq }: { etq: ReturnType<typeof useDashboardEtiquetas>['data'] }) {
  if (!etq) return null
  const sem = etq.sem_orc_vendedores
  // Junta info do por_vendedor (total de leads) pra ranking
  const dados = sem
    .map(v => {
      const info = etq.por_vendedor.find(x => x.vendedor === v)
      return { vendedor: v, total: info?.total_leads ?? 0, vendido: info?.vendido ?? 0 }
    })
    .sort((a, b) => b.total - a.total)

  if (dados.length === 0) {
    return (
      <div className="py-6 text-center text-[12px] text-ink-faint">
        Todos os vendedores etiquetaram pelo menos 1 ORC ENVIADO ✓
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {dados.map(d => (
        <div key={d.vendedor} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-surface-2/40 border border-border/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-medium text-ink capitalize">{d.vendedor.toLowerCase()}</span>
            {d.vendido > 0 && (
              <span className="text-[10px] px-1.5 py-px rounded bg-success-bg text-success font-mono">{d.vendido} ✓</span>
            )}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums font-mono">
            {d.total} leads · 0 ORC
          </div>
        </div>
      ))}
      <p className="text-[10px] text-ink-faint pt-1">
        Vendedores que recebem leads mas nunca etiquetam "ORCAMENTO ENVIADO" no WhatsApp. Cobra eles ou eles vendem sem mandar orçamento — ambos os casos são problema.
      </p>
    </div>
  )
}

function CriativoEtiqueta({ etq }: { etq: ReturnType<typeof useDashboardEtiquetas>['data'] }) {
  if (!etq || etq.por_criativo.length === 0) {
    return <div className="py-6 text-center text-[12px] text-ink-faint">Sem dados de criativo cruzado com etiquetas.</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-ink-faint border-b border-border">
            <th className="text-left py-2 px-2 font-semibold">Criativo</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Total</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Vendido</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Orçam.</th>
            <th className="text-right py-2 px-2 font-semibold w-20">Em and.</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Perdido</th>
            <th className="text-right py-2 px-2 font-semibold w-24">Não fabric.</th>
          </tr>
        </thead>
        <tbody>
          {etq.por_criativo.map(c => {
            const ratioNF = c.total > 0 ? (c.nao_fabricamos / c.total) * 100 : 0
            return (
              <tr key={c.codigo} className="border-b border-border/30 hover:bg-surface-2/40">
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted">{c.codigo}</span>
                    <span className="truncate text-ink" title={c.nome ?? ''}>{c.nome || '—'}</span>
                  </div>
                </td>
                <td className="text-right py-1.5 px-2 font-mono tabular-nums">{c.total}</td>
                <td className="text-right py-1.5 px-2 font-mono tabular-nums text-success">{c.vendido || '—'}</td>
                <td className="text-right py-1.5 px-2 font-mono tabular-nums text-accent">{c.orcamento || '—'}</td>
                <td className="text-right py-1.5 px-2 font-mono tabular-nums text-warning">{c.quente || '—'}</td>
                <td className="text-right py-1.5 px-2 font-mono tabular-nums text-ink-faint">{c.perdido || '—'}</td>
                <td className={`text-right py-1.5 px-2 font-mono tabular-nums ${ratioNF >= 15 ? 'text-danger font-semibold' : 'text-ink-muted'}`}>
                  {c.nao_fabricamos > 0 ? `${c.nao_fabricamos} (${ratioNF.toFixed(0)}%)` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-ink-faint mt-2">
        🚩 Coluna <span className="text-danger font-semibold">"Não fabric."</span> em vermelho (≥15%) = criativo trazendo leads errados. Considere pausar.
      </p>
    </div>
  )
}
