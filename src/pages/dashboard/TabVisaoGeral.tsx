import { useState } from 'react'
import { useDashboard } from '@/hooks/useDashboard'
import { useDashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import { useDashboardExtra } from '@/hooks/useDashboardExtra'
import { useDashboardVendedorFunil } from '@/hooks/useDashboardVendedorFunil'
import { useDashboardOrcamentos, useDashboardVendas } from '@/hooks/useDashboardOrcamentos'
import { useOrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { useFunilUnion } from '@/hooks/useFunilUnion'
import { useVendasReais } from '@/hooks/useVendasReais'
import { useJanela } from './DashboardFilterContext'
import { irPara, useDashboardTab, type TabId } from './tabs'
import { Metric } from './ui/Metric'
import { brl, n, pct } from './ui/format'
import { MetaDoMes } from './blocks/MetaDoMes'
import { FunilResumo } from './blocks/FunilResumo'
import { Tendencia } from './blocks/Tendencia'
import { AcoesPrioritarias } from './blocks/AcoesPrioritarias'
import { TopEquipe } from './blocks/TopEquipe'
import { DrillModal } from './blocks/DrillModal'

function Esqueleto() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-[220px] animate-pulse rounded-xl bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-[140px] animate-pulse rounded-xl bg-surface-2" />)}
      </div>
      <div className="h-[320px] animate-pulse rounded-xl bg-surface-2" />
    </div>
  )
}

/**
 * VISÃO GERAL — teto de ~3 alturas de tela no desktop.
 *
 * Ordem escolhida pela pergunta que cada bloco responde, na ordem em que o
 * gerente pergunta:
 *   1. bato a meta?          → Meta do mês
 *   2. quanto entrou e saiu? → os 5 números
 *   3. onde trava?           → funil + evolução
 *   4. o que faço hoje?      → ações prioritárias
 *   5. quem tá entregando?   → top 5
 *
 * O que SAIU daqui: propostas no builder e heatmap (→ Equipe), atendimentos
 * abertos e em negociação (→ Funil), os três mapas (→ Geografia), placar de
 * times e painel individual (→ Equipe).
 */
export function TabVisaoGeral() {
  const { preset, periodoLabel, temPeriodo } = useJanela()
  const [, setTab] = useDashboardTab()
  const [drill, setDrill] = useState<null | 'orcamentos' | 'vendidos' | 'valor'>(null)

  const { data, isLoading, error } = useDashboard({ preset })
  const { data: etq } = useDashboardEtiquetas(preset)
  const { data: extra } = useDashboardExtra()
  const { data: vendFunil } = useDashboardVendedorFunil(preset)
  const { data: funilUnion } = useFunilUnion(preset)
  const { data: orcamentosReais } = useDashboardOrcamentos(preset)
  const { data: orc } = useOrcamentosResumo(preset)
  const { data: vendas } = useDashboardVendas(preset)
  const { data: vendasReais } = useVendasReais()

  const ir = (tab: TabId, anchor?: string) => irPara(setTab, tab, anchor)

  if (isLoading) return <Esqueleto />

  if (error || !data) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-bg p-5">
        <h2 className="text-title text-danger">Não deu para carregar o dashboard.</h2>
        {error && <p className="mt-1 break-all font-mono text-micro text-danger/80">{(error as Error).message}</p>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-danger px-3 py-2 text-label font-semibold text-white hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  const qualificados = funilUnion?.qualificou ?? data.kpiQualificados.valor
  const propostasClientes = orcamentosReais ?? 0
  const propostasBrutas = orc?.propostasBrutas ?? 0
  const vendasQtd = vendas?.qtd ?? 0
  const vendasComOrigem = vendas?.qtdLead ?? 0
  const valorVendido = vendas?.valor ?? 0
  const valorComOrigem = vendas?.valorLead ?? 0

  return (
    <div className="flex flex-col gap-5">
      {/* ── 1. Bato a meta? ─────────────────────────────────────────── */}
      <MetaDoMes />

      {/* ── 2. Os 5 números ─────────────────────────────────────────── */}
      <section aria-label="Números do período" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric
          label="Leads"
          valor={n(data.kpiTotal.valor)}
          delta={temPeriodo ? data.kpiTotal.deltaPct : null}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Contatos que chegaram no período, da view de atendimentos. Um telefone conta uma vez."
        />
        <Metric
          label="Qualificados"
          valor={n(qualificados)}
          secundario={data.kpiTotal.valor > 0 ? `${pct((qualificados / data.kpiTotal.valor) * 100, 0)} dos leads` : undefined}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Qualificado pela IA OU já com etiqueta de avanço do vendedor (novo lead, follow-up, quente…)."
        />
        <Metric
          label="Clientes com proposta"
          valor={n(propostasClientes)}
          secundario={propostasBrutas > 0 ? `${n(propostasBrutas)} propostas emitidas` : undefined}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Clientes distintos que receberam proposta montada no builder. O número menor conta CLIENTE; o de baixo conta PROPOSTA — a diferença são as re-cotações do mesmo cliente."
          onClick={() => setDrill('orcamentos')}
        />
        <Metric
          label="Vendas"
          valor={n(vendasQtd)}
          secundario={`${n(vendasComOrigem)} com origem comprovada`}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Pedidos não-cancelados com data de venda no período. 'Origem comprovada' é o subconjunto que dá para rastrear até um lead — é piso de rastreio, não fatia de mercado."
          onClick={() => setDrill('vendidos')}
        />
        <Metric
          label="Valor vendido"
          valor={brl(valorVendido)}
          secundario={`${brl(valorComOrigem)} com origem comprovada`}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Soma dos pedidos do período. Atenção: este recorte segue o filtro do topo; o card Meta do mês usa o mês calendário, por isso os dois podem divergir."
          onClick={() => setDrill('valor')}
        />
      </section>

      {/* ── 3. Onde trava? ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <FunilResumo
            funil={data.funil}
            clientesComProposta={propostasClientes}
            vendasComOrigem={vendasComOrigem}
            periodoLabel={periodoLabel}
            onVerDetalhes={() => ir('funil')}
          />
        </div>
        <div className="xl:col-span-7">
          <Tendencia
            leadsPorDia={data.leadsPorDia}
            orcamentosPorDia={extra?.orcamentos_por_dia}
          />
        </div>
      </div>

      {/* ── 4. O que faço hoje? ─────────────────────────────────────── */}
      <AcoesPrioritarias data={data} etq={etq} vendFunil={vendFunil} onIr={ir} />

      {/* ── 5. Quem está entregando? ────────────────────────────────── */}
      <TopEquipe
        corrida={vendasReais?.corrida}
        metaVendedor={vendasReais?.metaVendedor ?? 0}
        degradado={vendasReais?.fonte === 'mirror-fallback'}
        onVerTodos={() => ir('equipe')}
      />

      {drill && <DrillModal kind={drill} preset={preset} onClose={() => setDrill(null)} />}
    </div>
  )
}
