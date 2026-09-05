import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle as TriangleAlert,
  CheckCircle2,
  FileText,
  Inbox,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import {
  criarCabecalhosHojeGestor,
  formatarMetricaGestor,
  formatarUltimoSinalGestor,
  ordenarVendedoresGestor,
  resolverSelecaoGestor,
  resolverVisaoTabelaGestor,
  rotuloOrdemGestor,
  type AlertaGestor,
  type EstadoFonteGestor,
  type OrdemGestor,
  type PeriodoGestor,
  type ResumoGestor,
  type VendedorGestor,
} from '@/lib/escritorio-gestor'

export type RankingMesGestor = {
  nome: string
  atendimentos: number
  leads: number
  orcamentos: number
}

export type EscritorioGestorProps = {
  vendedores: VendedorGestor[]
  resumo: ResumoGestor
  alertas: AlertaGestor[]
  rankingMes: RankingMesGestor[]
  rankingMesEstado: EstadoFonteGestor
  selecionado: string | null
  onSelecionar: (nome: string) => void
  mapa: ReactNode
}

type KpiProps = {
  label: string
  value: string
  icon: LucideIcon
  tone?: 'neutral' | 'danger'
}

function Kpi({ label, value, icon: Icon, tone = 'neutral' }: KpiProps) {
  const danger = tone === 'danger'

  return (
    <div className={`min-w-0 rounded-lg border p-3 ${danger ? 'border-danger/30 bg-danger-bg' : 'border-border bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-micro ${danger ? 'text-danger' : 'text-ink-muted'}`}>{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${danger ? 'text-danger' : 'text-accent'}`} aria-hidden="true" />
      </div>
      <p className={`mt-1 text-kpi-sm tabular-nums ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
    </div>
  )
}

function ResumoDia({ resumo }: { resumo: ResumoGestor }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="Resumo do dia">
      <Kpi label="Atendimentos hoje" value={formatarMetricaGestor(resumo.atendimentos)} icon={MessageSquare} />
      <Kpi label="Leads recebidos" value={formatarMetricaGestor(resumo.leads)} icon={Inbox} />
      <Kpi label="Orçamentos hoje" value={formatarMetricaGestor(resumo.orcamentos)} icon={FileText} />
      <Kpi
        label="Precisam de atenção"
        value={String(resumo.precisamAtencao)}
        icon={TriangleAlert}
        tone={resumo.precisamAtencao ? 'danger' : 'neutral'}
      />
    </div>
  )
}

const statusTone = (status: VendedorGestor['status']) => {
  if (['wa_fechado', 'verificar_wa', 'desconectado'].includes(status)) return 'bg-danger-bg text-danger border-danger/30'
  if (['ocioso', 'lento', 'versao_antiga'].includes(status)) return 'bg-warning-bg text-warning border-warning/30'
  if (status === 'ativo') return 'bg-success-bg text-success border-success/30'
  return 'bg-surface-2 text-ink-muted border-border'
}

const alertaTone = (nivel: AlertaGestor['nivel']) => {
  if (nivel === 'critico') return 'border-danger/30 bg-danger-bg text-danger'
  if (nivel === 'atencao') return 'border-warning/30 bg-warning-bg text-warning'
  return 'border-success/30 bg-success-bg text-success'
}

type PainelComparativoProps = EscritorioGestorProps & {
  periodo: PeriodoGestor
  ordem: OrdemGestor
  linhasHoje: VendedorGestor[]
  onPeriodo: (periodo: PeriodoGestor) => void
  onOrdem: (ordem: OrdemGestor) => void
}

function PainelComparativo({
  vendedores,
  alertas,
  rankingMes,
  rankingMesEstado,
  selecionado,
  onSelecionar,
  periodo,
  ordem,
  linhasHoje,
  onPeriodo,
  onOrdem,
}: PainelComparativoProps) {
  const vendedorSelecionado = vendedores.find(vendedor => vendedor.nome === selecionado) ?? null
  const cabecalhosHoje = criarCabecalhosHojeGestor(ordem)
  const visaoTabela = resolverVisaoTabelaGestor(periodo, rankingMesEstado)
  const motivosDistribuicao = vendedorSelecionado
    ? alertas.filter(alerta => alerta.vendedor === vendedorSelecionado.nome && alerta.nivel !== 'positivo')
    : []

  return (
    <aside className="order-1 min-w-0 space-y-3 rounded-xl border border-border bg-surface-2/30 p-3 xl:order-2" aria-label="Comparativo da equipe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-title text-ink">Visão do gestor</h2>
          <p className="text-micro text-ink-faint">Compare a equipe e escolha quem precisa de ação.</p>
        </div>
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5" aria-label="Período do comparativo">
          {(['hoje', 'mes'] as const).map(opcao => (
            <button
              key={opcao}
              type="button"
              onClick={() => onPeriodo(opcao)}
              aria-pressed={periodo === opcao}
              className={`rounded px-2.5 py-1 text-micro font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                periodo === opcao ? 'bg-accent text-accent-fg' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {opcao === 'hoje' ? 'Hoje' : 'Mês'}
            </button>
          ))}
        </div>
      </div>

      <section aria-labelledby="alertas-gestor-titulo">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 id="alertas-gestor-titulo" className="text-label font-semibold text-ink">Atenção agora</h3>
          <span className="text-micro tabular-nums text-ink-faint">{alertas.length} alerta{alertas.length === 1 ? '' : 's'}</span>
        </div>
        {alertas.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-micro text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Nenhum alerta operacional no momento.
          </div>
        ) : (
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {alertas.map(alerta => (
              <button
                key={alerta.id}
                type="button"
                onClick={() => onSelecionar(resolverSelecaoGestor({ tipo: 'alerta', vendedor: alerta.vendedor }))}
                aria-pressed={selecionado === alerta.vendedor}
                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${alertaTone(alerta.nivel)}`}
              >
                {alerta.nivel === 'positivo'
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block text-micro font-semibold">{alerta.titulo}</span>
                  <span className="block text-micro opacity-80">{alerta.texto}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="comparativo-gestor-titulo">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <h3 id="comparativo-gestor-titulo" className="text-label font-semibold text-ink">
            Comparativo {periodo === 'hoje' ? 'de hoje' : 'do mês'}
          </h3>
          {visaoTabela === 'hoje' && (
            <button
              type="button"
              onClick={() => onOrdem('atencao')}
              aria-pressed={ordem === 'atencao'}
              className={`rounded-md border px-2 py-1 text-micro font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                ordem === 'atencao' ? 'border-accent bg-accent-bg text-accent' : 'border-border bg-surface text-ink-muted hover:text-ink'
              }`}
            >
              {rotuloOrdemGestor('atencao')}
            </button>
          )}
        </div>
        {visaoTabela === 'hoje' ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[650px] border-collapse text-micro">
              <caption className="sr-only">Produção e pendências dos vendedores hoje</caption>
              <thead className="bg-surface-2 text-left text-ink-muted">
                <tr>
                  {cabecalhosHoje.map(cabecalho => (
                    <th
                      key={cabecalho.id}
                      scope="col"
                      aria-sort={cabecalho.ariaSort ?? undefined}
                      className="px-2 py-2 font-semibold"
                    >
                      {cabecalho.ordem ? (
                        <button
                          type="button"
                          onClick={() => onOrdem(cabecalho.ordem!)}
                          className={`whitespace-nowrap rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${ordem === cabecalho.ordem ? 'text-accent' : 'hover:text-ink'}`}
                        >
                          {cabecalho.label}
                        </button>
                      ) : cabecalho.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasHoje.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-5 text-center text-ink-faint">Sem vendedores para comparar.</td>
                  </tr>
                ) : linhasHoje.map(vendedor => (
                  <tr
                    key={vendedor.nome}
                    onClick={() => onSelecionar(resolverSelecaoGestor({ tipo: 'linha', nome: vendedor.nome }))}
                    onKeyDown={evento => {
                      if (evento.key === 'Enter' || evento.key === ' ') {
                        evento.preventDefault()
                        onSelecionar(resolverSelecaoGestor({ tipo: 'linha', nome: vendedor.nome }))
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selecionado === vendedor.nome}
                    className={`cursor-pointer border-t border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                      selecionado === vendedor.nome ? 'bg-accent-bg' : 'hover:bg-surface-2/70'
                    }`}
                  >
                    <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-semibold text-ink">{vendedor.nome}</th>
                    <td className="px-2 py-2">
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 font-semibold ${statusTone(vendedor.status)}`}>
                        {vendedor.statusLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(vendedor.atendimentos)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(vendedor.leads)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(vendedor.orcamentos)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(vendedor.ligacoesAtendidas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(vendedor.parados)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : visaoTabela === 'mes-carregando' ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-5 text-center text-micro text-ink-muted" role="status">
            Carregando comparativo do mês…
          </div>
        ) : visaoTabela === 'mes-indisponivel' ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-5 text-center text-micro text-ink-muted">
            O comparativo do mês está indisponível no momento.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[430px] border-collapse text-micro">
              <caption className="sr-only">Produção dos vendedores no mês</caption>
              <thead className="bg-surface-2 text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-2 py-2 font-semibold">Vendedor</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Atend.</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Leads</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Orç.</th>
                </tr>
              </thead>
              <tbody>
                {rankingMes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-5 text-center text-ink-faint">Sem dados do mês.</td>
                  </tr>
                ) : rankingMes.map(linha => (
                  <tr
                    key={linha.nome}
                    onClick={() => onSelecionar(resolverSelecaoGestor({ tipo: 'linha', nome: linha.nome }))}
                    onKeyDown={evento => {
                      if (evento.key === 'Enter' || evento.key === ' ') {
                        evento.preventDefault()
                        onSelecionar(resolverSelecaoGestor({ tipo: 'linha', nome: linha.nome }))
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selecionado === linha.nome}
                    className={`cursor-pointer border-t border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                      selecionado === linha.nome ? 'bg-accent-bg' : 'hover:bg-surface-2/70'
                    }`}
                  >
                    <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-semibold text-ink">{linha.nome}</th>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(linha.atendimentos)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(linha.leads)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{formatarMetricaGestor(linha.orcamentos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3" aria-live="polite" aria-labelledby="detalhe-vendedor-titulo">
        <h3 id="detalhe-vendedor-titulo" className="text-label font-semibold text-ink">
          {vendedorSelecionado ? vendedorSelecionado.nome : 'Detalhe do vendedor'}
        </h3>
        {vendedorSelecionado ? (
          <>
            <p className="mt-0.5 text-micro text-ink-muted">Produção de hoje e situação da carteira.</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              <div>
                <dt className="text-micro text-ink-faint">Status atual</dt>
                <dd>
                  <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-micro font-semibold ${statusTone(vendedorSelecionado.status)}`}>
                    {vendedorSelecionado.statusLabel}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-micro text-ink-faint">Último sinal</dt>
                <dd className="text-label font-semibold tabular-nums text-ink">{formatarUltimoSinalGestor(vendedorSelecionado.pingSec)}</dd>
              </div>
              {[
                ['Atendimentos hoje', vendedorSelecionado.atendimentos],
                ['Leads recebidos', vendedorSelecionado.leads],
                ['Orçamentos hoje', vendedorSelecionado.orcamentos],
                ['Ligações atendidas', vendedorSelecionado.ligacoesAtendidas],
                ['Total registrado', vendedorSelecionado.ligacoesTotal],
                ['Follow-up', vendedorSelecionado.followup],
                ['Quentes', vendedorSelecionado.quentes],
                ['Clientes parados', vendedorSelecionado.parados],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-micro text-ink-faint">{label}</dt>
                  <dd className="text-label font-semibold tabular-nums text-ink">{formatarMetricaGestor(value as number | null)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-micro text-ink-faint">Carteira</p>
              <p className="text-label font-semibold tabular-nums text-ink">
                {formatarMetricaGestor(vendedorSelecionado.carteiraAberta)} abertas de {formatarMetricaGestor(vendedorSelecionado.carteiraTotal)} clientes
              </p>
              <p className="mt-2 text-micro text-ink-faint">Recebimento de leads</p>
              {motivosDistribuicao.length === 0 ? (
                <p className="text-micro text-ink-muted">Sem impedimento operacional ou por cota identificado.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {motivosDistribuicao.map(alerta => (
                    <li key={alerta.id} className={`text-micro ${alerta.nivel === 'critico' ? 'text-danger' : 'text-warning'}`}>
                      <span className="font-semibold">{alerta.titulo}.</span> {alerta.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <p className="mt-1 text-micro text-ink-muted">Selecione um vendedor na tabela ou em um alerta para ver os detalhes.</p>
        )}
      </section>
    </aside>
  )
}

export function EscritorioGestor(props: EscritorioGestorProps) {
  const [periodo, setPeriodo] = useState<PeriodoGestor>('hoje')
  const [ordem, setOrdem] = useState<OrdemGestor>('atencao')
  const linhasHoje = useMemo(
    () => ordenarVendedoresGestor(props.vendedores, ordem, props.alertas),
    [props.vendedores, props.alertas, ordem],
  )

  return (
    <div className="space-y-3">
      <ResumoDia resumo={props.resumo} />
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.85fr)]">
        <PainelComparativo
          {...props}
          periodo={periodo}
          ordem={ordem}
          linhasHoje={linhasHoje}
          onPeriodo={setPeriodo}
          onOrdem={setOrdem}
        />
        <div className="order-2 min-w-0 xl:order-1">{props.mapa}</div>
      </div>
    </div>
  )
}
