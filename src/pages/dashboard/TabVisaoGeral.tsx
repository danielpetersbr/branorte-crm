import { useMemo, useState } from 'react'
import { useDashboard, type DashboardData } from '@/hooks/useDashboard'
import { useDashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import { useDashboardExtra } from '@/hooks/useDashboardExtra'
import { useDashboardVendedorFunil } from '@/hooks/useDashboardVendedorFunil'
import { useDashboardOrcamentos, useDashboardVendas } from '@/hooks/useDashboardOrcamentos'
import { useOrcamentosResumo } from '@/hooks/useOrcamentosResumo'
import { usePropostasStatus } from '@/hooks/usePropostasStatus'
import { useVendedorCobertura, type VendedorCobertura } from '@/hooks/useVendedorCobertura'
import { useFunilUnion } from '@/hooks/useFunilUnion'
import { useVendasReais } from '@/hooks/useVendasReais'
import { useJanela } from './DashboardFilterContext'
import { irPara, useDashboardTab, type TabId } from './tabs'
import { Metric } from './ui/Metric'
import { brl, n, pct, primeiroNome } from './ui/format'
import { MetaDoMes } from './blocks/MetaDoMes'
import { OperacaoAgora } from './blocks/OperacaoAgora'
import { FunilResumo } from './blocks/FunilResumo'
import { FinalizadosPorMotivo } from './blocks/FinalizadosPorMotivo'
import { Tendencia } from './blocks/Tendencia'
import { AcoesPrioritarias, type PositivoDestaques } from './blocks/AcoesPrioritarias'
import { TopEquipe } from './blocks/TopEquipe'
import { DrillModal } from './blocks/DrillModal'
import { naoEhVendedor } from '@/lib/vendedores-fora-do-ranking'


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
 *   3. onde trava?           → funil + evolução
 *   4. o que faço hoje?      → decisões do gerente (reforçar | cobrar)
 *   5. quem tá entregando?   → top 5
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

  const { data: etq, isPending: etqPendente, isPlaceholderData: etqVelho } = useDashboardEtiquetas(preset)
  const { data: extra, isPending: extraPendente } = useDashboardExtra()
  const { data: vendFunil, isPending: vendFunilPendente, isPlaceholderData: vendFunilVelho } = useDashboardVendedorFunil(preset)
  const { data: funilUnion, isPending: funilUnionPendente, isPlaceholderData: funilUnionVelho } = useFunilUnion(preset)
  const { data: orcamentosReais, isPending: orcamentosReaisPendente } = useDashboardOrcamentos(preset)
  const { data: orc, isPending: orcPendente, isPlaceholderData: orcVelho } = useOrcamentosResumo(preset)
  const { data: vendas, isPending: vendasPendente } = useDashboardVendas(preset)
  const { data: vendasReais, isPending: vendasReaisPendente } = useVendasReais()
  const { data: propStatus, isPending: propStatusPendente, isPlaceholderData: propStatusVelho } = usePropostasStatus(preset)
  const { data: cobertura, isPending: coberturaPendente, isPlaceholderData: coberturaVelho } = useVendedorCobertura(preset)

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
  const decisoesCarregando = etqPendente || vendFunilPendente || funilUnionPendente || orcPendente || propStatusPendente || coberturaPendente
  const decisoesPendentes = decisoesCarregando || etqVelho || vendFunilVelho || funilUnionVelho || orcVelho || propStatusVelho || coberturaVelho
  const decisoesSemDados = [etq, vendFunil, funilUnion, orc, propStatus, cobertura].some(value => value === undefined)
  const esmaece = (pendente: boolean) => `transition-opacity duration-200 ${pendente ? 'opacity-50' : ''}`

  const ir = (tab: TabId, anchor?: string) => irPara(setTab, tab, anchor)

  /**
   * Metade POSITIVA das decisões do gerente — o "reforçar / dobrar".
   *
   * Perdida inteira no refactor do Dashboard de 3.696 linhas: o
   * `DecisoesGerente` tinha as duas colunas e só a vermelha sobreviveu, virando
   * `AcoesPrioritarias`. Nenhuma aba mostrava mais quem lidera em propostas,
   * quem cobre melhor com etiqueta, nem o R$ em negociação quente.
   *
   * Contas idênticas às do original (linhas 423-441 do arquivo antigo).
   */
  const positivo = useMemo<PositivoDestaques>(() => {
    // porVendedor já vem ordenado por R$ desc no hook — [0] é o topo.
    const topOrc = (orc?.porVendedor ?? []).filter(v => v.vendedor !== '—' && v.brl > 0)[0] ?? null

    // Merge por 1º nome mantendo o MAIOR bucket: quando o responsável tem grafia
    // dupla ("Igor" e "IGOR" viram 2 linhas na RPC de cobertura), um Map simples
    // ficava com a ÚLTIMA — a menor — e o vendedor aparecia com 3 de 392.
    const porNome = new Map<string, VendedorCobertura>()
    for (const r of cobertura ?? []) {
      // Fora: o dono, a ANA (é a IA de atendimento, não vendedor) e quem não tem o
      // WhatsApp lido — a % dele não mede etiquetagem, mede falta de dado.
      if (naoEhVendedor(r.vendedor) || r.wa_capturado === false) continue
      const k = primeiroNome(r.vendedor)
      const cur = porNome.get(k)
      if (!cur || (r.total_passado ?? 0) > (cur.total_passado ?? 0)) porNome.set(k, r)
    }
    const coberturaTop = [...porNome.values()]
      // Abaixo de 50 clientes passados, o % é ruído: 4 de 5 vira 80% e ganha de
      // quem etiquetou 300 de 500.
      .filter(r => (r.total_passado ?? 0) >= 50)
      .map(r => ({
        nome: r.vendedor,
        pct: r.total_passado > 0 ? Math.round((r.com_etiqueta / r.total_passado) * 100) : 0,
        com: r.com_etiqueta,
        total: r.total_passado,
      }))
      .sort((a, b) => b.pct - a.pct)[0] ?? null

    return {
      topOrc,
      cobertura: coberturaTop,
      rNegoc: propStatus?.abertoQuente.brl ?? 0,
      rMontado: orc?.valorTotalBRL ?? 0,
      qualificou: funilUnion?.qualificou ?? data?.kpiQualificados.valor ?? 0,
      // Mesmo número do card "Clientes com proposta". `orc.geradas` deduplica por
      // vendedor+cliente: cliente cotado por 2 vendedores contava 2× (134 × 131 em 19/10).
      clientesComProposta: orcamentosReais ?? orc?.geradas ?? 0,
    }
  }, [orc, cobertura, propStatus, funilUnion, data?.kpiQualificados.valor, orcamentosReais])

  const vendedoresComProposta = useMemo(
    () => new Set((orc?.porVendedor ?? [])
      .filter(v => v.propostasN > 0)
      .map(v => (v.vendedor || '').trim().split(/\s+/)[0].toUpperCase())),
    [orc],
  )

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
    // tile baixo e Decisões do gerente como 4ª coluna da última faixa. Notebook e celular continuam como eram.
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
        {numerosPendentes || decisoesPendentes ? `Atualizando os números para ${periodoLabel}…` : ''}
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

      {/* ── 3. Onde trava? E o que faço hoje? ───────────────────────────
          (21/10/2026, Daniel: "eu quero os três, um do ladinho do outro") Funil do período, atendimentos finalizados e evolução
          diária na MESMA linha a partir de 2xl (1536 px). Entre xl e 2xl os três apertariam demais o gráfico: o funil e os
          finalizados ficam lado a lado e a evolução ocupa a linha de baixo inteira. Abaixo de xl, empilham.
          (21/10/2026, Daniel: "não quero precisar rolar") Decisões do gerente (era a seção 4, embaixo de tudo) vira a 4ª
          coluna desta faixa a partir de 2xl, com rolagem própria: o wrapper é `relative` e o cartão `absolute inset-0`, então
          ele não estica a faixa — a altura é a dos outros três. Abaixo de 2xl ocupa a largura toda, como antes.
          Entrou / Engajou / Qualificou vêm de dashboard_funil_union, a mesma conta do card Qualificados. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-4 2xl:gap-4">
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
        <div className={`xl:col-span-2 2xl:relative 2xl:col-span-1 ${esmaece(decisoesPendentes)}`} aria-busy={decisoesPendentes}>
          {decisoesCarregando ? <div className="h-[320px] animate-pulse rounded-xl bg-surface-2" aria-label="Carregando decisões do gerente" /> : decisoesSemDados ? <p className="rounded-xl bg-surface-2 p-5 text-body text-ink-muted">As decisões do gerente estão temporariamente indisponíveis. Use Atualizar dados agora para tentar novamente.</p> : <AcoesPrioritarias denso data={data} etq={etq} vendFunil={vendFunil} positivo={positivo} vendedoresComProposta={vendedoresComProposta} onIr={ir} />}
        </div>
      </div>


      {drill && <DrillModal kind={drill} preset={preset} onClose={() => setDrill(null)} />}
    </div>
  )
}
