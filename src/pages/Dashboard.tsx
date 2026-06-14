import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset, type FunilEtapa, type SlaVendedor, type LeadEmRisco } from '@/hooks/useDashboard'
import { useDashboardEtiquetas, useHeatmapSemanal, CATEGORIA_LABEL, type EtiquetaCategoria } from '@/hooks/useDashboardEtiquetas'
import { useOrcamentosResumo, type OrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { useVendedoresPainel, type VendedorPainel } from '@/hooks/useVendedoresPainel'
import { useOrfaosPorVendedor, type OrfaosPorVendedor } from '@/hooks/useOrfaosPorVendedor'
import {
  Area, AreaChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown, ArrowUp, Hand, FilePlus2, AlertTriangle, Clock, Ghost, Banknote } from 'lucide-react'

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

// Mapa choropleth do Brasil — lazy (puxa o Leaflet só quando o dashboard renderiza)
const MapaBrasilLeads = lazy(() => import('@/components/MapaBrasilLeads'))

function usePresetFilter(): [DashboardPreset, (p: DashboardPreset) => void] {
  const [preset, setPreset] = useState<DashboardPreset>(() => {
    if (typeof window === 'undefined') return '30d'
    // Default 30d na 1ª visita ('Tudo' dilui o sinal recente e distorce a conversão);
    // respeita escolha deliberada salva (inclusive 'Tudo' = '').
    const stored = localStorage.getItem('dashboard-preset')
    return stored !== null ? (stored as DashboardPreset) : '30d'
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

function Card({ children, className = '', id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`bg-surface border border-border rounded-xl p-5 transition-colors hover:border-border-strong scroll-mt-20 ${className}`}>
      {children}
    </div>
  )
}

// Cabeçalho de GRUPO — separa a página em blocos por pergunta de negócio.
function SectionTitle({ n, titulo, pergunta }: { n: string; titulo: string; pergunta: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-3 lg:pt-4 border-t border-border/60 first:border-t-0">
      <span className="text-[11px] font-bold text-accent tabular-nums">{n}</span>
      <h2 className="text-[14px] font-bold text-ink tracking-tight">{titulo}</h2>
      <span className="text-[11px] text-ink-faint truncate">— {pergunta}</span>
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
  // Valor das propostas montadas no builder (orcamentos_gerados) — única fonte real de R$
  const { data: orc } = useOrcamentosResumo(preset)
  // Painel por vendedor: funil de etiquetas WhatsApp + motivos de perda
  const { data: vendPainel } = useVendedoresPainel(preset)
  // Leads órfãos (NOVO LEAD parado >7d) por vendedor — janela por idade, não pelo filtro
  const { data: orfaos } = useOrfaosPorVendedor(7)
  // Heatmap usa janela fixa (30d) — ignora filtro do dashboard de propósito
  const { data: heatmap30d } = useHeatmapSemanal()

  // Funil de qualificação MONOTÔNICO: Entrou → Engajou → Qualificou (IA) →
  // Orçamento → Vendido (etiqueta WA). "Passou pro vendedor" saiu do funil —
  // atribuição não é etapa de qualificação e era o que deixava o funil maior no
  // meio (2.788 > 904), gerando o "sem sentido". pctAnterior travado em 100.
  const funilCanonico = useMemo<FunilEtapa[]>(() => {
    if (!data?.funil) return []
    const raw = [
      { etapa: 'Entrou',           valor: data.funil[0]?.valor ?? 0 },
      { etapa: 'Engajou com a IA', valor: data.funil[1]?.valor ?? 0 },
      { etapa: 'Qualificou',       valor: data.funil[2]?.valor ?? 0 },
      { etapa: 'Orçamento enviado', valor: etq?.por_categoria.orcamento ?? 0 },
      { etapa: 'Vendido',          valor: etq?.por_categoria.vendido ?? 0 },
    ]
    const topo = raw[0].valor || 1
    return raw.map((e, i) => {
      const prev = i > 0 ? raw[i - 1].valor : e.valor
      return {
        etapa: e.etapa,
        valor: e.valor,
        pctTopo: Math.min(100, (e.valor / topo) * 100),
        pctAnterior: prev > 0 ? Math.min(100, (e.valor / prev) * 100) : 0,
        perdidos: i > 0 ? Math.max(0, prev - e.valor) : 0,
      }
    })
  }, [data?.funil, etq])

  // Cards de vendedor (3 fontes mescladas + veredito), computados uma vez e
  // usados pelo Resumo do gerente e pelo Painel por vendedor.
  const vendCards = useMemo(
    () => montarCardsVendedor(vendPainel ?? [], data?.slaPorVendedor ?? [], orc),
    [vendPainel, data?.slaPorVendedor, orc],
  )

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

  // 5 KPIs essenciais (cortado de 9): o funil de entrada (leads), a qualidade
  // (qualificados), e o resultado (orçamento, vendido, taxa). "Hoje/Não respondeu/
  // Em andamento/Com vendedor" saíram — são estágios do funil, não KPI de topo.
  const orcamentoEtq = etq?.por_categoria.orcamento ?? 0
  const vendidoEtq = etq?.por_categoria.vendido ?? 0
  const taxaConv = data.totalLeads > 0 ? Math.round((vendidoEtq / data.totalLeads) * 1000) / 10 : 0

  const heroKpis = [
    { label: preset ? 'Leads no período' : 'Total de leads', kpi: data.kpiTotal, icon: Users, color: COLORS.ink, sub: preset ? periodoLabel.toLowerCase() : 'desde o início' },
    { label: 'Qualificados',  kpi: data.kpiQualificados, icon: CheckCircle2, color: COLORS.accent, sub: 'quer algo que a Branorte faz' },
    { label: 'Orçamentos',    kpi: { valor: orcamentoEtq, deltaPct: 0, sparkline: [] }, icon: FilePlus2, color: 'hsl(280 65% 50%)', sub: 'etiqueta no WhatsApp' },
    { label: 'Vendidos',      kpi: { valor: vendidoEtq, deltaPct: 0, sparkline: [] }, icon: CheckCircle2, color: 'hsl(152 60% 35%)', sub: 'etiqueta VENDIDO' },
    { label: 'Conversão',     kpi: { valor: taxaConv, deltaPct: 0, sparkline: [] }, icon: TrendingUp, color: COLORS.info, sub: 'lead → vendido', suffix: '%' },
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

      {/* RESUMO DO GERENTE — as 2 decisões (marketing + cobrar vendedor) no topo */}
      {(data.porOrigem.length > 0 || vendCards.length > 0) && (
        <ResumoGerente porOrigem={data.porOrigem} cards={vendCards} />
      )}

      <SectionTitle n="1" titulo="Visão geral" pergunta="Estou crescendo e o que preciso agir agora?" />

      {/* HERO KPIs com sparkline + delta */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {heroKpis.map(k => (
          <KpiHero key={k.label} {...k} showDelta={showDelta} />
        ))}
      </div>

      {/* DINHEIRO — valor das propostas montadas no período (único R$ real no fluxo de lead) */}
      {orc && orc.geradas > 0 && (
        <Card>
          <CardHeader
            title="Propostas no builder (R$)"
            subtitle="Valor montado pelos vendedores no sistema de orçamento — NÃO confundir com a etiqueta ORÇAMENTO do WhatsApp (KPI acima), nem com venda fechada (vive em Controle)."
          />
          <PropostasResumoView orc={orc} periodoLabel={periodoLabel} />
        </Card>
      )}

      {/* LEADS POR DIA — fecha o grupo Visão geral (tendência) */}
      <Card>
        <CardHeader
          title="Leads por dia"
          subtitle={data.leadsPorDia.length > 0 ? `${data.leadsPorDia.length} dias com atividade` : 'Sem dados'}
        />
        <div className="h-[220px]">
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

      {/* ════════ GRUPO 2 · FUNIL ════════ */}
      <SectionTitle n="2" titulo="Funil" pergunta="Onde o lead morre?" />
      <Card>
        <CardHeader
          title="Funil de qualificação"
          subtitle={`${fmtN(data.totalLeads)} leads · IA qualifica · vendedor fecha via etiqueta WA`}
        />
        <FunilHero etapas={funilCanonico} />
      </Card>
      {etq && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader title="Ciclo de venda" subtitle="Mediana de tempo entre etapas" />
            <CicloVenda etq={etq} />
          </Card>
          <Card>
            <CardHeader title="Motivos de trava / perda" subtitle="Por que o lead não avança (etiquetas do vendedor)" />
            <MapaEtiquetas etq={etq} variant="trava" />
          </Card>
        </div>
      )}

      {/* ════════ GRUPO 3 · ONDE INVESTIR (canônico de mídia) ════════ */}
      <SectionTitle n="3" titulo="Onde investir" pergunta="Pra onde vai (ou corta) a verba?" />
      <Card id="criativo-veredito">
        <CardHeader
          title="🎯 Onde investir — por criativo"
          subtitle="Escalar / pausar cada criativo. Decisão por qualidade do lead (conversão ~0 em tudo)."
        />
        <VereditoInvestimento criativos={data.porCriativo} etq={etq} />
      </Card>
      {data.porOrigem.length > 0 && (
        <Card>
          <CardHeader
            title="🎯 Onde investir — por origem (canal)"
            subtitle="Meta / Google / Instagram… origens WhatsApp de vendedor individual excluídas."
          />
          <VereditoOrigem origens={data.porOrigem} etq={etq} />
        </Card>
      )}

      {/* ════════ GRUPO 4 · OPERAÇÃO DO TIME ════════ */}
      <SectionTitle n="4" titulo="Operação do time" pergunta="Quem eu cobro hoje e qual lead resgato?" />
      {data.leadsEmRisco.length > 0 && (
        <Card id="leads-resgatar">
          <CardHeader
            title="🔥 Leads pra resgatar agora"
            subtitle="Disseram que querem investir agora e pararam de responder (+24h sem atividade) — quentes que sumiram, vale uma ligação"
          />
          <LeadsResgatar leads={data.leadsEmRisco} />
        </Card>
      )}
      {orfaos && orfaos.total > 0 ? (
        <Card id="leads-orfaos">
          <CardHeader
            title="Leads órfãos (zumbis no funil)"
            subtitle="Etiqueta NOVO LEAD parada há mais de 7 dias — quem recebeu lead novo e não deu o 1º atendimento"
          />
          <LeadsOrfaosVendedor orfaos={orfaos} />
        </Card>
      ) : etq && (
        <Card id="leads-orfaos">
          <CardHeader
            title="Leads órfãos (zumbis no funil)"
            subtitle={`Etiqueta NOVO ou PROSPECCAO há mais de ${etq.leads_orfaos_dias_limite} dias sem evoluir`}
          />
          <LeadsOrfaos etq={etq} />
        </Card>
      )}
      <Card id="vendedores">
        <CardHeader
          title="Painel por vendedor"
          subtitle="Contatos passados → qualificação da IA → etiquetas do funil no WhatsApp → motivos de perda. (Daniel/testes fora.)"
        />
        {vendCards.length > 0
          ? <PainelVendedores cards={vendCards} />
          : <SlaTable rows={data.slaPorVendedor} etqPorVendedor={etq?.por_vendedor} />}
      </Card>

      {/* ════════ GRUPO 5 · CONTEXTO (colapsável no caminho diário) ════════ */}
      <SectionTitle n="5" titulo="Contexto" pergunta="De onde e quando vêm os leads?" />
      {heatmap30d && heatmap30d.length > 0 && (
        <Card>
          <CardHeader
            title="Quando chegam os leads (BR)"
            subtitle="Últimos 30 dias — janela fixa, ignora o filtro de período acima"
          />
          <HeatmapDiaHora heatmap={heatmap30d} />
        </Card>
      )}
      <Card>
        <CardHeader
          title="Distribuição geográfica"
          subtitle={`${fmtN(data.porUf.reduce((s, u) => s + u.total, 0))} leads · ${data.porUf.filter(u => u.isBrasil).length} estados BR · ${data.porUf.filter(u => !u.isBrasil).length} países`}
        />
        <DistribuicaoGeo items={data.porUf} />
      </Card>
    </div>
  )
}

// ============================================================================
// COMPONENTES
// ============================================================================

function KpiHero({ label, kpi, icon: Icon, color, sub, suffix, showDelta: showDeltaProp = true }: {
  label: string;
  kpi: { valor: number; deltaPct: number; sparkline: number[] };
  icon: typeof Users;
  color: string;
  sub: string;
  suffix?: string;
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
        {suffix ? kpi.valor.toString().replace('.', ',') : fmtN(kpi.valor)}
        {suffix && <span className="text-base sm:text-xl font-medium ml-0.5">{suffix}</span>}
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
      {/* Sparkline — só quando há série (cards de etiqueta passam [] e não renderizam) */}
      {sparkData.length > 0 && (
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
      )}
    </div>
  )
}

// Resumo de R$ das propostas geradas — o único dinheiro real no fluxo de lead.
// Ticket alto (fábrica de ração) merece 1 casa em milhar — "R$ 80k" perde precisão de decisão
function fmtTicket(v: number): string {
  if (v >= 1_000_000) return 'R$ ' + (v / 1_000_000).toFixed(2).replace('.', ',') + 'M'
  if (v >= 1_000) return 'R$ ' + (v / 1_000).toFixed(1).replace('.', ',') + 'k'
  return 'R$ ' + Math.round(v)
}

function PropostasResumoView({ orc, periodoLabel }: { orc: OrcamentosResumo; periodoLabel: string }) {
  const top = orc.porVendedor.filter(v => v.brl > 0 && v.vendedor !== '—').slice(0, 4)
  const maxBrl = Math.max(...top.map(v => v.brl), 1)
  const nVendedores = orc.porVendedor.filter(v => v.vendedor !== '—').length
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-5">
      {/* Bloco de números */}
      <div>
        <div className="flex items-end gap-2">
          <Banknote className="h-6 w-6 text-success mb-1.5 shrink-0" />
          <div>
            <div className="text-[34px] leading-none font-semibold tabular-nums text-success">{fmtBRL(orc.valorTotalBRL)}</div>
            <p className="text-[11px] text-ink-faint mt-1">em propostas montadas · {periodoLabel.toLowerCase()}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtN(orc.geradas)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">propostas</div>
          </div>
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtTicket(orc.ticketMedioBRL)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">ticket médio</div>
          </div>
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtN(nVendedores)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">vendedores</div>
          </div>
        </div>
      </div>
      {/* Top vendedores por valor em proposta */}
      {top.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">Quem mais montou proposta (R$)</p>
          <div className="space-y-1.5">
            {top.map(v => (
              <div key={v.vendedor} className="grid grid-cols-[120px_1fr_64px] items-center gap-2 text-[12px]">
                <span className="truncate text-ink capitalize" title={v.vendedor}>{v.vendedor.toLowerCase()}</span>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-success/70 rounded-full" style={{ width: `${(v.brl / maxBrl) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-ink-muted">{fmtBRL(v.brl)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint pt-2">Valor das propostas montadas no builder de orçamento, não venda fechada. Daniel (testes) fora.</p>
        </div>
      )}
    </div>
  )
}

// Leads quentes parados — responde "qual lead resgato?" (dado já computado no hook)
function LeadsResgatar({ leads }: { leads: LeadEmRisco[] }) {
  return (
    <div className="space-y-1.5">
      {leads.map(l => {
        const dias = Math.floor(l.horasSemResposta / 24)
        const tempo = dias >= 1 ? `${dias}d parado` : `${Math.round(l.horasSemResposta)}h parado`
        const urg = l.horasSemResposta >= 168 // >7d = crítico
        return (
          <Link
            key={l.id}
            to={l.vendedor ? `/atendimentos?responsavel=${encodeURIComponent(l.vendedor)}` : '/atendimentos'}
            className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-surface-2/40 border border-border/30 hover:border-accent/30 hover:bg-surface-2/70 transition-colors"
            title="Abrir atendimentos deste vendedor"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Flame className={`h-3.5 w-3.5 shrink-0 ${urg ? 'text-danger' : 'text-warning'}`} />
              <div className="min-w-0">
                <div className="text-[12px] text-ink truncate">{l.nome || l.telefone || 'Lead sem nome'}</div>
                <div className="text-[10px] text-ink-faint truncate">
                  {l.momento === 'Agora' ? 'quer investir agora' : (l.momento || 'lead quente')}
                  {l.vendedor ? ` · ${l.vendedor}` : ' · sem vendedor'}
                </div>
              </div>
            </div>
            <span className={`text-[11px] font-medium tabular-nums shrink-0 ${urg ? 'text-danger' : 'text-warning'}`}>{tempo}</span>
          </Link>
        )
      })}
      <p className="text-[10px] text-ink-faint pt-1">
        Quentes que sumiram no meio do atendimento. Ordenados pelo tempo parado — comece por cima.
      </p>
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

// ============================================================================
// PAINEL POR VENDEDOR — funil de etiquetas WA + qualif IA + R$ + motivos de perda
// ============================================================================

// Primeiro nome em MAIÚSCULA = chave de merge entre as 3 fontes (etiqueta usa "PEDRO",
// atendimentos "Pedro Della Giustina", orçamentos "PEDRO DELA GIUSTINA ").
function primeiroNome(s: string): string {
  return (s || '').trim().split(/\s+/)[0]?.toUpperCase() ?? ''
}
const ehDaniel = (s: string) => /daniel/i.test(s || '')
function capitalizar(s: string): string {
  return (s || '').toLowerCase().replace(/\b\w/g, m => m.toUpperCase())
}

// Card de vendedor já com as 3 fontes mescladas + veredito de cobrança.
interface CardVend {
  v: VendedorPainel
  nome: string
  contatos: number
  qualifIa: number | null
  orcN: number            // orçamentos montados no builder
  orcBRL: number          // valor total montado
  ultimaDias: number | null
  veredito: { nivel: 'cobrar' | 'atencao' | 'ok'; tag: string; cor: string; motivo: string }
}

// Semáforo de cobrança — cobra PROCESSO verificável (parou de orçar, recebe muito lead
// e não monta orçamento, não fecha), não placar de venda (venda é sub-registro: depende
// do vendedor etiquetar à mão).
function vereditoVendedor(c: Omit<CardVend, 'veredito'>): CardVend['veredito'] {
  if (c.ultimaDias != null && c.ultimaDias > 4 && (c.v.quente + c.v.novo) > 20)
    return { nivel: 'cobrar', tag: 'COBRAR', cor: 'danger', motivo: `parou de orçar há ${c.ultimaDias} dias, com fila quente na mão` }
  if (c.contatos >= 200 && c.orcN <= 10 && c.v.vendido <= 1)
    return { nivel: 'cobrar', tag: 'COBRAR', cor: 'danger', motivo: `${fmtN(c.contatos)} contatos e só ${c.orcN} orçamentos montados` }
  if (c.orcN >= 25 && c.v.vendido === 0)
    return { nivel: 'atencao', tag: 'DESTRAVAR', cor: 'warning', motivo: `${c.orcN} orçamentos (${fmtBRL(c.orcBRL)}) e 0 venda — fechamento ou falta etiquetar` }
  return { nivel: 'ok', tag: 'OK', cor: 'success', motivo: c.v.vendido > 0 ? `${c.v.vendido} vendas etiquetadas` : 'em dia' }
}

const ORDEM_VEREDITO: Record<CardVend['veredito']['nivel'], number> = { cobrar: 0, atencao: 1, ok: 2 }

// Mescla painel (etiqueta) + atendimentos (qualif IA) + orçamentos (R$) por primeiro
// nome, calcula o veredito e ordena por gravidade (cobrar primeiro). Daniel fora.
function montarCardsVendedor(painel: VendedorPainel[], sla: SlaVendedor[], orc: OrcamentosResumo | undefined): CardVend[] {
  const slaByNome = new Map(sla.map(s => [primeiroNome(s.vendedor), s]))
  const orcByNome = new Map((orc?.porVendedor ?? []).map(o => [primeiroNome(o.vendedor), o]))
  return painel
    .filter(v => !ehDaniel(v.vendedor))
    .map(v => {
      const k = primeiroNome(v.vendedor)
      const s = slaByNome.get(k); const o = orcByNome.get(k)
      const base = {
        v,
        nome: s?.vendedor || capitalizar(v.vendedor),
        contatos: s?.totalLeads ?? v.contatos,
        qualifIa: s?.qualificados ?? null,
        orcN: o?.n ?? 0, orcBRL: o?.brl ?? 0,
        ultimaDias: o?.ultimaDias ?? null,
      }
      return { ...base, veredito: vereditoVendedor(base) }
    })
    .sort((a, b) => ORDEM_VEREDITO[a.veredito.nivel] - ORDEM_VEREDITO[b.veredito.nivel] || b.contatos - a.contatos)
}

// ════════ RESUMO DO GERENTE — as 2 decisões em 10 segundos, no topo ════════
function ResumoGerente({ porOrigem, cards }: {
  porOrigem: { origem: string; total: number; ctr: number; engajou: number }[]
  cards: CardVend[]
}) {
  // MARKETING: melhor canal por qualidade, canal que queima verba, dívida de rastreio
  const escalar = [...porOrigem].filter(o => o.total >= 30).sort((a, b) => b.ctr - a.ctr)[0]
  const queima = porOrigem.filter(o => o.total >= 50 && o.total > 0 && o.engajou / o.total < 0.12).sort((a, b) => b.total - a.total)[0]
  const semRastreio = porOrigem.filter(o => /n[aã]o identif|sem origem|desconhec|^outros$|direto/i.test(o.origem)).reduce((s, o) => s + o.total, 0)
  // VENDEDORES: pega os de "cobrar" e "destravar"
  const cobrar = cards.filter(c => c.veredito.nivel === 'cobrar').slice(0, 3)
  const destravar = cards.filter(c => c.veredito.nivel === 'atencao').slice(0, 2)

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-3 lg:p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[13px] font-bold text-ink">👔 Resumo do gerente</span>
        <span className="text-[10px] text-ink-faint">— o que decidir agora</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* MARKETING */}
        <a href="#criativo-veredito" className="block rounded-lg bg-surface-2/40 border border-border/40 p-3 hover:border-accent/30 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-1.5">📈 Marketing — onde botar dinheiro</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {escalar && <li><span className="text-success font-semibold">▲ Escalar {escalar.origem}</span> <span className="text-ink-faint">— melhor lead ({escalar.ctr.toFixed(0)}% qualificam)</span></li>}
            {queima && <li><span className="text-danger font-semibold">▼ Revisar {queima.origem}</span> <span className="text-ink-faint">— {fmtN(queima.total)} leads e quase ninguém engaja ({Math.round(queima.engajou / queima.total * 100)}%)</span></li>}
            {semRastreio > 0 && <li><span className="text-warning font-semibold">🔧 Rastreio: {fmtN(semRastreio)} leads sem origem</span> <span className="text-ink-faint">— e é onde caem vendas; corrigir antes de cortar verba</span></li>}
          </ul>
        </a>
        {/* VENDEDORES */}
        <a href="#vendedores" className="block rounded-lg bg-surface-2/40 border border-border/40 p-3 hover:border-accent/30 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-1.5">👥 Vendedores — quem cobrar</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {cobrar.map(c => (
              <li key={c.nome}><span className="text-danger font-semibold">🔴 {c.nome.split(' ')[0]}</span> <span className="text-ink-faint">— {c.veredito.motivo}</span></li>
            ))}
            {destravar.map(c => (
              <li key={c.nome}><span className="text-warning font-semibold">🟠 {c.nome.split(' ')[0]}</span> <span className="text-ink-faint">— {c.veredito.motivo}</span></li>
            ))}
            {cobrar.length === 0 && destravar.length === 0 && <li className="text-ink-faint">Time em dia — ninguém no vermelho.</li>}
          </ul>
        </a>
      </div>
      <p className="text-[10px] text-ink-faint mt-2">⚠️ "Venda" é sub-registro (depende do vendedor etiquetar à mão) — cobre PROCESSO (orçamento montado, follow-up), não o placar de vendas.</p>
    </div>
  )
}

function PainelVendedores({ cards }: { cards: CardVend[] }) {
  if (!cards.length) return <p className="text-sm text-ink-faint">Sem vendedores no período.</p>
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {cards.map(c => <VendedorCard key={c.nome} c={c} />)}
    </div>
  )
}

function VendedorCard({ c }: { c: CardVend }) {
  const { v, nome, contatos, qualifIa, orcN, orcBRL } = c
  const SEM = { danger: 'text-danger border-danger/40 bg-danger/10', warning: 'text-warning border-warning/40 bg-warning/10', success: 'text-success border-success/40 bg-success/10' }[c.veredito.cor] ?? ''
  const qualPct = contatos > 0 && qualifIa != null ? Math.round((qualifIa / contatos) * 100) : null
  // Onde os leads desse vendedor estão (etiqueta atual no WhatsApp)
  const etapas = [
    { label: 'Prospecção', n: v.novo, cor: CAT_COLOR.novo },
    { label: 'Quente', n: v.quente, cor: CAT_COLOR.lead_quente },
    { label: 'Follow-up', n: v.follow_up, cor: 'hsl(38 85% 50%)' },
    { label: 'Orçamento', n: v.orcamento, cor: CAT_COLOR.orcamento },
    { label: 'Vendido', n: v.vendido, cor: CAT_COLOR.vendido },
  ]
  const maxEtapa = Math.max(...etapas.map(e => e.n), 1)
  const motivos = [
    { label: 'Nunca respondeu', n: v.m_nao_respondeu },
    { label: 'Só base de preço', n: v.m_so_preco },
    { label: 'Fora do orçamento', n: v.m_fora_orcamento },
    { label: 'Não fabricamos', n: v.m_nao_fabricamos },
    { label: 'Sem interesse', n: v.m_sem_interesse },
    { label: 'Comprou concorrente', n: v.m_concorrente },
    { label: 'Outros', n: v.m_outros },
  ].filter(m => m.n > 0).sort((a, b) => b.n - a.n)

  return (
    <div className="rounded-lg border border-border bg-surface-2/30 p-3.5">
      {/* Cabeçalho: nome + contatos + qualif IA */}
      <div className="flex items-start justify-between gap-2 mb-3 pb-2.5 border-b border-border/60">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              to={`/atendimentos?responsavel=${encodeURIComponent(nome)}`}
              className="text-[13px] font-semibold text-ink hover:text-accent hover:underline truncate"
              title="Ver atendimentos deste vendedor"
            >
              {nome}
            </Link>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${SEM}`} title={c.veredito.motivo}>{c.veredito.tag}</span>
          </div>
          <div className="text-[10.5px] mt-0.5">
            <span className="text-ink-faint">IA qualificou </span>
            <span className="font-semibold text-accent tabular-nums">{qualifIa != null ? fmtN(qualifIa) : '—'}</span>
            {qualPct != null && <span className="text-ink-faint tabular-nums"> ({qualPct}%)</span>}
            {c.ultimaDias != null && (
              <span className={c.ultimaDias > 4 ? 'text-danger' : 'text-ink-faint'}> · última proposta há {c.ultimaDias}d</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] font-bold tabular-nums text-ink leading-none">{fmtN(contatos)}</div>
          <div className="text-[9px] text-ink-faint mt-0.5">contatos passados</div>
        </div>
      </div>

      {/* Funil de etiquetas do WhatsApp */}
      <p className="text-[9px] uppercase tracking-widest text-ink-faint mb-1.5">Etiquetas no WhatsApp</p>
      <div className="space-y-1 mb-3">
        {etapas.map(e => (
          <div key={e.label} className="grid grid-cols-[80px_1fr_30px] items-center gap-2 text-[11px]">
            <span className="text-ink-muted truncate">{e.label}</span>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max((e.n / maxEtapa) * 100, e.n > 0 ? 6 : 0)}%`, background: e.cor }} />
            </div>
            <span className="text-right font-mono tabular-nums text-ink">{e.n || '—'}</span>
          </div>
        ))}
      </div>

      {/* Orçamentos montados no builder */}
      <div className="flex items-center gap-1.5 text-[11px] mb-3 px-2 py-1.5 rounded-md bg-success/5 border border-success/20">
        <FilePlus2 className="h-3.5 w-3.5 text-success shrink-0" />
        <span className="text-ink-muted">Orçamentos montados:</span>
        <span className="font-semibold text-ink tabular-nums">{orcN}</span>
        {orcBRL > 0 && <span className="font-semibold text-success tabular-nums">· {fmtBRL(orcBRL)}</span>}
        {orcN === 0 && <span className="text-ink-faint">— nenhum no sistema</span>}
      </div>

      {/* Motivos de perda */}
      {motivos.length > 0 && (
        <div>
          <p className="text-[10px] text-ink-faint mb-1.5">Perdeu {fmtN(v.perdido)} — por quê:</p>
          <div className="flex flex-wrap gap-1">
            {motivos.slice(0, 6).map(m => (
              <span key={m.label} className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger tabular-nums">
                {m.label} <span className="font-semibold">{m.n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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

// ============================================================================
// VEREDITO DE INVESTIMENTO (criativo + origem) — modelo de QUALIDADE
// Como conversão e profundidade de funil (follow/quente/venda) são ~zero em TODO
// mundo (vendedor quase não etiqueta), a decisão de verba é por QUALIDADE de lead:
//   Resp. IA (engajou) + p/ Branorte (qualif) + Errado (NÃO FABRICAMOS) decidem.
// Conversão/funil entram só como BÔNUS no score, nunca como gatilho (senão escalava
// criativo bom por 1 orçamento de amostra pequena).
//
// Ordem (1º match vence):
//   excluir   → origem sem atribuição (Não identificou) — corrigir rastreio, não investir
//   amostra   → < 15 leads (sinal fraco)
//   pausar    → respIA < 25% (IA não conversa) OU errado ≥ 35% (público errado)
//   otimizar  → qualif < 20% (engaja mas não é público Branorte) OU errado 20-35% (vazamento)
//   score     → ≥68 escalar · ≥48 manter · resto otimizar
//   manter*   → volume alto sem fechar = gargalo é o FECHAMENTO, não a mídia
// Modelo desenhado por painel multi-agente + juiz adversarial contra dados reais.
// ============================================================================
const AMOSTRA_MIN = 15
const vClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type VerdictKey = 'escalar' | 'manter' | 'otimizar' | 'pausar' | 'amostra' | 'excluir'
const VERDICT_META: Record<VerdictKey, { label: string; emoji: string; cls: string; rank: number }> = {
  escalar:  { label: 'Escalar',  emoji: '🟢', cls: 'text-success border-success/40 bg-success/10', rank: 0 },
  pausar:   { label: 'Pausar',   emoji: '🔴', cls: 'text-danger border-danger/40 bg-danger/10',    rank: 1 },
  otimizar: { label: 'Otimizar', emoji: '🟠', cls: 'text-warning border-warning/40 bg-warning/10',  rank: 2 },
  manter:   { label: 'Manter',   emoji: '🟡', cls: 'text-ink-muted border-border bg-surface-2/40',  rank: 3 },
  amostra:  { label: 'Amostra',  emoji: '⚪', cls: 'text-ink-faint border-border bg-surface-2/20',  rank: 4 },
  excluir:  { label: 'Excluir',  emoji: '⚫', cls: 'text-ink-faint border-border bg-surface-2/10',  rank: 5 },
}

// Origens sem canal pagável real — não dá pra investir nem cortar, só corrigir rastreio.
const ORIGEM_NAO_RASTREAVEL = new Set([
  'não identificou', 'nao identificou', 'sem origem', 'desconhecido', 'outros', 'direto', '',
])

interface VerdictInput {
  label: string
  total: number
  engajouPct: number   // Resp. IA
  qualifPct: number    // p/ Branorte
  nfPct: number        // errado (NÃO FABRICAMOS)
  followUp: number
  leadQuente: number
  vendido: number
  orcamento: number
}

function scoreBruto(m: VerdictInput): number {
  const erradoPen = Math.max(0, 100 - 2 * m.nfPct)
  const bonus = Math.min(10, (m.followUp + m.leadQuente) * 3 + (m.vendido + m.orcamento) * 5)
  return vClamp(0.50 * m.qualifPct + 0.35 * m.engajouPct + 0.15 * erradoPen + bonus, 0, 100)
}

function classifyVerdict(m: VerdictInput, isOrigem: boolean): { verdict: VerdictKey; score: number; reasonKey: string } {
  const mk = (verdict: VerdictKey, score: number, reasonKey: string) => ({ verdict, score: Math.round(score), reasonKey })
  if (isOrigem && ORIGEM_NAO_RASTREAVEL.has(m.label.trim().toLowerCase())) return mk('excluir', 0, 'excluir')
  if (m.total < AMOSTRA_MIN) return mk('amostra', vClamp(scoreBruto(m) * 0.5, 0, 60), 'amostra')
  if (m.engajouPct < 25) return mk('pausar', vClamp(m.engajouPct * 0.6, 5, 25), 'pausar_respia')
  if (m.nfPct >= 35) return mk('pausar', vClamp(20 - (m.nfPct - 35) / 2, 5, 25), 'pausar_errado')
  if (m.qualifPct < 20) return mk('otimizar', vClamp(scoreBruto(m), 30, 55), 'otimizar_qualif')
  if (m.nfPct >= 20) return mk('otimizar', vClamp(scoreBruto(m), 40, 65), 'otimizar_vazamento')
  const s = scoreBruto(m)
  if (s >= 68) return mk('escalar', s, 'escalar')
  const conv = m.vendido + m.orcamento
  const convRate = m.total > 0 ? conv / m.total : 0
  if (m.total >= 40 && m.vendido === 0 && convRate < 0.01) return mk('manter', vClamp(s, 45, 72), 'manter_volume')
  if (s >= 48) return mk('manter', s, 'manter')
  return mk('otimizar', s, 'otimizar_fraco')
}

function reasonFor(key: string, m: VerdictInput): string {
  const q = Math.round(m.qualifPct), r = Math.round(m.engajouPct), e = Math.round(m.nfPct)
  switch (key) {
    case 'excluir': return 'Sem atribuição de canal — não dá pra investir nem cortar. Ação: corrigir rastreamento (UTM/pixel).'
    case 'amostra': return `Só ${m.total} leads (<${AMOSTRA_MIN}): amostra fraca. Acumular antes de decidir — nunca escalar no escuro.`
    case 'pausar_respia': return `Só ${r}% respondem à IA: atrai público errado, verba queimada. Revisar criativo/segmentação.`
    case 'pausar_errado': return `${e}% pedem o que a Branorte NÃO fabrica: tráfego desalinhado. Pausar e refazer segmentação.`
    case 'otimizar_qualif': return `${r}% respondem mas só ${q}% querem algo que fabricamos: público desalinhado, ajustar oferta/segmentação.`
    case 'otimizar_vazamento': return `Perfil bom (${q}% qualif) mas ${e}% chegam errados: ajustar copy/público antes de subir verba.`
    case 'otimizar_fraco': return `Morno (${q}% qualif, ${r}% engajam): testar novo ângulo antes de cortar ou subir verba.`
    case 'escalar': return `Melhor aposta: ${q}% qualificam, ${r}% engajam, ${e}% errado. Subir verba 20-30%.`
    case 'manter_volume': return `${m.total} leads, ${q}% qualif, mas ~0 fecha: a mídia entrega, o gargalo é o FECHAMENTO (vendedor). Manter verba e cobrar venda.`
    case 'manter': return `Saudável (${q}% qualif, ${r}% engajam) sem se destacar: manter verba e dar tempo ao ciclo maturar.`
    default: return ''
  }
}

function perfilCliente(c: { bovinos: number; suinos: number; aves: number }): { label: string; emoji: string; pct: number } | null {
  const classificados = c.bovinos + c.suinos + c.aves
  if (classificados === 0) return null
  const ranked: [string, string, number][] = [
    ['Bovinos', '🐂', c.bovinos],
    ['Suínos', '🐖', c.suinos],
    ['Aves', '🐔', c.aves],
  ]
  ranked.sort((a, b) => b[2] - a[2])
  const [label, emoji, n] = ranked[0]
  return { label, emoji, pct: Math.round((n / classificados) * 100) }
}

// Linha normalizada que alimenta a tabela de veredito (criativo OU origem)
interface FunilRow {
  key: string
  codigo?: string
  label: string
  perfil: { label: string; emoji: string; pct: number } | null
  total: number
  engajouPct: number
  qualifPct: number
  followUp: number
  leadQuente: number
  conv: number          // vendido + orçamento (etiqueta)
  vendido: number
  orcamento: number
  convPct: number
  nf: number
  nfPct: number
  verdict: VerdictKey
  score: number
  reason: string
}

// Headline em linguagem clara: o que fazer com a verba, a partir das linhas.
function montarHeadline(rows: FunilRow[]): { acoes: string; alerta: string | null } {
  const esc = rows.filter(r => r.verdict === 'escalar').sort((a, b) => b.score - a.score)
  const pau = rows.filter(r => r.verdict === 'pausar').sort((a, b) => a.score - b.score)
  const exc = rows.filter(r => r.verdict === 'excluir')
  const partes: string[] = []
  if (esc.length) partes.push(`📈 Escale ${esc.slice(0, 2).map(r => r.label).join(' e ')}`)
  if (pau.length) partes.push(`⏸️ Pause ${pau.slice(0, 3).map(r => r.label).join(', ')}`)
  if (exc.length) partes.push(`⚫ ${exc.length} sem atribuição (corrigir rastreio)`)
  if (!partes.length) partes.push('Nada claro pra escalar ainda — decidindo por qualidade de lead')
  const semVenda = rows.length > 0 && rows.every(r => r.vendido === 0)
  return {
    acoes: partes.join('  ·  '),
    alerta: semVenda ? '⚠️ Nenhuma venda fechada por etiqueta no período — o gargalo é o FECHAMENTO (vendedor), não a mídia.' : null,
  }
}

function FunilTable({ rows, primeiraColuna, semEtq }: { rows: FunilRow[]; primeiraColuna: string; semEtq: boolean }) {
  const { acoes, alerta } = montarHeadline(rows)
  return (
    <div className="space-y-2">
      {/* Headline: o que fazer com a verba, em linguagem clara */}
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
        <p className="text-[12px] text-ink font-medium leading-snug">{acoes}</p>
        {alerta && <p className="text-[11px] text-warning mt-1 leading-snug">{alerta}</p>}
      </div>
      {semEtq && (
        <p className="text-[11px] text-warning bg-warning/10 border border-warning/30 rounded-md px-2.5 py-1.5">
          ⚠️ Sem etiquetas no período — Follow Up / Lead Quente / Converteu ficam zerados (só os sinais da IA contam).
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-ink-faint border-b border-border">
              <th className="text-left py-2 px-2 font-semibold">{primeiraColuna}</th>
              <th className="text-left py-2 px-2 font-semibold">Perfil</th>
              <th className="text-right py-2 px-2 font-semibold">Leads</th>
              <th className="text-right py-2 px-2 font-semibold" title="% dos leads que responderam à IA">Respondeu</th>
              <th className="text-right py-2 px-2 font-semibold" title="% que quer algo que a Branorte fabrica">Qualificou</th>
              <th className="text-right py-2 px-2 font-semibold" title="Chegou a Follow Up (negociação)">Follow-up</th>
              <th className="text-right py-2 px-2 font-semibold" title="Chegou a Lead Quente (perto de fechar)">Quente</th>
              <th className="text-right py-2 px-2 font-semibold" title="Orçamentos enviados e vendas (etiqueta WhatsApp)">Orç / Venda</th>
              <th className="text-right py-2 px-2 font-semibold" title="Pediu algo que a Branorte NÃO fabrica">Errado</th>
              <th className="text-right py-2 px-2 font-semibold">Veredito</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const vm = VERDICT_META[r.verdict]
              return (
                <tr key={r.key} className="border-b border-border/30 hover:bg-surface-2/40">
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.codigo && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted shrink-0">{r.codigo}</span>}
                      <span className="truncate text-ink max-w-[220px]" title={r.label}>{r.label}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    {r.perfil
                      ? <span className="text-ink-muted">{r.perfil.emoji} {r.perfil.label} <span className="text-ink-faint tabular-nums">{r.perfil.pct}%</span></span>
                      : <span className="text-ink-faint">n/d</span>}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono tabular-nums text-ink">{r.total}</td>
                  <td className={`text-right py-1.5 px-2 font-mono tabular-nums ${r.engajouPct >= 45 ? 'text-success' : r.engajouPct >= 30 ? 'text-warning' : 'text-danger'}`}>{r.engajouPct.toFixed(0)}%</td>
                  <td className={`text-right py-1.5 px-2 font-mono tabular-nums ${r.qualifPct >= 35 ? 'text-success' : r.qualifPct >= 22 ? 'text-warning' : 'text-danger'}`}>{r.qualifPct.toFixed(0)}%</td>
                  <td className="text-right py-1.5 px-2 font-mono tabular-nums text-ink-muted">{r.followUp || '—'}</td>
                  <td className={`text-right py-1.5 px-2 font-mono tabular-nums ${r.leadQuente > 0 ? 'text-success font-semibold' : 'text-ink-faint'}`}>{r.leadQuente || '—'}</td>
                  <td className="text-right py-1.5 px-2 font-mono tabular-nums text-accent whitespace-nowrap">
                    {r.orcamento > 0 || r.vendido > 0
                      ? [r.orcamento > 0 ? `${r.orcamento} orç` : null, r.vendido > 0 ? `${r.vendido} vd` : null].filter(Boolean).join(' · ')
                      : '—'}
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono tabular-nums ${r.nfPct >= 20 ? 'text-danger font-semibold' : r.nfPct >= 10 ? 'text-warning' : 'text-ink-faint'}`}>
                    {r.nf > 0 ? `${r.nfPct.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-help ${vm.cls}`}
                      title={r.reason}
                    >
                      {vm.emoji} {vm.label}
                    </span>
                    <div className="text-[9px] text-ink-faint tabular-nums mt-0.5">score {r.score}</div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-ink-faint pt-1 space-y-0.5 whitespace-normal">
        <p>Funil: <strong className="text-ink-muted">Respondeu</strong> (à IA) → <strong className="text-ink-muted">Qualificou</strong> (a IA viu que quer algo que a Branorte faz, OU o vendedor já moveu pra follow-up/quente/orçamento) → <strong className="text-ink-muted">Follow-up</strong> (negociação) → <strong className="text-ink-muted">Quente</strong> (perto de fechar) → <strong className="text-ink-muted">Orç / Venda</strong> (etiqueta no WhatsApp).</p>
        <p><strong className="text-danger">Errado</strong> = o lead pediu uma máquina/produto que a Branorte <strong>NÃO fabrica</strong> — o anúncio atraiu o público errado (sinal de segmentação ruim, não de criativo fraco).</p>
        <p>Passe o mouse no veredito pra ver o porquê. 🟢 escalar verba · 🔴 pausar · 🟠 ajustar ângulo/segmentação · 🟡 manter · ⚪ amostra &lt;{AMOSTRA_MIN} leads · ⚫ sem atribuição. Decisão por QUALIDADE (conversão ~0 em tudo).</p>
      </div>
    </div>
  )
}

function sortFunil(a: FunilRow, b: FunilRow): number {
  const ra = VERDICT_META[a.verdict].rank
  const rb = VERDICT_META[b.verdict].rank
  if (ra !== rb) return ra - rb
  return b.total - a.total
}

function VereditoInvestimento({
  criativos,
  etq,
}: {
  criativos: { codigo: string; nome: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number }[]
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
}) {
  if (!criativos.length) return <p className="text-sm text-ink-faint">Nenhum criativo registrado.</p>
  const etqByCodigo = new Map((etq?.por_criativo ?? []).map(c => [c.codigo, c]))

  const rows: FunilRow[] = criativos.map(c => {
    const e = etqByCodigo.get(c.codigo)
    const vendido = e?.vendido ?? 0
    const orcamento = e?.orcamento ?? 0
    const conv = vendido + orcamento
    const engajouPct = c.total > 0 ? (c.engajou / c.total) * 100 : 0
    const convPct = c.total > 0 ? (conv / c.total) * 100 : 0
    const nf = e?.nao_fabricamos ?? 0
    const nfPct = c.total > 0 ? (nf / c.total) * 100 : 0
    const leadQuente = e?.lead_quente ?? 0
    const followUp = e?.follow_up ?? 0
    // Qualificou = IA qualificou OU o vendedor moveu o lead pro funil (follow-up/
    // quente/orçamento/vendido). Pega o maior dos dois (não soma, pra não duplicar).
    const qualifEf = Math.max(c.qualificados, followUp + leadQuente + orcamento + vendido)
    const qualifPct = c.total > 0 ? (qualifEf / c.total) * 100 : 0
    const vi: VerdictInput = { label: c.nome || c.codigo, total: c.total, engajouPct, qualifPct, nfPct, followUp, leadQuente, vendido, orcamento }
    const { verdict, score, reasonKey } = classifyVerdict(vi, false)
    return {
      key: c.codigo, codigo: c.codigo, label: c.nome || '—',
      perfil: perfilCliente(c), total: c.total,
      engajouPct, qualifPct,
      followUp, leadQuente,
      conv, vendido, orcamento, convPct, nf, nfPct,
      verdict, score, reason: reasonFor(reasonKey, vi),
    }
  }).sort(sortFunil)

  return <FunilTable rows={rows} primeiraColuna="Criativo" semEtq={!etq || etq.por_criativo.length === 0} />
}

function VereditoOrigem({
  origens,
  etq,
}: {
  origens: { origem: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number; orcamentos: number; vendidos: number }[]
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
}) {
  if (!origens.length) return <p className="text-sm text-ink-faint">Nenhuma origem registrada.</p>
  // Junta por origem CRUA (mesma string em ambas as fontes — leem apc.origem)
  const etqByOrigem = new Map((etq?.por_origem ?? []).map(o => [o.origem, o]))

  const rows: FunilRow[] = origens
    .filter(o => o.total >= 3) // tira ruído de origens com 1-2 leads
    .map(o => {
      const e = etqByOrigem.get(o.origem)
      const vendido = e?.vendido ?? 0
      const orcamento = e?.orcamento ?? 0
      const conv = vendido + orcamento
      const engajouPct = o.total > 0 ? (o.engajou / o.total) * 100 : 0
      const convPct = o.total > 0 ? (conv / o.total) * 100 : 0
      const nf = e?.nao_fabricamos ?? 0
      const nfPct = o.total > 0 ? (nf / o.total) * 100 : 0
      const leadQuente = e?.lead_quente ?? 0
      const followUp = e?.follow_up ?? 0
      // Qualificou = IA OU vendedor moveu pro funil (follow-up/quente/orçamento/vendido).
      const qualifEf = Math.max(o.qualificados, followUp + leadQuente + orcamento + vendido)
      const qualifPct = o.total > 0 ? (qualifEf / o.total) * 100 : 0
      const vi: VerdictInput = { label: o.origem, total: o.total, engajouPct, qualifPct, nfPct, followUp, leadQuente, vendido, orcamento }
      const { verdict, score, reasonKey } = classifyVerdict(vi, true)
      return {
        key: o.origem, label: o.origem,
        perfil: perfilCliente(o), total: o.total,
        engajouPct, qualifPct,
        followUp, leadQuente,
        conv, vendido, orcamento, convPct, nf, nfPct,
        verdict, score, reason: reasonFor(reasonKey, vi),
      }
    }).sort(sortFunil)

  return <FunilTable rows={rows} primeiraColuna="Origem (canal)" semEtq={!etq || etq.por_origem.length === 0} />
}

// Distribuição geográfica — mapa choropleth do Brasil + legenda + top estados + internacional
function DistribuicaoGeo({ items }: { items: { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }[] }) {
  return (
    <div className="space-y-3">
      <Suspense fallback={<div className="h-[330px] grid place-items-center text-[12px] text-ink-faint">Carregando mapa…</div>}>
        <MapaBrasilLeads items={items} />
      </Suspense>
      <div className="flex items-center gap-2 text-[10px] text-ink-faint border-b border-border/50 pb-3">
        <span>Menos</span>
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(152 62% 56%)' }} />
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(152 62% 44%)' }} />
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(152 62% 30%)' }} />
        <span>Mais leads</span>
        <span className="ml-auto">Passe o mouse num estado</span>
      </div>
      {/* Lista detalhada por estado (barras) abaixo do mapa */}
      <UfList items={items} />
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
      anchor: 'criativo-veredito',
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
      anchor: 'vendedores',
    },
  ].filter(Boolean) as { icon: typeof AlertTriangle; text: string; tone: string; anchor: string }[]

  if (items.length === 0) return null
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-bg/40 p-3 lg:p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-danger" />
        <span className="text-[12px] font-bold text-danger uppercase tracking-wide">Atenção</span>
        <span className="text-[10px] text-ink-faint normal-case font-normal">— clique pra ir direto ao ponto</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {items.map(it => (
          <a key={it.anchor} href={`#${it.anchor}`} className="flex items-center gap-1.5 text-[12px] text-ink hover:text-accent transition-colors cursor-pointer">
            <it.icon className={`h-3.5 w-3.5 ${it.tone === 'danger' ? 'text-danger' : 'text-warning'}`} />
            <span className="underline-offset-2 hover:underline">{it.text}</span>
          </a>
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
        ? Math.max(0, Math.round((etq.tempo_lead_vendido_dias - etq.tempo_lead_orcamento_dias) * 10) / 10)
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
        // Horas grandes ficam ilegíveis (357,9h) → mostra em dias quando ≥48h
        const disp = v == null
          ? { num: '—', unit: '' }
          : (s.unit === 'h' && v >= 48)
            ? { num: String(Math.round(v / 24)), unit: 'd' }
            : { num: (Math.round(v * 10) / 10).toString().replace('.', ','), unit: s.unit }
        // Quando o valor vira dias mas a meta é em horas, o "Nx acima" deixa claro o estouro
        const fatorAcima = v != null && s.target > 0 ? Math.round(v / s.target) : 0
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
                {disp.num}
                {disp.unit && <span className="text-sm font-medium ml-0.5">{disp.unit}</span>}
              </div>
              <p className={`text-[10px] mt-0.5 ${overBudget ? 'text-danger/80' : 'text-ink-faint'}`}>
                meta: &lt;{s.target}{s.unit}{overBudget && fatorAcima >= 2 ? ` · ${fatorAcima}× acima` : ''}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Órfãos (NOVO LEAD parado >7d) por vendedor — quem senta no lead novo
function LeadsOrfaosVendedor({ orfaos }: { orfaos: OrfaosPorVendedor }) {
  const max = Math.max(...orfaos.por_vendedor.map(v => v.n), 1)
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <Ghost className="h-6 w-6 text-warning self-center" />
        <span className="text-[32px] leading-none font-bold text-warning tabular-nums">{fmtN(orfaos.total)}</span>
        <span className="text-[12px] text-ink-muted">leads novos parados há +7 dias</span>
      </div>
      <div className="space-y-1.5">
        {orfaos.por_vendedor.map(v => (
          <Link
            key={v.vendedor}
            to={`/atendimentos?responsavel=${encodeURIComponent(capitalizar(v.vendedor))}`}
            className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-[12px] group"
            title="Abrir atendimentos deste vendedor"
          >
            <span className="truncate text-ink capitalize group-hover:text-accent">{v.vendedor.toLowerCase()}</span>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div className="h-full bg-warning/70 rounded-full" style={{ width: `${(v.n / max) * 100}%` }} />
            </div>
            <span className="text-right font-mono tabular-nums text-ink">{v.n}</span>
          </Link>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint pt-2.5">
        São leads que entraram, ganharam etiqueta "NOVO LEAD" e travaram aí. Cobrar o 1º atendimento — quem está no topo é quem mais deixa lead esfriar.
      </p>
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

function MapaEtiquetas({ etq, variant = 'full' }: { etq: ReturnType<typeof useDashboardEtiquetas>['data']; variant?: 'full' | 'trava' }) {
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

  // Variante 'trava': só os motivos de perda (o resto virou o Funil canônico).
  if (variant === 'trava') {
    if (topTrava.length === 0) {
      return <div className="py-6 text-center text-[12px] text-ink-faint">Sem motivos de trava no período ✓</div>
    }
    return (
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
    )
  }

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
