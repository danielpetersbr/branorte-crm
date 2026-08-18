import { Fragment, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp,
  CircleDashed, Info, Minus, Pause, Search, TrendingUp, Unlink, Wrench,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { useDashboard } from '@/hooks/useDashboard'
import { useDashboardEtiquetas, type DashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import {
  useDashboardOrcVendaPorCriativo,
  useDashboardOrcVendaPorOrigem,
  type OrcVendaAttr,
} from '@/hooks/useDashboardOrcamentos'
import {
  useMotivosPorFonte, MOTIVO_LABELS, type MotivoFonte, type MotivoKey,
} from '@/hooks/useMotivosPorFonte'

import { Card, CardHeader, Inner } from './ui/Card'
import { JanelaBadge } from './ui/JanelaBadge'
import { CHART, CHART_SERIE, TOOLTIP_STYLE } from './ui/chart-tokens'
import { brl, n, pct } from './ui/format'
import { useJanela } from './DashboardFilterContext'

// ============================================================================
// ABA MARKETING — "pra onde vai ou corta a verba?"
//
// O que mudou em relação à seção "Onde investir" do dashboard antigo:
//  1. Um RESUMO no topo responde a pergunta em 4 números. O detalhe fica abaixo,
//     em tabela — antes tudo chegava junto, em faixas soltas, sem hierarquia.
//  2. O veredito passou a mostrar o CRITÉRIO. Ele já era calculado por regra
//     (classifyVerdict), mas a regra vivia só no comentário do código: na tela
//     saía "Pausar" sem dizer por quê. Agora cada linha abre o motivo, e o rodapé
//     lista a régua inteira, na ordem em que ela é aplicada.
//  3. Origem (canal) vem ANTES de criativo: canal é a decisão macro de verba.
// ============================================================================

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
const ESCALAR_MIN = 68
const vClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type VerdictKey = 'escalar' | 'manter' | 'otimizar' | 'pausar' | 'amostra' | 'excluir'

type LucideIcon = typeof TrendingUp

const VERDICT_META: Record<VerdictKey, {
  label: string
  Icon: LucideIcon
  /** pill do badge */
  cls: string
  /** preenchimento da barra de proporção */
  fill: string
  rank: number
}> = {
  escalar:  { label: 'Escalar',         Icon: TrendingUp,    cls: 'text-success border-success/40 bg-success-bg',   fill: 'bg-success',        rank: 0 },
  pausar:   { label: 'Pausar',          Icon: Pause,         cls: 'text-danger border-danger/40 bg-danger-bg',      fill: 'bg-danger',         rank: 1 },
  otimizar: { label: 'Otimizar',        Icon: Wrench,        cls: 'text-warning border-warning/40 bg-warning-bg',   fill: 'bg-warning',        rank: 2 },
  manter:   { label: 'Manter',          Icon: Minus,         cls: 'text-ink-muted border-border bg-surface-2',      fill: 'bg-ink-muted',      rank: 3 },
  amostra:  { label: 'Amostra pequena', Icon: CircleDashed,  cls: 'text-ink-faint border-border bg-surface-2',      fill: 'bg-ink-faint',      rank: 4 },
  excluir:  { label: 'Sem atribuição',  Icon: Unlink,        cls: 'text-ink-faint border-border bg-surface-2',      fill: 'bg-ink-faint/50',   rank: 5 },
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
  if (s >= ESCALAR_MIN) return mk('escalar', s, 'escalar')
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

// Emoji de espécie é CONTEÚDO (o que o produtor cria), não decoração.
function perfilCliente(c: { bovinos: number; suinos: number; aves: number }): { label: string; emoji: string; pct: number } | null {
  const classificados = c.bovinos + c.suinos + c.aves
  if (classificados === 0) return null
  const ranked: [string, string, number][] = [
    ['Bovinos', '🐂', c.bovinos],
    ['Suínos', '🐖', c.suinos],
    ['Aves', '🐔', c.aves],
  ]
  ranked.sort((a, b) => b[2] - a[2])
  const [label, emoji, num] = ranked[0]
  return { label, emoji, pct: Math.round((num / classificados) * 100) }
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

type Fonte = 'origem' | 'criativo'
type RowComFonte = FunilRow & { fonte: Fonte }

// ---------------------------------------------------------------------------
// Montagem das linhas — cálculo idêntico ao VereditoInvestimento/VereditoOrigem
// ---------------------------------------------------------------------------

type CriativoBruto = { codigo: string; nome: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number }
type OrigemBruta = { origem: string; total: number; qualificados: number; ctr: number; engajou: number; bovinos: number; suinos: number; aves: number; orcamentos: number; vendidos: number }

function linhasDeCriativos(
  criativos: CriativoBruto[],
  etq: DashboardEtiquetas | undefined,
  real: Map<string, OrcVendaAttr> | undefined,
): FunilRow[] {
  const etqByCodigo = new Map((etq?.por_criativo ?? []).map(c => [c.codigo, c]))
  return criativos.map(c => {
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
  })
}

function linhasDeOrigens(
  origens: OrigemBruta[],
  etq: DashboardEtiquetas | undefined,
  real: Map<string, OrcVendaAttr> | undefined,
): FunilRow[] {
  // Junta por origem CRUA (mesma string em ambas as fontes — leem apc.origem)
  const etqByOrigem = new Map((etq?.por_origem ?? []).map(o => [o.origem, o]))
  return origens
    .filter(o => o.total >= 3) // tira ruído de origens com 1-2 leads
    .map(o => {
      const e = etqByOrigem.get(o.origem)
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
    })
}

// ---------------------------------------------------------------------------
// Tabela — cabeçalho fixo, ordenação por coluna, busca, "mostrar mais"
// ---------------------------------------------------------------------------

type SortKey = 'label' | 'total' | 'engajouPct' | 'qualifPct' | 'nfPct' | 'conv' | 'score' | 'verdict'
type SortDir = 'asc' | 'desc'

const COLUNAS: { key: SortKey; label: string; align: 'left' | 'right'; ajuda: string }[] = [
  { key: 'label',      label: 'Fonte',      align: 'left',  ajuda: 'Nome do canal ou do criativo. A barra mostra o volume de leads em relação ao maior da lista.' },
  { key: 'total',      label: 'Leads',      align: 'right', ajuda: 'Leads atribuídos no período.' },
  { key: 'engajouPct', label: 'Respondeu',  align: 'right', ajuda: 'Parte dos leads que respondeu à IA. Abaixo de 25% o veredito é Pausar.' },
  { key: 'qualifPct',  label: 'Qualificou', align: 'right', ajuda: 'Parte que quer algo que a Branorte fabrica (IA qualificou OU o vendedor moveu no funil). Abaixo de 20% o veredito é Otimizar.' },
  { key: 'nfPct',      label: 'Errado',     align: 'right', ajuda: 'Parte que pediu o que NÃO fabricamos. 20% já é vazamento; 35% ou mais é Pausar.' },
  { key: 'conv',       label: 'Orç · Venda', align: 'right', ajuda: 'Orçamentos e vendas casados pelo telefone do lead (não pela etiqueta do vendedor).' },
  { key: 'score',      label: 'Score',      align: 'right', ajuda: 'Qualidade do lead de 0 a 100: 50% qualificou + 35% respondeu + 15% penalidade de "errado", com bônus pequeno por funil/venda.' },
  { key: 'verdict',    label: 'Veredito',   align: 'right', ajuda: 'Decisão de verba. Clique no veredito da linha pra ver o critério que o gerou.' },
]

function ordenar(rows: FunilRow[], key: SortKey, dir: SortDir): FunilRow[] {
  const sinal = dir === 'asc' ? 1 : -1
  const num = (r: FunilRow): number => {
    switch (key) {
      case 'verdict': return VERDICT_META[r.verdict].rank
      case 'total': return r.total
      case 'engajouPct': return r.engajouPct
      case 'qualifPct': return r.qualifPct
      case 'nfPct': return r.nfPct
      case 'conv': return r.conv
      default: return r.score
    }
  }
  return [...rows].sort((a, b) => {
    if (key === 'label') {
      const c = a.label.localeCompare(b.label, 'pt-BR')
      if (c !== 0) return sinal * c
      return b.score - a.score
    }
    const d = num(a) - num(b)
    if (d !== 0) return sinal * d
    // Empate sempre resolve do melhor pro pior, depois pelo volume.
    if (b.score !== a.score) return b.score - a.score
    return b.total - a.total
  })
}

function ThOrdenavel({
  col, sortKey, sortDir, onSort,
}: {
  col: (typeof COLUNAS)[number]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
}) {
  const ativo = sortKey === col.key
  const ariaSort: 'ascending' | 'descending' | 'none' = ativo ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  const Icon = ativo ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`sticky top-0 z-10 border-b border-border bg-surface-2 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(col.key)}
        title={col.ajuda}
        aria-label={`Ordenar por ${col.label}`}
        className={[
          'flex w-full min-h-[44px] items-center gap-1 px-3 py-2 text-micro whitespace-nowrap',
          ativo ? 'text-ink' : 'text-ink-muted hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          col.align === 'right' ? 'justify-end' : 'justify-start',
        ].join(' ')}
      >
        <span>{col.label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${ativo ? 'text-accent' : 'text-ink-faint'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

function VeredictoBadge({ verdict }: { verdict: VerdictKey }) {
  const m = VERDICT_META[verdict]
  const Icon = m.Icon
  return (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{m.label}</span>
    </>
  )
}

function TabelaFonte({
  rows,
  fonte,
  vazio,
}: {
  rows: FunilRow[]
  fonte: Fonte
  vazio: string
}) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(10)
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set())

  const singular = fonte === 'origem' ? 'canal' : 'criativo'
  const plural = fonte === 'origem' ? 'canais' : 'criativos'

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const base = q
      ? rows.filter(r => r.label.toLowerCase().includes(q) || (r.codigo ?? '').toLowerCase().includes(q))
      : rows
    return ordenar(base, sortKey, sortDir)
  }, [rows, busca, sortKey, sortDir])

  const maxTotal = useMemo(() => Math.max(1, ...rows.map(r => r.total)), [rows])
  const somaLeads = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows])
  const visiveis = filtradas.slice(0, limite)
  const restantes = filtradas.length - visiveis.length

  function aoOrdenar(k: SortKey) {
    if (k === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      // Texto começa A→Z; número começa do maior.
      setSortDir(k === 'label' ? 'asc' : 'desc')
    }
  }

  function alternar(key: string) {
    setAbertas(prev => {
      const nx = new Set(prev)
      if (nx.has(key)) nx.delete(key)
      else nx.add(key)
      return nx
    })
  }

  if (rows.length === 0) return <p className="text-body text-ink-faint">{vazio}</p>

  return (
    <div className="space-y-3">
      {/* Busca + contagem */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input
            type="search"
            value={busca}
            onChange={e => { setBusca(e.target.value); setLimite(10) }}
            placeholder={`Buscar ${singular}…`}
            aria-label={`Buscar ${singular}`}
            className="w-full min-h-[44px] rounded-lg border border-border bg-surface-2 pl-10 pr-3 text-body text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <span className="text-micro tabular-nums text-ink-faint">
          {n(visiveis.length)} de {n(filtradas.length)} {plural}
        </span>
      </div>

      {/* A tabela rola DENTRO deste container — a página nunca rola na horizontal */}
      <div className="max-h-[70vh] overflow-x-auto overflow-y-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] border-separate border-spacing-0">
          <caption className="sr-only">
            Decisão de verba por {singular}: volume de leads, qualidade e veredito. Colunas ordenáveis.
          </caption>
          <thead>
            <tr>
              {COLUNAS.map(col => (
                <ThOrdenavel key={col.key} col={col} sortKey={sortKey} sortDir={sortDir} onSort={aoOrdenar} />
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={COLUNAS.length} className="px-3 py-5 text-center text-body text-ink-faint">
                  Nenhum resultado para “{busca}”.
                </td>
              </tr>
            )}
            {visiveis.map(r => {
              const meta = VERDICT_META[r.verdict]
              const aberta = abertas.has(r.key)
              const barW = Math.max(4, Math.round((r.total / maxTotal) * 100))
              const share = somaLeads > 0 ? (r.total / somaLeads) * 100 : 0
              return (
                <Fragment key={r.key}>
                  <tr className="align-middle hover:bg-surface-2/60">
                    {/* Fonte + barra de proporção inline */}
                    <td className="border-b border-border px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {r.codigo && (
                          <span className="shrink-0 rounded-sm bg-surface-3 px-2 py-1 font-mono text-micro text-ink-muted">{r.codigo}</span>
                        )}
                        <span className="truncate text-label text-ink" title={r.label}>{r.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 w-[160px] shrink-0 overflow-hidden rounded-full bg-surface-3">
                          <div className={`h-full rounded-full ${meta.fill}`} style={{ width: `${barW}%` }} />
                        </div>
                        <span className="text-micro tabular-nums text-ink-faint">{pct(share, 0)} dos leads</span>
                      </div>
                    </td>

                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums text-ink">{n(r.total)}</td>
                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums text-ink-muted">{pct(r.engajouPct, 0)}</td>
                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums text-ink-muted">{pct(r.qualifPct, 0)}</td>

                    {/* "Errado" ganha ícone quando passa do limiar — nunca só cor */}
                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums">
                      {r.nf === 0 ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 ${r.nfPct >= 20 ? 'text-danger' : 'text-ink-muted'}`}>
                          {r.nfPct >= 20 && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          {pct(r.nfPct, 0)}
                        </span>
                      )}
                    </td>

                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums whitespace-nowrap">
                      {r.orcamento === 0 && r.vendido === 0 ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <span className="text-ink-muted">
                          {n(r.orcamento)} orç · <span className={r.vendido > 0 ? 'text-success' : ''}>{n(r.vendido)} vd</span>
                          {r.vendido > 0 && !!r.valorVenda && <span className="text-ink-faint"> · {brl(r.valorVenda)}</span>}
                        </span>
                      )}
                    </td>

                    <td className="border-b border-border px-3 py-2 text-right text-micro tabular-nums text-ink">{r.score}</td>

                    <td className="border-b border-border px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => alternar(r.key)}
                        aria-expanded={aberta}
                        aria-label={`${meta.label}: ${r.label}. ${aberta ? 'Esconder' : 'Ver'} o critério.`}
                        title={r.reason}
                        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 py-2 text-micro ${meta.cls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                      >
                        <VeredictoBadge verdict={r.verdict} />
                        {aberta
                          ? <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      </button>
                    </td>
                  </tr>

                  {aberta && (
                    <tr className="bg-surface-2">
                      <td colSpan={COLUNAS.length} className="border-b border-border px-3 py-3">
                        <div className="flex items-start gap-2">
                          <Info className="mt-1 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                          <div className="min-w-0 space-y-1">
                            <p className="text-body text-ink">{r.reason}</p>
                            <p className="text-micro tabular-nums text-ink-faint">
                              score {r.score}/100 · {n(r.total)} leads · {pct(r.engajouPct, 0)} respondeu · {pct(r.qualifPct, 0)} qualificou · {pct(r.nfPct, 0)} não fabricamos
                              {r.followUp + r.leadQuente > 0 && ` · ${n(r.followUp)} follow-up · ${n(r.leadQuente)} quente`}
                              {r.perfil && ` · perfil ${r.perfil.emoji} ${r.perfil.label} ${r.perfil.pct}%`}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mostrar mais progressivo */}
      {restantes > 0 && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setLimite(l => l + 10)}
            className="min-h-[44px] flex-1 rounded-lg border border-dashed border-border px-3 py-2 text-label text-accent hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Mostrar mais {Math.min(10, restantes)} ({n(restantes)} {plural} restantes)
          </button>
          <button
            type="button"
            onClick={() => setLimite(filtradas.length)}
            className="min-h-[44px] rounded-lg border border-border px-3 py-2 text-label text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Mostrar todos
          </button>
        </div>
      )}
      {restantes === 0 && limite > 10 && filtradas.length > 10 && (
        <button
          type="button"
          onClick={() => setLimite(10)}
          className="min-h-[44px] w-full rounded-lg border border-border px-3 py-2 text-label text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Mostrar só os 10 primeiros
        </button>
      )}

      <CriterioVeredito fonte={fonte} />
    </div>
  )
}

/**
 * A régua do veredito, exposta. Era exatamente isto que faltava: o julgamento
 * saía na tela sem dizer de onde vinha.
 */
function CriterioVeredito({ fonte }: { fonte: Fonte }) {
  const regras: { verdict: VerdictKey; quando: string }[] = [
    ...(fonte === 'origem'
      ? [{ verdict: 'excluir' as VerdictKey, quando: 'origem sem canal identificável (Não identificou, Direto, Outros) — corrigir rastreio, não decidir verba' }]
      : []),
    { verdict: 'amostra',  quando: `menos de ${AMOSTRA_MIN} leads — sinal fraco demais pra julgar` },
    { verdict: 'pausar',   quando: 'respondeu abaixo de 25%, OU 35% ou mais pedindo o que não fabricamos' },
    { verdict: 'otimizar', quando: 'qualificou abaixo de 20%, OU entre 20% e 35% pedindo o que não fabricamos' },
    { verdict: 'escalar',  quando: `score ${ESCALAR_MIN} ou mais` },
    { verdict: 'manter',   quando: 'score entre 48 e 67 — ou muito volume qualificado sem fechar (aí o gargalo é o vendedor, não a mídia)' },
    { verdict: 'otimizar', quando: 'score abaixo de 48' },
  ]
  return (
    <details className="rounded-lg border border-border bg-surface-2">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-label text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        Como o veredito é decidido
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <p className="text-micro text-ink-muted">
          A régua roda de cima pra baixo e o <strong className="text-ink">primeiro caso que bater vence</strong>:
        </p>
        <ol className="space-y-2">
          {regras.map((r, i) => {
            const m = VERDICT_META[r.verdict]
            const Icon = m.Icon
            return (
              <li key={`${r.verdict}-${i}`} className="flex items-start gap-2">
                <span className="w-4 shrink-0 text-micro tabular-nums text-ink-faint">{i + 1}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-micro ${m.cls}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {m.label}
                </span>
                <span className="min-w-0 text-micro text-ink-muted">{r.quando}</span>
              </li>
            )
          })}
        </ol>
        <p className="text-micro text-ink-faint">
          <strong className="text-ink-muted">Score (0-100)</strong> = 50% qualificou + 35% respondeu + 15% de penalidade por “não fabricamos”, mais um bônus de até 10 pontos por follow-up, lead quente, orçamento e venda.
          Conversão nunca dispara veredito sozinha — só soma no bônus, senão um único orçamento escalava criativo de amostra pequena.
        </p>
        <p className="text-micro text-ink-faint">
          <strong className="text-ink-muted">Orç · Venda</strong> vêm do casamento por telefone do lead, não da etiqueta do vendedor.
          <strong className="text-ink-muted"> Respondeu</strong> e <strong className="text-ink-muted">Qualificou</strong> vêm da IA; “Errado”, follow-up e quente vêm das etiquetas do WhatsApp.
        </p>
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Resumo de topo — a resposta em 4 números
// ---------------------------------------------------------------------------

function ListaDecisao({
  titulo,
  Icon,
  iconCls,
  tone,
  rows,
  vazio,
  nota,
}: {
  titulo: string
  Icon: LucideIcon
  iconCls: string
  tone: 'positivo' | 'perigo'
  rows: RowComFonte[]
  vazio: string
  nota?: string
}) {
  return (
    <Inner tone={tone} className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconCls}`} aria-hidden="true" />
        <h4 className="text-label text-ink">{titulo}</h4>
      </div>
      {rows.length === 0 ? (
        <p className="text-micro text-ink-faint">{vazio}</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const m = VERDICT_META[r.verdict]
            const MIcon = m.Icon
            return (
              <li key={`${r.fonte}-${r.key}`} className="flex items-start gap-2">
                <span className="w-4 shrink-0 text-micro tabular-nums text-ink-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-sm border border-border bg-surface px-2 py-1 text-micro text-ink-muted">
                      {r.fonte === 'origem' ? 'Canal' : 'Criativo'}
                    </span>
                    <span className="truncate text-label text-ink" title={r.label}>{r.label}</span>
                    <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-micro ${m.cls}`} title={r.reason}>
                      <MIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {m.label}
                    </span>
                  </div>
                  <p className="mt-1 text-micro tabular-nums text-ink-faint">
                    {n(r.total)} leads · {pct(r.qualifPct, 0)} qualificou · {pct(r.engajouPct, 0)} respondeu · score {r.score}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {nota && <p className="text-micro text-ink-faint">{nota}</p>}
    </Inner>
  )
}

function MiniKpi({
  rotulo, valor, apoio, periodoLabel, tone,
}: {
  rotulo: string
  valor: string
  apoio: string
  periodoLabel: string
  tone?: 'neutro' | 'atencao'
}) {
  return (
    <Inner tone={tone ?? 'neutro'} className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-label text-ink-muted">{rotulo}</span>
        <JanelaBadge tipo="periodo" label={periodoLabel} />
      </div>
      <p className="text-kpi-sm tabular-nums text-ink">{valor}</p>
      <p className="text-micro text-ink-faint">{apoio}</p>
    </Inner>
  )
}

// ---------------------------------------------------------------------------
// TOP 10 — quem gera orçamento e venda (ranking por VOLUME REAL)
//
// Portado do Dashboard de produção (bloco `TopFontesOrcamento`). As tabelas de
// veredito abaixo ordenam por QUALIDADE (score), então quem traz mais orçamento
// fica espalhado no meio da lista. Este ranking responde a outra pergunta —
// "de onde saem os orçamentos e o dinheiro?" — pelo VOLUME REAL: orçamento
// montado casado pelo telefone do lead + pedido não-cancelado (R$). Mesma fonte
// (dashboard_orcvenda_por_criativo/_por_origem), só reordenada.
//
// A conta (buildRank/rankSorter) veio intocada da produção; o que mudou foi só a
// camada visual — escala tipográfica de 6 degraus, tokens de cor, alvo de toque
// de 44px e o troféu do título, que virou texto.
// ---------------------------------------------------------------------------
const TOP_RANK = 10
type RankMetric = 'orc' | 'valor'

interface RankRow {
  key: string
  codigo?: string
  label: string
  leads: number | null   // null = fonte fora do recorte de volume do dashboard
  orc: number
  venda: number
  valor: number
  semAtribuicao: boolean // balde "Não identificou": conta, mas não dá pra investir nele
}

type RankMeta = { label: string; codigo?: string; leads: number }

const SEM_ATRIB_RE = /não identific|nao identific|sem origem|desconhec/i

/** Ordena o mapa real (orç/venda por chave) e enriquece com nome + volume de leads. */
function buildRank(
  real: Map<string, OrcVendaAttr> | undefined,
  meta: Map<string, RankMeta>,
  excluir?: (key: string) => boolean,
): { rows: RankRow[]; foraQtd: number; foraOrc: number; foraValor: number } {
  const rows: RankRow[] = []
  let foraQtd = 0, foraOrc = 0, foraValor = 0
  for (const [key, v] of real ?? new Map()) {
    if (v.orc === 0 && v.venda === 0) continue
    if (excluir?.(key)) { foraQtd++; foraOrc += v.orc; foraValor += v.valor; continue }
    const m = meta.get(key)
    rows.push({
      key,
      codigo: m?.codigo,
      label: m?.label || key,
      leads: m ? m.leads : null,
      orc: v.orc, venda: v.venda, valor: v.valor,
      semAtribuicao: SEM_ATRIB_RE.test(key),
    })
  }
  return { rows, foraQtd, foraOrc, foraValor }
}

function rankSorter(metric: RankMetric) {
  return (a: RankRow, b: RankRow) =>
    metric === 'valor'
      ? (b.valor - a.valor) || (b.venda - a.venda) || (b.orc - a.orc)
      : (b.orc - a.orc) || (b.valor - a.valor)
}

/** Faixa da taxa lead→orçamento. Cor NUNCA sozinha: vem com ícone e com o motivo no title. */
function faixaTaxa(taxa: number): { cls: string; Icon: LucideIcon | null; hint: string } {
  if (taxa >= 4) return {
    cls: 'text-success', Icon: TrendingUp,
    hint: 'Taxa boa: 4% ou mais dos leads desta fonte viraram orçamento.',
  }
  if (taxa >= 1.5) return {
    cls: 'text-ink-muted', Icon: null,
    hint: 'Taxa mediana: entre 1,5% e 4% dos leads desta fonte viraram orçamento.',
  }
  return {
    cls: 'text-warning', Icon: AlertTriangle,
    hint: 'Taxa baixa: menos de 1,5% dos leads desta fonte viraram orçamento — muito lead, pouca proposta.',
  }
}

function RankPanel({ titulo, rows, metric, nota }: {
  titulo: string
  rows: RankRow[]
  metric: RankMetric
  nota?: string
}) {
  const [verTudo, setVerTudo] = useState(false)
  const ordenadas = [...rows].sort(rankSorter(metric))
  const visiveis = verTudo ? ordenadas : ordenadas.slice(0, TOP_RANK)
  const ocultos = ordenadas.length - visiveis.length
  const valorDe = (r: RankRow) => (metric === 'valor' ? r.valor : r.orc)
  const max = Math.max(1, ...ordenadas.map(valorDe))
  const totOrc = rows.reduce((s, r) => s + r.orc, 0)
  const totVenda = rows.reduce((s, r) => s + r.venda, 0)
  const totValor = rows.reduce((s, r) => s + r.valor, 0)

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h4 className="text-label text-ink">{titulo}</h4>
        <span className="shrink-0 whitespace-nowrap text-micro tabular-nums text-ink-faint">
          {n(totOrc)} orç · {n(totVenda)} vd · {brl(totValor)}
        </span>
      </div>

      {ordenadas.length === 0 ? (
        <p className="text-body text-ink-faint">Nenhum orçamento atribuído no período.</p>
      ) : (
        /* O ranking rola DENTRO deste container — em 360px a página não vaza */
        <div className="overflow-x-auto">
          <ol className="space-y-3">
            {visiveis.map((r, i) => {
              const barPct = Math.max(1.5, (valorDe(r) / max) * 100)
              // Fatia que virou VENDA — subconjunto do orçamento (todo pedido nasce de um
              // orçamento), então cabe dentro da mesma barra. Piso de 3px pra 1 venda em 36
              // orçamentos não sumir; o número exato fica no rótulo ao lado.
              const vendaPct = metric === 'orc' && r.orc > 0 ? (r.venda / r.orc) * barPct : 0
              // Taxa só com amostra mínima: "1 lead → 1 orçamento = 100%" é ruído, não sinal.
              const taxa = r.leads && r.leads >= AMOSTRA_MIN ? (r.orc / r.leads) * 100 : null
              const faixa = taxa != null ? faixaTaxa(taxa) : null
              return (
                <li key={r.key}>
                  <div className="flex items-baseline gap-2">
                    <span className="w-4 shrink-0 text-right text-micro tabular-nums text-ink-faint">{i + 1}</span>
                    {r.codigo && (
                      <span className="shrink-0 rounded-sm bg-surface-3 px-2 py-1 font-mono text-micro text-ink-muted">{r.codigo}</span>
                    )}
                    <span className="truncate text-label text-ink" title={r.label}>{r.label}</span>
                    {r.semAtribuicao && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border px-2 py-1 text-micro text-ink-faint"
                        title="Lead chegou sem UTM/rastreio: entra na conta, mas não dá pra investir nem cortar. Ação: corrigir rastreamento."
                      >
                        <Unlink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        sem rastreio
                      </span>
                    )}
                    <span className="ml-auto shrink-0 whitespace-nowrap text-micro tabular-nums">
                      <span className="text-ink">{n(r.orc)}</span><span className="text-ink-faint"> orç</span>
                      {r.venda > 0 && (
                        <span className="text-success"> · {n(r.venda)} vd · {brl(r.valor)}</span>
                      )}
                    </span>
                  </div>
                  <div className="ml-6 mt-1 flex items-center gap-2">
                    <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-info" style={{ width: `${barPct}%` }} />
                      {vendaPct > 0 && (
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-success ring-2 ring-surface"
                          style={{ width: `${vendaPct}%`, minWidth: '3px' }}
                        />
                      )}
                    </div>
                    <span className="w-[150px] shrink-0 whitespace-nowrap text-right text-micro tabular-nums text-ink-faint">
                      {r.leads == null ? 'volume n/d' : `${n(r.leads)} lead${r.leads === 1 ? '' : 's'}`}
                      {taxa != null && faixa
                        ? <>
                            {' · '}
                            <span className={`inline-flex items-center gap-1 ${faixa.cls}`} title={faixa.hint}>
                              {faixa.Icon && <faixa.Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
                              {pct(taxa, 1)}
                            </span>
                          </>
                        : r.leads != null && (
                            <span title={`Menos de ${AMOSTRA_MIN} leads: a taxa ainda não significa nada.`}> · amostra</span>
                          )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {ocultos > 0 && !verTudo && (
        <button
          type="button"
          onClick={() => setVerTudo(true)}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-label text-accent hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Mostrar mais {n(ocultos)} com menos orçamento
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      )}
      {verTudo && ordenadas.length > TOP_RANK && (
        <button
          type="button"
          onClick={() => setVerTudo(false)}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-label text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Mostrar só o top {TOP_RANK}
          <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      )}
      {nota && <p className="mt-3 text-micro text-ink-faint">{nota}</p>}
    </div>
  )
}

function TopFontesOrcamento({ criativos, origens, realCriativo, realOrigem }: {
  criativos: { codigo: string; nome: string; total: number }[]
  origens: { origem: string; total: number }[]
  realCriativo?: Map<string, OrcVendaAttr>
  realOrigem?: Map<string, OrcVendaAttr>
}) {
  const [metric, setMetric] = useState<RankMetric>('orc')

  const metaCriativo = useMemo(
    () => new Map<string, RankMeta>(criativos.map(c => [c.codigo, { label: c.nome || c.codigo, codigo: c.codigo, leads: c.total }])),
    [criativos],
  )
  const metaOrigem = useMemo(
    () => new Map<string, RankMeta>(origens.map(o => [o.origem, { label: o.origem, leads: o.total }])),
    [origens],
  )
  const rc = useMemo(() => buildRank(realCriativo, metaCriativo), [realCriativo, metaCriativo])
  // WhatsApp de vendedor individual não é mídia paga — mesma exclusão do card de
  // origem ao lado. Não some calado: o rodapé diz quanto ficou de fora.
  const ro = useMemo(() => buildRank(realOrigem, metaOrigem, k => /^whatsapp\s/i.test(k)), [realOrigem, metaOrigem])

  if (!realCriativo && !realOrigem) {
    return <p className="text-body text-ink-faint">Carregando atribuição de orçamento…</p>
  }

  const notaOrigem = ro.foraQtd > 0
    ? `Fora da lista: ${ro.foraQtd} origem(ns) de WhatsApp de vendedor individual (${n(ro.foraOrc)} orç · ${brl(ro.foraValor)}) — é atendimento direto, não verba de mídia.`
    : undefined

  return (
    <div className="space-y-3">
      {/* Métrica do ranking: volume de orçamento (o que o time gera) ou R$ fechado. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {([['orc', 'Mais orçamento'], ['valor', 'Mais venda (R$)']] as [RankMetric, string][]).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              aria-pressed={metric === k}
              className={`min-h-[44px] px-3 py-2 text-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                metric === k ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:text-ink'
              }`}
            >
              {lab}
            </button>
          ))}
        </div>
        {/* Legenda: a cor nunca fala sozinha — o nome dela está escrito ao lado.
            E ela MUDA com a métrica: no modo "Mais venda (R$)" a barra inteira
            é R$ vendido e não existe trecho verde. Manter "verde = virou venda"
            ali seria a legenda mentindo sobre o que a barra está medindo. */}
        <ul className="flex flex-wrap items-center gap-3 text-micro text-ink-faint">
          {metric === 'valor' ? (
            <li className="inline-flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
              azul = R$ vendido pela fonte
            </li>
          ) : (
            <>
              <li className="inline-flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
                azul = orçamento
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
                verde = virou venda
              </li>
            </>
          )}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <RankPanel titulo="Por criativo (anúncio)" rows={rc.rows} metric={metric} />
        <RankPanel titulo="Por origem (canal)" rows={ro.rows} metric={metric} nota={notaOrigem} />
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-micro text-ink-faint">
          <strong className="text-ink-muted">Barra</strong> = {metric === 'valor' ? 'R$ vendido' : 'nº de orçamentos'} (a maior vira 100%)
          {metric === 'valor'
            ? '.'
            : <>; o trecho <span className="text-success">verde</span> é a parte que virou venda.</>}
          À direita: leads da fonte e <strong className="text-ink-muted">quantos % viraram orçamento</strong> — é aí que aparece o
          criativo que traz muito lead e pouco orçamento.
        </p>
        <p className="text-micro text-ink-faint">
          Contagem <strong className="text-ink-muted">real</strong>: orçamento montado casado pelo telefone do lead e pedido não-cancelado (orçamento→pedido) —
          não depende da etiqueta do WhatsApp. Respeita o filtro de período pela data de chegada do lead.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Motivos de fechamento por criativo / origem
// ---------------------------------------------------------------------------

function MotivosPorFonteView({ data }: { data: { por_criativo: MotivoFonte[]; por_origem: MotivoFonte[] } }) {
  const [fonte, setFonte] = useState<Fonte>('criativo')
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

  // Donut ao lado: proporção do motivo selecionado entre as fontes (top 5 + "outros").
  const totalMotivo = ranked.reduce((s, r) => s + r.n, 0)
  const donutTop = ranked.slice(0, 5).map((r, i) => ({ nome: labelDe(r.it), value: r.n, cor: CHART_SERIE[i % CHART_SERIE.length] }))
  const restoN = ranked.slice(5).reduce((s, r) => s + r.n, 0)
  const donutData = restoN > 0 ? [...donutTop, { nome: 'outros', value: restoN, cor: CHART.ink }] : donutTop

  return (
    <div className="space-y-3">
      {/* Controles: fonte + motivo + ordem */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {(['criativo', 'origem'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFonte(f)}
              aria-pressed={fonte === f}
              className={`min-h-[44px] px-3 py-2 text-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                fonte === f ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:text-ink'
              }`}
            >
              {f === 'criativo' ? 'Por criativo' : 'Por origem'}
            </button>
          ))}
        </div>
        <select
          value={motivo}
          onChange={e => setMotivo(e.target.value as MotivoKey)}
          aria-label="Motivo de fechamento"
          title="Motivo de fechamento"
          className="min-h-[44px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-label text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {MOTIVO_LABELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setPior(p => !p)}
          aria-label={pior ? 'Ordenado do pior para o melhor. Inverter.' : 'Ordenado do melhor para o pior. Inverter.'}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-label text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {pior ? <ArrowDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ArrowUp className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {pior ? 'Pior primeiro' : 'Melhor primeiro'}
        </button>
      </div>

      {ranked.length === 0 ? (
        <p className="text-body text-ink-faint">Sem dados no período — nenhum{fonte === 'criativo' ? ' criativo' : 'a origem'} com “{motivoLabel}”.</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_240px]">
          <ol className="space-y-2">
            {ranked.map((r, i) => {
              const cod = r.it.codigo
              const temNomeProprio = fonte === 'criativo' && !!cod && !!r.it.nome
              return (
                <li key={idDe(r.it)} className="grid grid-cols-[20px_1fr] items-center gap-2 sm:grid-cols-[20px_minmax(0,1fr)_110px_140px]">
                  <span className="text-micro tabular-nums text-ink-faint">{i + 1}</span>
                  <span className="min-w-0 truncate text-label text-ink" title={`${cod ? cod + ' · ' : ''}${labelDe(r.it)}`}>
                    {temNomeProprio && (
                      <span className="mr-2 rounded-sm bg-surface-3 px-2 py-1 align-middle font-mono text-micro text-ink-muted">{cod}</span>
                    )}
                    {labelDe(r.it)}
                  </span>
                  <div className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-3 sm:col-span-1">
                    <div className="h-full rounded-full bg-danger/70" style={{ width: `${(r.n / maxN) * 100}%` }} />
                  </div>
                  <span className="col-span-2 whitespace-nowrap text-micro tabular-nums text-ink sm:col-span-1 sm:text-right">
                    {n(r.n)} <span className="text-ink-faint">({pct(r.pct, 0)} de {n(r.it.total)})</span>
                  </span>
                </li>
              )
            })}
          </ol>

          {/* Donut — proporção do motivo entre as fontes (top 5 + outros) */}
          <Inner className="space-y-3">
            <p className="truncate text-center text-micro text-ink-faint" title={`${motivoLabel} por ${fonte}`}>
              {motivoLabel} · por {fonte}
            </p>
            <div className="relative h-[170px]" role="img" aria-label={`Proporção de ${motivoLabel} por ${fonte}: ${donutData.map(d => `${d.nome} ${d.value}`).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="nome" cx="50%" cy="50%" innerRadius={44} outerRadius={68} paddingAngle={2} stroke="none">
                    {donutData.map((d, i) => <Cell key={i} fill={d.cor} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={((v: number, nome: string) => [`${n(v)} · ${totalMotivo > 0 ? Math.round((v / totalMotivo) * 100) : 0}%`, nome]) as never}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-kpi-sm tabular-nums text-ink">{n(totalMotivo)}</span>
                <span className="text-micro text-ink-faint">total</span>
              </div>
            </div>
            {/* Legenda — obrigatória, são várias séries */}
            <ul className="space-y-2">
              {donutData.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-micro">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: d.cor }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-ink-muted" title={d.nome}>{d.nome}</span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{n(d.value)}</span>
                </li>
              ))}
            </ul>
          </Inner>
        </div>
      )}

      <p className="text-micro text-ink-faint">
        Mostrando <strong className="text-ink-muted">{motivoLabel}</strong> por {fonte}
        {fonte === 'criativo' ? ' (o código vem em destaque — vários criativos repetem o mesmo nome)' : ''}.
        A porcentagem é a parte dos leads daquela fonte que fecharam nesse motivo. “Todos perdidos” soma todos os motivos de fechamento.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ABA
// ---------------------------------------------------------------------------

export function TabMarketing() {
  const { preset, periodoLabel } = useJanela()
  const { data, isLoading } = useDashboard({ preset })
  const { data: etq } = useDashboardEtiquetas(preset)
  const { data: orcVendaCriativo } = useDashboardOrcVendaPorCriativo(preset)
  const { data: orcVendaOrigem } = useDashboardOrcVendaPorOrigem(preset)
  const { data: motivosFonte } = useMotivosPorFonte(preset)

  const rowsOrigem = useMemo(
    () => linhasDeOrigens(data?.porOrigem ?? [], etq, orcVendaOrigem),
    [data?.porOrigem, etq, orcVendaOrigem],
  )
  const rowsCriativo = useMemo(
    () => linhasDeCriativos(data?.porCriativo ?? [], etq, orcVendaCriativo),
    [data?.porCriativo, etq, orcVendaCriativo],
  )

  const resumo = useMemo(() => {
    const todas: RowComFonte[] = [
      ...rowsOrigem.map(r => ({ ...r, fonte: 'origem' as Fonte })),
      ...rowsCriativo.map(r => ({ ...r, fonte: 'criativo' as Fonte })),
    ]
    const porScoreDesc = (a: RowComFonte, b: RowComFonte) => (b.score - a.score) || (b.total - a.total)

    const escalar = todas.filter(r => r.verdict === 'escalar').sort(porScoreDesc).slice(0, 3)
    // Quando nada bate o corte de Escalar, mostra os de melhor sinal — dito assim,
    // com todas as letras, pra ninguém ler "Manter" como "Escalar".
    const melhorSinal = todas.filter(r => r.verdict === 'manter').sort(porScoreDesc).slice(0, 3)

    const revisar = [
      ...todas.filter(r => r.verdict === 'pausar').sort((a, b) => a.score - b.score),
      ...todas.filter(r => r.verdict === 'otimizar').sort((a, b) => a.score - b.score),
    ].slice(0, 3)

    // Sem atribuição: origens que caem na lista de canais não rastreáveis.
    const origensBrutas = data?.porOrigem ?? []
    const totalLeadsOrigem = origensBrutas.reduce((s, o) => s + o.total, 0)
    const semAtribuicao = origensBrutas
      .filter(o => ORIGEM_NAO_RASTREAVEL.has((o.origem ?? '').trim().toLowerCase()))
      .reduce((s, o) => s + o.total, 0)
    const qualificados = origensBrutas.reduce((s, o) => s + o.qualificados, 0)

    return {
      escalar,
      melhorSinal,
      revisar,
      semAtribuicao,
      semAtribuicaoPct: totalLeadsOrigem > 0 ? (semAtribuicao / totalLeadsOrigem) * 100 : 0,
      totalLeadsOrigem,
      qualificados,
      qualifPct: totalLeadsOrigem > 0 ? (qualificados / totalLeadsOrigem) * 100 : 0,
    }
  }, [rowsOrigem, rowsCriativo, data?.porOrigem])

  if (isLoading && !data) {
    return (
      <div className="space-y-5">
        {[0, 1, 2].map(i => (
          <Card key={i}>
            <div className="h-4 w-48 animate-pulse rounded-sm bg-surface-2" />
            <div className="mt-4 h-32 animate-pulse rounded-lg bg-surface-2" />
          </Card>
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <Card>
          <p className="text-body text-ink-faint">Sem dados no período.</p>
        </Card>
      </div>
    )
  }

  const semEtiqueta = !etq || (etq.por_criativo.length === 0 && etq.por_origem.length === 0)
  const usaEscalar = resumo.escalar.length > 0

  return (
    <div className="space-y-5">
      {/* ═══ 1 · RESUMO — a resposta em 4 números ═══ */}
      <Card id="marketing-resumo">
        <CardHeader
          title="Decisão de verba"
          subtitle="O que subir, o que revisar e o quanto do tráfego chega sem canal identificado."
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ListaDecisao
            titulo={usaEscalar ? 'Melhores pra escalar' : 'Melhor sinal disponível'}
            Icon={TrendingUp}
            iconCls="text-success"
            tone="positivo"
            rows={usaEscalar ? resumo.escalar : resumo.melhorSinal}
            vazio="Nada com sinal suficiente pra subir verba no período."
            nota={usaEscalar
              ? `Score ${ESCALAR_MIN} ou mais, com pelo menos ${AMOSTRA_MIN} leads. Sugestão: subir verba 20-30%.`
              : `Nenhum bateu o corte de Escalar (score ${ESCALAR_MIN}). Estes são os de melhor sinal — manter verba, não subir.`}
          />
          <ListaDecisao
            titulo="Pra revisar ou cortar"
            Icon={AlertTriangle}
            iconCls="text-danger"
            tone="perigo"
            rows={resumo.revisar}
            vazio="Nenhum canal ou criativo em zona de corte no período."
            nota="Pausar primeiro, otimizar depois — a ordem é do pior score pro melhor."
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniKpi
            rotulo="Leads sem atribuição"
            valor={n(resumo.semAtribuicao)}
            apoio={`${pct(resumo.semAtribuicaoPct, 0)} de ${n(resumo.totalLeadsOrigem)} leads chegaram sem canal identificado. Não dá pra investir nem cortar — ação é corrigir o rastreio (UTM/pixel/código &NN).`}
            periodoLabel={periodoLabel}
            tone={resumo.semAtribuicaoPct >= 20 ? 'atencao' : 'neutro'}
          />
          <MiniKpi
            rotulo="Taxa de qualificação"
            valor={pct(resumo.qualifPct, 1)}
            apoio={`${n(resumo.qualificados)} de ${n(resumo.totalLeadsOrigem)} leads querem algo que a Branorte fabrica (qualificação da IA, somando todas as origens).`}
            periodoLabel={periodoLabel}
          />
        </div>

        <Inner tone="atencao" className="mt-3 flex items-start gap-2">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-micro text-ink-muted">
            <strong className="text-ink">Investimento não rastreado.</strong> A base do CRM não guarda o custo por canal nem por criativo — não existe CPL, CAC nem ROAS nesta tela, e nenhum número aqui foi estimado.
            A decisão de verba é por <strong className="text-ink">qualidade do lead</strong>: responde à IA, quer o que a Branorte fabrica, e não pede o que não fabricamos.
          </p>
        </Inner>

        {semEtiqueta && (
          <Inner tone="atencao" className="mt-3 flex items-start gap-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-micro text-ink-muted">
              Sem etiquetas do WhatsApp no período: follow-up, lead quente e “não fabricamos” ficam zerados, e o veredito passa a se apoiar só nos sinais da IA.
            </p>
          </Inner>
        )}
      </Card>

      {/* ═══ 2 · TOP 10 — ranking por VOLUME REAL, antes dos vereditos de qualidade ═══ */}
      <Card id="top-orcamento">
        <CardHeader
          title="Top 10 — quem gera orçamento e venda"
          subtitle="Ranking por volume REAL (não por score de qualidade). Qual anúncio e qual canal estão virando proposta e dinheiro."
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        <TopFontesOrcamento
          criativos={data.porCriativo}
          origens={data.porOrigem}
          realCriativo={orcVendaCriativo}
          realOrigem={orcVendaOrigem}
        />
      </Card>

      {/* ═══ 3 · POR ORIGEM (canal) — nível macro, vem antes do criativo ═══ */}
      <Card id="marketing-origem">
        <CardHeader
          title="Por origem (canal)"
          subtitle="Meta, Google, Instagram… A decisão macro da verba: qual canal merece mais e qual está queimando dinheiro. Origens de WhatsApp de vendedor individual ficam de fora."
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        <TabelaFonte rows={rowsOrigem} fonte="origem" vazio="Nenhuma origem registrada no período." />
      </Card>

      {/* ═══ 4 · POR CRIATIVO ═══ */}
      <Card id="marketing-criativo">
        <CardHeader
          title="Por criativo"
          subtitle="Dentro do canal, qual anúncio traz lead bom. O código &NN identifica o criativo — vários compartilham o mesmo nome."
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        <TabelaFonte rows={rowsCriativo} fonte="criativo" vazio="Nenhum criativo registrado no período." />
      </Card>

      {/* ═══ 5 · MOTIVOS DE FECHAMENTO ═══ */}
      {motivosFonte && (motivosFonte.por_criativo.length > 0 || motivosFonte.por_origem.length > 0) && (
        <Card id="marketing-motivos">
          <CardHeader
            title="Motivos de fechamento"
            subtitle="Qual anúncio ou canal traz mais lead que nunca respondeu, não tem interesse ou pede o que não fabricamos. Escolha o motivo e ordene do pior pro melhor pra cortar a fonte certa."
            janela={
              preset === ''
                ? <JanelaBadge tipo="fixo" label="90 dias" />
                : <JanelaBadge tipo="periodo" label={periodoLabel} />
            }
          />
          {preset === '' && (
            <Inner tone="atencao" className="mb-3 flex items-start gap-2">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-micro text-ink-muted">
                No filtro “Tudo”, este bloco cobre só os <strong className="text-ink">últimos 90 dias</strong> — os blocos acima cobrem todo o histórico. Escolha um período no topo pra comparar maçã com maçã.
              </p>
            </Inner>
          )}
          <MotivosPorFonteView data={motivosFonte} />
        </Card>
      )}
    </div>
  )
}
