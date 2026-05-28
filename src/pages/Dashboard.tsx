import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset, type FunilEtapa, type SlaVendedor } from '@/hooks/useDashboard'
import { useDashboardEtiquetas, useHeatmapSemanal, CATEGORIA_LABEL, type EtiquetaCategoria } from '@/hooks/useDashboardEtiquetas'
import {
  Area, AreaChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown, ArrowUp, Hand, FilePlus2, AlertTriangle, Clock, Ghost } from 'lucide-react'

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
  // Heatmap usa janela fixa (30d) — ignora filtro do dashboard de propósito
  const { data: heatmap30d } = useHeatmapSemanal()

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
      <div className="p-6 space-y-3">
        <div className="border border-danger/30 bg-danger-bg rounded-xl p-4 text-sm text-danger">
          <div className="font-semibold mb-1">Erro ao carregar dados do dashboard.</div>
          {error && (
            <div className="text-[12px] font-mono opacity-80 break-all">{(error as Error).message}</div>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mt-3 px-3 py-1 rounded bg-danger text-white text-[12px] font-medium hover:bg-danger/90"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  // Delta so faz sentido quando ha filtro de periodo (compara com periodo anterior)
  const showDelta = !!preset
  const periodoLabel = preset
    ? PRESET_LABELS.find(p => p.value === preset)?.label ?? 'período'
    : 'no total'

  // KPI Quentes: soma lead_quente das etiquetas (real) com a definição antiga (volume animais)
  // pra cobrir leads que não chegaram no WhatsApp do vendedor ainda
  const leadQuenteEtq = etq?.por_categoria.lead_quente ?? 0
  const kpiQuentesMerged = {
    ...data.kpiQuentes,
    valor: data.kpiQuentes.valor + leadQuenteEtq,
  }
  const orcamentoEtq = etq?.por_categoria.orcamento ?? 0
  const vendidoEtq = etq?.por_categoria.vendido ?? 0

  const heroKpis = [
    { label: preset ? 'Leads no período' : 'Total de leads', kpi: data.kpiTotal, icon: Users, color: COLORS.ink, sub: preset ? periodoLabel.toLowerCase() : 'desde o início' },
    { label: 'Hoje',              kpi: data.kpiHoje, icon: TrendingUp, color: COLORS.info, sub: 'leads novos' },
    { label: 'Não respondeu',    kpi: data.kpiNaoRespondeu, icon: Users, color: COLORS.warning, sub: 'não engajou com a IA' },
    { label: 'Em andamento',     kpi: data.kpiEmAndamento, icon: TrendingUp, color: 'hsl(200 70% 55%)', sub: 'conversando com a IA' },
    { label: 'Quentes',          kpi: kpiQuentesMerged, icon: Flame, color: COLORS.danger, sub: `${leadQuenteEtq} via etiqueta WA` },
    { label: 'Qualificados',     kpi: data.kpiQualificados, icon: CheckCircle2, color: COLORS.accent, sub: 'fábrica + animal · ou equip. Branorte' },
    { label: 'Com vendedor',     kpi: data.kpiBotao, icon: Hand, color: 'hsl(280 65% 60%)', sub: 'vendedor atribuído' },
    { label: 'Orçamentos',       kpi: { valor: orcamentoEtq, deltaPct: 0, sparkline: [] }, icon: FilePlus2, color: 'hsl(280 65% 50%)', sub: 'ORC ENVIADO no WhatsApp' },
    { label: 'Vendidos',         kpi: { valor: vendidoEtq, deltaPct: 0, sparkline: [] }, icon: CheckCircle2, color: 'hsl(152 60% 35%)', sub: 'etiqueta VENDIDO no WhatsApp' },
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

      {/* BANNER DE ALERTAS — só aparece se há algo crítico */}
      {etq && (etq.alertas.criativos_nao_fabricamos > 0 || etq.alertas.leads_orfaos > 0 || etq.alertas.vendedores_sem_orc > 0) && (
        <AlertasBanner etq={etq} />
      )}

      {/* HERO KPIs com sparkline + delta */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {heroKpis.map(k => (
          <KpiHero key={k.label} {...k} showDelta={showDelta} />
        ))}
      </div>

      {/* FUNIL principal IA → Vendedor (full width) */}
      <Card>
        <CardHeader
          title="Funil de qualificação (IA → Vendedor)"
          subtitle={`${fmtN(data.totalLeads)} leads · IA qualifica · vendedor confirma via etiqueta WA`}
        />
        <FunilHero etapas={funilIaMerged} />
      </Card>

      {/* TEMPOS + LEADS ÓRFÃOS */}
      {etq && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader
              title="Ciclo de venda"
              subtitle="Mediana de dias entre eventos"
            />
            <CicloVenda etq={etq} />
          </Card>
          <Card>
            <CardHeader
              title="Leads órfãos (zumbis no funil)"
              subtitle={`Etiqueta NOVO ou PROSPECCAO há mais de ${etq.leads_orfaos_dias_limite} dias sem evoluir`}
            />
            <LeadsOrfaos etq={etq} />
          </Card>
        </div>
      )}

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
          subtitle="Leads recebidos, qualificados, com ORÇAMENTO ENVIADO e VENDIDO (via etiqueta WA)"
        />
        <SlaTable rows={data.slaPorVendedor} etqPorVendedor={etq?.por_vendedor} />
      </Card>

      {/* ORIGEM × VENDIDO (etiquetas) — substitui "Conversão por canal" antigo */}
      {etq && etq.por_origem.length > 0 && (
        <Card>
          <CardHeader
            title="Origem × Resultado real"
            subtitle="Qual origem realmente vira venda (via etiqueta WA, não % qualificado da IA)"
          />
          <OrigemVendido etq={etq} />
        </Card>
      )}

      {/* PERFORMANCE POR CRIATIVO — top 10 com barras Qualif × Não qualif */}
      {data.porCriativo.length > 0 && (
        <Card>
          <CardHeader
            title="Performance por criativo"
            subtitle="Volume × % qualificados — top 10"
            right={
              <div className="flex gap-3 text-[10px] text-ink-faint">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> Qualif</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-info" /> Não qualif</span>
              </div>
            }
          />
          <CriativosList criativos={data.porCriativo} />
        </Card>
      )}

      {/* GEOGRAFIA — Momento de compra removido (campo descontinuado) */}
      <Card>
        <CardHeader
          title="Distribuição geográfica"
          subtitle={`${fmtN(data.porUf.reduce((s, u) => s + u.total, 0))} leads · ${data.porUf.filter(u => u.isBrasil).length} estados BR · ${data.porUf.filter(u => !u.isBrasil).length} países`}
        />
        <UfList items={data.porUf} />
      </Card>

      {/* HEATMAP: padrão semanal SEMPRE 30 dias (ignora filtro do dashboard) */}
      {heatmap30d && heatmap30d.length > 0 && (
        <Card>
          <CardHeader
            title="Quando chegam os leads (BR)"
            subtitle="Padrão dos últimos 30 dias — independente do filtro acima"
          />
          <HeatmapDiaHora heatmap={heatmap30d} />
        </Card>
      )}

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
// Tabela vendedores — volume + qualificacao + ORC ENVIADO/VENDIDO via etiqueta WA
function SlaTable({ rows, etqPorVendedor }: {
  rows: SlaVendedor[]
  etqPorVendedor?: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']>['por_vendedor']
}) {
  if (!rows.length) return <p className="text-sm text-ink-faint">Sem vendedores.</p>
  const maxLeads = Math.max(...rows.map(r => r.totalLeads))
  const etqLookup = new Map((etqPorVendedor ?? []).map(v => [v.vendedor.toUpperCase(), v]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-ink-faint border-b border-border">
            <th className="text-left font-medium py-2 pr-2">Vendedor</th>
            <th className="text-left font-medium py-2 px-2 w-[30%]">Distribuição</th>
            <th className="text-right font-medium py-2 px-2">Leads</th>
            <th className="text-right font-medium py-2 px-2">Qualif</th>
            <th className="text-right font-medium py-2 px-2" title="Leads com etiqueta ORCAMENTO ENVIADO no WhatsApp">ORC</th>
            <th className="text-right font-medium py-2 px-2" title="Leads com etiqueta VENDIDO no WhatsApp">Vend</th>
            <th className="text-right font-medium py-2 pl-2">% Vend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(v => {
            const widthPct = maxLeads > 0 ? (v.totalLeads / maxLeads) * 100 : 0
            const qualifPct = v.totalLeads > 0 ? (v.qualificados / v.totalLeads) * 100 : 0
            const etqInfo = etqLookup.get((v.vendedor || '').toUpperCase())
            const orc = etqInfo?.com_orcamento ?? 0
            const vendido = etqInfo?.vendido ?? 0
            const vendidoPct = v.totalLeads > 0 ? (vendido / v.totalLeads) * 100 : 0
            const vendColor = vendidoPct >= 3 ? 'text-success' : vendidoPct >= 1 ? 'text-warning' : 'text-danger'
            return (
              <tr key={v.vendedor} className="hover:bg-surface-2/50 transition-colors">
                <td className="py-2 pr-2">
                  <Link
                    to={`/atendimentos?responsavel=${encodeURIComponent(v.vendedor)}`}
                    className="text-ink hover:text-accent hover:underline"
                    title="Ver atendimentos deste vendedor"
                  >
                    {v.vendedor}
                  </Link>
                </td>
                <td className="py-2 px-2">
                  <div className="h-2 bg-surface-2 rounded-full relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
                    <div className="absolute inset-y-0 left-0 bg-info/40" style={{ width: '100%' }} />
                    <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifPct}%` }} />
                  </div>
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink">{v.totalLeads}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink-muted">{v.qualificados}</td>
                <td className={`py-2 px-2 text-right font-mono tabular-nums ${orc > 0 ? 'text-accent' : 'text-ink-faint'}`}>
                  {orc || '—'}
                </td>
                <td className={`py-2 px-2 text-right font-mono tabular-nums ${vendido > 0 ? 'text-success' : 'text-ink-faint'}`}>
                  {vendido || '—'}
                </td>
                <td className={`py-2 pl-2 text-right font-mono tabular-nums ${vendido > 0 ? vendColor : 'text-ink-faint'}`}>
                  {vendido > 0 ? `${vendidoPct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Lista compacta de criativos — top 10 ordenado por volume com barra Qualif × Não qualif
function CriativosList({ criativos }: { criativos: { codigo: string; nome: string; total: number; qualificados: number; ctr: number }[] }) {
  if (!criativos.length) {
    return <p className="text-sm text-ink-faint">Nenhum criativo registrado.</p>
  }
  // Ordena por volume (top 10 de fato) — match com a imagem que mostra os mais movimentados primeiro
  const sorted = [...criativos]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
  const maxTotal = Math.max(...sorted.map(c => c.total))
  return (
    <div className="space-y-2">
      {sorted.map(c => {
        const widthPct = (c.total / maxTotal) * 100
        const qualifPct = c.total > 0 ? (c.qualificados / c.total) * 100 : 0
        const ctrColor = c.ctr >= 15 ? 'text-accent' : c.ctr >= 5 ? 'text-warning' : c.total > 5 ? 'text-danger' : 'text-ink-faint'
        return (
          <div key={c.codigo} className="grid grid-cols-[60px_1fr_50px_60px] items-center gap-3 text-[11px]">
            <div className="font-mono text-ink-faint truncate">{c.codigo}</div>
            <div className="min-w-0">
              <div className="text-ink truncate mb-1">{c.nome}</div>
              <div className="h-2 bg-surface-2 rounded-sm relative overflow-hidden" style={{ width: `${Math.max(widthPct, 4)}%` }}>
                <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${qualifPct}%` }} />
                <div className="absolute inset-y-0 right-0 bg-info/70" style={{ width: `${100 - qualifPct}%` }} />
              </div>
            </div>
            <div className="text-right text-ink font-mono tabular-nums">{c.total}</div>
            <div className={`text-right font-mono tabular-nums ${ctrColor}`}>
              {c.ctr.toFixed(1)}%
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

function AlertasBanner({ etq }: { etq: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']> }) {
  const items = [
    etq.alertas.criativos_nao_fabricamos > 0 && {
      icon: AlertTriangle,
      text: `${etq.alertas.criativos_nao_fabricamos} criativo${etq.alertas.criativos_nao_fabricamos > 1 ? 's' : ''} com ≥15% "NÃO FABRICAMOS"`,
      tone: 'danger',
      anchor: 'criativo-etiqueta',
    },
    etq.alertas.leads_orfaos > 0 && {
      icon: Ghost,
      text: `${etq.alertas.leads_orfaos} leads órfãos no funil dos vendedores (>${etq.leads_orfaos_dias_limite}d sem evoluir)`,
      tone: 'warning',
      anchor: 'leads-orfaos',
    },
    etq.alertas.vendedores_sem_orc > 0 && {
      icon: AlertTriangle,
      text: `${etq.alertas.vendedores_sem_orc} vendedor${etq.alertas.vendedores_sem_orc > 1 ? 'es' : ''} com leads mas zero ORÇAMENTO ENVIADO`,
      tone: 'warning',
      anchor: 'sem-orc',
    },
  ].filter(Boolean) as { icon: typeof AlertTriangle; text: string; tone: string; anchor: string }[]

  if (items.length === 0) return null
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-bg/40 p-3 lg:p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-danger" />
        <span className="text-[12px] font-bold text-danger uppercase tracking-wide">Atenção</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[12px] text-ink">
            <it.icon className={`h-3.5 w-3.5 ${it.tone === 'danger' ? 'text-danger' : 'text-warning'}`} />
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CicloVenda({ etq }: { etq: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']> }) {
  const stages = [
    {
      label: 'Lead chega → 1ª etiqueta',
      value: etq.tempo_chegada_etiqueta_horas,
      unit: 'h',
      target: 4,
      desc: 'SLA: vendedor deveria classificar em <4h',
    },
    {
      label: 'Lead chega → ORÇAMENTO ENVIADO',
      value: etq.tempo_lead_orcamento_dias,
      unit: 'd',
      target: 3,
      desc: 'Meta: orçamento sai em até 3 dias',
    },
    {
      label: 'ORÇAMENTO → VENDIDO',
      value: etq.tempo_lead_vendido_dias != null && etq.tempo_lead_orcamento_dias != null
        ? Math.max(0, etq.tempo_lead_vendido_dias - etq.tempo_lead_orcamento_dias)
        : null,
      unit: 'd',
      target: 7,
      desc: 'Mediana de ciclo após o orçamento',
    },
  ]
  return (
    <div className="space-y-3">
      {stages.map(s => {
        const v = s.value
        const overBudget = v != null && v > s.target
        return (
          <div key={s.label} className="flex items-start justify-between gap-3 px-2 py-2 rounded-md bg-surface-2/40 border border-border/30">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12px] text-ink">
                <Clock className="h-3 w-3 text-ink-faint" />
                <span className="font-medium">{s.label}</span>
              </div>
              <p className="text-[10.5px] text-ink-faint mt-0.5">{s.desc}</p>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-2xl font-bold tabular-nums leading-none ${overBudget ? 'text-danger' : 'text-success'}`}>
                {v == null ? '—' : v}
                <span className="text-sm font-medium ml-0.5">{s.unit}</span>
              </div>
              <p className="text-[10px] text-ink-faint mt-0.5">meta: &lt;{s.target}{s.unit}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LeadsOrfaos({ etq }: { etq: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']> }) {
  const total = etq.leads_orfaos
  if (total === 0) {
    return <div className="py-6 text-center text-[12px] text-ink-faint">Sem leads órfãos no período ✓</div>
  }
  const pct = etq.leads_total > 0 ? Math.round((total / etq.leads_total) * 100) : 0
  return (
    <div className="flex flex-col items-center justify-center py-3">
      <Ghost className="h-9 w-9 text-warning mb-2" />
      <div className="text-4xl font-bold tabular-nums text-warning">{total}</div>
      <p className="text-[12px] text-ink-muted mt-1">
        leads parados com etiqueta NOVO/PROSPECCAO
      </p>
      <p className="text-[11px] text-ink-faint mt-0.5">{pct}% do total no período</p>
      <Link
        to="/atendimentos"
        className="mt-3 text-[12px] text-accent hover:underline"
      >
        Ver na lista de atendimentos →
      </Link>
    </div>
  )
}

function OrigemVendido({ etq }: { etq: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']> }) {
  // Separa origens em 2 grupos:
  // 1. COM conversão (alguma venda) — ordena por % desc → mostra "barra de qualidade"
  // 2. SEM conversão (0 vendidos) — agrupa, ordena por volume → só ranking de volume
  const comConv = etq.por_origem
    .filter(o => (o.vendido_pct ?? 0) > 0)
    .sort((a, b) => (b.vendido_pct ?? 0) - (a.vendido_pct ?? 0))
  const semConv = etq.por_origem
    .filter(o => (o.vendido_pct ?? 0) === 0)
    .sort((a, b) => b.total - a.total)
  const maxVolGeral = Math.max(...etq.por_origem.map(o => o.total), 1)

  // Linha "rica" para origens com conversão: nome + barra dupla + mini-stats
  const RowConv = ({ o }: { o: typeof etq.por_origem[number] }) => {
    const pct = o.vendido_pct ?? 0
    const tone = pct >= 5 ? 'text-success' : pct >= 1 ? 'text-warning' : 'text-ink-muted'
    const vendaOrc = o.vendido + o.orcamento
    const volPct = (o.total / maxVolGeral) * 100
    const convPctNaBarra = o.total > 0 ? (vendaOrc / o.total) * 100 : 0
    return (
      <div className="grid grid-cols-[140px_1fr_70px_60px] items-center gap-3 text-[12px]">
        <div className="min-w-0">
          <div className="truncate text-ink font-medium" title={o.origem}>{o.origem}</div>
          <div className="text-[10px] text-ink-faint truncate">
            {o.vendido > 0 && `${o.vendido} venda${o.vendido > 1 ? 's' : ''}`}
            {o.vendido > 0 && o.orcamento > 0 && ' · '}
            {o.orcamento > 0 && `${o.orcamento} orçamento${o.orcamento > 1 ? 's' : ''}`}
          </div>
        </div>
        {/* Barra: largura = volume relativo; fill verde = % convertido */}
        <div
          className="h-3 bg-surface-2 rounded overflow-hidden relative"
          style={{ width: `${Math.max(volPct, 6)}%` }}
          title={`${o.total} leads · ${vendaOrc} converteram (${convPctNaBarra.toFixed(1)}%)`}
        >
          <div className="absolute inset-y-0 left-0 bg-info/30" style={{ width: '100%' }} />
          <div className="absolute inset-y-0 left-0 bg-success" style={{ width: `${convPctNaBarra}%` }} />
        </div>
        <span className="text-right text-ink-muted font-mono tabular-nums text-[11px]">
          {vendaOrc}/{o.total}
        </span>
        <span className={`text-right font-mono tabular-nums font-bold ${tone}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
    )
  }

  // Linha "compacta" para origens sem conversão: nome + barra azul + volume
  const RowSemConv = ({ o }: { o: typeof etq.por_origem[number] }) => {
    const volPct = (o.total / maxVolGeral) * 100
    return (
      <div className="grid grid-cols-[140px_1fr_70px_60px] items-center gap-3 text-[12px] opacity-70">
        <div className="truncate text-ink-muted" title={o.origem}>{o.origem}</div>
        <div
          className="h-2 bg-surface-2 rounded overflow-hidden relative"
          style={{ width: `${Math.max(volPct, 6)}%` }}
        >
          <div className="absolute inset-y-0 left-0 bg-info/30" style={{ width: '100%' }} />
        </div>
        <span className="text-right text-ink-faint font-mono tabular-nums text-[11px]">
          0/{o.total}
        </span>
        <span className="text-right font-mono tabular-nums text-ink-faint">—</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header explicativo (curto, no topo, claro) */}
      <div className="flex items-center justify-between text-[10px] text-ink-faint border-b border-border pb-2">
        <span>Ordenado por <strong className="text-ink-muted">% de conversão</strong> (vendido + orçamento ÷ total)</span>
        <div className="flex gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success" /> Converteu</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-info/30" /> Volume</span>
        </div>
      </div>

      {/* Bloco 1: origens com conversão (destaque) */}
      {comConv.length > 0 ? (
        <div className="space-y-2">
          {comConv.map(o => <RowConv key={o.origem} o={o} />)}
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint italic">Nenhuma origem com vendas ou orçamentos no período.</p>
      )}

      {/* Bloco 2: origens sem conversão (agrupadas, esmaecidas) */}
      {semConv.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border/50">
          <div className="text-[10px] text-ink-faint uppercase tracking-wide">
            Sem conversão ainda · {semConv.length} {semConv.length === 1 ? 'origem' : 'origens'} · {semConv.reduce((s, o) => s + o.total, 0)} leads
          </div>
          {semConv.map(o => <RowSemConv key={o.origem} o={o} />)}
        </div>
      )}

      <p className="text-[10px] text-ink-faint pt-1 leading-relaxed">
        Origens <code className="text-[9px] bg-surface-2 px-1 rounded">WhatsApp NNNN</code> (vendedores individuais) excluídas. Conversão considera leads com etiqueta <strong>VENDIDO</strong> ou <strong>ORÇAMENTO ENVIADO</strong>.
      </p>
    </div>
  )
}

function HeatmapDiaHora({ heatmap }: { heatmap: { dow: number; hour: number; total: number }[] }) {
  const DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  // Constrói matriz 7 × 24 + agregados
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxVal = 0
  let pico = { dia: 0, hora: 0, val: 0 }
  for (const h of heatmap) {
    const di = h.dow >= 1 && h.dow <= 7 ? h.dow - 1 : 6
    if (h.hour >= 0 && h.hour < 24) {
      matrix[di][h.hour] = h.total
      if (h.total > maxVal) maxVal = h.total
      if (h.total > pico.val) pico = { dia: di, hora: h.hour, val: h.total }
    }
  }
  const totalPorDia = matrix.map(row => row.reduce((s, v) => s + v, 0))
  const totalPorHora = Array.from({ length: 24 }, (_, h) => matrix.reduce((s, row) => s + row[h], 0))
  const totalGeral = totalPorDia.reduce((s, v) => s + v, 0)
  const maxHora = Math.max(...totalPorHora, 1)
  const diaForte = totalPorDia.indexOf(Math.max(...totalPorDia))
  // Janela comercial padrão de 8h às 18h
  const dentroComercial = matrix.reduce((s, row, di) =>
    s + row.slice(8, 19).reduce((a, b) => a + b, 0) * (di < 5 ? 1 : 0), 0)
  const pctComercial = totalGeral > 0 ? Math.round((dentroComercial / totalGeral) * 100) : 0

  // 4 níveis discretos: vazio / baixo / médio / pico — facilita ler
  const cellColor = (v: number) => {
    if (v === 0) return 'hsl(240 6% 18%)'
    const r = v / maxVal
    if (r >= 0.66) return 'hsl(152 70% 42%)'   // pico — verde forte
    if (r >= 0.33) return 'hsl(152 50% 32%)'   // médio
    return 'hsl(152 30% 22%)'                  // baixo
  }
  const cellText = (v: number) => {
    if (v === 0) return ''
    const r = v / maxVal
    if (r >= 0.33) return v.toString()
    return ''  // baixo não mostra número — reduz clutter
  }

  return (
    <div className="space-y-3">
      {/* Insight box: pico + janela comercial */}
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        <div className="border-l-2 border-success pl-2">
          <div className="text-[10px] text-ink-faint uppercase tracking-wide">Pico</div>
          <div className="text-ink font-medium">{DOW[pico.dia]} {pico.hora}h</div>
          <div className="text-ink-faint">{pico.val} leads</div>
        </div>
        <div className="border-l-2 border-info pl-2">
          <div className="text-[10px] text-ink-faint uppercase tracking-wide">Dia mais movimentado</div>
          <div className="text-ink font-medium">{DOW[diaForte]}</div>
          <div className="text-ink-faint">{totalPorDia[diaForte]} leads</div>
        </div>
        <div className={`border-l-2 pl-2 ${pctComercial >= 70 ? 'border-success' : pctComercial >= 50 ? 'border-warning' : 'border-danger'}`}>
          <div className="text-[10px] text-ink-faint uppercase tracking-wide">No horário comercial</div>
          <div className="text-ink font-medium">{pctComercial}%</div>
          <div className="text-ink-faint">seg-sex · 8h-18h</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="w-10" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="text-[9px] text-ink-faint font-normal text-center w-6">{h}</th>
              ))}
              <th className="text-[9px] text-ink-faint font-normal text-center w-8 pl-1">Σ</th>
            </tr>
          </thead>
          <tbody>
            {DOW.map((d, di) => (
              <tr key={d}>
                <td className="text-[10px] text-ink-muted font-medium pr-2 text-right">{d}</td>
                {matrix[di].map((v, h) => (
                  <td
                    key={h}
                    className="w-6 h-6 rounded-sm text-center"
                    style={{ backgroundColor: cellColor(v) }}
                    title={`${d} ${h}h: ${v} leads`}
                  >
                    <span className="text-[10px] font-semibold text-white tabular-nums">
                      {cellText(v)}
                    </span>
                  </td>
                ))}
                <td className="text-[10px] text-ink-muted font-mono tabular-nums text-right pl-1">{totalPorDia[di]}</td>
              </tr>
            ))}
            {/* Total por hora — facilita ver picos */}
            <tr>
              <td className="text-[9px] text-ink-faint font-normal pr-2 text-right">Σ</td>
              {totalPorHora.map((t, h) => (
                <td key={h} className="text-center">
                  <div className="h-3 bg-surface-2 rounded-sm relative overflow-hidden mx-px">
                    <div className="absolute inset-y-0 left-0 bg-info/50" style={{ width: `${(t / maxHora) * 100}%` }} />
                  </div>
                  <div className="text-[8px] text-ink-faint tabular-nums leading-none mt-0.5">{t > 0 ? t : ''}</div>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-ink-faint">
        <span>Intensidade:</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(240 6% 18%)' }} /> Vazio</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(152 30% 22%)' }} /> Baixo</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(152 50% 32%)' }} /> Médio</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'hsl(152 70% 42%)' }} /> Pico</span>
        <span className="ml-auto">Fuso BR</span>
      </div>
    </div>
  )
}

function MapaEtiquetas({ etq }: { etq: ReturnType<typeof useDashboardEtiquetas>['data'] }) {
  if (!etq) return null
  const total = etq.leads_com_etiqueta || 1

  // 3 grupos macro (em vez de 7 categorias): o que importa pro gestor
  const grupoConv = (etq.por_categoria.vendido ?? 0) + (etq.por_categoria.orcamento ?? 0)
  const grupoAtivo = (etq.por_categoria.novo ?? 0) + (etq.por_categoria.quente ?? 0) + (etq.por_categoria.lead_quente ?? 0)
  const grupoPerdido = (etq.por_categoria.perdido ?? 0) + (etq.por_categoria.interno ?? 0) + (etq.por_categoria.outros ?? 0)

  const pctConv = Math.round((grupoConv / total) * 100)
  const pctAtivo = Math.round((grupoAtivo / total) * 100)
  const pctPerdido = Math.round((grupoPerdido / total) * 100)

  // Top etiquetas dedup por nome
  const mapEtq = new Map<string, { nome: string; categoria: EtiquetaCategoria; total: number }>()
  for (const e of etq.por_etiqueta) {
    const cur = mapEtq.get(e.nome)
    if (cur) cur.total += e.total
    else mapEtq.set(e.nome, { nome: e.nome, categoria: e.categoria, total: e.total })
  }
  const todasEtq = Array.from(mapEtq.values())

  // Separar pipeline ativo (novo/quente/orçamento) de motivos de trava (perdido/outros)
  const pipelineCats: EtiquetaCategoria[] = ['novo', 'quente', 'lead_quente', 'orcamento', 'vendido']
  const travaCats: EtiquetaCategoria[] = ['perdido', 'outros', 'interno']
  const topPipeline = todasEtq.filter(e => pipelineCats.includes(e.categoria)).sort((a, b) => b.total - a.total).slice(0, 5)
  const topTrava = todasEtq.filter(e => travaCats.includes(e.categoria)).sort((a, b) => b.total - a.total).slice(0, 5)

  const maxPipe = Math.max(...topPipeline.map(e => e.total), 1)
  const maxTrava = Math.max(...topTrava.map(e => e.total), 1)

  return (
    <div className="space-y-5">
      {/* Barra empilhada com 3 grupos só */}
      <div>
        <div className="flex h-4 rounded-full overflow-hidden bg-surface-2 border border-border/50">
          <div className="h-full bg-success" style={{ width: `${(grupoConv / total) * 100}%` }} title={`Convertido: ${grupoConv}`} />
          <div className="h-full bg-info" style={{ width: `${(grupoAtivo / total) * 100}%` }} title={`Em andamento: ${grupoAtivo}`} />
          <div className="h-full bg-danger/70" style={{ width: `${(grupoPerdido / total) * 100}%` }} title={`Perdido/Outros: ${grupoPerdido}`} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="border-l-2 border-success pl-2">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">Convertido</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[18px] font-bold text-ink tabular-nums">{grupoConv}</span>
              <span className="text-[11px] text-success tabular-nums">{pctConv}%</span>
            </div>
            <div className="text-[10px] text-ink-faint">
              {etq.por_categoria.vendido ? `${etq.por_categoria.vendido} vendido` : ''}
              {etq.por_categoria.vendido && etq.por_categoria.orcamento ? ' · ' : ''}
              {etq.por_categoria.orcamento ? `${etq.por_categoria.orcamento} orçamento` : ''}
            </div>
          </div>
          <div className="border-l-2 border-info pl-2">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">Em andamento</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[18px] font-bold text-ink tabular-nums">{grupoAtivo}</span>
              <span className="text-[11px] text-info tabular-nums">{pctAtivo}%</span>
            </div>
            <div className="text-[10px] text-ink-faint">
              novos + quentes + em conversa
            </div>
          </div>
          <div className="border-l-2 border-danger/70 pl-2">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">Perdido / Trava</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[18px] font-bold text-ink tabular-nums">{grupoPerdido}</span>
              <span className="text-[11px] text-danger tabular-nums">{pctPerdido}%</span>
            </div>
            <div className="text-[10px] text-ink-faint">
              perdido + outros + interno
            </div>
          </div>
        </div>
      </div>

      {/* Top pipeline (azul/verde — saúde) */}
      {topPipeline.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">🟢 Pipeline saudável</p>
          <div className="space-y-1.5">
            {topPipeline.map(e => (
              <div key={e.nome} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink" title={e.nome}>{e.nome}</span>
                <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
                  <div className="h-full" style={{ width: `${(e.total / maxPipe) * 100}%`, backgroundColor: CAT_COLOR[e.categoria] }} />
                </div>
                <span className="text-right text-ink-muted font-mono tabular-nums">{e.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top motivos de trava/perda (vermelho — ação necessária) */}
      {topTrava.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">🔴 Motivos de trava / perda</p>
          <div className="space-y-1.5">
            {topTrava.map(e => (
              <div key={e.nome} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink" title={e.nome}>{e.nome}</span>
                <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
                  <div className="h-full bg-danger/60" style={{ width: `${(e.total / maxTrava) * 100}%` }} />
                </div>
                <span className="text-right text-ink-muted font-mono tabular-nums">{e.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
        <Link
          key={d.vendedor}
          to={`/atendimentos?responsavel=${encodeURIComponent(d.vendedor)}`}
          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-surface-2/40 border border-border/30 hover:bg-surface-2/80 hover:border-accent/30 transition-colors"
          title="Abrir lista de atendimentos deste vendedor"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-medium text-ink capitalize">{d.vendedor.toLowerCase()}</span>
            {d.vendido > 0 && (
              <span className="text-[10px] px-1.5 py-px rounded bg-success-bg text-success font-mono">{d.vendido} ✓</span>
            )}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums font-mono">
            {d.total} leads · 0 ORC →
          </div>
        </Link>
      ))}
      <p className="text-[10px] text-ink-faint pt-1">
        Clique no vendedor pra abrir a lista de leads dele em /atendimentos. Quem recebe leads mas nunca etiqueta "ORCAMENTO ENVIADO" no WhatsApp tá com problema operacional.
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
