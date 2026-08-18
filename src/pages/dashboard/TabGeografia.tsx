import { lazy, Suspense, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp,
  FilePlus2, Flame, Globe, ListOrdered, Map as MapIcon, Users,
} from 'lucide-react'
import { useDashboard, UF_NOMES, PAIS_SIGLAS } from '@/hooks/useDashboard'
import { useDashboardOrcamentosDetalhe } from '@/hooks/useDashboardOrcamentos'
import { useNegociacaoPorUf } from '@/hooks/useNegociacaoPorUf'
import { DDD_TO_UF } from '@/lib/ddd-uf'
import { useJanela } from './DashboardFilterContext'
import { Card, CardHeader, Inner } from './ui/Card'
import { JanelaBadge, type TipoJanela } from './ui/JanelaBadge'
import { brl, brlFull, n, pct } from './ui/format'

/**
 * ABA GEOGRAFIA — "de onde vem?"
 *
 * O que mudou em relação ao Dashboard antigo:
 *
 *  - Eram TRÊS mapas do Brasil empilhados (Distribuição geográfica, Orçamentos
 *    por estado, Onde está a negociação), ~1.100px de altura, cada um com a sua
 *    própria legenda e a sua própria lista de UFs repetida embaixo. Os três
 *    respondiam à mesma pergunta com recortes diferentes e, pior, com JANELAS
 *    diferentes (dois seguiam o filtro do topo, o de negociação era snapshot)
 *    sem nada na tela avisando.
 *  - Agora é UM mapa com seletor de camada. A camada escolhida manda no mapa,
 *    na legenda, no ranking e no carimbo de janela — os três andam juntos.
 *  - `NegociacaoGeo` foi deletado: era cópia literal de `DistribuicaoGeo` com o
 *    hue trocado e uma lista de UFs quase igual à `UfList`.
 *  - Entrou a tabela comparativa: as três métricas LADO A LADO por estado, que é
 *    o que responde "onde entra lead e não sai proposta" sem rolar três mapas.
 */

// Mapa choropleth do Brasil — lazy (o Leaflet só é baixado quando esta aba abre).
const MapaBrasilLeads = lazy(() => import('@/components/MapaBrasilLeads'))

type UfItem = { uf: string; nome: string; total: number; pct: number; isBrasil: boolean }

type CamadaId = 'leads' | 'orcamentos' | 'negociacao'

type Camada = {
  id: CamadaId
  label: string
  Icon: typeof Users
  /**
   * Matiz do choropleth. É o mesmo H dos tokens --chart-*, que não muda entre o
   * tema claro e o escuro — assim o mapa e a barra do ranking ficam da mesma cor
   * nos dois temas, mesmo o mapa montando a cor por conta própria.
   */
  hue: number
  barra: string
  faixa: [string, string, string]
  /** Como o número se chama nesta camada (entra na legenda e no leitor de tela). */
  unidade: string
  janela: TipoJanela
  explica: string
}

const CAMADAS: Camada[] = [
  {
    id: 'leads', label: 'Leads', Icon: Users,
    hue: 211, barra: 'bg-chart-2', faixa: ['bg-chart-2/30', 'bg-chart-2/60', 'bg-chart-2'],
    unidade: 'leads', janela: 'periodo',
    explica: 'Leads do período por estado — UF pelo DDD do telefone.',
  },
  {
    id: 'orcamentos', label: 'Orçamentos', Icon: FilePlus2,
    hue: 38, barra: 'bg-chart-3', faixa: ['bg-chart-3/30', 'bg-chart-3/60', 'bg-chart-3'],
    unidade: 'clientes com orçamento', janela: 'periodo',
    explica: 'Clientes com orçamento montado no período, um por telefone.',
  },
  {
    id: 'negociacao', label: 'Em negociação', Icon: Flame,
    hue: 270, barra: 'bg-chart-5', faixa: ['bg-chart-5/30', 'bg-chart-5/60', 'bg-chart-5'],
    unidade: 'leads em negociação', janela: 'snapshot',
    explica: 'Estado ATUAL da etiqueta (follow-up + quente + orçamento). Não olha o filtro de período.',
  },
]

// ============================================================================

export function TabGeografia() {
  const { preset, periodoLabel } = useJanela()

  const { data, isLoading } = useDashboard({ preset })
  const { data: orcDetalhe } = useDashboardOrcamentosDetalhe(preset, true)
  const { data: negUf } = useNegociacaoPorUf()

  // Orçamentos por estado — UF pelo DDD do telefone canônico do cliente
  // (mesmo shape do mapa de leads). Cálculo idêntico ao do Dashboard antigo.
  const orcPorUf = useMemo<UfItem[]>(() => {
    const byUf = new Map<string, number>()
    for (const o of orcDetalhe ?? []) {
      const uf = DDD_TO_UF[String(o.fone ?? '').slice(0, 2)] ?? 'INTL'
      byUf.set(uf, (byUf.get(uf) ?? 0) + 1)
    }
    const total = [...byUf.values()].reduce((s, x) => s + x, 0) || 1
    return [...byUf.entries()]
      .map(([uf, x]) => ({
        uf, nome: UF_NOMES[uf] ?? uf, total: x,
        pct: Math.round((x / total) * 1000) / 10,
        isBrasil: UF_NOMES[uf] !== undefined && uf !== 'INTL' && !PAIS_SIGLAS.has(uf),
      }))
      .sort((a, b) => b.total - a.total)
  }, [orcDetalhe])

  // R$ orçado por estado — mesmo agrupamento do orcPorUf, somando valor_total.
  // NÃO vira camada do mapa (ver comentário do seletor); vive no ranking e na tabela.
  const valorPorUf = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orcDetalhe ?? []) {
      const uf = DDD_TO_UF[String(o.fone ?? '').slice(0, 2)] ?? 'INTL'
      m.set(uf, (m.get(uf) ?? 0) + (o.valor_total ?? 0))
    }
    return m
  }, [orcDetalhe])

  // Leads em negociação por estado. Reaproveita o nome do estado vindo do porUf
  // (mesma tabela UF→nome) e calcula % sobre o total em negociação.
  const negItems = useMemo<UfItem[]>(() => {
    const nomeByUf = new Map((data?.porUf ?? []).map(u => [u.uf, u.nome]))
    const lista = (negUf ?? []).filter(x => x.uf && x.total > 0)
    const tot = lista.reduce((s, x) => s + x.total, 0) || 1
    return lista
      .map(x => ({
        uf: x.uf, nome: nomeByUf.get(x.uf) ?? UF_NOMES[x.uf] ?? x.uf,
        total: x.total, pct: (x.total / tot) * 100, isBrasil: true,
      }))
      .sort((a, b) => b.total - a.total)
  }, [negUf, data?.porUf])

  const leadsItems: UfItem[] = data?.porUf ?? []

  const dados: Record<CamadaId, UfItem[]> = {
    leads: leadsItems,
    orcamentos: orcPorUf,
    negociacao: negItems,
  }

  // Só oferece a camada que tem dado — botão que abre um mapa vazio é armadilha.
  const disponiveis = CAMADAS.filter(c => dados[c.id].length > 0)

  const [camadaPref, setCamadaPref] = useState<CamadaId>('leads')
  const camada = disponiveis.find(c => c.id === camadaPref) ?? disponiveis[0] ?? CAMADAS[0]

  const [vista, setVista] = useState<'mapa' | 'ranking'>('mapa')

  const janelaLabel = camada.janela === 'snapshot' ? 'estado de agora' : periodoLabel
  const items = dados[camada.id]
  const brasil = items.filter(i => i.isBrasil)
  const intl = items.filter(i => !i.isBrasil)
  const totalCamada = items.reduce((s, i) => s + i.total, 0)

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-[520px] rounded-xl bg-surface-2 animate-pulse" />
        <div className="h-72 rounded-xl bg-surface-2 animate-pulse" />
      </div>
    )
  }

  if (disponiveis.length === 0) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="De onde vêm"
            subtitle="Leads, orçamentos e negociação por estado."
            janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
          />
          <Inner className="text-body text-ink-muted">Sem dados no período.</Inner>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── 1. MAPA ÚNICO + RANKING ───────────────────────────────────────── */}
      <Card id="geo-mapa">
        <CardHeader
          title="De onde vêm"
          subtitle={`${n(totalCamada)} ${camada.unidade} · ${brasil.length} ${brasil.length === 1 ? 'estado' : 'estados'} no Brasil${intl.length ? ` · ${intl.length} fora do país` : ''}`}
          janela={<JanelaBadge tipo={camada.janela} label={janelaLabel} />}
        />

        {/* Seletor de camada — troca o MESMO mapa, não empilha outro.
            "Valor (R$)" não entra aqui de propósito: o balão do MapaBrasilLeads
            escreve a palavra "leads" fixa, então pintar R$ ali mostraria
            "1257579 leads" no hover. O R$ está no ranking e na tabela abaixo,
            formatado. Pra virar camada, o mapa precisa aceitar a unidade. */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Métrica exibida no mapa">
          {disponiveis.map(c => {
            const ativa = c.id === camada.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCamadaPref(c.id)}
                aria-pressed={ativa}
                title={c.explica}
                className={[
                  'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 py-2 text-label transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  ativa
                    ? 'border-border-strong bg-surface-3 text-ink'
                    : 'border-border bg-surface-2 text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                <c.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{c.label}</span>
                <span className="tabular-nums text-ink-faint">{n(dados[c.id].reduce((s, i) => s + i.total, 0))}</span>
              </button>
            )
          })}
        </div>

        {/* Alternador só no celular: empilhar mapa + ranking dá 800px de rolagem
            pra ver a mesma informação duas vezes. */}
        <div className="mt-3 flex gap-2 lg:hidden" role="group" aria-label="Alternar entre mapa e ranking">
          {([['mapa', 'Mapa', MapIcon], ['ranking', 'Ranking', ListOrdered]] as const).map(([id, rotulo, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              aria-pressed={vista === id}
              className={[
                'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border px-3 py-2 text-label transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                vista === id
                  ? 'border-border-strong bg-surface-3 text-ink'
                  : 'border-border bg-surface-2 text-ink-muted',
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {rotulo}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Mapa */}
          <div className={vista === 'mapa' ? '' : 'hidden lg:block'}>
            {brasil.length === 0 ? (
              <Inner className="grid h-[330px] place-items-center text-body text-ink-muted">
                Sem dados no período.
              </Inner>
            ) : (
              <div
                role="img"
                aria-label={`Mapa do Brasil, estados coloridos por ${camada.unidade}. Os mesmos números estão no ranking ao lado.`}
              >
                <Suspense
                  fallback={
                    <div className="grid h-[330px] animate-pulse place-items-center rounded-lg bg-surface-2 text-label text-ink-faint">
                      Carregando mapa…
                    </div>
                  }
                >
                  {/* key: o efeito do MapaBrasilLeads só observa `items`; trocar a
                      camada remonta o Leaflet limpo e garante o hue novo. */}
                  <MapaBrasilLeads key={camada.id} items={brasil} hue={camada.hue} />
                </Suspense>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-micro text-ink-muted">
              <span>Menos</span>
              {camada.faixa.map((cor, i) => (
                <span key={i} className={`h-2 w-6 rounded-sm ${cor}`} aria-hidden="true" />
              ))}
              <span>Mais {camada.unidade}</span>
              <span className="ml-auto hidden sm:inline text-ink-faint">Passe o mouse num estado</span>
            </div>
          </div>

          {/* Ranking */}
          <div className={vista === 'ranking' ? '' : 'hidden lg:block'}>
            <Ranking
              brasil={brasil}
              intl={intl}
              camada={camada}
              janelaLabel={janelaLabel}
              valorPorUf={camada.id === 'orcamentos' ? valorPorUf : null}
            />
          </div>
        </div>

        {camada.id === 'leads' && leadsItems.length >= 20 && (
          <p className="mt-3 text-micro text-ink-faint">
            A fonte de leads entrega só os 20 maiores estados do período — quem ficou de fora
            aparece como indisponível, não como zero.
          </p>
        )}
      </Card>

      {/* ── 2. TABELA COMPARATIVA ─────────────────────────────────────────── */}
      <TabelaComparativa
        leads={leadsItems}
        orcamentos={orcPorUf}
        negociacao={negItems}
        valorPorUf={valorPorUf}
        periodoLabel={periodoLabel}
      />
    </div>
  )
}

// ============================================================================
// RANKING — porte do DistribuicaoGeo + UfList do arquivo antigo, com o nome do
// estado inteiro (a versão antiga usava `truncate` e cortava "Rio Grande do…").
// ============================================================================

const RANKING_INICIAL = 10

function Ranking({
  brasil, intl, camada, janelaLabel, valorPorUf,
}: {
  brasil: UfItem[]
  intl: UfItem[]
  camada: Camada
  janelaLabel: string
  valorPorUf: Map<string, number> | null
}) {
  const [tudo, setTudo] = useState(false)
  const max = Math.max(...brasil.map(i => i.total), 1)
  const lista = tudo ? brasil : brasil.slice(0, RANKING_INICIAL)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-title text-ink">Ranking de estados</h4>
        <JanelaBadge tipo={camada.janela} label={janelaLabel} />
      </div>

      {brasil.length === 0 ? (
        <p className="text-body text-ink-muted">Sem dados no período.</p>
      ) : (
        <ol className="divide-y divide-border">
          {lista.map(item => (
            <LinhaRanking
              key={item.uf}
              item={item}
              max={max}
              barra={camada.barra}
              valor={valorPorUf?.get(item.uf)}
            />
          ))}
        </ol>
      )}

      {brasil.length > RANKING_INICIAL && (
        <button
          type="button"
          onClick={() => setTudo(v => !v)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-2 text-label text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {tudo ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          {tudo ? 'Mostrar só o topo' : `Mostrar todos os ${brasil.length} estados`}
        </button>
      )}

      {intl.length > 0 && (
        <div className="mt-5 border-t border-border pt-3">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <h5 className="text-label text-ink">Fora do Brasil</h5>
            <span className="text-micro text-ink-faint">não entra no mapa</span>
          </div>
          <ol className="divide-y divide-border">
            {intl.map(item => (
              <LinhaRanking key={item.uf} item={item} max={max} barra="bg-info" valor={valorPorUf?.get(item.uf)} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function LinhaRanking({
  item, max, barra, valor,
}: {
  item: UfItem
  max: number
  barra: string
  valor?: number
}) {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-micro text-ink-faint">{item.uf}</span>
          {/* sem truncate: nome do estado nunca é cortado — quebra de linha, sim */}
          <span className="text-label text-ink">{item.nome}</span>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <span className="text-body text-ink">{n(item.total)}</span>
          <span className="ml-2 text-micro text-ink-faint">{pct(item.pct)}</span>
        </div>
      </div>
      {valor != null && valor > 0 && (
        <div className="mt-1 text-micro text-ink-faint" title={`${brlFull(valor)} em orçamentos`}>
          {brl(valor)} orçado
        </div>
      )}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${barra}`}
          style={{ width: `${Math.max((item.total / max) * 100, 3)}%` }}
        />
      </div>
    </li>
  )
}

// ============================================================================
// TABELA COMPARATIVA — as três métricas lado a lado, por estado.
// Bloco novo: é o que responde "onde tem lead e não tem proposta" sem obrigar a
// comparar três mapas de memória.
// ============================================================================

type Linha = {
  uf: string
  nome: string
  isBrasil: boolean
  /** null = estado fora do top 20 que a fonte de leads devolve (≠ zero) */
  leads: number | null
  orcamentos: number
  negociacao: number
  valor: number
  /** orçamentos ÷ leads, em % — só quando os dois existem (mesma janela) */
  taxa: number | null
}

type Col = 'uf' | 'leads' | 'orcamentos' | 'negociacao' | 'taxa' | 'valor'

type ColDef = { c: Col; rotulo: string; janela?: TipoJanela; ajuda: string }

/**
 * Cada coluna carrega a SUA janela no cabeçalho. Sem isso, "Em negociação"
 * (estado de agora) fica na mesma linha de "Leads" (período filtrado) e some a
 * diferença — exatamente o que acontecia com os três mapas empilhados.
 */
const COLUNAS: ColDef[] = [
  { c: 'uf', rotulo: 'Estado', ajuda: 'Ordenar por sigla do estado' },
  { c: 'leads', rotulo: 'Leads', janela: 'periodo',
    ajuda: 'Leads do período, UF pelo DDD do telefone' },
  { c: 'orcamentos', rotulo: 'Orçamentos', janela: 'periodo',
    ajuda: 'Clientes com orçamento montado no período (um por telefone)' },
  { c: 'taxa', rotulo: '% orç.', janela: 'periodo',
    ajuda: 'Orçamentos ÷ leads do MESMO período. Indisponível quando o estado não vem na lista de leads.' },
  { c: 'negociacao', rotulo: 'Em negociação', janela: 'snapshot',
    ajuda: 'Etiqueta ATUAL do WhatsApp (follow-up + quente + orçamento). Ignora o filtro de período.' },
  { c: 'valor', rotulo: 'R$ orçado', janela: 'periodo',
    ajuda: 'Soma do valor dos orçamentos montados no período' },
]

/**
 * Cabeçalho ordenável. Fica no topo do módulo (e não dentro do render da tabela)
 * porque um componente redeclarado a cada render vira um TIPO novo pro React:
 * ele desmonta e remonta o <button>, e quem ordenou pelo teclado perde o foco.
 */
function Th({
  def, col, dir, onOrdenar, periodoLabel,
}: {
  def: ColDef
  col: Col
  dir: 'asc' | 'desc'
  onOrdenar: (c: Col) => void
  periodoLabel: string
}) {
  const ativa = def.c === col
  const Icon = !ativa ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  const esquerda = def.c === 'uf'
  return (
    <th
      scope="col"
      aria-sort={ativa ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-2 py-2 align-bottom ${esquerda ? 'text-left' : 'text-right'}`}
    >
      <button
        type="button"
        onClick={() => onOrdenar(def.c)}
        title={def.ajuda}
        className={[
          'inline-flex min-h-[44px] items-center gap-2 rounded-sm px-2 py-2 text-micro transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          ativa ? 'text-ink' : 'text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <span>{def.rotulo}</span>
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">
          {ativa ? `ordenado ${dir === 'asc' ? 'crescente' : 'decrescente'}` : 'ordenar'}
        </span>
      </button>
      {def.janela && (
        <div className={`mt-1 flex ${esquerda ? 'justify-start' : 'justify-end'}`}>
          <JanelaBadge
            tipo={def.janela}
            label={def.janela === 'snapshot' ? 'estado de agora' : periodoLabel}
          />
        </div>
      )}
    </th>
  )
}

function TabelaComparativa({
  leads, orcamentos, negociacao, valorPorUf, periodoLabel,
}: {
  leads: UfItem[]
  orcamentos: UfItem[]
  negociacao: UfItem[]
  valorPorUf: Map<string, number>
  periodoLabel: string
}) {
  const [col, setCol] = useState<Col>('leads')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const linhas = useMemo<Linha[]>(() => {
    const leadsBy = new Map(leads.map(i => [i.uf, i]))
    const orcBy = new Map(orcamentos.map(i => [i.uf, i]))
    const negBy = new Map(negociacao.map(i => [i.uf, i]))

    const ufs = new Set<string>([...leadsBy.keys(), ...orcBy.keys(), ...negBy.keys()])

    return [...ufs].map(uf => {
      const l = leadsBy.get(uf)
      const o = orcBy.get(uf)
      const g = negBy.get(uf)
      const ref = l ?? o ?? g
      const qLeads = l ? l.total : null
      const qOrc = o?.total ?? 0
      return {
        uf,
        nome: ref?.nome ?? UF_NOMES[uf] ?? uf,
        isBrasil: ref?.isBrasil ?? (UF_NOMES[uf] !== undefined && uf !== 'INTL' && !PAIS_SIGLAS.has(uf)),
        leads: qLeads,
        orcamentos: qOrc,
        negociacao: g?.total ?? 0,
        valor: valorPorUf.get(uf) ?? 0,
        taxa: qLeads && qLeads > 0 ? (qOrc / qLeads) * 100 : null,
      }
    })
  }, [leads, orcamentos, negociacao, valorPorUf])

  const ordenadas = useMemo(() => {
    const sinal = dir === 'asc' ? 1 : -1
    const chave = (r: Linha): number | null =>
      col === 'leads' ? r.leads
      : col === 'orcamentos' ? r.orcamentos
      : col === 'negociacao' ? r.negociacao
      : col === 'valor' ? r.valor
      : col === 'taxa' ? r.taxa
      : null

    return [...linhas].sort((a, b) => {
      if (col === 'uf') return sinal * a.uf.localeCompare(b.uf, 'pt-BR')
      const va = chave(a)
      const vb = chave(b)
      // indisponível ("· · ·") sempre no fim, nas duas direções
      if (va == null && vb == null) return a.uf.localeCompare(b.uf, 'pt-BR')
      if (va == null) return 1
      if (vb == null) return -1
      return sinal * (va - vb) || a.uf.localeCompare(b.uf, 'pt-BR')
    })
  }, [linhas, col, dir])

  const totais = useMemo(() => {
    const tLeads = linhas.reduce((s, r) => s + (r.leads ?? 0), 0)
    const tOrc = linhas.reduce((s, r) => s + r.orcamentos, 0)
    return {
      leads: tLeads,
      orcamentos: tOrc,
      negociacao: linhas.reduce((s, r) => s + r.negociacao, 0),
      valor: linhas.reduce((s, r) => s + r.valor, 0),
      taxa: tLeads > 0 ? (tOrc / tLeads) * 100 : null,
    }
  }, [linhas])

  function ordenarPor(c: Col) {
    if (c === col) { setDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setCol(c)
    setDir(c === 'uf' ? 'asc' : 'desc')
  }

  return (
    <Card id="geo-tabela">
      <CardHeader
        title="Comparativo por estado"
        subtitle="Leads, orçamentos e negociação lado a lado. Ordene por “% orç.” crescente pra achar onde entra lead e não sai proposta."
      />

      {linhas.length === 0 ? (
        <Inner className="text-body text-ink-muted">Sem dados no período.</Inner>
      ) : (
        <>
          {/* Cada coluna carrega a SUA janela: negociação é estado de agora,
              as outras seguem o filtro do topo. Era isso que faltava quando os
              três mapas ficavam um embaixo do outro. */}
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {COLUNAS.map(def => (
                    <Th
                      key={def.c}
                      def={def}
                      col={col}
                      dir={dir}
                      onOrdenar={ordenarPor}
                      periodoLabel={periodoLabel}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordenadas.map(r => (
                  <tr key={r.uf} className="border-b border-border/60">
                    <th scope="row" className="px-2 py-2 text-left font-normal">
                      <span className="font-mono text-micro text-ink-faint">{r.uf}</span>
                      <span className="ml-2 text-label text-ink">{r.nome}</span>
                      {!r.isBrasil && (
                        <span className="ml-2 inline-flex items-center gap-2 text-micro text-ink-muted">
                          <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                          fora do BR
                        </span>
                      )}
                    </th>
                    <Td valor={r.leads} />
                    <Td valor={r.orcamentos} />
                    <td className="px-2 py-2 text-right text-label tabular-nums">
                      {r.taxa == null
                        ? <span className="text-ink-faint" title="Estado fora da lista de leads — não dá pra dividir">· · ·</span>
                        : <span className={r.taxa === 0 ? 'text-ink-faint' : 'text-ink'}>{pct(r.taxa)}</span>}
                    </td>
                    <Td valor={r.negociacao} />
                    <td className="px-2 py-2 text-right text-label tabular-nums">
                      {r.valor > 0
                        ? <span className="text-ink" title={brlFull(r.valor)}>{brl(r.valor)}</span>
                        : <span className="text-ink-faint">R$ 0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong">
                  <th scope="row" className="px-2 py-2 text-left text-label text-ink">
                    Total · {linhas.length} {linhas.length === 1 ? 'estado' : 'estados'}
                  </th>
                  <Td valor={totais.leads} forte />
                  <Td valor={totais.orcamentos} forte />
                  <td className="px-2 py-2 text-right text-label tabular-nums text-ink">
                    {totais.taxa == null ? '· · ·' : pct(totais.taxa)}
                  </td>
                  <Td valor={totais.negociacao} forte />
                  <td className="px-2 py-2 text-right text-label tabular-nums text-ink" title={brlFull(totais.valor)}>
                    {brl(totais.valor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-micro text-ink-faint">
            “· · ·” é dado indisponível, não zero: a fonte de leads devolve só os 20 maiores estados
            do período, então estados pequenos aparecem sem a coluna de leads.
          </p>
        </>
      )}
    </Card>
  )
}

function Td({ valor, forte = false }: { valor: number | null; forte?: boolean }) {
  return (
    <td className="px-2 py-2 text-right text-label tabular-nums">
      {valor == null ? (
        <span className="text-ink-faint" title="Indisponível nesta fonte — não é zero">· · ·</span>
      ) : (
        <span className={valor === 0 && !forte ? 'text-ink-faint' : 'text-ink'}>{n(valor)}</span>
      )}
    </td>
  )
}
