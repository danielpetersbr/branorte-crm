import { useMemo } from 'react'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboard'
import { Card, CardHeader } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { n, pct } from '../ui/format'

/**
 * `coorte`: a etapa conta os MESMOS leads que entraram no período. Proposta e
 * compra não são coorte: contam o cliente venha de onde vier (em 19/10, dos 131
 * com proposta só 31 eram leads de outubro; dos 6 que compraram, 1). Por isso
 * elas não ganham "% da anterior", não concorrem a "maior perda" e ficam num
 * bloco à parte — dividir 131 por 255 mede dois grupos diferentes.
 */
type Etapa = { nome: string; valor: number; ajuda: string; coorte: boolean }

/**
 * Funil do PERÍODO (fluxo), não do estoque.
 *
 * Todas as etapas saem do MESMO conjunto de linhas já filtrado por data
 * (data.funil, calculado em useDashboard sobre os mesmos leads), exceto a
 * última — "fechou" lá lê status_real, que nenhum atendimento tem preenchido,
 * então o número seria 0 sempre. Para a venda usamos a contagem que rastreia
 * pedido → orçamento → telefone do lead.
 *
 * NÃO clampamos as porcentagens. O dashboard antigo fazia Math.min(100, …) em
 * toda etapa, o que escondia o caso em que uma etapa tem mais gente que a
 * anterior. Esconder isso é pior do que mostrar: quando acontece, é sinal de que
 * as duas etapas medem universos diferentes — e o gerente precisa saber.
 */
export function FunilResumo({
  funil,
  clientesComProposta,
  vendasComOrigem,
  periodoLabel,
  onVerDetalhes,
}: {
  funil: DashboardData['funil'] | undefined
  clientesComProposta: number | undefined
  vendasComOrigem: number | undefined
  periodoLabel: string
  onVerDetalhes: () => void
}) {
  const etapas = useMemo<Etapa[]>(() => {
    const get = (nome: string) => funil?.find(e => e.etapa === nome)?.valor ?? 0
    return [
      { nome: 'Entrou',    valor: get('Entrou'),    ajuda: 'Contatos que chegaram no período.', coorte: true },
      { nome: 'Engajou',   valor: get('Engajou'),   ajuda: 'Respondeu pelo menos uma pergunta do atendimento.', coorte: true },
      { nome: 'Qualificou', valor: get('Qualificou'), ajuda: 'Disse à IA o que precisa, e é algo que a Branorte fabrica.', coorte: true },
      {
        nome: 'Recebeu proposta',
        coorte: false,
        // NÃO usar a etapa "Orçamento enviado" de data.funil: ela conta
        // orcamento_enviado / orcamento_valor na view de atendimentos, e esses
        // dois campos estão vazios — o funil aparecia com 0 aqui e 14 na etapa
        // seguinte. Usamos a MESMA contagem do card "Clientes com proposta"
        // logo acima, pra tela não mostrar dois números pro mesmo conceito.
        valor: clientesComProposta ?? 0,
        ajuda: 'Clientes distintos com proposta montada no período — o mesmo número do card acima. Conta o cliente venha ele de onde vier, então pode incluir quem não passou por este funil.',
      },
      {
        nome: 'Comprou',
        coorte: false,
        valor: vendasComOrigem ?? 0,
        ajuda: 'Venda que dá para rastrear até um lead (pedido → orçamento → telefone). É piso de rastreio, não o total de vendas da fábrica.',
      },
    ]
  }, [funil, clientesComProposta, vendasComOrigem])

  const topo = etapas[0]?.valor || 0
  if (topo === 0) {
    return (
      <Card>
        <CardHeader title="Funil do período" janela={<JanelaBadge tipo="periodo" label={periodoLabel} />} />
        <p className="py-5 text-center text-body text-ink-faint">Nenhum lead entrou neste período.</p>
      </Card>
    )
  }

  // Maior gargalo = maior queda percentual entre etapas consecutivas DA COORTE.
  let gargaloIdx = -1
  let piorQueda = -1
  for (let i = 1; i < etapas.length; i++) {
    if (!etapas[i].coorte || !etapas[i - 1].coorte) continue
    const ant = etapas[i - 1].valor
    if (ant <= 0) continue
    const queda = 1 - etapas[i].valor / ant
    if (queda > piorQueda) { piorQueda = queda; gargaloIdx = i }
  }

  const daCoorte = etapas.filter(e => e.coorte)
  const ultimaCoorte = daCoorte[daCoorte.length - 1]
  const conversaoCoorte = topo > 0 && ultimaCoorte ? (ultimaCoorte.valor / topo) * 100 : 0
  const proposta = etapas.find(e => e.nome === 'Recebeu proposta')?.valor ?? 0
  const comprou = etapas.find(e => e.nome === 'Comprou')?.valor ?? 0

  const linha = (e: Etapa, i: number) => {
    const larguraPct = topo > 0 ? (e.valor / topo) * 100 : 0
    const ant = i > 0 && e.coorte && etapas[i - 1].coorte ? etapas[i - 1].valor : null
    const conv = ant && ant > 0 ? (e.valor / ant) * 100 : null
    const ehGargalo = i === gargaloIdx && piorQueda > 0.15
    return (
      <li key={e.nome}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-1 text-label text-ink" title={e.ajuda}>
            {e.nome}
            {ehGargalo && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-warning-bg px-2 py-1 text-micro text-warning">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                maior perda
              </span>
            )}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-kpi-sm tabular-nums text-ink">{n(e.valor)}</span>
            {conv != null && (
              <span className="text-micro tabular-nums text-ink-faint">{pct(conv, 0)} da anterior</span>
            )}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${e.coorte ? 'bg-accent' : 'bg-ink-faint'}`}
            style={{ width: `${Math.max(Math.min(larguraPct, 100), e.valor > 0 ? 1 : 0)}%` }}
          />
        </div>
      </li>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Funil do período"
        subtitle={`De ${n(topo)} que entraram, ${n(ultimaCoorte?.valor ?? 0)} qualificaram (${pct(conversaoCoorte, 0)}). No período, ${n(proposta)} clientes receberam proposta e ${n(comprou)} compraram — de qualquer época.`}
        // Proposta e compra não são desta safra: a venda de hoje pode ter vindo de
        // um lead de meses atrás. Fica no title pra não virar parágrafo na tela.
        titleHint="Proposta e compra contam o cliente venha de onde vier: a venda de hoje pode ter vindo de um lead de meses atrás. Por isso não têm '% da anterior'."
        janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
        right={
          <button
            type="button"
            onClick={onVerDetalhes}
            className="inline-flex min-h-[44px] md:min-h-0 items-center gap-1 rounded-lg px-2 py-1 text-label text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver funil completo
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      />

      <ol className="flex flex-col gap-3">
        {etapas.map((e, i) => (e.coorte ? linha(e, i) : null))}
      </ol>

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-3 text-micro text-ink-faint">No mesmo período, de qualquer lead (não só os que entraram acima)</p>
        <ul className="flex flex-col gap-3">
          {etapas.map((e, i) => (e.coorte ? null : linha(e, i)))}
        </ul>
      </div>
    </Card>
  )
}
