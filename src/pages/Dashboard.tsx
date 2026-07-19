import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard, type DashboardPreset, type FunilEtapa, type SlaVendedor, type LeadEmRisco } from '@/hooks/useDashboard'
import { useDashboardEtiquetas, useHeatmapSemanal, CATEGORIA_LABEL, type EtiquetaCategoria } from '@/hooks/useDashboardEtiquetas'
import { useDashboardVendedorFunil, type VendedorFunilRow } from '@/hooks/useDashboardVendedorFunil'
import { useDashboardExtra, type DashboardExtra } from '@/hooks/useDashboardExtra'
import { useVendasReais, type CorridaVendedor } from '@/hooks/useVendasReais'
import { useFunilUnion } from '@/hooks/useFunilUnion'
import { useFunilEtiquetas } from '@/hooks/useFunilEtiquetas'
import { useCicloVenda, type CicloVenda as CicloVendaData } from '@/hooks/useCicloVenda'
import { useDashboardOrcamentos, useDashboardVendas, useDashboardOrcVendaPorCriativo, useDashboardOrcVendaPorOrigem, useDashboardVendasDetalhe, useDashboardOrcamentosDetalhe, type OrcVendaAttr } from '@/hooks/useDashboardOrcamentos'
import { useOrcamentosResumo, type OrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { usePropostasStatus, CATS_ABERTO, type PropostasStatus, type PropCategoria } from '@/hooks/usePropostasStatus'
import { useVendedoresPainel, type VendedorPainel } from '@/hooks/useVendedoresPainel'
import { useOrfaosPorVendedor, type OrfaosPorVendedor } from '@/hooks/useOrfaosPorVendedor'
import { useVendedorCobertura, type VendedorCobertura } from '@/hooks/useVendedorCobertura'
import { useMotivosPorFonte, MOTIVO_LABELS, type MotivoFonte, type MotivoKey } from '@/hooks/useMotivosPorFonte'
import { useNegociacaoPorUf } from '@/hooks/useNegociacaoPorUf'
import {
  Area, AreaChart, Cell, Pie, PieChart, XAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { Flame, TrendingUp, Users, CheckCircle2, ArrowDown, ArrowUp, Hand, FilePlus2, AlertTriangle, Clock, Ghost, Banknote, ChevronRight, Sun, Moon, X } from 'lucide-react'
import { useDarkMode } from '@/hooks/useDarkMode'
import { RangeCalendar } from '@/components/RangeCalendar'
import { ResumoDiaVendedores } from '@/components/ResumoDiaVendedores'

const PRESET_LABELS: { value: DashboardPreset; label: string }[] = [
  { value: '',     label: 'Tudo' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: 'mes',  label: 'Este mês' },
]

// Período personalizado — codificado no preset como "custom:YYYY-MM-DD:YYYY-MM-DD".
function isCustomPreset(p: DashboardPreset): boolean {
  return typeof p === 'string' && p.startsWith('custom:')
}
function customDates(p: DashboardPreset): { from: string; to: string } {
  if (!isCustomPreset(p)) return { from: '', to: '' }
  const [, from = '', to = ''] = (p as string).split(':')
  return { from, to }
}
function ddmm(iso: string): string {
  const [, m, d] = (iso || '').split('-')
  return d && m ? `${d}/${m}` : iso
}

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

// Placar por vendedor — vinculado AO VIVO ao Controle (mesmos dados da Corrida de Vendas de lá).
function CorridaVendas({ corrida, metaVendedor }: { corrida: CorridaVendedor[]; metaVendedor: number }) {
  if (!corrida.length) return null
  const barBg = (pct: number) => (pct >= 100 ? 'bg-success' : pct >= 75 ? 'bg-warning' : 'bg-info')
  const pctTxt = (pct: number) => (pct >= 100 ? 'text-success' : pct >= 75 ? 'text-warning' : 'text-ink-muted')
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-[15px] font-bold text-ink tracking-tight">Corrida de vendas</h2>
        <a
          href="https://controle.branorte.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-ink-faint hover:text-accent tabular-nums"
        >
          ao vivo do Controle · meta {fmtBRL(metaVendedor)}/vendedor ↗
        </a>
      </div>
      <div className="space-y-1.5">
        {corrida.map((v, i) => {
          const w = Math.max(Math.min(v.pct, 100), 2)
          return (
            <div key={v.vendedor} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">{i + 1}º</span>
              <span className="w-24 shrink-0 truncate text-[12px] font-medium text-ink" title={v.vendedor}>{v.vendedor}</span>
              <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-surface-2">
                <div className={`h-full rounded ${barBg(v.pct)} transition-all`} style={{ width: `${w}%` }} />
              </div>
              <span className={`w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums ${pctTxt(v.pct)}`}>{v.pct.toFixed(0)}%</span>
              <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">{fmtBRL(v.valor)}</span>
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-faint">{v.numVendas}v</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-info" /> &lt; 75%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-warning" /> 75–99%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-success" /> ≥ 100%</span>
      </div>
    </div>
  )
}

// Placar dos 3 times de vendas (composição fixa; meta R$833k/time = 2,5M/3).
// Dados = a MESMA Corrida de vendas (ao vivo do Controle), somados por time.
const TIMES_DEF: { nome: string; membros: string[] }[] = [
  { nome: 'Esquadrão Classe A', membros: ['ALVARO', 'IGOR', 'EDER'] },
  { nome: 'Los Melhores', membros: ['JARDEL', 'LUCAS', 'RAMON'] },
  { nome: 'Os Caça Lead', membros: ['PEDRO', 'GUSTAVO', 'EDILSON'] },
]
const META_TIME = 833_000
const primeiroToken = (s: string) => (s || '').trim().toUpperCase().split(/\s+/)[0]

function PlacarTimes({ corrida }: { corrida: CorridaVendedor[] }) {
  const porVend = new Map(corrida.map(c => [primeiroToken(c.vendedor), c]))
  const times = TIMES_DEF.map(t => {
    const membros = t.membros
      .map(m => ({ nome: m, valor: porVend.get(m)?.valor ?? 0, vendas: porVend.get(m)?.numVendas ?? 0 }))
      .sort((a, b) => b.valor - a.valor)
    const valor = membros.reduce((s, m) => s + m.valor, 0)
    return { nome: t.nome, membros, valor, pct: META_TIME > 0 ? (valor / META_TIME) * 100 : 0 }
  }).sort((a, b) => b.valor - a.valor)
  const medalhas = ['🥇', '🥈', '🥉']
  const barBg = (pct: number) => (pct >= 100 ? 'bg-success' : pct >= 75 ? 'bg-warning' : 'bg-info')
  const pctTxt = (pct: number) => (pct >= 100 ? 'text-success' : pct >= 75 ? 'text-warning' : 'text-ink-muted')
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-4">
        <h2 className="text-[15px] font-bold text-ink tracking-tight">🏆 Placar dos times</h2>
        <span className="text-[11px] text-ink-faint tabular-nums">meta {fmtBRL(META_TIME)}/time · ao vivo do Controle</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {times.map((t, i) => (
          <div key={t.nome} className={`rounded-xl border p-3.5 ${i === 0 ? 'border-warning/50 bg-warning-bg/20' : 'border-border/60 bg-surface-2/30'}`}>
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[13px] font-bold text-ink truncate">{medalhas[i]} {t.nome}</span>
              <span className={`text-[13px] font-bold tabular-nums ${pctTxt(t.pct)}`}>{t.pct.toFixed(0)}%</span>
            </div>
            <div className="text-[18px] font-bold text-ink tabular-nums leading-tight">{fmtBRL(t.valor)}</div>
            <div className="text-[10px] text-ink-faint mb-2">de {fmtBRL(META_TIME)}</div>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden mb-2.5">
              <div className={`h-full rounded-full ${barBg(t.pct)} transition-all`} style={{ width: `${Math.max(Math.min(t.pct, 100), 2)}%` }} />
            </div>
            <div className="space-y-0.5 border-t border-border/40 pt-1.5">
              {t.membros.map(m => (
                <div key={m.nome} className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-muted capitalize">{m.nome.toLowerCase()}</span>
                  <span className="tabular-nums text-ink-faint">{fmtBRL(m.valor)}<span className="opacity-60"> · {m.vendas}v</span></span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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

// Estado de abertura das seções (persistido no navegador).
// Default: só "Visão geral" aberta — o resto começa fechado pra não afogar.
function useOpenSections() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const fallback = { g1: false, g2: false, g3: false, g4: false, g5: false }
    if (typeof window === 'undefined') return fallback
    try {
      const stored = localStorage.getItem('dashboard-sections')
      if (stored) return { ...fallback, ...JSON.parse(stored) }
    } catch { /* ignora json inválido */ }
    return fallback
  })
  useEffect(() => {
    try { localStorage.setItem('dashboard-sections', JSON.stringify(open)) } catch { /* quota */ }
  }, [open])
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }))
  return [open, toggle] as const
}

// Grupo colapsável — clica no título pra abrir/fechar. Detalhes ficam fora do caminho.
function CollapsibleSection({ n, titulo, pergunta, open, onToggle, children }: {
  n: string; titulo: string; pergunta: string
  open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="pt-3 lg:pt-4 border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-baseline gap-2 text-left group"
      >
        <ChevronRight className={`h-4 w-4 self-center text-ink-faint transition-transform shrink-0 ${open ? 'rotate-90 text-accent' : ''}`} />
        <span className="text-[11px] font-bold text-accent tabular-nums">{n}</span>
        <h2 className="text-[14px] font-bold text-ink tracking-tight group-hover:text-accent transition-colors">{titulo}</h2>
        <span className="text-[11px] text-ink-faint truncate">— {pergunta}</span>
      </button>
      {open && <div className="space-y-3 lg:space-y-5 mt-3 lg:mt-5">{children}</div>}
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
  // Período personalizado: popover + inputs de data (De/Até).
  const [customOpen, setCustomOpen] = useState(false)
  const [customDe, setCustomDe] = useState('')
  const [customAte, setCustomAte] = useState('')
  // Data de hoje (local) — teto dos inputs pra não escolher período futuro.
  const hojeISO = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}` })()
  const [openSec, toggleSec] = useOpenSections()
  const [dark, toggleDark] = useDarkMode()
  // Drill-down "de onde vem" dos KPIs de resultado (clicar no card abre a lista).
  const [drill, setDrill] = useState<null | 'orcamentos' | 'vendidos' | 'valor'>(null)
  const { data, isLoading, error } = useDashboard({ preset })
  const { data: etq } = useDashboardEtiquetas(preset)
  const { data: vendFunil } = useDashboardVendedorFunil(preset)
  const { data: extra } = useDashboardExtra()
  // Vendas REAIS do mês (espelho do Controle) — o forecast do useDashboard lê status_real
  // dos atendimentos, que NUNCA tem "vendido" → sempre R$ 0. Aqui vem o número de verdade.
  const { data: vendasReais } = useVendasReais()
  const { data: funilUnion } = useFunilUnion(preset)
  const { data: funilEtq } = useFunilEtiquetas()
  const { data: ciclo } = useCicloVenda(preset)
  // Valor das propostas montadas no builder (orcamentos_gerados) — única fonte real de R$
  const { data: orc } = useOrcamentosResumo(preset)
  // Contagem REAL de orçamentos: leads do período com orçamento montado (match por
  // telefone). Substitui a etiqueta do WhatsApp, que subconta (vendedor esquece de marcar).
  const { data: orcamentosReais } = useDashboardOrcamentos(preset)
  // Vendas REAIS do período (pedidos não-cancelados, via orçamento→pedido) + valor convertido.
  const { data: vendas } = useDashboardVendas(preset)
  const vendidosReais = vendas?.qtd        // todas as vendas do período (pedidos)
  const vendidosLead = vendas?.qtdLead     // subconjunto amarrado a um lead do atendimento
  // Orçamento/venda REAIS atribuídos por criativo e por origem (via telefone do lead).
  const { data: orcVendaCriativo } = useDashboardOrcVendaPorCriativo(preset)
  const { data: orcVendaOrigem } = useDashboardOrcVendaPorOrigem(preset)
  // Propostas × estágio atual do funil (dinheiro em aberto vs vendido, por vendedor)
  const { data: propStatus } = usePropostasStatus(preset)
  // Painel por vendedor: funil de etiquetas WhatsApp + motivos de perda
  const { data: vendPainel } = useVendedoresPainel(preset)
  // Leads órfãos (NOVO LEAD parado >7d) por vendedor — janela por idade, não pelo filtro
  const { data: orfaos } = useOrfaosPorVendedor(7)
  // Cobertura: total passado vs com/sem etiqueta por vendedor (buraco de acompanhamento)
  const { data: cobertura } = useVendedorCobertura(preset)
  // Motivos de perda por criativo/origem (qual anúncio traz mais "não respondeu" etc.)
  const { data: motivosFonte } = useMotivosPorFonte(preset)
  // Leads em negociação (follow-up / quente / orçamento) por estado — estado atual da etiqueta
  const { data: negUf } = useNegociacaoPorUf()
  // Heatmap usa janela fixa (30d) — ignora filtro do dashboard de propósito
  const { data: heatmap30d } = useHeatmapSemanal()

  // Funil de qualificação MONOTÔNICO: Entrou → Engajou → Qualificou (IA) →
  // Orçamento → Vendido (etiqueta WA). "Passou pro vendedor" saiu do funil —
  // atribuição não é etapa de qualificação e era o que deixava o funil maior no
  // meio (2.788 > 904), gerando o "sem sentido". pctAnterior travado em 100.
  const funilCanonico = useMemo<FunilEtapa[]>(() => {
    if (!data?.funil) return []
    // Qualificou/Engajou = IA OU etiqueta do vendedor (funilUnion). Fallback p/ funil só-IA.
    const raw = [
      { etapa: 'Entrou',            valor: funilUnion?.entrou ?? data.funil[0]?.valor ?? 0 },
      { etapa: 'Engajou',           valor: funilUnion?.engajou ?? data.funil[1]?.valor ?? 0 },
      { etapa: 'Qualificou',        valor: funilUnion?.qualificou ?? data.funil[2]?.valor ?? 0 },
      { etapa: 'Orçamento enviado', valor: orcamentosReais ?? etq?.por_categoria.orcamento ?? 0 },
      // Vendido do FUNIL = vendas amarradas a um lead (orçamento→pedido). Mantém o funil
      // monotônico (Orçamento ≥ Vendido) — antes usava o total de pedidos (378) e estourava
      // acima dos 134 orçamentos, quebrando o trapézio.
      { etapa: 'Vendido',           valor: vendidosLead ?? etq?.por_categoria.vendido ?? 0 },
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
  }, [data?.funil, etq, funilUnion, orcamentosReais, vendidosLead])

  // Funil pelas ETIQUETAS REAIS do WhatsApp (Prospecção → ... → Vendido).
  // DISTRIBUIÇÃO: cada telefone no seu estágio MAIS AVANÇADO (dedup por telefone).
  // pctAnterior=100 / perdidos=0 de propósito: os estágios são um SNAPSHOT do estado
  // atual (não marcos sequenciais), então não inventamos "perdidos" entre eles.
  const funilEtiquetas = useMemo<FunilEtapa[]>(() => {
    const rows = funilEtq ?? []
    if (rows.length === 0) return []
    const topo = rows.find(r => r.ord === 0)?.phones || rows[0].phones || 1
    return rows.map(r => ({
      etapa: r.stage,
      valor: r.phones,
      pctTopo: Math.min(100, (r.phones / topo) * 100),
      pctAnterior: 100,
      perdidos: 0,
    }))
  }, [funilEtq])

  // Cards de vendedor (3 fontes mescladas + veredito), computados uma vez e
  // usados pelo Resumo do gerente e pelo Painel por vendedor.
  const vendCards = useMemo(
    () => montarCardsVendedor(vendPainel ?? [], data?.slaPorVendedor ?? [], orc, cobertura ?? []),
    [vendPainel, data?.slaPorVendedor, orc, cobertura],
  )

  // Destaques POSITIVOS — o espelho do "resumo do gerente": o que reforçar, quem
  // parabenizar, onde dobrar a aposta. Tudo computado das fontes que já temos.
  const positivo = useMemo(() => {
    const topOrc = (orc?.porVendedor ?? []).filter(v => v.vendedor !== '—' && v.brl > 0)[0] ?? null
    const cobertura = vendCards.filter(c => c.totalPassado >= 50)
      .map(c => ({ nome: c.nome, pct: c.totalPassado > 0 ? Math.round((c.comEtiqueta / c.totalPassado) * 100) : 0, com: c.comEtiqueta, total: c.totalPassado }))
      .sort((a, b) => b.pct - a.pct)[0] ?? null
    const fecharam = vendCards.filter(c => c.v.vendido > 0).sort((a, b) => b.v.vendido - a.v.vendido)
    const totalVendido = vendCards.reduce((s, c) => s + c.v.vendido, 0)
    const escalar = [...(data?.porOrigem ?? [])].filter(o => o.total >= 30).sort((a, b) => b.ctr - a.ctr)[0] ?? null
    const criativo = [...(data?.porCriativo ?? [])].filter(c => c.total >= 20)
      .map(c => ({ codigo: c.codigo, nome: c.nome, pct: c.total > 0 ? (c.qualificados / c.total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct)[0] ?? null
    return {
      topOrc, cobertura, fecharam, totalVendido, escalar, criativo,
      rMontado: orc?.valorTotalBRL ?? 0,
      rNegoc: propStatus?.abertoQuente.brl ?? 0,
      qualificou: funilCanonico.find(e => e.etapa === 'Qualificou')?.valor ?? 0,
      propostas: orc?.geradas ?? 0,
    }
  }, [vendCards, orc, data?.porOrigem, data?.porCriativo, propStatus, funilCanonico])

  // 2º mapa: leads em negociação por estado. Reaproveita o nome do estado vindo do
  // porUf (mesma tabela de UF→nome) e calcula % sobre o total em negociação.
  const negItems = useMemo(() => {
    const nomeByUf = new Map((data?.porUf ?? []).map(u => [u.uf, u.nome]))
    const lista = (negUf ?? []).filter(n => n.uf && n.total > 0)
    const tot = lista.reduce((s, n) => s + n.total, 0) || 1
    return lista
      .map(n => ({ uf: n.uf, nome: nomeByUf.get(n.uf) ?? n.uf, total: n.total, pct: (n.total / tot) * 100, isBrasil: true }))
      .sort((a, b) => b.total - a.total)
  }, [negUf, data?.porUf])

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
  const periodoLabel = isCustomPreset(preset)
    ? (() => { const { from, to } = customDates(preset); return `${ddmm(from)}–${ddmm(to)}` })()
    : preset
      ? PRESET_LABELS.find(p => p.value === preset)?.label ?? 'período'
      : 'no total'

  // 5 KPIs essenciais (cortado de 9): o funil de entrada (leads), a qualidade
  // (qualificados), e o resultado (orçamento, vendido, taxa). "Hoje/Não respondeu/
  // Em andamento/Com vendedor" saíram — são estágios do funil, não KPI de topo.
  const orcamentoEtq = etq?.por_categoria.orcamento ?? 0
  const vendidoEtq = etq?.por_categoria.vendido ?? 0
  // Conversão "lead → vendido" REAL: usa só as vendas amarradas a um lead (vendidosLead),
  // não o total de pedidos. O total inclui compradores que nunca passaram pelo funil.
  const taxaConv = data.totalLeads > 0 ? Math.round(((vendidosLead ?? vendidoEtq) / data.totalLeads) * 1000) / 10 : 0

  const heroKpis = [
    { label: preset ? 'Leads no período' : 'Total de leads', kpi: data.kpiTotal, icon: Users, color: COLORS.ink, sub: preset ? periodoLabel.toLowerCase() : 'desde o início' },
    { label: 'Qualificados',  kpi: { valor: funilUnion?.qualificou ?? data.kpiQualificados.valor, deltaPct: 0, sparkline: [] }, icon: CheckCircle2, color: COLORS.accent, sub: 'IA ou etiqueta (novo lead, follow-up, quente…)' },
    { label: 'Orçamentos',    kpi: { valor: orcamentosReais ?? orcamentoEtq, deltaPct: 0, sparkline: [] }, icon: FilePlus2, color: 'hsl(280 65% 50%)', sub: 'telefone × orçamentos montados', onClick: () => setDrill('orcamentos') },
    { label: 'Vendidos',      kpi: { valor: vendidosLead ?? vendidoEtq, deltaPct: 0, sparkline: [] }, icon: CheckCircle2, color: 'hsl(152 60% 35%)', sub: `vendas de lead · ${vendidosReais ?? 0} no total`, onClick: () => setDrill('vendidos') },
    { label: 'Valor convertido', kpi: { valor: vendas?.valorLead ?? 0, deltaPct: 0, sparkline: [] }, icon: Banknote, color: 'hsl(152 60% 40%)', sub: `de lead · R$ ${(vendas?.valor ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} no total`, prefix: 'R$ ', onClick: () => setDrill('valor') },
    { label: 'Conversão',     kpi: { valor: taxaConv, deltaPct: 0, sparkline: [] }, icon: TrendingUp, color: COLORS.info, sub: 'vendas ÷ leads do período', suffix: '%' },
  ]

  // ⚡ AÇÃO DO DIA — pega tudo que já temos, prioriza por urgência e vira 1-3 frases clicáveis.
  const semEtqTotal = (vendFunil ?? []).reduce((s, v) => s + v.sem_etiqueta, 0)
  const pioresRastreio = [...(vendFunil ?? [])]
    .filter(v => v.sem_etiqueta >= 8)
    .sort((a, b) => b.sem_etiqueta - a.sem_etiqueta)
    .slice(0, 2)
    .map(v => v.vendedor)
  const acoesDia: { sev: 'critica' | 'alta' | 'media'; texto: string; key: string; anchor: string }[] = []
  if (data.leadsEmRisco.length > 0) {
    const n = data.leadsEmRisco.length
    acoesDia.push({ sev: 'critica', texto: `${n} lead${n > 1 ? 's' : ''} quente${n > 1 ? 's' : ''} sumiram (+24h sem resposta) — ligar antes de esfriar`, key: 'g4', anchor: 'leads-resgatar' })
  }
  if (semEtqTotal >= 20) {
    acoesDia.push({ sev: 'alta', texto: `${fmtN(semEtqTotal)} leads sem etiqueta = invisíveis no funil${pioresRastreio.length ? ` — cobrar rastreio de ${pioresRastreio.join(' e ')}` : ''}`, key: 'g4', anchor: 'vendedores-funil' })
  }
  if (etq && etq.sem_orc_vendedores.length > 0) {
    const vs = etq.sem_orc_vendedores.slice(0, 3)
    acoesDia.push({ sev: 'alta', texto: `${vs.join(', ')} ${etq.sem_orc_vendedores.length > 1 ? 'têm' : 'tem'} leads e zero orçamento enviado`, key: 'g4', anchor: 'vendedores' })
  }
  if (etq && etq.alertas.leads_orfaos > 0) {
    acoesDia.push({ sev: 'media', texto: `${etq.alertas.leads_orfaos} leads órfãos parados +7 dias no começo do funil`, key: 'g4', anchor: 'leads-orfaos' })
  }
  if (etq && etq.alertas.criativos_nao_fabricamos > 0) {
    acoesDia.push({ sev: 'media', texto: `${etq.alertas.criativos_nao_fabricamos} criativo(s) trazendo lead que a Branorte não fabrica — revisar verba`, key: 'g3', anchor: 'criativo-veredito' })
  }
  const sevRank: Record<string, number> = { critica: 0, alta: 1, media: 2 }
  const acoesTop = acoesDia.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]).slice(0, 3)

  // Distribuição atual por etapa (rosca) — a partir das etiquetas do WhatsApp.
  const pieData = etq ? [
    { nome: 'Novo', valor: etq.por_categoria.novo ?? 0, cor: COLORS.info },
    { nome: 'Em negociação', valor: (etq.por_categoria.quente ?? 0) + (etq.por_categoria.lead_quente ?? 0), cor: COLORS.warn },
    { nome: 'Orçamento', valor: etq.por_categoria.orcamento ?? 0, cor: 'hsl(280 65% 55%)' },
    { nome: 'Vendido', valor: etq.por_categoria.vendido ?? 0, cor: COLORS.accent },
    { nome: 'Perdido', valor: etq.por_categoria.perdido ?? 0, cor: COLORS.danger },
  ].filter(d => d.valor > 0) : []

  // Abre a seção (se fechada) e rola até o card relevante.
  const irParaSecao = (key: string, anchor: string) => {
    if (!openSec[key]) toggleSec(key)
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

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
          <button
            type="button"
            onClick={toggleDark}
            title={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium border bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong transition-colors"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {dark ? 'Tema claro' : 'Tema escuro'}
          </button>
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
            {/* Período personalizado (intervalo de datas) */}
            <div className="relative">
              <button
                onClick={() => {
                  // Pré-preenche com o range atual se já estiver em modo personalizado.
                  const { from, to } = customDates(preset)
                  setCustomDe(from)
                  setCustomAte(to)
                  setCustomOpen(v => !v)
                }}
                className={
                  'h-8 px-3 rounded-md text-[12px] font-medium border transition-colors inline-flex items-center gap-1 ' +
                  (isCustomPreset(preset)
                    ? 'bg-accent-bg text-accent border-accent/30'
                    : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')
                }
                title="Escolher um intervalo de datas específico"
              >
                📅 {isCustomPreset(preset) ? periodoLabel : 'Personalizado'}
              </button>
              {customOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCustomOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 bg-surface border border-border rounded-lg shadow-xl p-3 w-[264px]">
                    <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-2">Período personalizado</p>
                    <RangeCalendar
                      from={customDe}
                      to={customAte}
                      max={hojeISO}
                      onChange={(f, t) => { setCustomDe(f); setCustomAte(t) }}
                    />
                    <div className="mt-2 mb-3 text-[11px] text-ink-muted leading-snug">
                      {customDe
                        ? <>De <b className="text-ink">{customDe.split('-').reverse().join('/')}</b>{customAte && <> · Até <b className="text-ink">{customAte.split('-').reverse().join('/')}</b></>}</>
                        : <span className="text-ink-faint">Toque na data inicial e depois na final</span>}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setCustomOpen(false)}
                        className="h-8 px-3 rounded-md text-[12px] text-ink-muted hover:bg-surface-3 border border-border"
                      >
                        Cancelar
                      </button>
                      <button
                        disabled={!customDe || !customAte}
                        onClick={() => { setPreset(`custom:${customDe}:${customAte}`); setCustomOpen(false) }}
                        className="h-8 px-3 rounded-md text-[12px] font-bold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════════ META DO MÊS — a pergunta nº1 do dono: "bato a meta?" ════════ */}
      {data?.forecast && (() => {
        const f0 = data.forecast
        // vendido/meta REAIS (fonte viva do Controle: pedidos_venda) sobrescrevem o forecast (que lia status_real, sempre 0)
        const vendidoMes = vendasReais?.vendidoMes ?? f0.vendidoMes
        const pedidosMes = vendasReais?.pedidosMes ?? f0.pedidosMes
        const meta = vendasReais?.meta ?? f0.meta
        const ritmoDia = f0.diaDoMes > 0 ? vendidoMes / f0.diaDoMes : 0
        const projecao = ritmoDia * f0.diasNoMes
        const f = {
          ...f0, vendidoMes, pedidosMes, meta, ritmoDia, projecao,
          pctMeta: meta > 0 ? (vendidoMes / meta) * 100 : 0,
          pctProjecao: meta > 0 ? (projecao / meta) * 100 : 0,
        }
        const pctMeta = Math.min(f.pctMeta, 100)
        const projOk = f.pctProjecao >= 100
        const projPerto = f.pctProjecao >= 80 && f.pctProjecao < 100
        const projCor = projOk ? 'text-success' : projPerto ? 'text-warning' : 'text-danger'
        const projBg = projOk ? 'bg-success' : projPerto ? 'bg-warning' : 'bg-danger'
        return (
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
              <h2 className="text-[15px] font-bold text-ink tracking-tight">Meta do mês</h2>
              <span className="text-[11px] text-ink-faint tabular-nums">
                dia {f.diaDoMes} de {f.diasNoMes} · ritmo {fmtBRL(f.ritmoDia)}/dia
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              {/* Vendido no mês vs meta */}
              <div className="sm:col-span-2">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-ink-faint font-medium">Vendido no mês</span>
                  <span className="text-[11px] tabular-nums text-ink-faint">meta {fmtBRL(f.meta)}</span>
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-[28px] font-bold text-ink tabular-nums leading-none">{fmtBRL(f.vendidoMes)}</span>
                  <span className="text-[13px] font-semibold text-accent tabular-nums">{Math.round(f.pctMeta)}%</span>
                </div>
                {/* barra: preenchido = vendido; marcador tracejado = projeção */}
                <div className="relative h-3 rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(pctMeta, 1)}%` }} />
                  {f.pctProjecao > 0 && f.pctProjecao < 100 && (
                    <div className="absolute top-0 h-full w-0.5 bg-ink/50" style={{ left: `${Math.min(f.pctProjecao, 99)}%` }} title={`Projeção: ${fmtBRL(f.projecao)}`} />
                  )}
                </div>
                <div className="mt-1 text-[10.5px] text-ink-faint">
                  {f.pedidosMes} {f.pedidosMes === 1 ? 'pedido' : 'pedidos'} fechados este mês
                </div>
              </div>
              {/* Projeção no ritmo atual */}
              <div className={`rounded-lg border p-3 ${projOk ? 'border-success/30 bg-success-bg/20' : projPerto ? 'border-warning/30 bg-warning-bg/20' : 'border-danger/30 bg-danger-bg/20'}`}>
                <div className="text-[11px] uppercase tracking-wider text-ink-faint font-medium mb-1">No ritmo atual, fecha</div>
                <div className={`text-[22px] font-bold tabular-nums leading-none ${projCor}`}>{fmtBRL(f.projecao)}</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${projBg}`} />
                  <span className={`text-[11px] font-semibold tabular-nums ${projCor}`}>
                    {Math.round(f.pctProjecao)}% da meta
                    {projOk ? ' — no caminho 🎯' : projPerto ? ' — quase lá' : ' — abaixo do ritmo'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════════ CORRIDA DE VENDAS — placar por vendedor, ao vivo do Controle ════════ */}
      {vendasReais?.corrida && vendasReais.corrida.length > 0 && (
        <CorridaVendas corrida={vendasReais.corrida} metaVendedor={vendasReais.metaVendedor} />
      )}

      {/* ════════ PLACAR DOS TIMES — 3 times, meta R$833k, ao vivo do Controle ════════ */}
      {vendasReais?.corrida && vendasReais.corrida.length > 0 && (
        <PlacarTimes corrida={vendasReais.corrida} />
      )}

      {/* ════════ DINHEIRO PARADO — orçamento por tempo sem resposta (aciona cobrança) ════════ */}
      {data?.leadAging && data.leadAging.some(a => a.valor > 0 || a.leads > 0) && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-2 mb-2.5">
            <h2 className="text-[13px] font-bold text-ink tracking-tight">Dinheiro parado — sem resposta há</h2>
            <span className="text-[10.5px] text-ink-faint">quanto mais velho, mais frio: cobre os da direita primeiro</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {data.leadAging.map((a, i) => {
              const critico = i >= 2 // 7d-30d e +30d
              return (
                <div
                  key={a.faixa}
                  className={`rounded-lg border p-2.5 ${critico ? 'border-danger/25 bg-danger-bg/15' : 'border-border bg-surface-2/40'}`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">{a.faixa}</div>
                  <div className={`text-[18px] font-bold tabular-nums leading-tight ${critico ? 'text-danger' : 'text-ink'}`}>
                    {a.valor > 0 ? fmtBRL(a.valor) : '—'}
                  </div>
                  <div className="text-[10.5px] text-ink-muted tabular-nums">{a.leads} {a.leads === 1 ? 'lead' : 'leads'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ════════ URGÊNCIA — quem quer comprar AGORA vs quem está pesquisando ════════ */}
      {/* Drill-down "de onde vem" (Orçamentos / Vendidos / Valor convertido) */}
      {drill && <DrillModal kind={drill} preset={preset} onClose={() => setDrill(null)} />}

      {/* ════════ O ESSENCIAL — glance de 5 segundos, no topo da página ════════ */}
      <Card className="border-accent/25 bg-accent-bg/30">
        <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-[15px] font-bold text-ink tracking-tight">
            O essencial{preset && <span className="text-accent"> · {periodoLabel}</span>}
          </h2>
          <span className="text-[11px] text-ink-faint">o que importa agora — abra as seções abaixo pro detalhe</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {heroKpis.map(k => (
            <KpiHero key={k.label} {...k} showDelta={showDelta} />
          ))}
        </div>

        {/* MINI-GRÁFICOS — funil (onde vaza) · tendência (o detalhe abre nas seções) */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Funil */}
          <div className="rounded-lg border border-border/60 bg-surface p-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2.5">Funil por etiqueta (WhatsApp)</div>
            <div className="space-y-2">
              {(funilEtiquetas.length ? funilEtiquetas : funilCanonico).map((e, i) => (
                <div key={e.etapa}>
                  <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                    <span className="text-ink-muted truncate pr-2">{e.etapa}</span>
                    <span className="font-mono tabular-nums text-ink shrink-0">
                      {fmtN(e.valor)}{i > 0 && <span className="text-ink-faint"> · {Math.round(e.pctTopo)}%</span>}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(e.pctTopo, 2)}%`, background: i === 6 ? COLORS.accent : i === 5 ? 'hsl(280 65% 55%)' : COLORS.info }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tendência */}
          <div className="rounded-lg border border-border/60 bg-surface p-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-1.5">Leads por dia (30d)</div>
            <div className="h-[132px]">
              {data.leadsPorDia.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.leadsPorDia} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gEss1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.info} stopOpacity={0.4} /><stop offset="100%" stopColor={COLORS.info} stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="gEss2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.5} /><stop offset="100%" stopColor={COLORS.accent} stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <XAxis dataKey="dia" hide />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--surface))', border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 11 }}
                      formatter={((v: number, n: string) => [fmtN(v), n === 'total' ? 'Total' : 'Qualif.']) as never}
                      labelFormatter={((l: string) => new Date(l + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })) as never}
                    />
                    <Area type="monotone" dataKey="total" stroke={COLORS.info} strokeWidth={2} fill="url(#gEss1)" />
                    <Area type="monotone" dataKey="qualificados" stroke={COLORS.accent} strokeWidth={2} fill="url(#gEss2)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="h-full grid place-items-center text-[11px] text-ink-faint">Sem dados</div>}
            </div>
          </div>

        </div>

        {acoesTop.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/60">
            <span className="text-[11px] font-bold uppercase tracking-widest text-ink-faint">⚡ Ação do dia</span>
            <ul className="mt-2 space-y-1.5">
              {acoesTop.map((a, i) => {
                const dot = a.sev === 'critica' ? 'bg-danger' : a.sev === 'alta' ? 'bg-warning' : 'bg-info'
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => irParaSecao(a.key, a.anchor)}
                      className={`w-full flex items-start gap-2 text-left text-[13px] group transition-colors ${i === 0 ? 'font-semibold text-ink' : 'text-ink-muted'} hover:text-accent`}
                    >
                      <span className={`mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                      <span className="flex-1">{a.texto}</span>
                      <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-ink-faint group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Card>

      {/* ════════ GRÁFICOS DO DIA — no início da página (pedido do gerente) ════════ */}
      {extra && (
        <Card>
          <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-[14px] font-bold text-ink tracking-tight">📊 Gráficos do dia</h2>
            <span className="text-[11px] text-ink-faint">orçamentos · hoje, aberto e negociação</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <OrcamentosPorDiaChart data={extra.orcamentos_por_dia} />
            <AtendimentosHojeCard data={extra.atendimentos} />
            <AbertoCard data={extra.aberto} onIr={() => irParaSecao('g4', 'vendedores-funil')} />
            <NegociacaoCard data={extra.negociacao} />
          </div>
        </Card>
      )}

      {/* BANNER DE ALERTAS — só aparece se há algo crítico */}
      {etq && (etq.alertas.criativos_nao_fabricamos > 0 || etq.alertas.leads_orfaos > 0 || etq.alertas.vendedores_sem_orc > 0) && (
        <AlertasBanner etq={etq} />
      )}

      {/* DECISÕES DO GERENTE — reforçar 🟢 + cobrar 🔴 num card só */}
      {(data.porOrigem.length > 0 || vendCards.length > 0) && (
        <DecisoesGerente porOrigem={data.porOrigem} cards={vendCards} p={positivo} />
      )}

      {/* RESUMO DO DIA POR VENDEDOR — números de HOJE ao vivo (mesma fonte das mesas do /disparos) */}
      <ResumoDiaVendedores preset={preset} periodoLabel={periodoLabel} />

      {/* ════════ GRUPO 1 · VISÃO GERAL ════════ */}
      <CollapsibleSection n="1" titulo="Propostas & dinheiro na mesa" pergunta="Quanto tem montado e em que estágio" open={openSec.g1} onToggle={() => toggleSec('g1')}>

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

      </CollapsibleSection>

      {/* ════════ GRUPO 2 · FUNIL ════════ */}
      <CollapsibleSection n="2" titulo="Funil" pergunta="Onde o lead morre?" open={openSec.g2} onToggle={() => toggleSec('g2')}>
      <Card>
        <CardHeader
          title="Funil por etiqueta (WhatsApp)"
          subtitle={`${fmtN(funilEtiquetas[0]?.valor ?? 0)} contatos com etiqueta · estágio atual pela etiqueta do WhatsApp (o mais avançado por telefone)`}
        />
        <FunilHero etapas={funilEtiquetas.length ? funilEtiquetas : funilCanonico} />
      </Card>
      {etq && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader title="Ciclo de venda" subtitle="Mediana de tempo entre etapas (timestamps reais)" />
            <CicloVenda ciclo={ciclo} />
          </Card>
          <Card>
            <CardHeader title="Motivos de trava / perda" subtitle="Por que o lead não avança (etiquetas do vendedor)" />
            <MapaEtiquetas etq={etq} variant="trava" />
          </Card>
        </div>
      )}

      </CollapsibleSection>

      {/* ════════ GRUPO 3 · ONDE INVESTIR (canônico de mídia) ════════ */}
      <CollapsibleSection n="3" titulo="Onde investir" pergunta="Pra onde vai (ou corta) a verba?" open={openSec.g3} onToggle={() => toggleSec('g3')}>
      <Card id="criativo-veredito">
        <CardHeader
          title="🎯 Onde investir — por criativo"
          subtitle="Escalar / pausar cada criativo. Decisão por qualidade do lead (conversão ~0 em tudo)."
        />
        <VereditoInvestimento criativos={data.porCriativo} etq={etq} real={orcVendaCriativo} />
      </Card>
      {data.porOrigem.length > 0 && (
        <Card>
          <CardHeader
            title="🎯 Onde investir — por origem (canal)"
            subtitle="Meta / Google / Instagram… origens WhatsApp de vendedor individual excluídas."
          />
          <VereditoOrigem origens={data.porOrigem} etq={etq} real={orcVendaOrigem} />
        </Card>
      )}
      {motivosFonte && (motivosFonte.por_criativo.length > 0 || motivosFonte.por_origem.length > 0) && (
        <Card id="motivos-fonte">
          <CardHeader
            title="🔎 Motivos de fechamento — por criativo / origem"
            subtitle="Qual anúncio/canal traz mais lead que NÃO RESPONDEU, NÃO TEM INTERESSE, NÃO FABRICAMOS etc. Escolha o motivo e ordene do pior pro melhor pra cortar a fonte certa."
          />
          <MotivosPorFonteView data={motivosFonte} />
        </Card>
      )}

      </CollapsibleSection>

      {/* ════════ GRUPO 4 · OPERAÇÃO DO TIME ════════ */}
      <CollapsibleSection n="4" titulo="Operação do time" pergunta="Quem eu cobro hoje e qual lead resgato?" open={openSec.g4} onToggle={() => toggleSec('g4')}>
      <Card id="vendedores">
        <CardHeader
          title="Painel por vendedor"
          subtitle="Contatos passados → qualificação da IA → etiquetas do funil no WhatsApp → motivos de perda. (Daniel/testes fora.)"
        />
        {vendCards.length > 0
          ? <PainelVendedores cards={vendCards} />
          : <SlaTable rows={data.slaPorVendedor} etqPorVendedor={etq?.por_vendedor} />}
      </Card>

      </CollapsibleSection>

      {/* ════════ GRUPO 5 · CONTEXTO (colapsável no caminho diário) ════════ */}
      <CollapsibleSection n="5" titulo="Contexto" pergunta="De onde e quando vêm os leads?" open={openSec.g5} onToggle={() => toggleSec('g5')}>
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
      {negItems.length > 0 && (
        <Card>
          <CardHeader
            title="Onde está a negociação"
            subtitle={`${fmtN(negItems.reduce((s, n) => s + n.total, 0))} leads em negociação ativa (follow-up + quente) · ${negItems.length} estados — onde o pipeline está esquentando agora`}
          />
          <NegociacaoGeo items={negItems} />
        </Card>
      )}
      </CollapsibleSection>
    </div>
  )
}

// ============================================================================
// COMPONENTES
// ============================================================================

// ════════ DRILL-DOWN: "de onde vem" (Orçamentos / Vendidos / Valor convertido) ════════
// Abre ao clicar no card. Lista as linhas por trás do número (reconcilia 1:1 com o KPI).
function DrillModal({ kind, preset, onClose }: { kind: 'orcamentos' | 'vendidos' | 'valor'; preset: DashboardPreset; onClose: () => void }) {
  const isVendas = kind === 'vendidos' || kind === 'valor'
  const vendasQ = useDashboardVendasDetalhe(preset, isVendas)
  const orcQ = useDashboardOrcamentosDetalhe(preset, kind === 'orcamentos')
  const [soLead, setSoLead] = useState(true)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  const dt = (s: string | null) => s ? new Date(s.length <= 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—'

  const loading = isVendas ? vendasQ.isLoading : orcQ.isLoading
  const err = (isVendas ? vendasQ.error : orcQ.error) as Error | null

  const vendas = vendasQ.data ?? []
  const vendasView = soLead ? vendas.filter(v => v.is_lead) : vendas
  const vTot = vendasView.reduce((s, v) => s + v.valor, 0)
  const orc = orcQ.data ?? []
  const orcValTot = orc.reduce((s, o) => s + o.valor_total, 0)

  const title = kind === 'orcamentos' ? 'Orçamentos — de onde vem'
    : kind === 'vendidos' ? 'Vendidos — de onde vem' : 'Valor convertido — de onde vem'
  const subtitle = isVendas
    ? `${vendasView.length} venda(s) · ${brl(vTot)}${soLead ? ' — amarradas a um lead do atendimento' : ' — todas as vendas do período'}`
    : `${orc.length} telefone(s) com orçamento · ${brl(orcValTot)} montados`

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink truncate">{title}</h3>
            <p className="text-[11px] text-ink-faint truncate">{subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-ink-faint shrink-0" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto p-2 sm:p-3">
          {loading && <div className="p-8 text-center text-[12px] text-ink-faint">Carregando…</div>}
          {err && <div className="p-4 text-[12px] text-danger font-mono break-all">Erro: {err.message}</div>}

          {!loading && !err && isVendas && (
            <>
              <div className="flex items-center gap-2 mb-2 px-1">
                <button onClick={() => setSoLead(true)} className={`text-[11px] px-2 py-1 rounded transition-colors ${soLead ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>De lead ({vendas.filter(v => v.is_lead).length})</button>
                <button onClick={() => setSoLead(false)} className={`text-[11px] px-2 py-1 rounded transition-colors ${!soLead ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>Todas ({vendas.length})</button>
                <span className="ml-auto text-[12px] font-semibold text-ink tabular-nums">{brl(vTot)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-ink-faint text-[10px] uppercase tracking-wide">
                      <th className="text-left py-1 px-2 font-semibold">Cliente</th>
                      <th className="text-left py-1 px-2 font-semibold">Vendedor</th>
                      <th className="text-left py-1 px-2 font-semibold">Origem</th>
                      <th className="text-left py-1 px-2 font-semibold">Criativo</th>
                      <th className="text-right py-1 px-2 font-semibold">Valor</th>
                      <th className="text-left py-1 px-2 font-semibold">Data</th>
                      <th className="text-left py-1 px-2 font-semibold">Cidade/UF</th>
                      <th className="text-left py-1 px-2 font-semibold">Nº orç.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendasView.map((v, i) => (
                      <tr key={i} className="border-t border-border/50 hover:bg-surface-2/50">
                        <td className="py-1.5 px-2 text-ink">{v.cliente || '—'}</td>
                        <td className="py-1.5 px-2 text-ink-muted">{v.vendedor || '—'}</td>
                        <td className="py-1.5 px-2 text-ink-muted">{v.origem || '—'}</td>
                        <td className="py-1.5 px-2 text-ink-faint font-mono">{v.criativo || '—'}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink">{brl(v.valor)}</td>
                        <td className="py-1.5 px-2 text-ink-muted whitespace-nowrap">{dt(v.data_venda)}</td>
                        <td className="py-1.5 px-2 text-ink-muted">{[v.cidade, v.estado].filter(Boolean).join('/') || '—'}</td>
                        <td className="py-1.5 px-2 text-ink-faint font-mono">{v.numero || '—'}</td>
                      </tr>
                    ))}
                    {vendasView.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink-faint">Nada no período.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!loading && !err && !isVendas && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-ink-faint text-[10px] uppercase tracking-wide">
                    <th className="text-left py-1 px-2 font-semibold">Cliente</th>
                    <th className="text-left py-1 px-2 font-semibold">Telefone</th>
                    <th className="text-right py-1 px-2 font-semibold">Qtd</th>
                    <th className="text-right py-1 px-2 font-semibold">Valor total</th>
                    <th className="text-left py-1 px-2 font-semibold">Último</th>
                    <th className="text-left py-1 px-2 font-semibold">Vendedor</th>
                    <th className="text-left py-1 px-2 font-semibold">Origem</th>
                    <th className="text-left py-1 px-2 font-semibold">Criativo</th>
                  </tr>
                </thead>
                <tbody>
                  {orc.map((o, i) => (
                    <tr key={i} className="border-t border-border/50 hover:bg-surface-2/50">
                      <td className="py-1.5 px-2 text-ink">{o.cliente || '—'}</td>
                      <td className="py-1.5 px-2 text-ink-muted font-mono">{o.fone}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-ink-muted">{o.qtd}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums text-ink">{brl(o.valor_total)}</td>
                      <td className="py-1.5 px-2 text-ink-muted whitespace-nowrap">{dt(o.ultima_data)}</td>
                      <td className="py-1.5 px-2 text-ink-muted">{o.vendedor || '—'}</td>
                      <td className="py-1.5 px-2 text-ink-muted">{o.origem || '—'}</td>
                      <td className="py-1.5 px-2 text-ink-faint font-mono">{o.criativo || '—'}</td>
                    </tr>
                  ))}
                  {orc.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink-faint">Nada no período.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiHero({ label, kpi, icon: Icon, color, sub, suffix, prefix, onClick, showDelta: showDeltaProp = true }: {
  label: string;
  kpi: { valor: number; deltaPct: number; sparkline: number[] };
  icon: typeof Users;
  color: string;
  sub: string;
  suffix?: string;
  prefix?: string;
  onClick?: () => void;
  showDelta?: boolean;
}) {
  const showDelta = showDeltaProp && Math.abs(kpi.deltaPct) > 0.5
  const positivo = kpi.deltaPct > 0
  const sparkData = kpi.sparkline.map((v, i) => ({ i, v }))
  const gid = `spark-${label.replace(/\s+/g, '')}`
  return (
    <div
      className={`bg-surface border border-border rounded-xl p-3 sm:p-5 transition-colors relative overflow-hidden ${onClick ? 'cursor-pointer hover:border-accent/60 hover:bg-accent-bg/20' : 'hover:border-border-strong'}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}
    >
      <div className="flex items-start justify-between mb-0.5">
        <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.08em] text-ink-faint font-medium leading-tight">{label}</p>
        <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" style={{ color }} />
      </div>
      <p className="text-[26px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight tabular-nums" style={{ color }}>
        {prefix && <span className="text-base sm:text-2xl font-medium mr-0.5">{prefix}</span>}
        {suffix ? kpi.valor.toString().replace('.', ',') : fmtN(kpi.valor)}
        {suffix && <span className="text-base sm:text-xl font-medium ml-0.5">{suffix}</span>}
      </p>
      <div className="flex items-center justify-between mt-0.5 sm:mt-1.5">
        <p className="text-[10px] sm:text-[11px] text-ink-faint leading-tight">{sub}{onClick && <span className="text-accent font-medium"> · ver origem</span>}</p>
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
  // TODOS os vendedores com proposta (não só top 4) — pra Jardel/Edilson/Lucas aparecerem.
  const todos = orc.porVendedor.filter(v => v.brl > 0 && v.vendedor !== '—')
  const maxBrl = Math.max(...todos.map(v => v.brl), 1)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-5">
      {/* Bloco de números */}
      <div>
        <div className="flex items-end gap-2">
          <Banknote className="h-6 w-6 text-success mb-1.5 shrink-0" />
          <div>
            <div className="text-[34px] leading-none font-semibold tabular-nums text-success">{fmtBRL(orc.valorTotalBRL)}</div>
            <p className="text-[11px] text-ink-faint mt-1">em propostas · {periodoLabel.toLowerCase()} · 1 por cliente (última)</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtN(orc.geradas)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">clientes com proposta</div>
          </div>
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtTicket(orc.ticketMedioBRL)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">ticket médio</div>
          </div>
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtN(orc.propostasBrutas)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">propostas montadas (c/ re-cotação)</div>
          </div>
          <div className="rounded-md bg-surface-2/40 border border-border/30 px-2.5 py-2">
            <div className="text-[17px] font-bold tabular-nums text-ink">{fmtN(todos.length)}</div>
            <div className="text-[10px] text-ink-faint leading-tight">vendedores ativos</div>
          </div>
        </div>
      </div>
      {/* TODOS os vendedores por valor em proposta (1 por cliente) */}
      {todos.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">Quem montou proposta — R$ por cliente (clica e vê)</p>
          <div className="space-y-1.5">
            {todos.map(v => (
              <Link
                key={v.vendedor}
                to={`/orcamentos/salvos?vendedor=${encodeURIComponent(v.vendedor)}`}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-[12px] group"
                title={`${v.n} cliente(s), ${v.propostasN} proposta(s) — ver os orçamentos de ${v.vendedor.toLowerCase()}`}
              >
                <span className="truncate text-ink capitalize group-hover:text-accent group-hover:underline" title={v.vendedor}>{v.vendedor.toLowerCase()}</span>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-success/70 rounded-full" style={{ width: `${(v.brl / maxBrl) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-ink-muted whitespace-nowrap">{fmtBRL(v.brl)} <span className="text-[10px] text-ink-faint">· {v.n} cli{v.propostasN > v.n ? `/${v.propostasN}p` : ''}</span></span>
              </Link>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint pt-2">Valor = última proposta de cada cliente (re-cotação do mesmo cliente conta 1×), não venda fechada. "{todos.length} cli/Np" = clientes/propostas. Daniel (testes) fora.</p>
        </div>
      )}
    </div>
  )
}

// Metadados por categoria do funil (rótulo + cor) pra o card de propostas por estágio.
const PROP_CAT_META: Record<PropCategoria, { label: string; cor: string }> = {
  orcamento:    { label: 'Orçamento enviado', cor: 'hsl(38 92% 50%)' },
  quente:       { label: 'Quente / follow-up', cor: 'hsl(0 72% 51%)' },
  lead_quente:  { label: 'Lead quente',        cor: 'hsl(14 80% 52%)' },
  novo:         { label: 'Novo (sem mexer)',   cor: 'hsl(217 91% 60%)' },
  sem_etiqueta: { label: 'Sem etiqueta',       cor: 'hsl(240 5% 55%)' },
  vendido:      { label: 'Vendido',            cor: 'hsl(152 60% 40%)' },
  perdido:      { label: 'Perdido',            cor: 'hsl(240 4% 50%)' },
  outros:       { label: 'Outros / interno',   cor: 'hsl(270 30% 55%)' },
}

// Propostas × estágio atual do funil. Headline = R$ em ABERTO (não vendido = dinheiro
// na mesa). Chips por etapa filtram o ranking de vendedores abaixo, que linka pra lista
// de orçamentos já filtrada por vendedor + etapa. Resolve "quais orçamentos foram
// enviados e estão com atendimento aberto" + "quem montou mais proposta em cada etapa".
function PropostasPorEstagio({ status }: { status: PropostasStatus }) {
  const [sel, setSel] = useState<PropCategoria | 'aberto'>('aberto')

  // Ordem de exibição dos chips (abertos primeiro, fechados por último).
  const ordem: PropCategoria[] = ['orcamento', 'quente', 'lead_quente', 'novo', 'sem_etiqueta', 'vendido', 'perdido', 'outros']
  const chips = ordem
    .map(c => status.porCategoria.find(p => p.categoria === c))
    .filter((p): p is PropostasStatus['porCategoria'][number] => !!p && p.n > 0)

  const totalGeral = status.porCategoria.reduce((s, c) => s + c.brl, 0) || 1

  // Vendedores do estágio selecionado (pra 'aberto', soma as categorias em aberto).
  const cats = sel === 'aberto' ? CATS_ABERTO : [sel]
  const vendMap = new Map<string, { n: number; brl: number }>()
  for (const r of status.porCatVendedor) {
    if (!cats.includes(r.categoria)) continue
    const acc = vendMap.get(r.vendedor) ?? { n: 0, brl: 0 }
    acc.n += r.n; acc.brl += r.brl
    vendMap.set(r.vendedor, acc)
  }
  const vendRank = [...vendMap.entries()].map(([vendedor, v]) => ({ vendedor, ...v })).sort((a, b) => b.brl - a.brl)
  const maxV = Math.max(...vendRank.map(v => v.brl), 1)

  const selTotal = sel === 'aberto' ? status.aberto : (status.porCategoria.find(c => c.categoria === sel) ?? { n: 0, brl: 0 })
  const selLabel = sel === 'aberto' ? 'em aberto (não vendido)' : PROP_CAT_META[sel].label.toLowerCase()
  const selCor = sel === 'aberto' ? 'hsl(38 92% 50%)' : PROP_CAT_META[sel].cor

  return (
    <div className="space-y-4">
      {/* Headline: dinheiro na mesa (aberto) vs vendido */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button
          onClick={() => setSel('aberto')}
          className={`text-left rounded-lg px-3 py-2.5 border transition-colors ${sel === 'aberto' ? 'border-warning/60 bg-warning/10' : 'border-border/40 bg-surface-2/30 hover:bg-surface-2/60'}`}
        >
          <div className="text-[10px] uppercase tracking-wide text-ink-faint">Dinheiro na mesa</div>
          <div className="text-[22px] leading-tight font-bold tabular-nums text-warning">{fmtBRL(status.aberto.brl)}</div>
          <div className="text-[10px] text-ink-faint">{fmtN(status.aberto.n)} propostas abertas</div>
        </button>
        <div className="rounded-lg px-3 py-2.5 border border-border/40 bg-surface-2/30">
          <div className="text-[10px] uppercase tracking-wide text-ink-faint">Vendido (etiqueta)</div>
          <div className="text-[22px] leading-tight font-bold tabular-nums text-success">{fmtBRL(status.vendido.brl)}</div>
          <div className="text-[10px] text-ink-faint">{fmtN(status.vendido.n)} propostas · sub-registro*</div>
        </div>
        <div className="rounded-lg px-3 py-2.5 border border-border/40 bg-surface-2/30 col-span-2 sm:col-span-1">
          <div className="text-[10px] uppercase tracking-wide text-ink-faint">% já com etiqueta VENDIDO</div>
          <div className="text-[22px] leading-tight font-bold tabular-nums text-ink">
            {status.aberto.brl + status.vendido.brl > 0 ? ((status.vendido.brl / (status.aberto.brl + status.vendido.brl)) * 100).toFixed(0) : '0'}%
          </div>
          <div className="text-[10px] text-ink-faint">vendido ÷ (aberto + vendido)</div>
        </div>
      </div>

      {/* Chips por estágio — clicáveis */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map(c => {
          const ativo = sel === c.categoria
          return (
            <button
              key={c.categoria}
              onClick={() => setSel(c.categoria)}
              className={`flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1 text-[11px] border transition-colors ${ativo ? 'border-accent bg-accent/10 text-ink' : 'border-border/50 bg-surface-2/30 text-ink-muted hover:bg-surface-2/60'}`}
              title={`${PROP_CAT_META[c.categoria].label} — ${fmtBRL(c.brl)} · ${((c.brl / totalGeral) * 100).toFixed(0)}% do valor`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: PROP_CAT_META[c.categoria].cor }} />
              <span className="font-medium">{PROP_CAT_META[c.categoria].label}</span>
              <span className="font-mono tabular-nums text-ink-faint">{c.n}</span>
            </button>
          )
        })}
      </div>

      {/* Ranking de vendedores no estágio selecionado */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-[11px] text-ink-muted">
            <span className="font-semibold tabular-nums" style={{ color: selCor }}>{fmtBRL(selTotal.brl)}</span> em {fmtN(selTotal.n)} propostas <span className="text-ink-faint">{selLabel}</span>
          </p>
          <Link to={`/orcamentos/salvos?etiqueta=${sel}`} className="text-[11px] text-accent hover:underline shrink-0">Ver lista →</Link>
        </div>
        {vendRank.length > 0 ? (
          <div className="space-y-1.5">
            {vendRank.map(v => (
              <Link
                key={v.vendedor}
                to={`/orcamentos/salvos?vendedor=${encodeURIComponent(v.vendedor)}&etiqueta=${sel}`}
                className="grid grid-cols-[130px_1fr_auto] items-center gap-2 text-[12px] group"
                title={`Ver os orçamentos de ${v.vendedor.toLowerCase()} nesse estágio`}
              >
                <span className="truncate text-ink capitalize group-hover:text-accent group-hover:underline" title={v.vendedor}>{v.vendedor.toLowerCase()}</span>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(v.brl / maxV) * 100}%`, background: selCor }} />
                </div>
                <span className="text-right font-mono tabular-nums text-ink-muted whitespace-nowrap">{fmtBRL(v.brl)} <span className="text-ink-faint">· {v.n}</span></span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-faint">Nenhuma proposta nesse estágio.</p>
        )}
      </div>

      <p className="text-[10px] text-ink-faint border-t border-border/40 pt-2">
        *Vendido aqui = proposta cujo cliente tem etiqueta VENDIDO no WhatsApp. Muita venda fecha sem a etiqueta ser marcada, então o nº real é maior — use como piso, não teto. "Sem etiqueta" = proposta montada mas o cliente não tem etiqueta de funil agora (gap de acompanhamento).
      </p>
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

// Motivos de fechamento por criativo/origem — escolhe a fonte (criativo/origem) e o
// motivo, ordena do pior pro melhor. Responde "qual anúncio traz mais não-respondeu".
function MotivosPorFonteView({ data }: { data: { por_criativo: MotivoFonte[]; por_origem: MotivoFonte[] } }) {
  const [fonte, setFonte] = useState<'criativo' | 'origem'>('criativo')
  const [motivo, setMotivo] = useState<MotivoKey>('perdido')
  const [pior, setPior] = useState(true) // true = pior primeiro (mais motivo)

  const itens = fonte === 'criativo' ? data.por_criativo : data.por_origem
  const motivoLabel = MOTIVO_LABELS.find(m => m.key === motivo)?.label ?? ''
  const ranked = [...itens]
    .map(it => ({ it, n: (it[motivo] as number) || 0, pct: it.total > 0 ? (((it[motivo] as number) || 0) / it.total) * 100 : 0 }))
    .filter(r => r.n > 0)
    .sort((a, b) => pior ? b.n - a.n : a.n - b.n)
    .slice(0, 20)
  const maxN = Math.max(...ranked.map(r => r.n), 1)
  // ID ÚNICO p/ key do React: criativo usa o CÓDIGO (vários criativos repetem o mesmo
  // nome_oficial — &8/&63/&9 são todos "COMPACTA 02"; sem isso o React duplica linha).
  const idDe = (it: MotivoFonte) => fonte === 'criativo' ? (it.codigo || it.nome || '?') : (it.origem || '?')
  const labelDe = (it: MotivoFonte) => fonte === 'criativo' ? (it.nome || it.codigo || '—') : (it.origem || '—')

  return (
    <div className="space-y-3">
      {/* Controles: fonte + motivo + ordem */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-[12px]">
          {(['criativo', 'origem'] as const).map(f => (
            <button key={f} onClick={() => setFonte(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${fonte === f ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-2/70'}`}>
              {f === 'criativo' ? 'Por criativo' : 'Por origem'}
            </button>
          ))}
        </div>
        <select value={motivo} onChange={e => setMotivo(e.target.value as MotivoKey)}
          className="px-3 py-1.5 text-[12px] border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
          title="Motivo de fechamento">
          {MOTIVO_LABELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={() => setPior(p => !p)}
          className="px-3 py-1.5 text-[12px] border border-border rounded-md bg-surface-2 text-ink-muted hover:bg-surface-2/70 inline-flex items-center gap-1"
          title="Inverter ordem">
          {pior ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
          {pior ? 'Pior primeiro' : 'Melhor primeiro'}
        </button>
      </div>

      {ranked.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Nenhum{fonte === 'criativo' ? ' criativo' : 'a origem'} com "{motivoLabel}" no período.</p>
      ) : (
        <div className="space-y-1.5">
          {ranked.map((r, i) => {
            const cod = r.it.codigo
            const temNomeProprio = fonte === 'criativo' && !!cod && !!r.it.nome
            return (
              <div key={idDe(r.it)} className="grid grid-cols-[20px_1fr_110px_92px] items-center gap-2 text-[12px]">
                <span className="text-[10px] text-ink-faint tabular-nums text-right">{i + 1}</span>
                <span className="truncate text-ink min-w-0" title={`${cod ? cod + ' · ' : ''}${labelDe(r.it)}`}>
                  {temNomeProprio && (
                    <span className="font-mono text-[10px] text-accent bg-accent/10 rounded px-1 py-0.5 mr-1.5 align-middle">{cod}</span>
                  )}
                  {labelDe(r.it)}
                </span>
                <div className="h-2.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-danger/70" style={{ width: `${(r.n / maxN) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums text-ink whitespace-nowrap">
                  {r.n} <span className="text-[10px] text-ink-faint">({r.pct.toFixed(0)}% de {fmtN(r.it.total)})</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[10px] text-ink-faint pt-1">
        Mostrando <b>{motivoLabel}</b> por {fonte}{fonte === 'criativo' ? ' (código em destaque — vários criativos têm o mesmo nome)' : ''}. % = parte dos leads daquela fonte que fecharam nesse motivo. "Todos perdidos" soma todos os motivos de fechamento.
      </p>
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
  totalPassado: number    // clientes atribuídos a ele (responsável) — base da cobrança
  comEtiqueta: number     // quantos ele etiquetou (entraram no funil)
  semEtiqueta: number     // quantos ele NEM etiquetou — buraco de acompanhamento
  veredito: { nivel: 'cobrar' | 'atencao' | 'ok'; tag: string; cor: string; motivo: string }
}

// Semáforo de cobrança — cobra PROCESSO verificável (parou de orçar, recebe muito lead
// e não monta orçamento, não fecha), não placar de venda (venda é sub-registro: depende
// do vendedor etiquetar à mão).
function vereditoVendedor(c: Omit<CardVend, 'veredito'>): CardVend['veredito'] {
  const semPct = c.totalPassado > 0 ? c.semEtiqueta / c.totalPassado : 0
  if (c.ultimaDias != null && c.ultimaDias > 4 && (c.v.quente + c.v.novo) > 20)
    return { nivel: 'cobrar', tag: 'COBRAR', cor: 'danger', motivo: `parou de orçar há ${c.ultimaDias} dias, com fila quente na mão` }
  if (c.contatos >= 200 && c.orcN <= 10 && c.v.vendido <= 1)
    return { nivel: 'cobrar', tag: 'COBRAR', cor: 'danger', motivo: `${fmtN(c.contatos)} contatos e só ${c.orcN} orçamentos montados` }
  // Não etiqueta: recebeu volume e deixou metade+ dos clientes sem nenhuma etiqueta
  if (c.totalPassado >= 80 && semPct >= 0.5)
    return { nivel: 'cobrar', tag: 'NÃO ETIQUETA', cor: 'danger', motivo: `${fmtN(c.semEtiqueta)} dos ${fmtN(c.totalPassado)} clientes (${Math.round(semPct * 100)}%) sem nenhuma etiqueta — sem rastreio do que fez` }
  if (c.orcN >= 25 && c.v.vendido === 0)
    return { nivel: 'atencao', tag: 'DESTRAVAR', cor: 'warning', motivo: `${c.orcN} orçamentos (${fmtBRL(c.orcBRL)}) e 0 venda ETIQUETADA — conferir vendas reais antes de cobrar fechamento` }
  if (c.totalPassado >= 80 && semPct >= 0.3)
    return { nivel: 'atencao', tag: 'ETIQUETAR', cor: 'warning', motivo: `${Math.round(semPct * 100)}% dos clientes sem etiqueta — pedir pra etiquetar pra dar pra acompanhar` }
  return { nivel: 'ok', tag: 'OK', cor: 'success', motivo: c.v.vendido > 0 ? `${c.v.vendido} leads marcados VENDIDO` : 'em dia' }
}

const ORDEM_VEREDITO: Record<CardVend['veredito']['nivel'], number> = { cobrar: 0, atencao: 1, ok: 2 }

// Mescla painel (etiqueta) + atendimentos (qualif IA) + orçamentos (R$) por primeiro
// nome, calcula o veredito e ordena por gravidade (cobrar primeiro). Daniel fora.
function montarCardsVendedor(painel: VendedorPainel[], sla: SlaVendedor[], orc: OrcamentosResumo | undefined, cobertura: VendedorCobertura[]): CardVend[] {
  // Merge por 1º nome mantendo o MAIOR bucket. Sem isso, quando o responsável tem grafia
  // dupla (ex.: "Igor" e "IGOR" → 2 linhas na cobertura/SLA), o Map simples ficava com a
  // ÚLTIMA (a menor), zerando o card (Igor mostrava 3 de 392).
  const maiorPorNome = <T,>(rows: T[], nome: (t: T) => string, tam: (t: T) => number): Map<string, T> => {
    const m = new Map<string, T>()
    for (const r of rows) {
      const k = primeiroNome(nome(r))
      const cur = m.get(k)
      if (!cur || tam(r) > tam(cur)) m.set(k, r)
    }
    return m
  }
  const slaByNome = maiorPorNome(sla, s => s.vendedor, s => s.totalLeads ?? 0)
  const orcByNome = maiorPorNome(orc?.porVendedor ?? [], o => o.vendedor, o => o.n ?? 0)
  const cobByNome = maiorPorNome(cobertura, c => c.vendedor, c => c.total_passado ?? 0)
  return painel
    .filter(v => !ehDaniel(v.vendedor))
    .map(v => {
      const k = primeiroNome(v.vendedor)
      const s = slaByNome.get(k); const o = orcByNome.get(k); const cob = cobByNome.get(k)
      // total passado = base de cobrança (responsável no atendimento). Cai pro SLA/painel se faltar cobertura.
      const totalPassado = cob?.total_passado ?? s?.totalLeads ?? v.contatos
      const base = {
        v,
        nome: s?.vendedor || capitalizar(v.vendedor),
        contatos: s?.totalLeads ?? v.contatos,
        qualifIa: s?.qualificados ?? null,
        orcN: o?.n ?? 0, orcBRL: o?.brl ?? 0,
        ultimaDias: o?.ultimaDias ?? null,
        totalPassado,
        comEtiqueta: cob?.com_etiqueta ?? 0,
        semEtiqueta: cob?.sem_etiqueta ?? 0,
      }
      return { ...base, veredito: vereditoVendedor(base) }
    })
    .sort((a, b) => ORDEM_VEREDITO[a.veredito.nivel] - ORDEM_VEREDITO[b.veredito.nivel] || b.contatos - a.contatos)
}

// ════════ RESUMO DO GERENTE — as 2 decisões em 10 segundos, no topo ════════
// ════════ DECISÕES DO GERENTE — fusão do "resumo" (cobrar) + "positivo" (reforçar) num card só ════════
function DecisoesGerente({ porOrigem, cards, p }: {
  porOrigem: { origem: string; total: number; ctr: number; engajou: number }[]
  cards: CardVend[]
  p: PositivoData
}) {
  const queima = porOrigem.filter(o => o.total >= 50 && o.total > 0 && o.engajou / o.total < 0.12).sort((a, b) => b.total - a.total)[0]
  const semRastreio = porOrigem.filter(o => /n[aã]o identif|sem origem|desconhec|^outros$|direto/i.test(o.origem)).reduce((s, o) => s + o.total, 0)
  const cobrar = cards.filter(c => c.veredito.nivel === 'cobrar').slice(0, 3)
  const destravar = cards.filter(c => c.veredito.nivel === 'atencao').slice(0, 2)
  // Não cobrar/destravar quem já está no 🏆 (topo em propostas) — evita a contradição
  // "Igor lidera E Igor cobrar", que confundia o gerente.
  const heroNome = p.topOrc ? primeiroNome(p.topOrc.vendedor) : null
  const cobrarF = cobrar.filter(c => primeiroNome(c.nome) !== heroNome)
  const destravarF = destravar.filter(c => primeiroNome(c.nome) !== heroNome)
  const numeros = [
    { v: fmtBRL(p.rMontado), l: 'em propostas montadas' },
    { v: fmtN(p.qualificou), l: 'leads qualificados' },
    { v: fmtN(p.propostas), l: 'propostas no período' },
    { v: fmtN(p.totalVendido), l: 'leads marcados VENDIDO' },
  ]
  return (
    <div className="rounded-xl border border-border bg-surface p-3 lg:p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[13px] font-bold text-ink">👔 Decisões do gerente</span>
        <span className="text-[10px] text-ink-faint">— o que reforçar e o que cobrar agora</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* REFORÇAR */}
        <div className="rounded-lg border border-success/30 bg-success/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-success mb-1.5">🟢 Reforçar / dobrar</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {p.escalar && <li><span className="text-success font-semibold">▲ {p.escalar.origem}</span> <span className="text-ink-faint">melhor canal — {p.escalar.ctr.toFixed(0)}% qualificam</span></li>}
            {p.criativo && p.criativo.pct >= 20 && <li><span className="text-success font-semibold">🎨 {p.criativo.nome || p.criativo.codigo}</span> <span className="text-ink-faint">criativo campeão — {p.criativo.pct.toFixed(0)}%</span></li>}
            {p.topOrc && <li><span className="text-success font-semibold">🏆 {capitalizar(primeiroNome(p.topOrc.vendedor))}</span> <span className="text-ink-faint">lidera em propostas montadas — {fmtBRL(p.topOrc.brl)} ({p.topOrc.n} clientes)</span></li>}
            {p.cobertura && p.cobertura.pct >= 55 && <li><span className="text-success font-semibold">🎯 {p.cobertura.nome.split(' ')[0]}</span> <span className="text-ink-faint">etiqueta {p.cobertura.pct}% dos clientes</span></li>}
            {p.rNegoc > 0 && <li><span className="text-success font-semibold">💰 {fmtBRL(p.rNegoc)} em negociação quente</span> <span className="text-ink-faint">— orçamento/quente (sem 'novo' e sem-etiqueta)</span></li>}
            {!p.escalar && !p.topOrc && !p.rNegoc && <li className="text-ink-faint">Sem destaque no período.</li>}
          </ul>
        </div>
        {/* COBRAR */}
        <div className="rounded-lg border border-danger/25 bg-danger/[0.04] p-3">
          <p className="text-[10px] uppercase tracking-widest text-danger mb-1.5">🔴 Cobrar / revisar</p>
          <ul className="space-y-1 text-[12px] text-ink">
            {queima && <li><span className="text-danger font-semibold">▼ Revisar {queima.origem}</span> <span className="text-ink-faint">— {fmtN(queima.total)} leads, quase ninguém engaja ({Math.round(queima.engajou / queima.total * 100)}%)</span></li>}
            {semRastreio > 0 && <li><span className="text-warning font-semibold">🔧 {fmtN(semRastreio)} leads sem origem</span> <span className="text-ink-faint">— corrigir rastreio antes de cortar verba</span></li>}
            {cobrarF.map(c => <li key={c.nome}><a href="#vendedores" className="hover:underline"><span className="text-danger font-semibold">🔴 {c.nome.split(' ')[0]}</span> <span className="text-ink-faint">— {c.veredito.motivo}</span></a></li>)}
            {destravarF.map(c => <li key={c.nome}><a href="#vendedores" className="hover:underline"><span className="text-warning font-semibold">🟠 {c.nome.split(' ')[0]}</span> <span className="text-ink-faint">— {c.veredito.motivo}</span></a></li>)}
            {!queima && !semRastreio && cobrar.length === 0 && destravar.length === 0 && <li className="text-ink-faint">Nada crítico — time e verba em dia.</li>}
          </ul>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {numeros.map(x => (
          <div key={x.l} className="rounded-md bg-surface-2/30 border border-border/30 px-2.5 py-2">
            <div className="text-[15px] font-bold tabular-nums text-ink">{x.v}</div>
            <div className="text-[10px] text-ink-faint leading-tight">{x.l}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-2">⚠️ "Venda" aqui é sub-registro (depende do vendedor etiquetar) — cobre PROCESSO (orçamento, follow-up), não o placar real.</p>
    </div>
  )
}

// ════════ DESTAQUES POSITIVOS — o espelho do resumo do gerente (o que reforçar) ════════
interface PositivoData {
  topOrc: { vendedor: string; n: number; brl: number } | null
  cobertura: { nome: string; pct: number; com: number; total: number } | null
  fecharam: CardVend[]
  totalVendido: number
  escalar: { origem: string; ctr: number } | null
  criativo: { codigo: string | null; nome: string | null; pct: number } | null
  rMontado: number; rNegoc: number; qualificou: number; propostas: number
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
  const { v, nome, contatos, qualifIa, orcN, orcBRL, totalPassado, comEtiqueta, semEtiqueta } = c
  const SEM = { danger: 'text-danger border-danger/40 bg-danger/10', warning: 'text-warning border-warning/40 bg-warning/10', success: 'text-success border-success/40 bg-success/10' }[c.veredito.cor] ?? ''
  const qualPct = contatos > 0 && qualifIa != null ? Math.round((qualifIa / contatos) * 100) : null
  const semPct = totalPassado > 0 ? Math.round((semEtiqueta / totalPassado) * 100) : 0
  // Reconciliação dos clientes passados: em etiqueta + sem etiqueta = total (fonte: cobertura).
  // Perdidos é um sub-grupo do "em etiqueta" (mostrado como nota, não fatia separada).
  const reconTotal = Math.max(comEtiqueta + semEtiqueta, 1)
  // Funil na ORDEM real da Branorte: Prospecção (sondagem) → Novo lead (confirmou
  // interesse) → Follow-up (negociação começa aqui) → Quente → Orçamento → Vendido.
  const etapas = [
    { label: 'Prospecção', n: v.prospeccao, cor: 'hsl(217 60% 62%)', neg: false },
    { label: 'Novo lead', n: v.novo, cor: CAT_COLOR.novo, neg: false },
    { label: 'Follow-up', n: v.follow_up, cor: 'hsl(38 85% 50%)', neg: true },
    { label: 'Quente', n: v.quente, cor: CAT_COLOR.lead_quente, neg: true },
    { label: 'Orçamento', n: v.orcamento, cor: CAT_COLOR.orcamento, neg: true },
    { label: 'Vendido', n: v.vendido, cor: CAT_COLOR.vendido, neg: true },
  ]
  const maxEtapa = Math.max(...etapas.map(e => e.n), 1)
  const motivos = [
    { label: 'Nunca respondeu', n: v.m_nunca_respondeu },
    { label: 'Sumiu na conversa', n: v.m_nao_respondeu_mais },
    { label: 'Só base de preço', n: v.m_so_preco },
    { label: 'Fora do orçamento', n: v.m_fora_orcamento },
    { label: 'Não fabricamos', n: v.m_nao_fabricamos },
    { label: 'Sem interesse', n: v.m_sem_interesse },
    { label: 'Comprou concorrente', n: v.m_concorrente },
    { label: 'Transportadora', n: v.m_transportadora },
    { label: 'Suporte técnico', n: v.m_suporte },
    { label: 'Outros', n: v.m_outros },
  ].filter(m => m.n > 0).sort((a, b) => b.n - a.n)
  const motivosSoma = motivos.reduce((s, m) => s + m.n, 0)
  const perdidoSemMotivo = Math.max(0, v.perdido - motivosSoma)

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
            {qualifIa != null && <span className="text-ink-faint tabular-nums"> de {fmtN(contatos)}</span>}
            {qualPct != null && <span className="text-ink-faint tabular-nums"> ({qualPct}%)</span>}
            {c.ultimaDias != null && (
              <span className={c.ultimaDias > 4 ? 'text-danger' : 'text-ink-faint'}> · última proposta há {c.ultimaDias}d</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] font-bold tabular-nums text-ink leading-none">{fmtN(totalPassado)}</div>
          <div className="text-[9px] text-ink-faint mt-0.5">clientes passados</div>
        </div>
      </div>

      {/* Reconciliação: dos clientes passados, quantos ele etiquetou vs deixou SEM etiqueta */}
      {(comEtiqueta + semEtiqueta) > 0 && (
        <div className="mb-3">
          <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-2">
            <div style={{ width: `${(comEtiqueta / reconTotal) * 100}%`, background: 'hsl(152 60% 45%)' }} title={`Em etiqueta: ${fmtN(comEtiqueta)}`} />
            <div style={{ width: `${(semEtiqueta / reconTotal) * 100}%`, background: 'hsl(38 92% 50%)' }} title={`Sem etiqueta: ${fmtN(semEtiqueta)}`} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[10px]">
            <span className="text-ink-muted">
              <span className="inline-block h-2 w-2 rounded-sm mr-1 align-middle" style={{ background: 'hsl(152 60% 45%)' }} />
              Em etiqueta <b className="tabular-nums text-ink">{fmtN(comEtiqueta)}</b>
              {v.perdido > 0 && <span className="text-ink-faint"> (perdeu {fmtN(v.perdido)})</span>}
            </span>
            <span className={`font-semibold ${semPct >= 40 ? 'text-danger' : semPct >= 25 ? 'text-warning' : 'text-ink-muted'}`}>
              <span className="inline-block h-2 w-2 rounded-sm mr-1 align-middle" style={{ background: 'hsl(38 92% 50%)' }} />
              Sem etiqueta nenhuma <b className="tabular-nums">{fmtN(semEtiqueta)}</b> ({semPct}%)
            </span>
          </div>
        </div>
      )}

      {/* Funil de etiquetas do WhatsApp — ordem Branorte; negociação começa no Follow-up */}
      <p className="text-[9px] uppercase tracking-widest text-ink-faint mb-1.5">Etiquetas no WhatsApp <span className="normal-case tracking-normal text-ink-faint/70">(sondagem → negociação)</span></p>
      <div className="space-y-1 mb-3">
        {etapas.map((e, i) => (
          <div key={e.label}>
            {i > 0 && etapas[i - 1].neg === false && e.neg === true && (
              <div className="flex items-center gap-1.5 my-1 text-[8.5px] uppercase tracking-widest text-warning/80">
                <span className="h-px flex-1 bg-warning/20" />negociação<span className="h-px flex-1 bg-warning/20" />
              </div>
            )}
            <div className="grid grid-cols-[80px_1fr_30px] items-center gap-2 text-[11px]">
              <span className="text-ink-muted truncate">{e.label}</span>
              <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max((e.n / maxEtapa) * 100, e.n > 0 ? 6 : 0)}%`, background: e.cor }} />
              </div>
              <span className="text-right font-mono tabular-nums text-ink">{e.n || '—'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Orçamentos montados no builder (clica e vê os orçamentos dele) */}
      <Link
        to={`/orcamentos/salvos?vendedor=${encodeURIComponent(primeiroNome(nome))}`}
        className="flex items-center gap-1.5 text-[11px] mb-3 px-2 py-1.5 rounded-md bg-success/5 border border-success/20 hover:border-success/40 hover:bg-success/10 transition-colors group"
        title="Ver os orçamentos deste vendedor"
      >
        <FilePlus2 className="h-3.5 w-3.5 text-success shrink-0" />
        <span className="text-ink-muted">Clientes c/ orçamento:</span>
        <span className="font-semibold text-ink tabular-nums">{orcN}</span>
        {orcBRL > 0 && <span className="font-semibold text-success tabular-nums">· {fmtBRL(orcBRL)}</span>}
        {orcN === 0 && <span className="text-ink-faint">— nenhum no sistema</span>}
        {orcN > 0 && <span className="ml-auto text-[10px] text-ink-faint group-hover:text-success">ver →</span>}
      </Link>

      {/* Motivos de perda — completos (somam o total perdido) */}
      {v.perdido > 0 && (
        <div>
          <p className="text-[10px] text-ink-faint mb-1.5">Perdeu {fmtN(v.perdido)} — por quê:</p>
          <div className="flex flex-wrap gap-1">
            {motivos.map(m => (
              <span key={m.label} className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger tabular-nums">
                {m.label} <span className="font-semibold">{m.n}</span>
              </span>
            ))}
            {perdidoSemMotivo > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-ink-faint tabular-nums" title="Perdidos sem motivo específico marcado">
                Sem motivo marcado <span className="font-semibold">{perdidoSemMotivo}</span>
              </span>
            )}
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

// Tabela "Leads por vendedor": quantos leads, qualificado (IA vs vendedor) e etapas do funil.
function FunilVendedorTable({ rows }: { rows: VendedorFunilRow[] }) {
  if (!rows.length) return <p className="text-sm text-ink-faint">Sem vendedores no período.</p>
  const tot = rows.reduce((a, r) => ({
    leads: a.leads + r.leads,
    qualif_ia: a.qualif_ia + r.qualif_ia,
    qualif_vendedor: a.qualif_vendedor + r.qualif_vendedor,
    qualificado: a.qualificado + r.qualificado,
    sem_etiqueta: a.sem_etiqueta + r.sem_etiqueta,
    prospeccao: a.prospeccao + r.prospeccao,
    novo_lead: a.novo_lead + r.novo_lead,
    follow_up: a.follow_up + r.follow_up,
    lead_quente: a.lead_quente + r.lead_quente,
    orcamento: a.orcamento + r.orcamento,
    vendido: a.vendido + r.vendido,
    perdido: a.perdido + r.perdido,
  }), {
    leads: 0, qualif_ia: 0, qualif_vendedor: 0, qualificado: 0, sem_etiqueta: 0,
    prospeccao: 0, novo_lead: 0, follow_up: 0, lead_quente: 0, orcamento: 0, vendido: 0, perdido: 0,
  })
  const cell = (n: number, tone = 'text-ink-muted') =>
    <td className={`py-2 px-2 text-right font-mono tabular-nums ${n > 0 ? tone : 'text-ink-faint'}`}>{n || '—'}</td>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] whitespace-nowrap">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-ink-faint border-b border-border">
            <th className="text-left font-medium py-2 pr-2 sticky left-0 bg-surface">Vendedor</th>
            <th className="text-right font-medium py-2 px-2">Leads</th>
            <th className="text-right font-medium py-2 px-2" title="Qualificado pela IA do bot OU por etiqueta de avanço do vendedor (dedup por lead)">Qualif.</th>
            <th className="text-right font-medium py-2 px-2" title="Qualificado pela IA do bot">· IA</th>
            <th className="text-right font-medium py-2 px-2" title="Recebeu etiqueta de avanço (Novo Lead/Follow Up/Lead Quente/Interesse Futuro/Vendido)">· Vend.</th>
            <th className="text-right font-medium py-2 px-2" title="No WhatsApp do vendedor sem nenhuma etiqueta">Sem etiq.</th>
            <th className="text-right font-medium py-2 px-2">Prosp.</th>
            <th className="text-right font-medium py-2 px-2">Novo</th>
            <th className="text-right font-medium py-2 px-2">Follow</th>
            <th className="text-right font-medium py-2 px-2">Quente</th>
            <th className="text-right font-medium py-2 px-2">Orç.</th>
            <th className="text-right font-medium py-2 px-2">Vend.</th>
            <th className="text-right font-medium py-2 pl-2">Perd.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(v => {
            const qualifPct = v.leads > 0 ? Math.round((v.qualificado / v.leads) * 100) : 0
            return (
              <tr key={v.vendedor} className="hover:bg-surface-2/50 transition-colors">
                <td className="py-2 pr-2 sticky left-0 bg-surface">
                  <Link
                    to={`/atendimentos?responsavel=${encodeURIComponent(v.vendedor)}`}
                    className="text-ink hover:text-accent hover:underline"
                    title="Ver atendimentos deste vendedor"
                  >
                    {v.vendedor}
                  </Link>
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-ink">{v.leads}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-accent">
                  {v.qualificado}<span className="text-ink-faint text-[10px]"> · {qualifPct}%</span>
                </td>
                {cell(v.qualif_ia, 'text-info')}
                {cell(v.qualif_vendedor, 'text-ink')}
                {cell(v.sem_etiqueta, 'text-danger')}
                {cell(v.prospeccao)}
                {cell(v.novo_lead)}
                {cell(v.follow_up, 'text-warning')}
                {cell(v.lead_quente, 'text-warning')}
                {cell(v.orcamento, 'text-accent')}
                {cell(v.vendido, 'text-success')}
                {cell(v.perdido, 'text-ink-faint')}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-medium text-ink">
            <td className="py-2 pr-2 sticky left-0 bg-surface uppercase text-[10px] tracking-widest text-ink-faint">Total</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.leads}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums text-accent">{tot.qualificado}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums text-info">{tot.qualif_ia}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.qualif_vendedor}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums text-danger">{tot.sem_etiqueta}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.prospeccao}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.novo_lead}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.follow_up}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.lead_quente}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums">{tot.orcamento}</td>
            <td className="py-2 px-2 text-right font-mono tabular-nums text-success">{tot.vendido}</td>
            <td className="py-2 pl-2 text-right font-mono tabular-nums">{tot.perdido}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-[11px] text-ink-faint leading-relaxed">
        As colunas de etapa contam o lead em <strong>toda etiqueta que ele tem</strong> (um lead em Follow Up e Lead Quente
        conta nas duas), por isso não somam o total. <strong>Sem etiq.</strong> = está no WhatsApp do vendedor mas sem
        nenhuma etiqueta de funil.
      </p>
    </div>
  )
}

// ════════ GRÁFICOS DO DIA (pedido do gerente) ════════

// Orçamentos montados por dia (área roxa). data = [{dia:'YYYY-MM-DD', total}].
function OrcamentosPorDiaChart({ data }: { data: { dia: string; total: number }[] }) {
  const ROXO = 'hsl(280 65% 55%)'
  const total30d = data.reduce((s, d) => s + d.total, 0)
  const mediaDia = data.length ? Math.round(total30d / data.length) : 0
  const fmtDia = (dia: string) => { const [, m, d] = dia.split('-'); return `${d}/${m}` }
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Clientes orçados por dia (30d)</div>
      <div className="flex items-end justify-between mb-1">
        <div>
          <div className="text-2xl font-mono tabular-nums text-ink leading-none">{total30d}</div>
          <div className="text-[11px] text-ink-faint mt-0.5">clientes únicos · sem repetir</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono tabular-nums text-ink-muted leading-none">{mediaDia}</div>
          <div className="text-[11px] text-ink-faint mt-0.5">média/dia ativo</div>
        </div>
      </div>
      <div style={{ height: 120 }}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="gradOrcDia" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ROXO} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ROXO} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="dia" hide />
              <Tooltip
                cursor={{ stroke: ROXO, strokeOpacity: 0.3 }}
                contentStyle={{ background: 'hsl(var(--surface))', border: '1px solid ' + COLORS.border, borderRadius: 6, fontSize: 11 }}
                labelFormatter={((v: string) => fmtDia(v)) as never}
                formatter={((value: number) => [`${value} orçamento(s)`, '']) as never}
              />
              <Area type="monotone" dataKey="total" stroke={ROXO} strokeWidth={2} fill="url(#gradOrcDia)" dot={false} activeDot={{ r: 3, fill: ROXO }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="h-full grid place-items-center text-[11px] text-ink-faint">Sem dados</div>}
      </div>
    </div>
  )
}

type AvaliacaoClienteData = { media: number; total: number; por_nota: { nota: number; qtd: number }[] }
// Distribuição das notas (1..5) — barras CSS.
function AvaliacaoCliente({ data }: { data: AvaliacaoClienteData }) {
  const { media, total, por_nota } = data
  const buckets = [5, 4, 3, 2, 1].map(n => ({ nota: n, qtd: por_nota.find(p => p.nota === n)?.qtd ?? 0 }))
  const maxQtd = Math.max(1, ...buckets.map(b => b.qtd))
  const corNota = (n: number) => (n >= 4 ? COLORS.accent : n === 3 ? COLORS.warn : COLORS.danger)
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Avaliação do cliente</div>
      {total === 0 ? (
        <div className="flex h-[120px] items-center justify-center text-xs text-ink-faint">Sem avaliações ainda</div>
      ) : (
        <>
          <div className="flex items-end justify-between mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono tabular-nums text-2xl font-bold text-ink">{media.toFixed(2).replace('.', ',')}</span>
              <span className="text-sm" style={{ color: COLORS.warn }}>★</span>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums text-lg font-bold text-ink">{total}</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">avaliações</div>
            </div>
          </div>
          <div className="space-y-1.5">
            {buckets.map(b => {
              const pct = total > 0 ? (b.qtd / total) * 100 : 0
              const barPct = (b.qtd / maxQtd) * 100
              return (
                <div key={b.nota} className="flex items-center gap-2">
                  <div className="flex w-7 shrink-0 items-center gap-0.5">
                    <span className="font-mono tabular-nums text-xs text-ink-muted">{b.nota}</span>
                    <span className="text-[10px]" style={{ color: COLORS.warn }}>★</span>
                  </div>
                  <div className="relative h-3 flex-1 overflow-hidden rounded bg-surface-2">
                    <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, backgroundColor: corNota(b.nota), opacity: b.qtd === 0 ? 0 : 1 }} />
                  </div>
                  <div className="w-12 shrink-0 text-right font-mono tabular-nums text-[11px] text-ink-muted">{b.qtd}<span className="text-ink-faint"> ({pct.toFixed(0)}%)</span></div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Mini 3-em-1: melhor origem, melhor criativo, e quem qualifica (IA vs vendedor).
function Top3em1({ origem, criativo, vendFunil }: {
  origem: { origem: string; ctr: number; total: number } | null
  criativo: { codigo: string; nome: string; pct: number } | null
  vendFunil: VendedorFunilRow[]
}) {
  const ia = vendFunil.reduce((s, v) => s + v.qualif_ia, 0)
  const vend = vendFunil.reduce((s, v) => s + v.qualif_vendedor, 0)
  const tot = ia + vend || 1
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Quem atrai lead bom</div>
      <div className="space-y-2.5 text-[12px]">
        <div>
          <div className="text-ink-faint text-[10px] uppercase tracking-wider">Melhor origem</div>
          {origem ? <div className="text-ink font-medium truncate">{origem.origem} <span className="text-accent font-mono">{Math.round(origem.ctr)}%</span> <span className="text-ink-faint">qualif</span></div> : <div className="text-ink-faint">—</div>}
        </div>
        <div>
          <div className="text-ink-faint text-[10px] uppercase tracking-wider">Melhor criativo</div>
          {criativo ? <div className="text-ink font-medium truncate">{criativo.codigo}{criativo.nome && criativo.nome !== '—' ? ` ${criativo.nome}` : ''} <span className="text-accent font-mono">{Math.round(criativo.pct)}%</span></div> : <div className="text-ink-faint">—</div>}
        </div>
        <div>
          <div className="text-ink-faint text-[10px] uppercase tracking-wider mb-1">Qualificou — IA vs vendedor</div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-2">
            <div style={{ width: `${(ia / tot) * 100}%`, background: COLORS.info }} />
            <div style={{ width: `${(vend / tot) * 100}%`, background: COLORS.accent }} />
          </div>
          <div className="flex justify-between mt-1 text-[11px] font-mono tabular-nums">
            <span className="text-info">IA {ia}</span>
            <span className="text-accent">Vendedor {vend}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Atendimentos que chegaram hoje (KPI) + comparação com ontem.
function AtendimentosHojeCard({ data }: { data: { hoje: number; ontem: number } }) {
  const { hoje, ontem } = data
  const delta = hoje - ontem
  const pct = ontem > 0 ? Math.round((delta / ontem) * 100) : null
  const up = delta > 0, flat = delta === 0
  const deltaColor = flat ? 'text-ink-faint' : up ? 'text-accent' : 'text-danger'
  const arrow = flat ? '→' : up ? '↑' : '↓'
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Atendimentos hoje</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-4xl font-bold leading-none text-ink">{hoje}</span>
        <span className="text-[11px] text-ink-faint">leads novos</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span className={`font-mono tabular-nums font-semibold ${deltaColor}`}>{arrow} {flat ? '0' : `${up ? '+' : ''}${delta}`}{pct !== null && !flat ? ` (${up ? '+' : ''}${pct}%)` : ''}</span>
        <span className="text-ink-faint">vs ontem (<span className="font-mono tabular-nums text-ink-muted">{ontem}</span>) · dia parcial</span>
      </div>
    </div>
  )
}

// Atendimentos abertos (Prospecção + Novo Lead + Follow Up) — clica e abre a seção do funil por vendedor.
function AbertoCard({ data, onIr }: { data: DashboardExtra['aberto']; onIr: () => void }) {
  const subs: [string, number, string][] = [
    ['Prospecção', data.prospeccao, 'text-ink'],
    ['Novo lead', data.novo_lead, 'text-info'],
    ['Follow up', data.follow_up, 'text-warning'],
    ['Lead quente', data.lead_quente, 'text-danger'],
  ]
  return (
    <button type="button" onClick={onIr} className="text-left rounded-lg border border-border/60 bg-surface p-3 hover:border-accent/40 transition-colors">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Atendimentos abertos</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-4xl font-bold leading-none text-ink">{fmtN(data.total)}</span>
        <span className="text-[11px] text-ink-faint">no funil, sem fechar</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-center">
        {subs.map(([l, n, cor]) => (
          <div key={l} className="rounded bg-surface-2 py-1">
            <div className={`font-mono tabular-nums text-sm ${cor}`}>{fmtN(n as number)}</div>
            <div className="text-[9px] uppercase tracking-wide text-ink-faint">{l}</div>
          </div>
        ))}
      </div>
    </button>
  )
}

// Em negociação = leads em FOLLOW UP + soma dos orçamentos deles (previsão de faturar).
function NegociacaoCard({ data }: { data: DashboardExtra['negociacao'] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-2">Em negociação · previsão</div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-2xl font-bold leading-none" style={{ color: COLORS.warn }}>{fmtBRL(data.valor)}</span>
        <span className="text-[11px] text-ink-faint">previsto</span>
      </div>
      <div className="text-[11px] text-ink-faint mt-0.5">soma dos orçamentos de quem está em follow up + lead quente</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-ink"><span className="font-mono tabular-nums font-semibold">{fmtN(data.em_negociacao)}</span> <span className="text-ink-faint">em negociação</span></span>
        <span className="text-ink-faint">·</span>
        <span className="text-warning"><span className="font-mono tabular-nums font-semibold">{fmtN(data.follow_up)}</span> <span className="text-ink-faint">follow up</span></span>
        <span className="text-danger"><span className="font-mono tabular-nums font-semibold">{fmtN(data.lead_quente)}</span> <span className="text-ink-faint">quente</span></span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink"><span className="font-mono tabular-nums font-semibold">{fmtN(data.com_orcamento)}</span> <span className="text-ink-faint">com orçamento</span></span>
      </div>
    </div>
  )
}

// Funil de venda DE VERDADE (trapézio que estreita) + os vazamentos ao lado.
function FunilDeVenda({ etapas }: { etapas: FunilEtapa[] }) {
  if (!etapas.length) return null
  const CORES = ['hsl(217 91% 60%)', 'hsl(217 78% 52%)', 'hsl(152 60% 42%)', 'hsl(280 65% 55%)', 'hsl(152 55% 32%)']
  const transicoes = etapas.slice(1).map((e, i) => ({
    de: etapas[i].etapa, para: e.etapa,
    perdidos: e.perdidos,
    pctPerda: etapas[i].valor > 0 ? Math.round((e.perdidos / etapas[i].valor) * 100) : 0,
  }))
  const piorIdx = transicoes.reduce((mi, t, i, a) => (t.perdidos > a[mi].perdidos ? i : mi), 0)
  const pior = transicoes[piorIdx]
  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-faint mb-3">Funil de venda · onde vaza</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funil visual (estreitando) */}
        <div className="flex flex-col items-center gap-1">
          {etapas.map((e, i) => {
            const w = Math.max(e.pctTopo, 9)
            return (
              <div key={e.etapa} className="w-full flex flex-col items-center">
                <div className="rounded-md text-white text-center py-2 px-2 shadow-sm transition-all" style={{ width: `${w}%`, background: CORES[i] ?? CORES[CORES.length - 1] }}>
                  <div className="text-[11px] font-semibold leading-tight opacity-95 truncate">{e.etapa}</div>
                  <div className="text-[13px] font-mono font-bold tabular-nums leading-tight">{fmtN(e.valor)}<span className="opacity-80 text-[10px] font-normal"> · {Math.round(e.pctTopo)}%</span></div>
                </div>
                {i < etapas.length - 1 && <div className="text-[10px] leading-none text-ink-faint py-0.5">▼</div>}
              </div>
            )
          })}
        </div>
        {/* Vazamentos ao lado */}
        <div>
          <div className="text-[11px] text-ink-faint mb-2">Quanto some entre cada etapa — o vazamento:</div>
          <div className="space-y-1.5">
            {transicoes.map((t, i) => {
              const ehPior = i === piorIdx && t.perdidos > 0
              return (
                <div key={i} className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${ehPior ? 'bg-danger/10 border border-danger/30' : 'bg-surface-2'}`}>
                  <div className="text-[12px] text-ink-muted truncate pr-2">{t.de} <span className="text-ink-faint">→</span> {t.para}</div>
                  <div className="text-right shrink-0">
                    <span className={`font-mono tabular-nums font-semibold ${ehPior ? 'text-danger' : 'text-warning'}`}>−{fmtN(t.perdidos)}</span>
                    <span className="text-ink-faint text-[11px]"> ({t.pctPerda}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
          {pior && pior.perdidos > 0 && (
            <p className="text-[11px] text-danger mt-2 leading-snug">🩸 Maior vazamento: <strong>{pior.de} → {pior.para}</strong> — {pior.pctPerda}% somem aqui.</p>
          )}
        </div>
      </div>
      <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
        <strong>Qualificou</strong> = quer algo que a Branorte faz (IA) <strong>ou</strong> o vendedor já etiquetou como avanço (Novo Lead / Follow Up / Lead Quente / Orçamento / Vendido). <strong>Engajou</strong> = respondeu à IA ou já recebeu etiqueta.
      </p>
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

// Cor sólida (ponto + preenchimento da barra) por veredito — pareia com VERDICT_META.
const VERDICT_TONE: Record<VerdictKey, { dot: string; fill: string }> = {
  escalar:  { dot: 'bg-success',      fill: 'bg-success' },
  pausar:   { dot: 'bg-danger',       fill: 'bg-danger' },
  otimizar: { dot: 'bg-warning',      fill: 'bg-warning' },
  manter:   { dot: 'bg-ink-muted',    fill: 'bg-ink-muted' },
  amostra:  { dot: 'bg-ink-faint',    fill: 'bg-ink-faint' },
  excluir:  { dot: 'bg-ink-faint/50', fill: 'bg-ink-faint/40' },
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
  conv: number          // vendido + orçamento
  vendido: number
  orcamento: number
  valorVenda?: number   // R$ da venda real atribuída (quando real=true)
  real?: boolean        // orç/venda vêm do match por telefone (não etiqueta)
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
    alerta: semVenda ? '⚠️ Nenhuma venda real atribuída a lead no período (pedido casado pelo telefone) — pode ser fechamento lento OU venda que não veio do funil rastreado.' : null,
  }
}

function FunilTable({ rows, primeiraColuna, semEtq }: { rows: FunilRow[]; primeiraColuna: string; semEtq: boolean }) {
  const { acoes, alerta } = montarHeadline(rows)
  const [verTudo, setVerTudo] = useState(false)
  const TOP = 8
  const maxLeads = Math.max(1, ...rows.map(r => r.total))
  const visiveis = verTudo ? rows : rows.slice(0, TOP)
  const ocultos = rows.length - visiveis.length
  const noun = primeiraColuna.toLowerCase().includes('origem') ? 'origens menores' : 'criativos menores'

  return (
    <div className="space-y-2.5">
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

      {/* Faixas de investimento: barra = volume de leads, preenchimento = % qualificou, cor = veredito */}
      <div className="space-y-1.5">
        {visiveis.map(r => {
          const vm = VERDICT_META[r.verdict]
          const tone = VERDICT_TONE[r.verdict]
          const barW = Math.max(6, Math.round((r.total / maxLeads) * 100))
          return (
            <div key={r.key} className="rounded-lg border border-border bg-surface-2/30 hover:bg-surface-2/60 transition-colors px-3 py-2.5" title={r.reason}>
              <div className="flex items-start gap-2.5">
                <span className={`shrink-0 mt-1 h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {r.codigo && <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-surface text-ink-faint shrink-0">{r.codigo}</span>}
                    <span className="truncate text-[13px] text-ink font-medium max-w-[260px]" title={r.label}>{r.label}</span>
                    {r.perfil && <span className="text-[10px] text-ink-faint shrink-0 tabular-nums">{r.perfil.emoji} {r.perfil.pct}%</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="relative h-2.5 rounded-full bg-surface overflow-hidden shrink-0" style={{ width: `${barW}%` }}
                         title={`${r.total} leads · ${r.qualifPct.toFixed(0)}% qualificaram p/ Branorte`}>
                      <div className={`absolute inset-y-0 left-0 rounded-full ${tone.fill}`} style={{ width: `${Math.min(100, r.qualifPct)}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-ink-faint shrink-0">{r.total} leads · <span className="text-ink-muted">{r.qualifPct.toFixed(0)}% qualif</span></span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${vm.cls}`}>{vm.emoji} {vm.label}</span>
                  <div className="text-[10px] text-ink-faint tabular-nums mt-0.5">score {r.score}</div>
                </div>
              </div>
              {/* chips de métrica */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] pl-5 tabular-nums">
                <span className={r.engajouPct >= 45 ? 'text-success' : r.engajouPct >= 30 ? 'text-warning' : 'text-danger'}>{r.engajouPct.toFixed(0)}% respondeu</span>
                {(r.followUp > 0 || r.leadQuente > 0) && (
                  <span className="text-ink-muted">{r.followUp} follow · <span className={r.leadQuente > 0 ? 'text-success font-semibold' : ''}>{r.leadQuente} quente</span></span>
                )}
                {(r.orcamento > 0 || r.vendido > 0) ? (
                  <span className="text-accent">
                    {[r.orcamento > 0 ? `${r.orcamento} orç` : null, r.vendido > 0 ? `${r.vendido} vd` : null].filter(Boolean).join(' · ')}
                    {r.vendido > 0 && r.valorVenda ? <span className="text-success"> · R$ {Math.round(r.valorVenda / 1000)}k</span> : null}
                  </span>
                ) : <span className="text-ink-faint">sem orç/venda</span>}
                {r.nf > 0 && <span className={r.nfPct >= 20 ? 'text-danger font-semibold' : 'text-warning'}>🚩 {r.nfPct.toFixed(0)}% não fab.</span>}
              </div>
            </div>
          )
        })}
      </div>

      {ocultos > 0 && !verTudo && (
        <button onClick={() => setVerTudo(true)} className="w-full text-[12px] text-accent hover:text-accent/80 border border-dashed border-border rounded-lg py-1.5">
          + {ocultos} {noun} (menor volume) ↓
        </button>
      )}
      {verTudo && rows.length > TOP && (
        <button onClick={() => setVerTudo(false)} className="w-full text-[12px] text-ink-faint hover:text-ink-muted py-1">Mostrar só o top {TOP} ↑</button>
      )}

      <div className="text-[11px] text-ink-faint pt-1 space-y-1 whitespace-normal leading-relaxed">
        <p><strong className="text-ink-muted">Barra</strong> = volume de leads (quanto maior, mais lead o {primeiraColuna.toLowerCase()} trouxe); <strong className="text-ink-muted">preenchimento</strong> = % que qualificou p/ Branorte; <strong className="text-ink-muted">cor</strong> = veredito. Barra longa e verde = escalar verba; barra longa e vermelha = verba queimada, cortar.</p>
        <p>🟢 escalar · 🔴 pausar · 🟠 ajustar ângulo/segmentação · 🟡 manter · ⚪ amostra &lt;{AMOSTRA_MIN} leads · ⚫ sem atribuição. Orç/Venda são REAIS (casados pelo telefone do lead, não pela etiqueta). Passe o mouse na faixa pra ver o porquê do veredito.</p>
      </div>
    </div>
  )
}

function sortFunil(a: FunilRow, b: FunilRow): number {
  // Do MELHOR pro PIOR: maior score primeiro (escalar no topo → pausar embaixo).
  // O score já correlaciona com o veredito. Empate vai pelo volume de leads.
  if (b.score !== a.score) return b.score - a.score
  return b.total - a.total
}

function VereditoInvestimento({
  criativos,
  etq,
  real,
}: {
  criativos: { codigo: string; nome: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number }[]
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
  real?: Map<string, OrcVendaAttr>
}) {
  if (!criativos.length) return <p className="text-sm text-ink-faint">Nenhum criativo registrado.</p>
  const etqByCodigo = new Map((etq?.por_criativo ?? []).map(c => [c.codigo, c]))

  const rows: FunilRow[] = criativos.map(c => {
    const e = etqByCodigo.get(c.codigo)
    // Orç/Venda REAIS (match por telefone) substituem a contagem por etiqueta. Enquanto
    // o mapa não carregou, cai pra etiqueta pra não piscar zerado.
    const r = real?.get(c.codigo)
    const vendido = real ? (r?.venda ?? 0) : (e?.vendido ?? 0)
    const orcamento = real ? (r?.orc ?? 0) : (e?.orcamento ?? 0)
    const valorVenda = r?.valor ?? 0
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
      conv, vendido, orcamento, valorVenda, real: !!real, convPct, nf, nfPct,
      verdict, score, reason: reasonFor(reasonKey, vi),
    }
  }).sort(sortFunil)

  return <FunilTable rows={rows} primeiraColuna="Criativo" semEtq={!etq || etq.por_criativo.length === 0} />
}

function VereditoOrigem({
  origens,
  etq,
  real,
}: {
  origens: { origem: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number; orcamentos: number; vendidos: number }[]
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
  real?: Map<string, OrcVendaAttr>
}) {
  if (!origens.length) return <p className="text-sm text-ink-faint">Nenhuma origem registrada.</p>
  // Junta por origem CRUA (mesma string em ambas as fontes — leem apc.origem)
  const etqByOrigem = new Map((etq?.por_origem ?? []).map(o => [o.origem, o]))

  const rows: FunilRow[] = origens
    .filter(o => o.total >= 3) // tira ruído de origens com 1-2 leads
    .map(o => {
      const e = etqByOrigem.get(o.origem)
      // Orç/Venda REAIS (match por telefone) no lugar da etiqueta.
      const rl = real?.get(o.origem)
      const vendido = real ? (rl?.venda ?? 0) : (e?.vendido ?? 0)
      const orcamento = real ? (rl?.orc ?? 0) : (e?.orcamento ?? 0)
      const valorVenda = rl?.valor ?? 0
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
        conv, vendido, orcamento, valorVenda, real: !!real, convPct, nf, nfPct,
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

// 2º mapa: leads em negociação (follow-up/quente/orçamento) por estado — laranja
// pra distinguir de "volume de leads" (verde). Mostra mapa + top estados compacto.
function NegociacaoGeo({ items }: { items: { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }[] }) {
  const max = Math.max(...items.map(i => i.total), 1)
  const top = items.slice(0, 12)
  return (
    <div className="space-y-3">
      <Suspense fallback={<div className="h-[330px] grid place-items-center text-[12px] text-ink-faint">Carregando mapa…</div>}>
        <MapaBrasilLeads items={items} hue={32} />
      </Suspense>
      <div className="flex items-center gap-2 text-[10px] text-ink-faint border-b border-border/50 pb-3">
        <span>Menos</span>
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(32 62% 56%)' }} />
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(32 62% 44%)' }} />
        <span className="h-2.5 w-6 rounded-sm" style={{ background: 'hsl(32 62% 30%)' }} />
        <span>Mais em negociação</span>
        <span className="ml-auto">Estado atual da etiqueta (ignora o período)</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0.5">
        {top.map(item => (
          <div key={item.uf} className="grid grid-cols-[36px_1fr_44px_44px] items-center gap-2 text-[11px] py-1">
            <span className="font-mono text-ink-faint">{item.uf}</span>
            <div className="min-w-0">
              <div className="text-ink truncate mb-1">{item.nome}</div>
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max((item.total / max) * 100, 3)}%`, background: 'hsl(32 80% 50%)' }} />
              </div>
            </div>
            <span className="text-right font-mono tabular-nums text-ink">{item.total}</span>
            <span className="text-right font-mono tabular-nums text-ink-faint">{item.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
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

function CicloVenda({ ciclo }: { ciclo?: CicloVendaData }) {
  if (!ciclo) return null
  const MIN_N = 8   // corte de amostra: com menos casos a mediana não é confiável → "—"
  const stages = [
    { label: 'Lead chega → 1ª etiqueta', n: ciclo.n_chegada, value: ciclo.n_chegada >= MIN_N ? ciclo.chegada_1a_etq_horas : null, unit: 'h', target: 4, desc: 'SLA: classificar em <4h' },
    { label: 'Lead → orçamento enviado', n: ciclo.n_orcamento, value: ciclo.n_orcamento >= MIN_N ? ciclo.lead_orcamento_dias : null, unit: 'd', target: 3, desc: 'Data real do orçamento gerado' },
    { label: 'Orçamento → vendido', n: ciclo.n_orc_vendido, value: ciclo.n_orc_vendido >= MIN_N ? ciclo.orcamento_vendido_dias : null, unit: 'd', target: 7, desc: 'Mesma coorte (orçou E vendeu)' },
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
              <p className="text-[10.5px] text-ink-faint mt-0.5">{s.desc}{s.n > 0 && ` · ${s.n} casos`}</p>
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

// Órfãos parados >7d por vendedor — 3 baldes: novo, prospecção e sem etiqueta nenhuma
function LeadsOrfaosVendedor({ orfaos }: { orfaos: OrfaosPorVendedor }) {
  const max = Math.max(...orfaos.por_vendedor.map(v => v.n), 1)
  const CORES = { novo: 'hsl(217 91% 60%)', prospeccao: 'hsl(38 92% 50%)', sem: 'hsl(0 60% 55%)' }
  const totSem = orfaos.por_vendedor.reduce((s, v) => s + (v.sem_etiqueta || 0), 0)
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <Ghost className="h-6 w-6 text-warning self-center" />
        <span className="text-[32px] leading-none font-bold text-warning tabular-nums">{fmtN(orfaos.total)}</span>
        <span className="text-[12px] text-ink-muted">leads parados há +7 dias sem evoluir</span>
      </div>
      {/* Legenda dos baldes — ordem do funil: Prospecção → Novo lead → Sem etiqueta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-3 text-[10px] text-ink-muted">
        <span><span className="inline-block h-2 w-2 rounded-sm mr-1 align-middle" style={{ background: CORES.prospeccao }} />Prospecção/tentativa</span>
        <span><span className="inline-block h-2 w-2 rounded-sm mr-1 align-middle" style={{ background: CORES.novo }} />Novo lead</span>
        <span><span className="inline-block h-2 w-2 rounded-sm mr-1 align-middle" style={{ background: CORES.sem }} />Sem etiqueta nenhuma <b className="text-danger tabular-nums">{fmtN(totSem)}</b></span>
      </div>
      <div className="space-y-1.5">
        {orfaos.por_vendedor.map(v => (
          <Link
            key={v.vendedor}
            to={`/atendimentos?responsavel=${encodeURIComponent(capitalizar(v.vendedor))}`}
            className="grid grid-cols-[110px_1fr_92px] items-center gap-2 text-[12px] group"
            title="Abrir atendimentos deste vendedor"
          >
            <span className="truncate text-ink capitalize group-hover:text-accent">{v.vendedor.toLowerCase()}</span>
            <div className="flex h-2.5 bg-surface-2 rounded-full overflow-hidden" style={{ width: `${Math.max((v.n / max) * 100, 4)}%` }}>
              {v.prospeccao > 0 && <div style={{ width: `${(v.prospeccao / v.n) * 100}%`, background: CORES.prospeccao }} title={`Prospecção: ${v.prospeccao}`} />}
              {v.novo > 0 && <div style={{ width: `${(v.novo / v.n) * 100}%`, background: CORES.novo }} title={`Novo: ${v.novo}`} />}
              {v.sem_etiqueta > 0 && <div style={{ width: `${(v.sem_etiqueta / v.n) * 100}%`, background: CORES.sem }} title={`Sem etiqueta: ${v.sem_etiqueta}`} />}
            </div>
            <span className="text-right font-mono tabular-nums text-ink whitespace-nowrap">
              {v.n} <span className="text-[10px] text-ink-faint">({v.prospeccao}/{v.novo}/{v.sem_etiqueta})</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint pt-2.5">
        Travados há +7 dias antes da negociação (número = <b>prospecção / novo / sem etiqueta</b>). Prospecção e novo lead = o vendedor até etiquetou mas parou aí; <b>sem etiqueta</b> é o pior — nem foi registrado. Cobrar o próximo passo de quem está no topo.
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
