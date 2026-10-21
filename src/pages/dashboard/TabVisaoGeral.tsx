import { useState } from 'react'
import { useDashboard, type DashboardData } from '@/hooks/useDashboard'
import { useDashboardExtra } from '@/hooks/useDashboardExtra'
import { useDashboardOrcamentos, useDashboardVendas } from '@/hooks/useDashboardOrcamentos'
import { useOrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { useFunilUnion } from '@/hooks/useFunilUnion'
import { useVendasReais } from '@/hooks/useVendasReais'
import { useJanela } from './DashboardFilterContext'
import { irPara, useDashboardTab, type TabId } from './tabs'
import { Metric } from './ui/Metric'
import { brl, n, pct } from './ui/format'
import { MetaDoMes } from './blocks/MetaDoMes'
import { OperacaoAgora } from './blocks/OperacaoAgora'
import { FunilResumo } from './blocks/FunilResumo'
import { FinalizadosPorMotivo } from './blocks/FinalizadosPorMotivo'
import { Tendencia } from './blocks/Tendencia'
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
 *   2. quanto entrou e saiu? → os 5 números do período + atendimentos de HOJE
 *   3. onde trava?           → funil + finalizados + evolução
 *   (o "4. o que faço hoje? → decisões do gerente" saiu em 21/10/2026, a pedido do Daniel; o bloco
 *    continua em blocks/AcoesPrioritarias.tsx, sem uso)
 *   5. quem tá entregando?   → top 5 (subiu pra junto da meta)
 *
 * O que SAIU daqui: propostas no builder e heatmap (→ Equipe), atendimentos
 * abertos e em negociação (→ Funil), os três mapas (→ Geografia), placar de
 * times e painel individual (→ Equipe).
 */
export function TabVisaoGeral() {
  const { preset } = useJanela()
  const { data, isLoading, error } = useDashboard({ preset })

  if (isLoading) return <Esqueleto />
  if (error || !data) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-bg p-5">
        <h2 className="text-title text-danger">Não deu para carregar o dashboard.</h2>
        {error && <p className="mt-1 break-all font-mono text-micro text-danger/80">{(error as Error).message}</p>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-danger px-3 py-2 text-label font-semibold text-accent-fg hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  // Evita competir com o snapshot na primeira abertura (ou quando ele falha).
  // Os complementos só montam depois; o cache continua compartilhado entre abas.
  return <VisaoGeralDados data={data} />
}

function VisaoGeralDados({ data }: { data: DashboardData }) {
  const { preset, periodoLabel, temPeriodo } = useJanela()
  const [, setTab] = useDashboardTab()
  const [drill, setDrill] = useState<null | 'orcamentos' | 'vendidos' | 'valor'>(null)

  const { data: extra, isPending: extraPendente } = useDashboardExtra()
  const { data: funilUnion, isPending: funilUnionPendente, isPlaceholderData: funilUnionVelho } = useFunilUnion(preset)
  const { data: orcamentosReais, isPending: orcamentosReaisPendente } = useDashboardOrcamentos(preset)
  const { data: orc, isPending: orcPendente, isPlaceholderData: orcVelho } = useOrcamentosResumo(preset)
  const { data: vendas, isPending: vendasPendente } = useDashboardVendas(preset)
  const { data: vendasReais, isPending: vendasReaisPendente } = useVendasReais()
  // (21/10/2026) etiquetas, funil por vendedor, status das propostas e cobertura eram só das Decisões do gerente,
  // que saíram da aba: não são mais buscados aqui (as outras abas buscam o que usam).

  // TROCA DE PERÍODO (29/09/2026). O useDashboard troca de preset na hora (select
  // sobre o cache), mas os hooks por período abaixo têm key própria: na troca eles
  // ou seguram o número do período ANTERIOR (`placeholderData: prev => prev` →
  // isPlaceholderData) ou ficam sem dado e a tela pinta 0 (os dois de
  // useDashboardOrcamentos → isPending). Nos dois casos o tile já exibe o rótulo
  // novo. Enquanto isso durar, o bloco esmaece e fica aria-busy: é o sinal de "este
  // número ainda não é do período que você escolheu". Background refetch da MESMA
  // key não liga nenhuma das duas flags, então não pisca a cada poll.
  const funilPendente = orcamentosReaisPendente || vendasPendente
  // o bloco do funil espera também a RPC da união: sem ela o Qualificou nasceria pela regra antiga e pularia ao chegar
  const funilBlocoPendente = funilPendente || funilUnionPendente
  const numerosPendentes = funilPendente || funilUnionPendente || orcPendente || funilUnionVelho || orcVelho
  const esmaece = (pendente: boolean) => `transition-opacity duration-200 ${pendente ? 'opacity-50' : ''}`

  const ir = (tab: TabId, anchor?: string) => irPara(setTab, tab, anchor)

  const qualificados = funilUnion?.qualificou ?? data.kpiQualificados.valor
  // Divide pelo universo da MESMA RPC: dividir pelo kpiTotal misturava a contagem
  // da RPC com a da view lida aqui no cliente.
  const baseQualificados = funilUnion?.entrou ?? data.kpiTotal.valor
  // Quantos entram só pela etiqueta do vendedor: é a diferença para a etapa
  // "Qualificou" do funil abaixo, que conta só a IA.
  const qualificadosSoEtiqueta = funilUnion ? Math.max(0, funilUnion.qualificou - funilUnion.qualif_ia) : 0
  const propostasClientes = orcamentosReais ?? 0
  const propostasBrutas = orc?.propostasBrutas ?? 0
  const vendasQtd = vendas?.qtd ?? 0
  const vendasComOrigem = vendas?.qtdLead ?? 0
  const valorVendido = vendas?.valor ?? 0
  const valorComOrigem = vendas?.valorLead ?? 0

  return (
    // (21/10/2026, Daniel: "não quero precisar rolar, quero que ao abrir a visão geral apareça tudo certinho já") A partir
    // de 2xl a aba cabe numa tela de 1920×1080 sem rolar: espaços de 16 px, cartões com padding menor, os 6 números em
    // tile baixo e a última faixa com os 3 gráficos. Notebook e celular continuam como eram.
    <div className="flex flex-col gap-5 2xl:gap-4">
      {/* ── 1. Bato a meta? Quem está entregando? E como está a operação agora? ──
          (21/10/2026, Daniel: "diminuir a meta, puxar pra esquerda, e onde eu circulei os atendimentos em aberto…")
          A meta fica com a coluna da esquerda; a direita é Operação agora (etiquetas, follow up, lead quente,
          anúncio e ligações). Abaixo de xl as duas empilham.
          (21/10/2026, Daniel: "coloca aquele gráfico de quem está entregando ao lado da meta do mês, ou junto do quadrado")
          O top 5 do mês (era a seção 5, no fim da aba) sobe pra cá. A partir de 2xl (1536 px) fica LADO A LADO: meta, ranking
          e Operação agora na mesma linha (3 + 3 + 6) — o `2xl:contents` desfaz a coluna da esquerda e os dois viram itens da
          grade. Entre xl e 2xl três colunas apertariam o painel: o ranking fica embaixo da meta, na mesma coluna. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 2xl:gap-4">
        <div className="flex flex-col gap-5 xl:col-span-5 2xl:contents">
          <div className="2xl:col-span-3"><MetaDoMes compacto /></div>
          <div className="flex-1 2xl:col-span-3">
            {vendasReaisPendente ? <div className="h-[220px] animate-pulse rounded-xl bg-surface-2" aria-label="Carregando ranking da equipe" /> : vendasReais === undefined ? <p className="rounded-xl bg-surface-2 p-5 text-body text-ink-muted">O ranking está temporariamente indisponível. Use Atualizar dados agora para tentar novamente.</p> : <TopEquipe
              compacto
              corrida={vendasReais?.corrida}
              metaVendedor={vendasReais?.metaVendedor ?? 0}
              totalMes={vendasReais?.vendidoMes}
              degradado={vendasReais?.fonte === 'mirror-fallback'}
              onVerTodos={() => ir('equipe')}
            />}
          </div>
        </div>
        <div className="xl:col-span-7 2xl:col-span-6"><OperacaoAgora /></div>
      </div>

      {/* Aviso falado da troca de período: o esmaecido é só visual. Sempre montado
          (vazio quando não há troca) pra região viva existir antes da mensagem. */}
      <p className="sr-only" role="status" aria-live="polite">
        {numerosPendentes ? `Atualizando os números para ${periodoLabel}…` : ''}
      </p>

      {/* ── 2. Os 5 números ─────────────────────────────────────────── */}
      <section
        aria-label="Números do período e do dia"
        aria-busy={numerosPendentes}
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 ${esmaece(numerosPendentes)}`}
      >
        <Metric
          denso
          label="Leads"
          valor={n(data.kpiTotal.valor)}
          // Período anterior sem lead: o hook devolve +100%, que não é uma variação de verdade.
          delta={temPeriodo && data.kpiTotal.anterior > 0 ? data.kpiTotal.deltaPct : null}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Contatos que CHEGARAM no período (data do 1º contato). Um telefone conta uma vez. O /atendimentos filtra pela data da ÚLTIMA mensagem e esconde quem não tem telefone, por isso lá o número do mesmo período é outro."
        />
        <Metric
          denso
          label="Qualificados"
          valor={funilUnionPendente ? 'Carregando…' : funilUnion === undefined ? 'Indisponível' : n(qualificados)}
          secundario={funilUnion !== undefined && baseQualificados > 0
            ? `${pct((qualificados / baseQualificados) * 100, 0)} dos leads${qualificadosSoEtiqueta > 0 ? ` · ${n(qualificadosSoEtiqueta)} pela etiqueta` : ''}`
            : undefined}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Lead do período que a ANA PASSOU PRO VENDEDOR (ela só passa quem respondeu e quer algo que a Branorte fabrica; repasse de dúvida técnica não conta), ou que já qualificava pelo critério antigo do robô, ou com etiqueta que só existe depois de conversa com o vendedor: LEAD QUENTE, FOLLOW UP, AGENDAMENTO, ORÇAMENTO ou VENDIDO. NOVO LEAD, PROSPECÇÃO, 2ª TENTATIVA e INTERESSE FUTURO não contam. 'Pela etiqueta' = os que só entram pela etiqueta."
        />
        <Metric
          denso
          label="Clientes com proposta"
          valor={orcamentosReaisPendente ? 'Carregando…' : orcamentosReais === undefined ? 'Indisponível' : n(propostasClientes)}
          secundario={!orcPendente && propostasBrutas > 0 ? `${n(propostasBrutas)} propostas emitidas` : undefined}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Clientes distintos que receberam proposta montada no builder. O número menor conta CLIENTE; o de baixo conta PROPOSTA — a diferença são as re-cotações do mesmo cliente."
          onClick={() => setDrill('orcamentos')}
        />
        <Metric
          denso
          label="Vendas"
          valor={vendasPendente ? 'Carregando…' : vendas === undefined ? 'Indisponível' : n(vendasQtd)}
          secundario={vendas === undefined ? undefined : `${n(vendasComOrigem)} com origem comprovada`}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Pedidos não-cancelados com data de venda no período. 'Origem comprovada' é o subconjunto que dá para rastrear até um lead — é piso de rastreio, não fatia de mercado. Lê a cópia do Controle, que atualiza de hora em hora (aos :37); a Meta do mês lê o Controle ao vivo, então por até 1 h um pedido novo aparece lá antes daqui."
          onClick={() => setDrill('vendidos')}
        />
        <Metric
          denso
          label="Valor vendido"
          valor={vendasPendente ? 'Carregando…' : vendas === undefined ? 'Indisponível' : brl(valorVendido)}
          secundario={vendas === undefined ? undefined : `${brl(valorComOrigem)} com origem comprovada`}
          janela="periodo"
          janelaLabel={periodoLabel}
          ajuda="Soma dos pedidos do período. Atenção: este recorte segue o filtro do topo; o card Meta do mês usa o mês calendário, por isso os dois podem divergir. Lê a cópia do Controle, que atualiza de hora em hora (aos :37); a Meta lê o Controle ao vivo, então por até 1 h os dois diferem."
          onClick={() => setDrill('valor')}
        />
        {/*
          ATENDIMENTOS HOJE — o único tile desta fileira que NÃO segue o filtro
          do topo. Some no refactor (o `extra.atendimentos` ficou sem leitor
          nenhum) e com ele o único sinal de "o telefone tocou hoje?".

          A ressalva "dia parcial" aparece TRÊS vezes de propósito: no carimbo
          da janela, na linha secundária e na ajuda. Sem ela alguém compara meio
          dia com um dia inteiro e conclui que o movimento caiu 60% às 10h da
          manhã — o que é só o relógio, não o mercado.
        */}
        {(() => {
          // (21/10/2026, Daniel: "pra considerar um atendimento tem que ter troca de mensagem: o cliente mandou, o vendedor
          // mandou, o cliente mandou e o vendedor mandou") RPC dashboard_atendimentos_troca: conversa com 2 idas e voltas no
          // dia, 1 por cliente. Antes contava LEAD NOVO (49 contra 64 às 14h de 21/10; 20/10 inteiro, 77 × 109).
          // Dia parcial contra ONTEM ATÉ A MESMA HORA (19/10/2026): contra o dia inteiro, às 16h dizia −44% quando era −18%.
          const at = extra?.atendimentosTroca
          const ajuda = 'Cliente com TROCA DE MENSAGENS hoje: ele mandou, alguém da Branorte respondeu, ele mandou de novo e foi respondido de novo (2 idas e voltas no mesmo dia). Conta 1 por cliente, mesmo que ele fale com a Ana e depois com o vendedor. "Com vendedor" = teve as 2 idas e voltas com um vendedor; "só com a Ana" = só com ela. Prospecção sem resposta e ligação não contam. Comparado com ONTEM ATÉ A MESMA HORA (parcial contra parcial); ignora o filtro de período do topo. Lê o espelho de mensagens do WhatsApp: conta que aparece em "sem espelho" não está sendo copiada, e os atendimentos dela ficam de fora.'
          if (!at) {
            return (
              <Metric
                denso
                label="Atendimentos hoje"
                valor={extraPendente ? 'Carregando…' : 'Indisponível'}
                janela="fixo"
                janelaLabel="hoje · parcial"
                ajuda={`${ajuda} Não deu para carregar agora; use Atualizar dados.`}
              />
            )
          }
          const base = at.ontemAteAgora
          const dif = at.hoje - base
          const deltaPct = base > 0 ? (dif / base) * 100 : null
          const nomeConta = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())
          return (
            <Metric
              denso
              label="Atendimentos hoje"
              valor={n(at.hoje)}
              delta={deltaPct}
              janela="fixo"
              janelaLabel="hoje · parcial"
              secundario={<>
                <span className="block">
                  {base > 0 ? `${dif > 0 ? '+' : ''}${n(dif)} vs. ontem até esta hora (${n(base)})` : 'ontem até esta hora: 0'} · <span className="whitespace-nowrap">ontem inteiro: {n(at.ontem)}</span>
                </span>
                <span className="block">{n(at.hojeComVendedor)} com vendedor · {n(at.hojeSoAna)} só com a Ana</span>
                {at.semEspelho.length > 0 && (
                  <span className="block text-warning">⚠ sem espelho: {at.semEspelho.map(nomeConta).join(', ')}</span>
                )}
              </>}
              ajuda={ajuda}
            />
          )
        })()}
      </section>

      {/* ── 3. Onde trava? ───────────────────────────────────────────────
          (21/10/2026, Daniel: "eu quero os três, um do ladinho do outro") Funil do período, atendimentos finalizados e evolução
          diária na MESMA linha a partir de 2xl (1536 px). Entre xl e 2xl os três apertariam demais o gráfico: o funil e os
          finalizados ficam lado a lado e a evolução ocupa a linha de baixo inteira. Abaixo de xl, empilham.
          (21/10/2026, Daniel: "remove esse negócio de decisões do gerente… e centraliza os três gráficos") A 4ª coluna
          (Decisões do gerente) saiu: a partir de 2xl os três dividem a faixa inteira, um terço cada.
          Entrou / Engajou / Qualificou vêm de dashboard_funil_union, a mesma conta do card Qualificados. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3 2xl:gap-4">
        <div className={esmaece(funilBlocoPendente || funilUnionVelho)} aria-busy={funilBlocoPendente || funilUnionVelho}>
          {funilBlocoPendente ? <div className="h-[320px] animate-pulse rounded-xl bg-surface-2" aria-label="Carregando funil do período" /> : orcamentosReais === undefined || vendas === undefined ? <p className="rounded-xl bg-surface-2 p-5 text-body text-ink-muted">O funil está temporariamente indisponível. Use Atualizar dados agora para tentar novamente.</p> : <FunilResumo
            funil={data.funil}
            uniao={funilUnion}
            clientesComProposta={propostasClientes}
            vendasComOrigem={vendasComOrigem}
            vendasTotal={vendasQtd}
            periodoLabel={periodoLabel}
            onVerDetalhes={() => ir('funil')}
          />}
        </div>
        <FinalizadosPorMotivo />
        <div className="xl:col-span-2 2xl:col-span-1">
          <Tendencia
            leadsPorDia={data.leadsPorDia}
            orcamentosPorDia={extra?.orcamentos_por_dia}
          />
        </div>
      </div>


      {drill && <DrillModal kind={drill} preset={preset} onClose={() => setDrill(null)} />}
    </div>
  )
}
