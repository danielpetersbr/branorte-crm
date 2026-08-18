import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, UserPlus, RefreshCw, Flame, Banknote, Clock, Ghost,
  TrendingDown, CheckCircle2, ChevronRight, Camera, AlertTriangle,
} from 'lucide-react'

import { useDashboard, type LeadAging, type LeadEmRisco } from '@/hooks/useDashboard'
import { useDashboardExtra, type DashboardExtra } from '@/hooks/useDashboardExtra'
import { useFunilEtiquetas } from '@/hooks/useFunilEtiquetas'
import { usePropostasStatus, CATS_ABERTO, type PropostasStatus, type PropCategoria } from '@/hooks/usePropostasStatus'
import { useOrfaosPorVendedor, type OrfaosPorVendedor } from '@/hooks/useOrfaosPorVendedor'
import { useCicloVenda, type CicloVenda as CicloVendaData } from '@/hooks/useCicloVenda'
import { useDashboardEtiquetas, type EtiquetaCategoria } from '@/hooks/useDashboardEtiquetas'

import { Card, Inner, CardHeader } from './ui/Card'
import { JanelaBadge } from './ui/JanelaBadge'
import { n, brl, brlFull, pct } from './ui/format'
import { CHART_ETAPA } from './ui/chart-tokens'
import { useJanela } from './DashboardFilterContext'

/* ────────────────────────────────────────────────────────────────────────────
   Aba FUNIL — "onde o lead morre?"

   O que mudou em relação ao arquivo antigo, e por quê:

   1. O funil por etiqueta NÃO mostra mais "% de conversão" nem "N leads
      perdidos" entre etapas. Aquele número era forjado: o hook devolve um
      SNAPSHOT (cada telefone no seu estágio mais avançado de AGORA) e o
      Dashboard cravava `pctAnterior = 100` e `perdidos = 0` para poder
      reaproveitar o componente do funil sequencial. Resultado: uma faixa
      colorida dizendo "100% conv · -0% · 0 leads perdidos" em cima de um dado
      que simplesmente não mede transição. Ficou só o que é verdade: etapa,
      quantidade e % sobre o topo.

   2. Três blocos que estavam DEFINIDOS mas nunca renderizados voltaram ao ar:
      propostas por estágio, leads a resgatar e órfãos por vendedor.

   3. Todo bloco carrega o carimbo da janela. Nesta aba convivem três janelas
      diferentes na mesma tela — snapshot (etiqueta de agora), período (o filtro
      do topo) e fixa (órfãos = idade > 7 dias) — e antes nada avisava.
   ──────────────────────────────────────────────────────────────────────────── */

function capitalizar(s: string): string {
  return (s || '').toLowerCase().replace(/\b\w/g, m => m.toUpperCase())
}

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="py-3 text-label text-ink-faint">{children}</p>
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · ETAPAS ABERTAS — header do funil (não é card solto)
// ═══════════════════════════════════════════════════════════════════════════

const ETAPAS_ABERTAS: { chave: keyof DashboardExtra['aberto']; label: string; filtro: string; Icon: typeof Search; cor: string }[] = [
  { chave: 'prospeccao',  label: 'Prospecção',  filtro: 'PROSPECCAO',  Icon: Search,   cor: 'text-ink-muted' },
  { chave: 'novo_lead',   label: 'Novo lead',   filtro: 'NOVO LEAD',   Icon: UserPlus, cor: 'text-info' },
  { chave: 'follow_up',   label: 'Follow-up',   filtro: 'FOLLOW UP',   Icon: RefreshCw, cor: 'text-warning' },
  { chave: 'lead_quente', label: 'Lead quente', filtro: 'LEAD QUENTE', Icon: Flame,    cor: 'text-danger' },
]

function EtapasAbertas({ data }: { data: DashboardExtra['aberto'] }) {
  return (
    <div className="mb-5 border-b border-border pb-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-kpi-sm text-ink tabular-nums">{n(data.total)}</span>
        <span className="text-label text-ink-muted">atendimentos abertos, sem fechar</span>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ETAPAS_ABERTAS.map(({ chave, label, filtro, Icon, cor }) => (
          <li key={chave}>
            <Link
              to={`/atendimentos?etiqueta=${encodeURIComponent(filtro)}`}
              title={`Abrir os atendimentos com etiqueta ${label} no WhatsApp`}
              aria-label={`${label}: ${n(data[chave])} atendimentos abertos. Abrir a lista.`}
              className="flex min-h-[44px] flex-col justify-center gap-1 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="text-title text-ink tabular-nums">{n(data[chave])}</span>
              <span className="flex items-center gap-2 text-micro text-ink-muted">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${cor}`} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · FUNIL POR ETIQUETA (trapézio) — snapshot, SEM % de perda
// ═══════════════════════════════════════════════════════════════════════════

/** Cor por SIGNIFICADO da etapa (não por posição) — mesma cor do mesmo conceito no resto do app. */
function corEtapa(stage: string): string {
  const s = (stage || '').toLowerCase()
  if (s.includes('vendid')) return CHART_ETAPA.vendas
  if (s.includes('orcament') || s.includes('orçament')) return CHART_ETAPA.propostas
  if (s.includes('quente')) return CHART_ETAPA.propostas
  if (s.includes('follow')) return CHART_ETAPA.qualificados
  return CHART_ETAPA.leads
}

function FunilTrapezio({ etapas, carregando }: { etapas: { etapa: string; valor: number; pctTopo: number }[]; carregando: boolean }) {
  // Base visual = a 1ª etapa EXIBIDA (o funil rebaseia em Prospecção); o % ao
  // lado continua sendo sobre o topo real, que está no subtítulo do card.
  const base = Math.max(1, etapas[0]?.valor ?? 1)
  if (!etapas.length) {
    return <Vazio>{carregando ? 'Carregando o funil…' : 'Sem contatos com etiqueta no WhatsApp.'}</Vazio>
  }

  return (
    <ol className="space-y-3">
      {etapas.map(e => {
        const largura = Math.max((e.valor / base) * 100, 2)
        return (
          <li key={e.etapa}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body text-ink" title={e.etapa}>{e.etapa}</span>
              <span className="shrink-0 text-label text-ink tabular-nums">
                {n(e.valor)}
                <span className="ml-2 text-micro text-ink-faint">{pct(e.pctTopo, 0)} do topo</span>
              </span>
            </div>
            <div className="mt-1 h-5 overflow-hidden rounded-sm bg-surface-2">
              <div
                className="h-full rounded-sm transition-all"
                style={{ width: `${largura}%`, background: corEtapa(e.etapa) }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · DINHEIRO EM JOGO — (a) em negociação  (b) dinheiro parado
// ═══════════════════════════════════════════════════════════════════════════

function NegociacaoBloco({ data }: { data: DashboardExtra['negociacao'] }) {
  const contagens: [string, number][] = [
    ['Em negociação', data.em_negociacao],
    ['Follow up', data.follow_up],
    ['Lead quente', data.lead_quente],
    ['Com orçamento', data.com_orcamento],
  ]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-2 text-title text-ink">
          <Banknote className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          Em negociação · previsão
        </h4>
        <JanelaBadge tipo="snapshot" label="estado de agora" />
      </div>

      <div className="text-kpi text-warning tabular-nums" title={brlFull(data.valor)}>{brl(data.valor)}</div>
      <p className="mt-1 text-micro text-ink-faint">
        soma dos orçamentos de quem está em follow up + lead quente
      </p>

      {data.valor_followup > 0 && (
        <Inner tone="atencao" className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-micro text-ink-muted">só em follow up</span>
          <span className="text-label text-warning tabular-nums" title={brlFull(data.valor_followup)}>
            {brl(data.valor_followup)}
            <span className="ml-2 text-micro text-ink-faint">{n(data.com_orcamento_followup)} orç.</span>
          </span>
        </Inner>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {contagens.map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg border border-border bg-surface-2 p-3">
            <dt className="text-micro text-ink-faint">{rotulo}</dt>
            <dd className="text-title text-ink tabular-nums">{n(valor)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function AgingBloco({
  faixas,
  carregando,
  onAbrirFaixa,
}: {
  faixas: LeadAging[]
  carregando: boolean
  onAbrirFaixa?: (faixa: string) => void
}) {
  const temDestino = typeof onAbrirFaixa === 'function'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-2 text-title text-ink">
          <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          Dinheiro parado — sem resposta há
        </h4>
        <JanelaBadge tipo="snapshot" label="estado de agora" />
      </div>
      <p className="mb-3 text-micro text-ink-faint">
        Quanto mais velho, mais frio: comece a cobrança pelas faixas de baixo.
      </p>

      {faixas.length === 0 ? (
        <Vazio>{carregando ? 'Carregando as faixas…' : 'Nenhum orçamento parado sem resposta.'}</Vazio>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {faixas.map((f, i) => {
            // 7d-30d e +30d: já esfriaram, entram em tom de perigo.
            const critico = i >= 2
            return (
              <li key={f.faixa}>
                {/* <button> já carrega role="button" — o id é a âncora do atalho. */}
                <button
                  type="button"
                  id={`aging-${slug(f.faixa)}`}
                  onClick={() => onAbrirFaixa?.(f.faixa)}
                  aria-label={`Sem resposta há ${f.faixa}: ${brlFull(f.valor)} em ${n(f.leads)} leads. Ver a lista.`}
                  title={temDestino
                    ? `Ver os leads parados há ${f.faixa}`
                    : `Ainda não há tela de destino ligada a esta faixa (${f.faixa}) — o botão existe, o drill-down entra depois.`}
                  className={[
                    'flex min-h-[44px] w-full cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    critico
                      ? 'border-danger/30 bg-danger-bg hover:border-danger/60'
                      : 'border-border bg-surface-2 hover:border-border-strong',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 text-micro text-ink-muted">
                    {critico && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />}
                    <span className="truncate">{f.faixa}</span>
                  </span>
                  <span className={`text-title tabular-nums ${critico ? 'text-danger' : 'text-ink'}`} title={brlFull(f.valor)}>
                    {f.valor > 0 ? brl(f.valor) : '—'}
                  </span>
                  <span className="text-micro text-ink-faint tabular-nums">
                    {n(f.leads)} {f.leads === 1 ? 'lead' : 'leads'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · PROPOSTAS POR ESTÁGIO (estava morto no arquivo antigo)
// ═══════════════════════════════════════════════════════════════════════════

// Metadados por categoria — a cor agora é classe de token (o objeto antigo
// carregava hsl() literal, que não respondia ao tema escuro).
const PROP_CAT_META: Record<PropCategoria, { label: string; barra: string; texto: string }> = {
  orcamento:    { label: 'Orçamento enviado',  barra: 'bg-warning',    texto: 'text-warning' },
  quente:       { label: 'Quente / follow-up', barra: 'bg-danger',     texto: 'text-danger' },
  lead_quente:  { label: 'Lead quente',        barra: 'bg-danger/70',  texto: 'text-danger' },
  novo:         { label: 'Novo (sem mexer)',   barra: 'bg-info',       texto: 'text-info' },
  sem_etiqueta: { label: 'Sem etiqueta',       barra: 'bg-ink-faint',  texto: 'text-ink-muted' },
  vendido:      { label: 'Vendido',            barra: 'bg-success',    texto: 'text-success' },
  perdido:      { label: 'Perdido',            barra: 'bg-ink-muted',  texto: 'text-ink-muted' },
  outros:       { label: 'Outros / interno',   barra: 'bg-accent',     texto: 'text-accent' },
}

const ORDEM_CAT: PropCategoria[] = ['orcamento', 'quente', 'lead_quente', 'novo', 'sem_etiqueta', 'vendido', 'perdido', 'outros']

function PropostasPorEstagio({ status }: { status: PropostasStatus }) {
  const [sel, setSel] = useState<PropCategoria | 'aberto'>('aberto')

  const chips = ORDEM_CAT
    .map(c => status.porCategoria.find(p => p.categoria === c))
    .filter((p): p is PropostasStatus['porCategoria'][number] => !!p && p.n > 0)

  const totalGeral = status.porCategoria.reduce((s, c) => s + c.brl, 0) || 1

  // Vendedores do estágio selecionado (para 'aberto', soma as categorias em aberto).
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
  const selBarra = sel === 'aberto' ? 'bg-warning' : PROP_CAT_META[sel].barra
  const selTexto = sel === 'aberto' ? 'text-warning' : PROP_CAT_META[sel].texto

  const somaFechado = status.aberto.brl + status.vendido.brl
  const pctVendido = somaFechado > 0 ? (status.vendido.brl / somaFechado) * 100 : 0

  return (
    <div className="space-y-5">
      {/* Headline: dinheiro na mesa vs vendido */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setSel('aberto')}
          aria-pressed={sel === 'aberto'}
          title="Propostas montadas cujo cliente ainda não está com etiqueta VENDIDO nem PERDIDO"
          className={[
            'flex min-h-[44px] cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            sel === 'aberto' ? 'border-warning bg-warning-bg' : 'border-border bg-surface-2 hover:border-border-strong',
          ].join(' ')}
        >
          <span className="text-micro text-ink-faint">Dinheiro na mesa</span>
          <span className="text-kpi-sm text-warning tabular-nums" title={brlFull(status.aberto.brl)}>{brl(status.aberto.brl)}</span>
          <span className="text-micro text-ink-faint tabular-nums">{n(status.aberto.n)} propostas abertas</span>
        </button>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-micro text-ink-faint">Vendido (etiqueta)</div>
          <div className="text-kpi-sm text-success tabular-nums" title={brlFull(status.vendido.brl)}>{brl(status.vendido.brl)}</div>
          <div className="text-micro text-ink-faint tabular-nums">{n(status.vendido.n)} propostas · piso, não teto</div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-micro text-ink-faint">Já com etiqueta VENDIDO</div>
          <div className="text-kpi-sm text-ink tabular-nums">{pct(pctVendido, 0)}</div>
          <div className="text-micro text-ink-faint">vendido ÷ (aberto + vendido)</div>
        </div>
      </div>

      {/* Chips por estágio */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estágio do funil">
        {chips.map(c => {
          const ativo = sel === c.categoria
          const meta = PROP_CAT_META[c.categoria]
          return (
            <button
              key={c.categoria}
              type="button"
              onClick={() => setSel(c.categoria)}
              aria-pressed={ativo}
              title={`${meta.label} — ${brlFull(c.brl)} · ${pct((c.brl / totalGeral) * 100, 0)} do valor`}
              className={[
                'inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-3 text-micro transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                ativo ? 'border-accent bg-accent-bg text-ink' : 'border-border bg-surface-2 text-ink-muted hover:border-border-strong',
              ].join(' ')}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${meta.barra}`} aria-hidden="true" />
              <span>{meta.label}</span>
              <span className="text-ink-faint tabular-nums">{n(c.n)}</span>
            </button>
          )
        })}
      </div>

      {/* Ranking de vendedores no estágio selecionado */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-label text-ink-muted">
            <span className={`tabular-nums ${selTexto}`} title={brlFull(selTotal.brl)}>{brl(selTotal.brl)}</span>
            {' '}em {n(selTotal.n)} propostas <span className="text-ink-faint">{selLabel}</span>
          </p>
          <Link
            to={`/orcamentos/salvos?etiqueta=${encodeURIComponent(sel)}`}
            className="inline-flex min-h-[44px] md:min-h-0 shrink-0 items-center gap-1 text-label text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver lista
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {vendRank.length > 0 ? (
          <ul className="space-y-2">
            {vendRank.map(v => (
              <li key={v.vendedor}>
                <Link
                  to={`/orcamentos/salvos?vendedor=${encodeURIComponent(v.vendedor)}&etiqueta=${encodeURIComponent(sel)}`}
                  title={`Ver os orçamentos de ${v.vendedor.toLowerCase()} nesse estágio`}
                  className="block min-h-[44px] rounded-lg p-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-body capitalize text-ink">{v.vendedor.toLowerCase()}</span>
                    <span className="shrink-0 text-label text-ink-muted tabular-nums" title={brlFull(v.brl)}>
                      {brl(v.brl)}<span className="ml-2 text-micro text-ink-faint">{n(v.n)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full rounded-full ${selBarra}`} style={{ width: `${(v.brl / maxV) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Vazio>Nenhuma proposta nesse estágio.</Vazio>
        )}
      </div>

      <p className="border-t border-border pt-3 text-micro text-ink-faint">
        "Vendido" aqui = proposta cujo cliente tem etiqueta VENDIDO no WhatsApp. Muita venda fecha sem a etiqueta ser
        marcada, então o número real é maior — use como piso, não teto. "Sem etiqueta" = proposta montada mas o cliente
        não tem etiqueta de funil agora (gap de acompanhamento).
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · LEADS A RESGATAR (estava morto no arquivo antigo)
// ═══════════════════════════════════════════════════════════════════════════

function LeadsResgatar({ leads }: { leads: LeadEmRisco[] }) {
  if (!leads.length) {
    return (
      <p className="flex items-center gap-2 py-3 text-label text-ink-faint">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        Nenhum lead quente parado no momento.
      </p>
    )
  }

  return (
    <div>
      <ul className="space-y-2">
        {leads.map(l => {
          const dias = Math.floor(l.horasSemResposta / 24)
          const tempo = dias >= 1 ? `${dias}d parado` : `${Math.round(l.horasSemResposta)}h parado`
          const urgente = l.horasSemResposta >= 168 // +7d = crítico
          return (
            <li key={l.id}>
              <Link
                to={l.vendedor ? `/atendimentos?responsavel=${encodeURIComponent(l.vendedor)}` : '/atendimentos'}
                title="Abrir os atendimentos deste vendedor"
                className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Flame className={`h-4 w-4 shrink-0 ${urgente ? 'text-danger' : 'text-warning'}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-body text-ink">{l.nome || l.telefone || 'Lead sem nome'}</span>
                    <span className="block truncate text-micro text-ink-faint">
                      {l.momento === 'Agora' ? 'quer investir agora' : (l.momento || 'lead quente')}
                      {l.vendedor ? ` · ${l.vendedor}` : ' · sem vendedor'}
                    </span>
                  </span>
                </span>
                <span className={`shrink-0 text-label tabular-nums ${urgente ? 'text-danger' : 'text-warning'}`}>{tempo}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="pt-3 text-micro text-ink-faint">
        Quentes que sumiram no meio do atendimento, ordenados por valor e tempo parado — comece por cima. A lista é
        cortada nos 8 primeiros: existem outros abaixo do corte.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · LEADS ÓRFÃOS POR VENDEDOR (estava morto no arquivo antigo)
// ═══════════════════════════════════════════════════════════════════════════

const BALDES: { chave: 'prospeccao' | 'novo' | 'sem_etiqueta'; label: string; barra: string }[] = [
  { chave: 'prospeccao',   label: 'Prospecção / tentativa', barra: 'bg-warning' },
  { chave: 'novo',         label: 'Novo lead',              barra: 'bg-info' },
  { chave: 'sem_etiqueta', label: 'Sem etiqueta nenhuma',   barra: 'bg-danger' },
]

function LeadsOrfaosVendedor({ orfaos }: { orfaos: OrfaosPorVendedor }) {
  const max = Math.max(...orfaos.por_vendedor.map(v => v.n), 1)
  const totSem = orfaos.por_vendedor.reduce((s, v) => s + (v.sem_etiqueta || 0), 0)

  if (!orfaos.por_vendedor.length) return <Vazio>Nenhum lead parado há mais de 7 dias.</Vazio>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <Ghost className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <span className="text-kpi text-warning tabular-nums">{n(orfaos.total)}</span>
        </span>
        <span className="text-label text-ink-muted">leads parados há +7 dias sem evoluir</span>
      </div>

      {/* Legenda dos baldes — ordem do funil */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-muted">
        {BALDES.map(b => (
          <li key={b.chave} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-sm ${b.barra}`} aria-hidden="true" />
            <span>{b.label}</span>
            {b.chave === 'sem_etiqueta' && <span className="text-danger tabular-nums">{n(totSem)}</span>}
          </li>
        ))}
      </ul>

      <ul className="space-y-2">
        {orfaos.por_vendedor.map(v => (
          <li key={v.vendedor}>
            <Link
              to={`/atendimentos?responsavel=${encodeURIComponent(capitalizar(v.vendedor))}`}
              title={`Abrir os atendimentos de ${v.vendedor.toLowerCase()}`}
              aria-label={`${capitalizar(v.vendedor)}: ${n(v.n)} leads parados — ${v.prospeccao} em prospecção, ${v.novo} novos, ${v.sem_etiqueta} sem etiqueta.`}
              className="block min-h-[44px] rounded-lg p-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body capitalize text-ink">{v.vendedor.toLowerCase()}</span>
                <span className="shrink-0 text-label text-ink tabular-nums">
                  {n(v.n)}
                  <span className="ml-2 text-micro text-ink-faint">
                    {v.prospeccao} / {v.novo} / {v.sem_etiqueta}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="flex h-full" style={{ width: `${Math.max((v.n / max) * 100, 4)}%` }}>
                  {BALDES.map(b => {
                    const parte = v[b.chave] || 0
                    if (parte <= 0) return null
                    return (
                      <span
                        key={b.chave}
                        className={`h-full ${b.barra}`}
                        style={{ width: `${(parte / Math.max(v.n, 1)) * 100}%` }}
                      />
                    )
                  })}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <p className="pt-3 text-micro text-ink-faint">
        Travados há +7 dias antes da negociação (números = prospecção / novo / sem etiqueta). Prospecção e novo lead = o
        vendedor até etiquetou mas parou aí; sem etiqueta é o pior — nem foi registrado. Cobrar o próximo passo de quem
        está no topo.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · CICLO DE VENDA
// ═══════════════════════════════════════════════════════════════════════════

const MIN_AMOSTRA = 8 // abaixo disso a mediana não é confiável → "—"

function CicloVenda({ ciclo }: { ciclo: CicloVendaData }) {
  const etapas = [
    { label: 'Lead chega → 1ª etiqueta', n: ciclo.n_chegada,     valor: ciclo.n_chegada >= MIN_AMOSTRA ? ciclo.chegada_1a_etq_horas : null, unidade: 'h', meta: 4, desc: 'SLA: classificar em menos de 4h' },
    { label: 'Lead → orçamento enviado', n: ciclo.n_orcamento,   valor: ciclo.n_orcamento >= MIN_AMOSTRA ? ciclo.lead_orcamento_dias : null, unidade: 'd', meta: 3, desc: 'Data real do orçamento gerado' },
    { label: 'Orçamento → vendido',      n: ciclo.n_orc_vendido, valor: ciclo.n_orc_vendido >= MIN_AMOSTRA ? ciclo.orcamento_vendido_dias : null, unidade: 'd', meta: 7, desc: 'Mesma coorte (orçou E vendeu)' },
  ]

  return (
    <ul className="space-y-3">
      {etapas.map(e => {
        const v = e.valor
        const estourou = v != null && v > e.meta
        // Horas grandes ficam ilegíveis (357,9h) → vira dias a partir de 48h.
        const disp = v == null
          ? { num: '—', un: '' }
          : (e.unidade === 'h' && v >= 48)
            ? { num: String(Math.round(v / 24)), un: 'd' }
            : { num: (Math.round(v * 10) / 10).toString().replace('.', ','), un: e.unidade }
        const fator = v != null && e.meta > 0 ? Math.round(v / e.meta) : 0
        return (
          <li
            key={e.label}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-body text-ink">
                <Clock className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                <span className="truncate">{e.label}</span>
              </div>
              <p className="mt-1 text-micro text-ink-faint">
                {e.desc}{e.n > 0 && ` · ${n(e.n)} casos`}
                {v == null && e.n > 0 && e.n < MIN_AMOSTRA && ' · amostra pequena'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-kpi-sm tabular-nums ${estourou ? 'text-danger' : 'text-success'}`}>
                {disp.num}
                {disp.un && <span className="ml-1 text-label">{disp.un}</span>}
              </div>
              <p className={`mt-1 text-micro ${estourou ? 'text-danger' : 'text-ink-faint'}`}>
                meta: &lt;{e.meta}{e.unidade}
                {estourou && fator >= 2 ? ` · ${fator}× acima` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · MOTIVOS DE TRAVA / PERDA (variante 'trava' do MapaEtiquetas)
// ═══════════════════════════════════════════════════════════════════════════

const CATS_TRAVA: EtiquetaCategoria[] = ['perdido', 'outros', 'interno']

function MotivosTrava({ etq }: { etq: NonNullable<ReturnType<typeof useDashboardEtiquetas>['data']> }) {
  // Dedup por nome — a mesma etiqueta aparece uma vez por conta de WhatsApp.
  const top = useMemo(() => {
    const mapa = new Map<string, { nome: string; categoria: EtiquetaCategoria; total: number }>()
    for (const e of etq.por_etiqueta) {
      const cur = mapa.get(e.nome)
      if (cur) cur.total += e.total
      else mapa.set(e.nome, { nome: e.nome, categoria: e.categoria, total: e.total })
    }
    return [...mapa.values()]
      .filter(e => CATS_TRAVA.includes(e.categoria))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [etq.por_etiqueta])

  if (!top.length) {
    return (
      <p className="flex items-center gap-2 py-3 text-label text-ink-faint">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        Sem motivos de trava no período.
      </p>
    )
  }

  const max = Math.max(...top.map(e => e.total), 1)

  return (
    <ul className="space-y-3">
      {top.map(e => (
        <li key={e.nome}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-body text-ink" title={e.nome}>{e.nome}</span>
            <span className="shrink-0 text-label text-ink-muted tabular-nums">{n(e.total)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-danger/70" style={{ width: `${(e.total / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA
// ═══════════════════════════════════════════════════════════════════════════

export function TabFunil({ onAbrirFaixa }: { onAbrirFaixa?: (faixa: string) => void } = {}) {
  const { preset, periodoLabel } = useJanela()

  const { data } = useDashboard({ preset })
  const { data: extra } = useDashboardExtra()
  const { data: funilEtq } = useFunilEtiquetas()
  const { data: propStatus } = usePropostasStatus(preset)
  const { data: orfaos } = useOrfaosPorVendedor(7)
  const { data: ciclo } = useCicloVenda(preset)
  const { data: etq } = useDashboardEtiquetas(preset)

  // Funil por etiqueta: SNAPSHOT. Cada telefone entra no seu estágio mais
  // avançado — os estágios não são marcos percorridos, então não existe
  // "perdidos entre etapas" aqui (o Dashboard antigo inventava zero).
  const funil = useMemo(() => {
    const rows = [...(funilEtq ?? [])].sort((a, b) => a.ord - b.ord)
    if (!rows.length) return { total: 0, etapas: [] as { etapa: string; valor: number; pctTopo: number }[] }
    const topo = rows.find(r => r.ord === 0)?.phones || rows[0].phones || 1
    return {
      total: topo,
      // slice(1) tira a linha "Entrou" (o topo) — ela já está no subtítulo.
      etapas: rows.slice(1).map(r => ({
        etapa: r.stage,
        valor: r.phones,
        pctTopo: Math.min(100, (r.phones / topo) * 100),
      })),
    }
  }, [funilEtq])

  const aging = (data?.leadAging ?? []).filter(a => a.valor > 0 || a.leads > 0)

  return (
    <div className="space-y-5">
      {/* ── 1 + 2 · Etapas abertas (header) + funil por etiqueta ───────────── */}
      <Card id="funil-etiquetas">
        <CardHeader
          title="Funil por etiqueta (WhatsApp)"
          subtitle={`${n(funil.total)} contatos com etiqueta · cada telefone no estágio mais avançado de agora`}
          janela={<JanelaBadge tipo="snapshot" label="estado de agora" />}
        />

        {extra ? <EtapasAbertas data={extra.aberto} /> : <Vazio>Carregando as etapas abertas…</Vazio>}

        <FunilTrapezio etapas={funil.etapas} carregando={!funilEtq} />

        <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-micro text-ink-faint">
          <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Isto é uma fotografia do estado atual, não um percurso: os estágios não são marcos que o lead atravessou,
            então não existe "% de perda" nem "leads perdidos" entre eles. Quem mede transição real é o ciclo de venda,
            mais abaixo.
          </span>
        </p>
      </Card>

      {/* ── 3 · Dinheiro em jogo ───────────────────────────────────────────── */}
      <Card id="dinheiro-em-jogo">
        <CardHeader
          title="Dinheiro em jogo"
          subtitle="O que está previsto para fechar e o que já esfriou esperando resposta"
          janela={<JanelaBadge tipo="snapshot" label="estado de agora" />}
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {extra ? <NegociacaoBloco data={extra.negociacao} /> : <Vazio>Carregando a previsão…</Vazio>}
          <AgingBloco faixas={aging} carregando={!data} onAbrirFaixa={onAbrirFaixa} />
        </div>
      </Card>

      {/* ── 4 · Propostas por estágio ──────────────────────────────────────── */}
      <Card id="propostas-estagio">
        <CardHeader
          title="Propostas por estágio"
          subtitle="Propostas montadas no período, classificadas pelo estágio ATUAL da etiqueta do cliente"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        {propStatus
          ? <PropostasPorEstagio status={propStatus} />
          : <Vazio>Carregando as propostas…</Vazio>}
      </Card>

      {/* ── 5 · Leads a resgatar ─────────────────────────────────────────────
          O hook calcula os leads em risco sobre TODOS os leads (rows), não sobre o
          recorte do filtro: com 30d nenhum lead alcançaria 720h parado e o monte mais
          caro sumiria. Por isso o carimbo aqui é snapshot, não período. */}
      <Card id="leads-resgatar">
        <CardHeader
          title="Leads a resgatar"
          subtitle="Top 8 por valor parado — a lista é cortada, há mais abaixo"
          janela={<JanelaBadge tipo="snapshot" label="estado de agora" />}
        />
        {data ? <LeadsResgatar leads={data.leadsEmRisco} /> : <Vazio>Carregando os leads…</Vazio>}
      </Card>

      {/* ── 6 · Leads órfãos por vendedor ──────────────────────────────────── */}
      <Card id="leads-orfaos">
        <CardHeader
          title="Leads órfãos por vendedor"
          subtitle="Parados no intake há mais de 7 dias — janela por idade da etiqueta, não pelo filtro do topo"
          janela={<JanelaBadge tipo="fixo" label="parados +7 dias" />}
        />
        {orfaos ? <LeadsOrfaosVendedor orfaos={orfaos} /> : <Vazio>Carregando os órfãos…</Vazio>}
      </Card>

      {/* ── 7 · Ciclo de venda ─────────────────────────────────────────────── */}
      <Card id="ciclo-venda">
        <CardHeader
          title="Ciclo de venda"
          subtitle="Mediana de tempo entre etapas, com timestamps reais"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        {ciclo ? <CicloVenda ciclo={ciclo} /> : <Vazio>Carregando o ciclo…</Vazio>}
      </Card>

      {/* ── 8 · Motivos de trava / perda ───────────────────────────────────── */}
      <Card id="motivos-trava">
        <CardHeader
          title="Motivos de trava / perda"
          subtitle="Top 5 etiquetas de encerramento — o que mais mata negócio"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
          right={<TrendingDown className="h-5 w-5 text-danger" aria-hidden="true" />}
        />
        {etq ? <MotivosTrava etq={etq} /> : <Vazio>Carregando os motivos…</Vazio>}
      </Card>
    </div>
  )
}
