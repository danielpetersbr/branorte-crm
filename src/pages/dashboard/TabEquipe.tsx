import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Clock, ExternalLink,
  FileText, Flame, Ghost, Handshake, Info, MessageSquare, Phone, Target,
  Trophy, User, Users, X,
} from 'lucide-react'

import { useDashboard, type SlaVendedor } from '@/hooks/useDashboard'
import { useHeatmapSemanal } from '@/hooks/useDashboardEtiquetas'
import { useVendasReais, type CorridaVendedor, type VendasReais } from '@/hooks/useVendasReais'
import { useVendedoresPainel, type VendedorPainel } from '@/hooks/useVendedoresPainel'
import { useVendedorCobertura, type VendedorCobertura } from '@/hooks/useVendedorCobertura'
import { useOrcamentosResumo, type OrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { useOrfaosPorVendedor, type OrfaosPorVendedor } from '@/hooks/useOrfaosPorVendedor'
import { ResumoDiaVendedores } from '@/components/ResumoDiaVendedores'

import { Card, CardHeader, Inner } from './ui/Card'
import { JanelaBadge } from './ui/JanelaBadge'
import { useJanela } from './DashboardFilterContext'
import { brl, brlFull, n, pct, primeiroNome } from './ui/format'
import { foraDoRanking } from '@/lib/vendedores-fora-do-ranking'

/* ═══════════════════════════════════════════════════════════════════════════
   ABA EQUIPE — "quem entrega e quem cobrar?"

   Ordem: 1) Ranking de vendas (indivíduo | time, UM bloco só)
          2) Tabela comparativa (1 linha por vendedor) → clique abre o detalhe
          3) Drawer de detalhe do vendedor
          4) Resumo do dia por vendedor (componente de outro dono)
          5) Quando chegam os leads (heatmap dia × hora, janela fixa 30d)

   O que esta aba conserta do Dashboard antigo:
   · o mesmo vendedor aparecia 2× na mesma tela (Corrida de vendas + Placar dos
     times liam a MESMA fonte). Agora é um bloco com alternador.
   · 9 painéis completos de vendedor empilhados → 1 tabela + 1 drawer sob demanda.
   · nome de time cortado ("Esquadr…", "Los Melh…") → quebra em 2 linhas, nunca corta.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ATENÇÃO — composição dos times e meta por time são HARDCODED aqui, herdadas do
 * Dashboard antigo. Deveriam vir de `system_settings` (o Controle já guarda
 * `meta_mensal` e `corrida_vendas_meta` lá; falta `times_vendas` e `meta_time`).
 * Enquanto não vierem, trocar de time exige deploy. Mantido por ora.
 */
export const TIMES_DEF: { nome: string; membros: string[] }[] = [
  { nome: 'Esquadrão Classe A', membros: ['ALVARO', 'IGOR', 'EDER'] },
  { nome: 'Los Melhores', membros: ['JARDEL', 'LUCAS', 'RAMON'] },
  { nome: 'Os Caça Lead', membros: ['PEDRO', 'GUSTAVO', 'EDILSON'] },
]

/** Meta por time = R$ 2,5M / 3. Também deveria vir de `system_settings`. */
export const META_TIME = 833_000

/* ─── helpers locais ─────────────────────────────────────────────────────── */

/** Chave de merge entre as 3 fontes: 1º nome em MAIÚSCULA.
 *  (etiqueta usa "PEDRO", atendimentos "Pedro Della Giustina", orçamento "PEDRO DELA GIUSTINA ") */
const chaveNome = (s: string): string => (s || '').trim().split(/\s+/)[0]?.toUpperCase() ?? ''
const capitalizar = (s: string) => (s || '').toLowerCase().replace(/\b\w/g, m => m.toUpperCase())

/** Barra de progresso vs meta: cor + SEMPRE o número ao lado (nunca só cor). */
const barMeta = (p: number) => (p >= 100 ? 'bg-success' : p >= 75 ? 'bg-warning' : 'bg-info')
const txtMeta = (p: number) => (p >= 100 ? 'text-success' : p >= 75 ? 'text-warning' : 'text-ink-muted')

/* ═══════════════════════════════════════════════════════════════════════════
   1 · RANKING DE VENDAS — indivíduo | time (fusão de CorridaVendas + PlacarTimes)
   ═══════════════════════════════════════════════════════════════════════════ */

function LegendaMeta() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-micro text-ink-faint">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-info" aria-hidden="true" />abaixo de 75%
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-warning" aria-hidden="true" />75 a 99%
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />bateu a meta
      </span>
    </div>
  )
}

function RankingIndividuo({ corrida, metaVendedor }: { corrida: CorridaVendedor[]; metaVendedor: number }) {
  if (!corrida.length) {
    return <p className="text-body text-ink-faint">Sem venda registrada no mês corrente.</p>
  }
  return (
    <>
      <ol className="space-y-3">
        {corrida.map((v, i) => {
          const largura = Math.max(Math.min(v.pct, 100), 2)
          return (
            <li
              key={v.vendedor}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.25rem_10rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
            >
              <span className="text-micro tabular-nums text-ink-faint text-right">{i + 1}º</span>
              {/* nome NUNCA cortado — quebra em 2 linhas se precisar */}
              <span className="min-w-0 break-words text-label text-ink leading-snug">
                {capitalizar(v.vendedor)}
              </span>
              <div className="col-span-2 sm:col-span-1 flex items-center gap-3 min-w-0">
                <div
                  className="relative h-3 flex-1 min-w-0 overflow-hidden rounded-full bg-surface-2"
                  role="img"
                  aria-label={`${capitalizar(v.vendedor)}: ${pct(v.pct, 0)} da meta`}
                >
                  <div className={`h-full rounded-full ${barMeta(v.pct)}`} style={{ width: `${largura}%` }} />
                </div>
                <span className={`shrink-0 text-label tabular-nums ${txtMeta(v.pct)}`}>{pct(v.pct, 0)}</span>
                <span className="shrink-0 text-label tabular-nums text-ink-muted" title={brlFull(v.valor)}>
                  {brl(v.valor)}
                </span>
                <span className="shrink-0 text-micro tabular-nums text-ink-faint">
                  {v.numVendas} {v.numVendas === 1 ? 'venda' : 'vendas'}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-micro text-ink-faint tabular-nums">
        Meta de {brl(metaVendedor)} por vendedor.
      </p>
      <LegendaMeta />
    </>
  )
}

function RankingTime({ corrida }: { corrida: CorridaVendedor[] }) {
  const porVend = new Map(corrida.map(c => [chaveNome(c.vendedor), c]))
  const times = TIMES_DEF.map(t => {
    const membros = t.membros
      .map(m => ({ nome: m, valor: porVend.get(m)?.valor ?? 0, vendas: porVend.get(m)?.numVendas ?? 0 }))
      .sort((a, b) => b.valor - a.valor)
    const valor = membros.reduce((s, m) => s + m.valor, 0)
    return { nome: t.nome, membros, valor, pct: META_TIME > 0 ? (valor / META_TIME) * 100 : 0 }
  }).sort((a, b) => b.valor - a.valor)

  return (
    <>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {times.map((t, i) => (
          <li key={t.nome}>
            <Inner tone={i === 0 ? 'atencao' : 'neutro'} className="h-full">
              {/* Cabeçalho: posição + nome. O nome tem linha própria e QUEBRA — nunca trunca. */}
              <div className="flex items-start gap-2">
                <span className="shrink-0 inline-flex items-center gap-1 text-micro tabular-nums text-ink-muted">
                  {i === 0 && <Trophy className="h-3.5 w-3.5 text-warning" aria-hidden="true" />}
                  {i + 1}º
                </span>
                <h4 className="min-w-0 flex-1 break-words text-label text-ink leading-snug">{t.nome}</h4>
                <span className={`shrink-0 text-label tabular-nums ${txtMeta(t.pct)}`}>{pct(t.pct, 0)}</span>
              </div>

              <div className="mt-3">
                <div className="text-kpi-sm text-ink tabular-nums break-words" title={brlFull(t.valor)}>
                  {brl(t.valor)}
                </div>
                <div className="text-micro text-ink-faint tabular-nums">de {brl(META_TIME)}</div>
              </div>

              <div
                className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden"
                role="img"
                aria-label={`${t.nome}: ${pct(t.pct, 0)} da meta do time`}
              >
                <div
                  className={`h-full rounded-full ${barMeta(t.pct)}`}
                  style={{ width: `${Math.max(Math.min(t.pct, 100), 2)}%` }}
                />
              </div>

              <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
                {t.membros.map(m => (
                  <li key={m.nome} className="flex items-baseline justify-between gap-2 text-micro">
                    <span className="min-w-0 break-words text-ink-muted">{capitalizar(m.nome)}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint" title={brlFull(m.valor)}>
                      {brl(m.valor)} · {m.vendas}v
                    </span>
                  </li>
                ))}
              </ul>
            </Inner>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-micro text-ink-faint tabular-nums">
        Meta de {brl(META_TIME)} por time · composição fixa no código (deveria vir de system_settings).
      </p>
      <LegendaMeta />
    </>
  )
}

function RankingVendas({ vendas }: { vendas: VendasReais | undefined }) {
  const [modo, setModo] = useState<'individuo' | 'time'>('individuo')
  const degradada = !!vendas && vendas.fonte !== 'controle-live'

  const botao = (id: 'individuo' | 'time', label: string, Icon: typeof User) => (
    <button
      key={id}
      type="button"
      onClick={() => setModo(id)}
      aria-pressed={modo === id}
      className={[
        'inline-flex min-h-[44px] items-center gap-2 rounded-sm px-3 text-label transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        modo === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  )

  return (
    <Card id="ranking-vendas">
      <CardHeader
        title="Ranking de vendas"
        subtitle="Pedidos não cancelados, ao vivo do Controle. É a mesma fonte nas duas visões — por isso viraram um bloco só."
        janela={<JanelaBadge tipo="mes" label="mês corrente" />}
        right={
          <div className="inline-flex gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Ver ranking por">
            {botao('individuo', 'Indivíduo', User)}
            {botao('time', 'Time', Users)}
          </div>
        }
      />

      {!vendas && <p className="text-body text-ink-faint">Carregando o placar do Controle…</p>}

      {degradada && (
        <Inner tone="atencao" className="mb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-label text-ink">Fonte degradada: espelho</p>
              <p className="mt-1 text-micro text-ink-muted">
                O Controle não respondeu; o número veio do espelho local (mirror_pedidos_venda), que{' '}
                <strong>não tem quebra por vendedor</strong>. Total do mês: {brlFull(vendas.vendidoMes)} em{' '}
                {n(vendas.pedidosMes)} pedidos. O ranking abaixo fica indisponível até a fonte viva voltar.
              </p>
            </div>
          </div>
        </Inner>
      )}

      {vendas && !degradada && (
        modo === 'individuo'
          ? <RankingIndividuo corrida={vendas.corrida} metaVendedor={vendas.metaVendedor} />
          : <RankingTime corrida={vendas.corrida} />
      )}

      {vendas && (
        <a
          href="https://controle.branorte.com/controle-vendas"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-micro text-ink-faint hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          Abrir a Corrida de Vendas no Controle
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · MERGE DAS FONTES POR VENDEDOR (portado de montarCardsVendedor, ~1638)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CardVend {
  v: VendedorPainel
  nome: string
  contatos: number        // atendimentos no período (SLA)
  qualifIa: number | null
  orcN: number            // clientes com proposta montada no builder
  orcBRL: number          // valor total montado
  ultimaDias: number | null
  totalPassado: number    // clientes atribuídos a ele (responsável) — base da cobrança
  comEtiqueta: number     // quantos ele etiquetou (entraram no funil)
  semEtiqueta: number     // quantos ele NEM etiquetou — buraco de acompanhamento
  veredito: { nivel: 'cobrar' | 'atencao' | 'ok'; tag: string; motivo: string }
}

// Semáforo de cobrança — cobra PROCESSO verificável (parou de orçar, recebe muito lead
// e não monta orçamento, não etiqueta), não placar de venda (a etiqueta VENDIDO é
// sub-registro: depende do vendedor marcar à mão).
function vereditoVendedor(c: Omit<CardVend, 'veredito'>): CardVend['veredito'] {
  const semPct = c.totalPassado > 0 ? c.semEtiqueta / c.totalPassado : 0
  if (c.ultimaDias != null && c.ultimaDias > 4 && (c.v.quente + c.v.novo) > 20)
    return { nivel: 'cobrar', tag: 'Cobrar', motivo: `parou de orçar há ${c.ultimaDias} dias, com fila quente na mão` }
  if (c.contatos >= 200 && c.orcN <= 10 && c.v.vendido <= 1)
    return { nivel: 'cobrar', tag: 'Cobrar', motivo: `${n(c.contatos)} contatos e só ${c.orcN} orçamentos montados` }
  if (c.totalPassado >= 80 && semPct >= 0.5)
    return { nivel: 'cobrar', tag: 'Não etiqueta', motivo: `${n(c.semEtiqueta)} dos ${n(c.totalPassado)} clientes (${Math.round(semPct * 100)}%) sem nenhuma etiqueta — sem rastreio do que fez` }
  if (c.orcN >= 25 && c.v.vendido === 0)
    return { nivel: 'atencao', tag: 'Destravar', motivo: `${c.orcN} orçamentos (${brl(c.orcBRL)}) e 0 venda ETIQUETADA — conferir vendas reais antes de cobrar fechamento` }
  if (c.totalPassado >= 80 && semPct >= 0.3)
    return { nivel: 'atencao', tag: 'Etiquetar', motivo: `${Math.round(semPct * 100)}% dos clientes sem etiqueta — pedir pra etiquetar pra dar pra acompanhar` }
  return { nivel: 'ok', tag: 'Em dia', motivo: c.v.vendido > 0 ? `${c.v.vendido} leads marcados VENDIDO` : 'em dia' }
}

const ORDEM_VEREDITO: Record<CardVend['veredito']['nivel'], number> = { cobrar: 0, atencao: 1, ok: 2 }

/**
 * Mescla painel (etiqueta) + atendimentos (qualif IA) + orçamentos (R$) + cobertura
 * pelo 1º nome, calcula o veredito e ordena por gravidade (cobrar primeiro). Daniel fora.
 *
 * Merge mantendo o MAIOR bucket: quando o responsável tem grafia dupla ("Igor" e "IGOR"
 * → 2 linhas), um Map simples ficava com a ÚLTIMA (a menor) e zerava a linha.
 */
export function montarCardsVendedor(
  painel: VendedorPainel[],
  sla: SlaVendedor[],
  orc: OrcamentosResumo | undefined,
  cobertura: VendedorCobertura[],
): CardVend[] {
  const maiorPorNome = <T,>(rows: T[], nome: (t: T) => string, tam: (t: T) => number): Map<string, T> => {
    const m = new Map<string, T>()
    for (const r of rows) {
      const k = chaveNome(nome(r))
      const cur = m.get(k)
      if (!cur || tam(r) > tam(cur)) m.set(k, r)
    }
    return m
  }
  const slaByNome = maiorPorNome(sla, s => s.vendedor, s => s.totalLeads ?? 0)
  const orcByNome = maiorPorNome(orc?.porVendedor ?? [], o => o.vendedor, o => o.n ?? 0)
  const cobByNome = maiorPorNome(cobertura, c => c.vendedor, c => c.total_passado ?? 0)

  return painel
    .filter(v => !foraDoRanking(v.vendedor))
    .map(v => {
      const k = chaveNome(v.vendedor)
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

/* ═══════════════════════════════════════════════════════════════════════════
   3 · TABELA COMPARATIVA — uma linha por vendedor
   ═══════════════════════════════════════════════════════════════════════════ */

const VEREDITO_UI: Record<CardVend['veredito']['nivel'], { Icon: typeof AlertTriangle; cls: string }> = {
  cobrar:  { Icon: AlertTriangle, cls: 'text-danger border-danger/40 bg-danger-bg' },
  atencao: { Icon: Clock,         cls: 'text-warning border-warning/40 bg-warning-bg' },
  ok:      { Icon: CheckCircle2,  cls: 'text-success border-success/40 bg-success-bg' },
}

/** Célula numérica. `vazio` distingue "zero medido" (0) de "sem fonte" (· · ·). */
function Num({ v, forte = false }: { v: number | null; forte?: boolean }) {
  if (v == null) {
    return (
      <td className="px-3 py-3 text-right text-micro text-ink-faint tabular-nums" title="Indisponível — sem fonte de dados">
        · · ·
      </td>
    )
  }
  return (
    <td className={`px-3 py-3 text-right text-label tabular-nums ${v === 0 ? 'text-ink-faint' : forte ? 'text-ink' : 'text-ink-muted'}`}>
      {n(v)}
    </td>
  )
}

function TabelaEquipe({ cards, corridaPorNome, onAbrir }: {
  cards: CardVend[]
  corridaPorNome: Map<string, CorridaVendedor>
  onAbrir: (nome: string, gatilho: HTMLElement | null) => void
}) {
  const { periodoLabel } = useJanela()

  const tot = useMemo(() => cards.reduce((a, c) => {
    const cor = corridaPorNome.get(chaveNome(c.nome))
    return {
      atribuidos: a.atribuidos + c.totalPassado,
      atendimentos: a.atendimentos + c.contatos,
      proposta: a.proposta + c.orcN,
      negociando: a.negociando + c.v.follow_up,
      quentes: a.quentes + c.v.quente,
      vendas: a.vendas + (cor?.numVendas ?? 0),
      brl: a.brl + (cor?.valor ?? 0),
    }
  }, { atribuidos: 0, atendimentos: 0, proposta: 0, negociando: 0, quentes: 0, vendas: 0, brl: 0 }), [cards, corridaPorNome])

  if (!cards.length) {
    return (
      <Card id="tabela-equipe">
        <CardHeader
          title="Comparativo da equipe"
          janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        />
        <p className="text-body text-ink-faint">Sem vendedores no período.</p>
      </Card>
    )
  }

  const th = 'px-3 py-2 text-right text-micro font-medium uppercase tracking-wide text-ink-faint whitespace-nowrap'

  return (
    <Card id="tabela-equipe">
      <CardHeader
        title="Comparativo da equipe"
        subtitle="Uma linha por vendedor. Clique na linha para abrir o detalhe completo — sem empilhar nove painéis."
        janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <caption className="sr-only">
            Comparativo por vendedor: leads atribuídos, atendimentos, ligações, propostas,
            negociação, quentes e vendas fechadas.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th rowSpan={2} scope="col" className="px-3 py-2 text-left text-micro font-medium uppercase tracking-wide text-ink-faint align-bottom">
                Vendedor
              </th>
              <th colSpan={6} scope="colgroup" className="px-3 py-2 text-left text-micro font-medium text-ink-muted">
                <span className="inline-flex items-center gap-2">
                  Atividade <JanelaBadge tipo="periodo" label={periodoLabel} />
                </span>
              </th>
              <th colSpan={3} scope="colgroup" className="px-3 py-2 text-left text-micro font-medium text-ink-muted">
                <span className="inline-flex items-center gap-2">
                  Vendas fechadas <JanelaBadge tipo="mes" label="mês corrente" />
                </span>
              </th>
            </tr>
            <tr className="border-b border-border">
              <th scope="col" className={th} title="Clientes passados para ele no período (RPC de cobertura). A SOMA desta coluna conta atribuições, não pessoas distintas.">
                Leads atribuídos
              </th>
              <th scope="col" className={th} title="Linhas de atendimento no período (SLA por vendedor).">Atendimentos</th>
              <th scope="col" className={th} title="Sem fonte no CRM: a captura de ligação vive na extensão do WhatsApp e ainda não chega ao dashboard.">Ligações</th>
              <th scope="col" className={th} title="Clientes distintos com proposta montada no builder (orcamentos_gerados).">Com proposta</th>
              <th scope="col" className={th} title="Etiqueta FOLLOW-UP no WhatsApp — onde a negociação começa.">Negociando</th>
              <th scope="col" className={th} title="Etiqueta LEAD QUENTE no WhatsApp.">Quentes</th>
              <th scope="col" className={th} title="Pedidos não cancelados no mês corrente (fonte: Controle).">Vendas</th>
              <th scope="col" className={th} title="Valor líquido de ajustes no mês corrente (fonte: Controle).">R$</th>
              <th scope="col" className={th} title="Valor do mês ÷ meta individual da corrida.">% meta</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {cards.map(c => {
              const cor = corridaPorNome.get(chaveNome(c.nome))
              const ui = VEREDITO_UI[c.veredito.nivel]
              const p = cor?.pct ?? 0
              return (
                <tr
                  key={c.nome}
                  onClick={e => onAbrir(c.nome, e.currentTarget.querySelector('button'))}
                  className="cursor-pointer transition-colors hover:bg-surface-2"
                >
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onAbrir(c.nome, e.currentTarget) }}
                      aria-label={`Abrir detalhe de ${c.nome}`}
                      className="group flex min-h-[44px] w-full items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="min-w-0 break-words text-label text-ink group-hover:text-accent">{c.nome}</span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-micro ${ui.cls}`}
                        title={c.veredito.motivo}
                      >
                        <ui.Icon className="h-3 w-3" aria-hidden="true" />
                        {c.veredito.tag}
                      </span>
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-ink-faint group-hover:text-accent" aria-hidden="true" />
                    </button>
                  </td>
                  <Num v={c.totalPassado} forte />
                  <Num v={c.contatos} />
                  <Num v={null} />
                  <Num v={c.orcN} forte />
                  <Num v={c.v.follow_up} />
                  <Num v={c.v.quente} />
                  <Num v={cor?.numVendas ?? 0} forte />
                  <td className="px-3 py-3 text-right text-label tabular-nums text-ink" title={brlFull(cor?.valor ?? 0)}>
                    {cor ? brl(cor.valor) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2">
                        <div className={`h-full rounded-full ${barMeta(p)}`} style={{ width: `${Math.max(Math.min(p, 100), 2)}%` }} />
                      </div>
                      <span className={`w-12 shrink-0 text-right text-label tabular-nums ${txtMeta(p)}`}>
                        {cor ? pct(p, 0) : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-border-strong">
              <td className="px-3 py-3 text-label text-ink-muted">
                Total <span className="text-micro text-ink-faint">({cards.length} vendedores)</span>
              </td>
              <td className="px-3 py-3 text-right text-label tabular-nums text-ink" title="Soma de atribuições, não de pessoas distintas.">
                {n(tot.atribuidos)}
                <span className="block text-micro font-normal text-ink-faint">atribuições</span>
              </td>
              <Num v={tot.atendimentos} />
              <Num v={null} />
              <Num v={tot.proposta} forte />
              <Num v={tot.negociando} />
              <Num v={tot.quentes} />
              <Num v={tot.vendas} forte />
              <td className="px-3 py-3 text-right text-label tabular-nums text-ink" title={brlFull(tot.brl)}>{brl(tot.brl)}</td>
              <td className="px-3 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-surface-2 p-3">
        <Info className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <p className="text-micro text-ink-muted">
          <strong className="text-ink">A coluna soma atribuições, não pessoas.</strong> Um cliente que está no
          WhatsApp de dois vendedores aparece nas duas linhas — por isso o total do rodapé diz
          &ldquo;atribuições&rdquo;. Para contar clientes distintos, use a tela de Contatos.
          <span className="block mt-1">
            &ldquo;Ligações&rdquo; aparece como <span className="tabular-nums">· · ·</span>: o dado é capturado
            na extensão do WhatsApp e ainda não chega ao CRM. Zero medido seria <span className="tabular-nums">0</span>.
          </span>
        </p>
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · DRAWER DE DETALHE DO VENDEDOR (portado de VendedorCard, ~1761)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Etapas do funil na ORDEM real da Branorte. Cores por token de gráfico. */
const ETAPAS_FUNIL: { key: keyof VendedorPainel; label: string; cls: string; negociacao: boolean }[] = [
  { key: 'prospeccao', label: 'Prospecção', cls: 'bg-chart-2/50', negociacao: false },
  { key: 'novo',       label: 'Novo lead',  cls: 'bg-chart-2',    negociacao: false },
  { key: 'follow_up',  label: 'Follow-up',  cls: 'bg-chart-3',    negociacao: true },
  { key: 'quente',     label: 'Quente',     cls: 'bg-chart-4',    negociacao: true },
  { key: 'orcamento',  label: 'Orçamento',  cls: 'bg-chart-5',    negociacao: true },
  { key: 'vendido',    label: 'Vendido',    cls: 'bg-chart-1',    negociacao: true },
]

const MOTIVOS_LABEL: { key: keyof VendedorPainel; label: string }[] = [
  { key: 'm_nunca_respondeu',    label: 'Nunca respondeu' },
  { key: 'm_nao_respondeu_mais', label: 'Sumiu na conversa' },
  { key: 'm_so_preco',           label: 'Só base de preço' },
  { key: 'm_fora_orcamento',     label: 'Fora do orçamento' },
  { key: 'm_nao_fabricamos',     label: 'Não fabricamos' },
  { key: 'm_sem_interesse',      label: 'Sem interesse' },
  { key: 'm_concorrente',        label: 'Comprou concorrente' },
  { key: 'm_transportadora',     label: 'Transportadora' },
  { key: 'm_suporte',            label: 'Suporte técnico' },
  { key: 'm_outros',             label: 'Outros' },
]

function BlocoTitulo({ Icon, children }: { Icon: typeof Users; children: ReactNode }) {
  return (
    <h4 className="mb-3 flex items-center gap-2 text-label text-ink-muted">
      <Icon className="h-4 w-4 text-ink-faint" aria-hidden="true" />
      {children}
    </h4>
  )
}

function DrawerVendedor({ card, corrida, orfao, onFechar }: {
  card: CardVend
  corrida: CorridaVendedor | undefined
  orfao: OrfaosPorVendedor['por_vendedor'][number] | undefined
  onFechar: () => void
}) {
  const { periodoLabel } = useJanela()
  const painelRef = useRef<HTMLDivElement>(null)

  // Esc fecha · foco entra no painel ao abrir · trava a rolagem do fundo.
  // (o retorno de foco ao gatilho é feito por quem abriu — ver `abrir`/`fechar`)
  useEffect(() => {
    painelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    document.addEventListener('keydown', onKey)
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflowAntes
    }
  }, [onFechar])

  const { v, nome, contatos, qualifIa, orcN, orcBRL, totalPassado, comEtiqueta, semEtiqueta } = card
  const ui = VEREDITO_UI[card.veredito.nivel]
  const qualPct = contatos > 0 && qualifIa != null ? Math.round((qualifIa / contatos) * 100) : null
  const semPct = totalPassado > 0 ? Math.round((semEtiqueta / totalPassado) * 100) : 0
  const reconTotal = Math.max(comEtiqueta + semEtiqueta, 1)

  const etapas = ETAPAS_FUNIL.map(e => ({ ...e, n: Number(v[e.key] ?? 0) }))
  const maxEtapa = Math.max(...etapas.map(e => e.n), 1)

  const motivos = MOTIVOS_LABEL
    .map(m => ({ label: m.label, n: Number(v[m.key] ?? 0) }))
    .filter(m => m.n > 0)
    .sort((a, b) => b.n - a.n)
  const motivosSoma = motivos.reduce((s, m) => s + m.n, 0)
  const perdidoSemMotivo = Math.max(0, v.perdido - motivosSoma)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Fundo: clicar fecha. Tokenizado (bg do tema) para acompanhar claro/escuro. */}
      <div
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />

      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe de ${nome}`}
        tabIndex={-1}
        className={[
          'relative flex h-full w-full flex-col bg-surface shadow-2xl outline-none',
          'sm:w-[min(560px,100%)] sm:border-l sm:border-border',
          'focus-visible:ring-2 focus-visible:ring-accent',
        ].join(' ')}
      >
        {/* Cabeçalho fixo */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-title text-ink">{nome}</h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-micro ${ui.cls}`}
                title={card.veredito.motivo}
              >
                <ui.Icon className="h-3 w-3" aria-hidden="true" />
                {card.veredito.tag}
              </span>
            </div>
            <p className="mt-1 text-micro text-ink-muted">{card.veredito.motivo}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar detalhe do vendedor"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Corpo rolável */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Resumo ─────────────────────────────────────────────────── */}
          <section>
            <BlocoTitulo Icon={Users}>
              Resumo <JanelaBadge tipo="periodo" label={periodoLabel} />
            </BlocoTitulo>
            <div className="grid grid-cols-2 gap-3">
              <Inner>
                <div className="text-kpi-sm text-ink tabular-nums">{n(totalPassado)}</div>
                <div className="mt-1 text-micro text-ink-faint">clientes atribuídos</div>
              </Inner>
              <Inner>
                <div className="text-kpi-sm text-ink tabular-nums">{n(contatos)}</div>
                <div className="mt-1 text-micro text-ink-faint">atendimentos</div>
              </Inner>
              <Inner>
                <div className="text-kpi-sm text-ink tabular-nums">{qualifIa != null ? n(qualifIa) : '· · ·'}</div>
                <div className="mt-1 text-micro text-ink-faint">
                  qualificados pela IA{qualPct != null ? ` (${qualPct}%)` : ''}
                </div>
              </Inner>
              <Inner tone={card.ultimaDias != null && card.ultimaDias > 4 ? 'perigo' : 'neutro'}>
                <div className="text-kpi-sm text-ink tabular-nums">
                  {card.ultimaDias != null ? `${card.ultimaDias}d` : '· · ·'}
                </div>
                <div className="mt-1 text-micro text-ink-faint">desde a última proposta</div>
              </Inner>
            </div>
          </section>

          {/* ── Cobertura: etiquetou vs deixou sem etiqueta ─────────────── */}
          {(comEtiqueta + semEtiqueta) > 0 && (
            <section>
              <BlocoTitulo Icon={Target}>Cobertura dos clientes atribuídos</BlocoTitulo>
              <div
                className="flex h-3 overflow-hidden rounded-full bg-surface-2"
                role="img"
                aria-label={`${n(comEtiqueta)} clientes etiquetados e ${n(semEtiqueta)} sem etiqueta`}
              >
                <div className="bg-success" style={{ width: `${(comEtiqueta / reconTotal) * 100}%` }} />
                <div className="bg-warning" style={{ width: `${(semEtiqueta / reconTotal) * 100}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-micro">
                <span className="inline-flex items-center gap-2 text-ink-muted">
                  <span className="inline-block h-2 w-2 rounded-sm bg-success" aria-hidden="true" />
                  Etiquetados <b className="tabular-nums text-ink">{n(comEtiqueta)}</b>
                  {v.perdido > 0 && <span className="text-ink-faint">(perdeu {n(v.perdido)})</span>}
                </span>
                <span className={`inline-flex items-center gap-2 ${semPct >= 40 ? 'text-danger' : semPct >= 25 ? 'text-warning' : 'text-ink-muted'}`}>
                  <span className="inline-block h-2 w-2 rounded-sm bg-warning" aria-hidden="true" />
                  Sem etiqueta nenhuma <b className="tabular-nums">{n(semEtiqueta)}</b> ({semPct}%)
                </span>
              </div>
            </section>
          )}

          {/* ── Funil de etiqueta ───────────────────────────────────────── */}
          <section>
            <BlocoTitulo Icon={Handshake}>Funil de etiqueta no WhatsApp</BlocoTitulo>
            <div className="space-y-2">
              {etapas.map((e, i) => (
                <div key={e.label}>
                  {i > 0 && !etapas[i - 1].negociacao && e.negociacao && (
                    <div className="my-2 flex items-center gap-2 text-micro uppercase tracking-wide text-warning">
                      <span className="h-px flex-1 bg-warning/30" />negociação<span className="h-px flex-1 bg-warning/30" />
                    </div>
                  )}
                  <div className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-2">
                    <span className="min-w-0 break-words text-micro text-ink-muted">{e.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${e.cls}`}
                        style={{ width: `${Math.max((e.n / maxEtapa) * 100, e.n > 0 ? 6 : 0)}%` }}
                      />
                    </div>
                    <span className="text-right text-label tabular-nums text-ink">{e.n || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-micro text-ink-faint">
              Sondagem → negociação. Estado atual da etiqueta, não marcos sequenciais.
            </p>
          </section>

          {/* ── Propostas ───────────────────────────────────────────────── */}
          <section>
            <BlocoTitulo Icon={FileText}>
              Propostas montadas <JanelaBadge tipo="periodo" label={periodoLabel} />
            </BlocoTitulo>
            <Link
              to={`/orcamentos/salvos?vendedor=${encodeURIComponent(primeiroNome(nome))}`}
              className="group flex min-h-[44px] items-center gap-3 rounded-lg border border-success/30 bg-success-bg p-3 transition-colors hover:border-success/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <FileText className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0 text-label text-ink-muted">Clientes com proposta</span>
              <span className="text-label tabular-nums text-ink">{n(orcN)}</span>
              {orcBRL > 0 && (
                <span className="text-label tabular-nums text-success" title={brlFull(orcBRL)}>{brl(orcBRL)}</span>
              )}
              {orcN === 0 && <span className="text-micro text-ink-faint">nenhuma no sistema</span>}
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-faint group-hover:text-success" aria-hidden="true" />
            </Link>
          </section>

          {/* ── Vendas fechadas + ligações ──────────────────────────────── */}
          <section>
            <BlocoTitulo Icon={Trophy}>
              Vendas fechadas <JanelaBadge tipo="mes" label="mês corrente" />
            </BlocoTitulo>
            <div className="grid grid-cols-2 gap-3">
              <Inner tone={corrida && corrida.pct >= 100 ? 'positivo' : 'neutro'}>
                <div className="text-kpi-sm text-ink tabular-nums break-words" title={brlFull(corrida?.valor ?? 0)}>
                  {corrida ? brl(corrida.valor) : '—'}
                </div>
                <div className="mt-1 text-micro text-ink-faint">
                  {corrida ? `${n(corrida.numVendas)} ${corrida.numVendas === 1 ? 'pedido' : 'pedidos'} · ${pct(corrida.pct, 0)} da meta` : 'sem pedido no mês'}
                </div>
              </Inner>
              <Inner>
                <div className="text-kpi-sm text-ink tabular-nums">{n(v.vendido)}</div>
                <div className="mt-1 text-micro text-ink-faint">leads etiquetados VENDIDO no período</div>
              </Inner>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-surface-2 p-3">
              <Phone className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
              <p className="text-micro text-ink-muted">
                <strong className="text-ink">Ligações: <span className="tabular-nums">· · ·</span></strong> — o
                registro de chamada é capturado na extensão do WhatsApp e ainda não chega ao CRM.
                Não é zero: é ausência de fonte.
              </p>
            </div>
          </section>

          {/* ── Motivos de perda ────────────────────────────────────────── */}
          {v.perdido > 0 && (
            <section>
              <BlocoTitulo Icon={Flame}>Perdeu {n(v.perdido)} — por quê</BlocoTitulo>
              <ul className="flex flex-wrap gap-2">
                {motivos.map(m => (
                  <li key={m.label} className="rounded-sm bg-danger-bg px-2 py-1 text-micro tabular-nums text-danger">
                    {m.label} <b>{n(m.n)}</b>
                  </li>
                ))}
                {perdidoSemMotivo > 0 && (
                  <li
                    className="rounded-sm bg-surface-2 px-2 py-1 text-micro tabular-nums text-ink-faint"
                    title="Perdidos sem motivo específico marcado"
                  >
                    Sem motivo marcado <b>{n(perdidoSemMotivo)}</b>
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* ── Clientes que precisam de ação ───────────────────────────── */}
          <section>
            <BlocoTitulo Icon={Ghost}>
              Clientes que precisam de ação <JanelaBadge tipo="fixo" label="parados +7 dias" />
            </BlocoTitulo>
            {orfao && orfao.n > 0 ? (
              <Inner tone="atencao">
                <div className="flex items-baseline gap-2">
                  <span className="text-kpi-sm text-warning tabular-nums">{n(orfao.n)}</span>
                  <span className="text-micro text-ink-muted">leads travados antes da negociação</span>
                </div>
                <ul className="mt-3 space-y-2 text-micro">
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-muted">Prospecção / tentativa</span>
                    <span className="tabular-nums text-ink">{n(orfao.prospeccao)}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-muted">Novo lead</span>
                    <span className="tabular-nums text-ink">{n(orfao.novo)}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-danger">Sem etiqueta nenhuma</span>
                    <span className="tabular-nums text-danger">{n(orfao.sem_etiqueta)}</span>
                  </li>
                </ul>
                <p className="mt-3 text-micro text-ink-muted">
                  &ldquo;Sem etiqueta&rdquo; é o pior caso: nem foi registrado. Cobrar o próximo passo.
                </p>
              </Inner>
            ) : (
              <p className="text-body text-ink-faint">Nenhum lead parado há mais de 7 dias.</p>
            )}
          </section>
        </div>

        {/* Rodapé fixo: ações */}
        <div className="border-t border-border p-5">
          <Link
            to={`/atendimentos?responsavel=${encodeURIComponent(nome)}`}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-label text-ink transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Ver atendimentos de {primeiroNome(nome)}
          </Link>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · HEATMAP DIA × HORA (portado de HeatmapDiaHora, ~3116)
   ═══════════════════════════════════════════════════════════════════════════ */

const DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// 4 níveis discretos, todos tokenizados (o original usava hsl() fixo, que não
// respondia ao dark mode). Alpha ≤ 60% mantém `text-ink` legível por cima.
const NIVEL_CLS = ['bg-surface-2', 'bg-success/15', 'bg-success/35', 'bg-success/60'] as const
const NIVEL_LABEL = ['Vazio', 'Baixo', 'Médio', 'Pico'] as const

function HeatmapDiaHora({ heatmap }: { heatmap: { dow: number; hour: number; total: number }[] }) {
  const matriz: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxVal = 0
  let pico = { dia: 0, hora: 0, val: 0 }
  for (const h of heatmap) {
    const di = h.dow >= 1 && h.dow <= 7 ? h.dow - 1 : 6
    if (h.hour >= 0 && h.hour < 24) {
      matriz[di][h.hour] = h.total
      if (h.total > maxVal) maxVal = h.total
      if (h.total > pico.val) pico = { dia: di, hora: h.hour, val: h.total }
    }
  }
  const totalPorDia = matriz.map(row => row.reduce((s, v) => s + v, 0))
  const totalPorHora = Array.from({ length: 24 }, (_, h) => matriz.reduce((s, row) => s + row[h], 0))
  const totalGeral = totalPorDia.reduce((s, v) => s + v, 0)
  const maxHora = Math.max(...totalPorHora, 1)
  const diaForte = totalPorDia.indexOf(Math.max(...totalPorDia))
  // Janela comercial padrão: seg-sex, 8h às 18h
  const dentroComercial = matriz.reduce((s, row, di) =>
    s + row.slice(8, 19).reduce((a, b) => a + b, 0) * (di < 5 ? 1 : 0), 0)
  const pctComercial = totalGeral > 0 ? Math.round((dentroComercial / totalGeral) * 100) : 0

  if (totalGeral === 0) {
    return <p className="text-body text-ink-faint">Sem dados no período.</p>
  }

  const nivel = (v: number): 0 | 1 | 2 | 3 => {
    if (v === 0) return 0
    const r = v / (maxVal || 1)
    if (r >= 0.66) return 3
    if (r >= 0.33) return 2
    return 1
  }

  return (
    <div className="space-y-5">
      {/* Leitura rápida: pico, dia mais forte, % no horário comercial */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Inner tone="positivo">
          <div className="text-micro uppercase tracking-wide text-ink-faint">Pico</div>
          <div className="mt-1 text-label text-ink">{DOW[pico.dia]} {pico.hora}h</div>
          <div className="text-micro tabular-nums text-ink-muted">{n(pico.val)} leads</div>
        </Inner>
        <Inner>
          <div className="text-micro uppercase tracking-wide text-ink-faint">Dia mais movimentado</div>
          <div className="mt-1 text-label text-ink">{DOW[diaForte]}</div>
          <div className="text-micro tabular-nums text-ink-muted">{n(totalPorDia[diaForte])} leads</div>
        </Inner>
        <Inner tone={pctComercial >= 70 ? 'positivo' : pctComercial >= 50 ? 'atencao' : 'perigo'}>
          <div className="text-micro uppercase tracking-wide text-ink-faint">No horário comercial</div>
          <div className="mt-1 text-label text-ink tabular-nums">{pctComercial}%</div>
          <div className="text-micro text-ink-muted">seg a sex · 8h às 18h</div>
        </Inner>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <caption className="sr-only">Leads por dia da semana e hora, últimos 30 dias, fuso de Brasília.</caption>
          <thead>
            <tr>
              <th className="w-12" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="w-8 text-center text-micro font-normal text-ink-faint">{h}</th>
              ))}
              <th scope="col" className="w-10 pl-2 text-center text-micro font-normal text-ink-faint" title="Total do dia">Total</th>
            </tr>
          </thead>
          <tbody>
            {DOW.map((d, di) => (
              <tr key={d}>
                <th scope="row" className="pr-2 text-right text-micro font-medium text-ink-muted">{d}</th>
                {matriz[di].map((v, h) => {
                  const nv = nivel(v)
                  return (
                    <td
                      key={h}
                      className={`h-8 w-8 rounded-sm text-center ${NIVEL_CLS[nv]}`}
                      title={`${d} ${h}h — ${n(v)} ${v === 1 ? 'lead' : 'leads'} (${NIVEL_LABEL[nv]})`}
                    >
                      <span className="text-micro tabular-nums text-ink">{nv >= 2 ? n(v) : ''}</span>
                    </td>
                  )
                })}
                <td className="pl-2 text-right text-micro tabular-nums text-ink-muted">{n(totalPorDia[di])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="pr-2 text-right text-micro font-normal text-ink-faint">Hora</th>
              {totalPorHora.map((t, h) => (
                <td key={h} className="align-middle" title={`${h}h — ${n(t)} leads na semana toda`}>
                  <div className="h-3 overflow-hidden rounded-sm bg-surface-2">
                    <div className="h-full bg-info" style={{ width: `${(t / maxHora) * 100}%` }} />
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-micro text-ink-faint">
        <span>Intensidade:</span>
        {NIVEL_LABEL.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-sm ${NIVEL_CLS[i]}`} aria-hidden="true" />
            {label}
          </span>
        ))}
        <span className="sm:ml-auto">Fuso de Brasília</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ABA
   ═══════════════════════════════════════════════════════════════════════════ */

export function TabEquipe() {
  const { preset, periodoLabel } = useJanela()

  const { data } = useDashboard({ preset })
  const { data: vendasReais } = useVendasReais()
  const { data: orc } = useOrcamentosResumo(preset)
  const { data: vendPainel } = useVendedoresPainel(preset)
  const { data: cobertura } = useVendedorCobertura(preset)
  // Órfãos usam janela por IDADE (>7d), não o filtro do topo — de propósito.
  const { data: orfaos } = useOrfaosPorVendedor(7)
  // Heatmap usa janela fixa (30d) — ignora o filtro do topo, de propósito.
  const { data: heatmap30d } = useHeatmapSemanal()

  const cards = useMemo(
    () => montarCardsVendedor(vendPainel ?? [], data?.slaPorVendedor ?? [], orc, cobertura ?? []),
    [vendPainel, data?.slaPorVendedor, orc, cobertura],
  )

  const corridaPorNome = useMemo(
    () => new Map((vendasReais?.corrida ?? []).map(c => [chaveNome(c.vendedor), c])),
    [vendasReais?.corrida],
  )

  const orfaoPorNome = useMemo(
    () => new Map((orfaos?.por_vendedor ?? []).map(o => [chaveNome(o.vendedor), o])),
    [orfaos?.por_vendedor],
  )

  // Drawer: guarda o gatilho pra devolver o foco no fechamento (WCAG 2.4.3).
  const [aberto, setAberto] = useState<string | null>(null)
  const gatilhoRef = useRef<HTMLElement | null>(null)

  const abrir = useCallback((nome: string, gatilho: HTMLElement | null) => {
    gatilhoRef.current = gatilho
    setAberto(nome)
  }, [])

  const fechar = useCallback(() => {
    setAberto(null)
    const g = gatilhoRef.current
    gatilhoRef.current = null
    // devolve o foco no próximo frame, quando o drawer já saiu da árvore
    requestAnimationFrame(() => g?.focus?.())
  }, [])

  const cardAberto = aberto ? cards.find(c => c.nome === aberto) ?? null : null

  return (
    <>
      <div className="space-y-5">
        {/* 1 · Ranking de vendas — indivíduo | time (um bloco só) */}
        <RankingVendas vendas={vendasReais} />

        {/* 2 · Comparativo da equipe — clique abre o detalhe */}
        <TabelaEquipe cards={cards} corridaPorNome={corridaPorNome} onAbrir={abrir} />

        {/* 3 · Resumo do dia por vendedor (componente de outro dono) */}
        <ResumoDiaVendedores preset={preset} periodoLabel={periodoLabel} />

        {/* 4 · Quando chegam os leads — janela fixa de 30 dias */}
        <Card id="quando-chegam">
          <CardHeader
            title="Quando chegam os leads"
            subtitle="Dia da semana × hora. Serve pra escalar plantão e turno de atendimento."
            janela={<JanelaBadge tipo="fixo" label="últimos 30 dias" />}
          />
          {heatmap30d && heatmap30d.length > 0
            ? <HeatmapDiaHora heatmap={heatmap30d} />
            : <p className="text-body text-ink-faint">Sem dados no período.</p>}
        </Card>
      </div>

      {/* Detalhe do vendedor (drawer). FORA do space-y-5 de propósito: o seletor
          `> * + *` colocaria margin-top num elemento `fixed inset-0` e o painel
          desceria 20px, deixando uma faixa do fundo clicável no topo. */}
      {cardAberto && (
        <DrawerVendedor
          card={cardAberto}
          corrida={corridaPorNome.get(chaveNome(cardAberto.nome))}
          orfao={orfaoPorNome.get(chaveNome(cardAberto.nome))}
          onFechar={fechar}
        />
      )}
    </>
  )
}
