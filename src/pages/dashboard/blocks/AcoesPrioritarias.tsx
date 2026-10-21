import { useMemo } from 'react'
import { AlertTriangle, ChevronRight, CheckCircle2, Flame, Target, TrendingUp, Trophy } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboard'
import type { useDashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import type { VendedorFunilRow } from '@/hooks/useDashboardVendedorFunil'
import { RISCO_MAX_HORAS } from '@/lib/dashboard-risco'
import { foraDoRanking, naoEhVendedor } from '@/lib/vendedores-fora-do-ranking'
import { Card, CardHeader } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { useJanela } from '../DashboardFilterContext'
import { brl, n, primeiroNome } from '../ui/format'
import type { TabId } from '../tabs'

type Prioridade = 'critica' | 'alta' | 'media'

type Acao = {
  prioridade: Prioridade
  titulo: string
  motivo: string
  quantidade: number
  valor?: number
  responsavel?: string
  destino: { tab: TabId; anchor?: string }
}

/**
 * A metade POSITIVA do bloco — o que reforçar.
 *
 * Vive fora daqui (a TabVisaoGeral calcula, porque é ela quem tem os hooks de
 * orçamento, cobertura e propostas). Este bloco só desenha.
 */
export type PositivoDestaques = {
  /** Quem montou mais R$ em proposta no builder. */
  topOrc: { vendedor: string; n: number; brl: number } | null
  /** Maior % de clientes passados que o vendedor etiquetou (entraram no funil). */
  cobertura: { nome: string; pct: number; com: number; total: number } | null
  /** R$ das propostas em orçamento / quente / lead quente — pipeline quente real. */
  rNegoc: number
  /** R$ total montado no builder no período. */
  rMontado: number
  /** Leads qualificados (IA ou etiqueta de avanço). */
  qualificou: number
  /**
   * Clientes DISTINTOS com proposta montada no período.
   * ATENÇÃO: no dashboard antigo este número era rotulado "propostas no
   * período", o que é falso — `orc.geradas` conta CLIENTE, não proposta
   * (a contagem de propostas é `orc.propostasBrutas`, sempre maior por causa
   * das re-cotações do mesmo cliente). Conta mantida igual, rótulo corrigido.
   */
  clientesComProposta: number
}

const ORDEM: Record<Prioridade, number> = { critica: 0, alta: 1, media: 2 }

const ESTILO: Record<Prioridade, { pill: string; label: string }> = {
  critica: { pill: 'border-danger/40 bg-danger-bg text-danger',   label: 'Crítica' },
  alta:    { pill: 'border-warning/40 bg-warning-bg text-warning', label: 'Alta' },
  media:   { pill: 'border-border bg-surface-2 text-ink-muted',    label: 'Média' },
}

/**
 * DECISÕES DO GERENTE — as duas metades, lado a lado.
 *
 * A metade "cobrar" já existia aqui (a lógica calculava `acoesTop` no dashboard
 * antigo e nunca renderizava — era jogada fora todo render). A metade
 * "reforçar" veio do `DecisoesGerente` do arquivo de 3.696 linhas e tinha se
 * perdido inteira no refactor: nenhuma aba mostrava mais quem lidera em
 * propostas, quem cobre melhor com etiqueta, nem o R$ em negociação quente.
 *
 * Como as duas metades se distinguem SEM depender de cor:
 *   1. cada uma tem um <h4> em texto puro — "Reforçar" e "Cobrar";
 *   2. cada uma tem uma linha explicando o que aquela coluna significa;
 *   3. cada uma tem um ícone lucide próprio (tendência × alerta);
 *   4. só DEPOIS disso vem a cor, como reforço.
 * Em print P&B, com daltonismo, ou com o CSS de cor falhando, o título ainda
 * diz de que lado o item está. (No original isso era emoji de bolinha verde /
 * vermelha mais a cor, e só — as duas coisas que sumiram do padrão novo.)
 */
export function AcoesPrioritarias({
  data,
  etq,
  vendFunil,
  positivo,
  vendedoresComProposta,
  onIr,
  denso = false,
}: {
  data: DashboardData
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
  vendFunil: VendedorFunilRow[] | undefined
  positivo: PositivoDestaques
  /** 1º nome em CAIXA de quem montou proposta no builder no período. */
  vendedoresComProposta: Set<string>
  onIr: (tab: TabId, anchor?: string) => void
  /**
   * (21/10/2026, Daniel: "não quero precisar rolar") Na Visão geral, a partir de 2xl o bloco é a 4ª coluna da última
   * faixa: as duas metades empilham com COBRAR em cima (é o que pede decisão hoje; a ordem muda só no visual, `order`),
   * reforçar vira lista de uma linha por item, cada item mostra só o título (o porquê fica no title=, ao passar o mouse)
   * e o cartão ocupa a altura da faixa com rolagem própria (absolute no wrapper `relative` da TabVisaoGeral), pra não
   * esticar a página. Abaixo de 2xl nada muda.
   */
  denso?: boolean
}) {
  const { periodoLabel } = useJanela()
  const d = (cls: string) => (denso ? ` ${cls}` : '')

  const acoes = useMemo<Acao[]>(() => {
    const out: Acao[] = []

    // 1. Lead quente sumido — o mais caro de perder.
    // Quantidade, R$ e responsáveis vêm da lista INTEIRA (riscoResumo), não dos 8 que a
    // aba Funil mostra: o card somava só os 8 maiores e apontava 1 responsável para
    // leads de 10 vendedores (19/10/2026). A janela vai no título porque quem passou de
    // 14 dias parado não está aqui por decisão (29/09/2026), não por esquecimento.
    const risco = data.riscoResumo
    if (risco.indisponivel) {
      out.push({
        prioridade: 'critica',
        titulo: 'Leads quentes parados: não deu para conferir agora',
        motivo: 'A busca de orçamentos e conversas do WhatsApp falhou. Sem ela não dá para dizer quem está parado nem quanto está em jogo. Use Atualizar dados.',
        quantidade: 0,
        destino: { tab: 'funil', anchor: 'leads-resgatar' },
      })
    } else if (risco.qtd > 0) {
      const top = risco.vendedores.slice(0, 3).map(v => `${primeiroNome(v.nome)} (${n(v.qtd)})`)
      const resto = risco.vendedores.length - top.length
      out.push({
        prioridade: 'critica',
        titulo: `${n(risco.qtd)} lead${risco.qtd > 1 ? 's' : ''} com proposta ou querendo comprar agora, sem movimento há mais de 24h (até ${RISCO_MAX_HORAS / 24} dias)`,
        motivo: 'Sem mensagem no WhatsApp, no atendimento nem proposta nova desde então. É a situação de agora: não segue o filtro de período.',
        quantidade: risco.qtd,
        valor: risco.valor > 0 ? risco.valor : undefined,
        responsavel: top.length > 0 ? `${top.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}` : undefined,
        destino: { tab: 'funil', anchor: 'leads-resgatar' },
      })
    }

    // 2. Lead sem etiqueta = invisível no funil. Sem o dono: o WhatsApp dele não é carteira.
    const equipeFunil = (vendFunil ?? []).filter(v => !foraDoRanking(v.vendedor))
    const semEtq = equipeFunil.reduce((s, v) => s + v.sem_etiqueta, 0)
    if (semEtq >= 20) {
      const piores = [...equipeFunil]
        .filter(v => v.sem_etiqueta >= 8)
        .sort((a, b) => b.sem_etiqueta - a.sem_etiqueta)
        .slice(0, 2)
        .map(v => v.vendedor)
      out.push({
        prioridade: 'alta',
        titulo: `${n(semEtq)} leads sem etiqueta`,
        motivo: 'Sem etiqueta o lead não aparece em nenhuma etapa do funil — some do acompanhamento.',
        quantidade: semEtq,
        responsavel: piores.join(' e ') || undefined,
        destino: { tab: 'equipe' },
      })
    }

    // 3. Vendedor com lead e zero proposta.
    // A RPC decide "sem proposta" pela ETIQUETA de orçamento no WhatsApp, não pelo
    // builder: em 19/10 listava IGOR, que tinha montado 46 propostas no mês. Aqui
    // vale o builder (a mesma fonte do card "Clientes com proposta"), e saem o dono
    // e a ANA, que é a IA de atendimento e não monta orçamento.
    const semOrc = (etq?.sem_orc_vendedores ?? []).filter(v => {
      const nome = String(v ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? ''
      return nome !== '' && !naoEhVendedor(v) && !vendedoresComProposta.has(nome)
    })
    if (semOrc.length > 0) {
      out.push({
        prioridade: 'alta',
        titulo: `${semOrc.length} vendedor(es) com lead e nenhuma proposta montada`,
        motivo: 'Recebeu lead no período e não montou um orçamento sequer no CRM.',
        quantidade: semOrc.length,
        responsavel: semOrc.slice(0, 3).join(', '),
        destino: { tab: 'equipe' },
      })
    }

    // 4. Parados no começo do funil. A RPC passou a exigir também zero mensagem no
    // WhatsApp e a tirar o dono (19/10/2026: os 6 "órfãos" eram do dono e tinham
    // conversa no mesmo dia — "parado" olhava só quando a etiqueta mudou).
    if (etq && etq.alertas.leads_orfaos > 0) {
      out.push({
        prioridade: 'media',
        titulo: `${n(etq.alertas.leads_orfaos)} leads parados no começo do funil há mais de 7 dias`,
        motivo: 'Novo lead, prospecção ou 2ª tentativa, sem etiqueta nova nem mensagem no WhatsApp há mais de 7 dias.',
        quantidade: etq.alertas.leads_orfaos,
        destino: { tab: 'funil', anchor: 'leads-orfaos' },
      })
    }

    // 5. Criativo trazendo lead fora do que a fábrica faz.
    if (etq && etq.alertas.criativos_nao_fabricamos > 0) {
      out.push({
        prioridade: 'media',
        titulo: `${etq.alertas.criativos_nao_fabricamos} criativo(s) trazendo lead que a Branorte não fabrica`,
        motivo: 'Verba comprando contato que nunca vira venda.',
        quantidade: etq.alertas.criativos_nao_fabricamos,
        destino: { tab: 'marketing' },
      })
    }

    return out.sort((a, b) => ORDEM[a.prioridade] - ORDEM[b.prioridade]).slice(0, 5)
  }, [data.riscoResumo, etq, vendFunil, vendedoresComProposta])

  // Metade "reforçar". Mesmos cortes do original: cobertura só entra a partir de
  // 55% (abaixo disso não é destaque, é o normal) e negociação só com R$ > 0.
  const reforcar = useMemo(() => {
    const out: { Icon: typeof Trophy; titulo: string; motivo: string }[] = []
    if (positivo.topOrc) {
      out.push({
        Icon: Trophy,
        // Ordena por R$, não por quantidade — o título tem que dizer isso.
        titulo: `${primeiroNome(positivo.topOrc.vendedor)} lidera em R$ de propostas montadas`,
        motivo: `${brl(positivo.topOrc.brl)} em ${n(positivo.topOrc.n)} ${positivo.topOrc.n === 1 ? 'cliente' : 'clientes'}.`,
      })
    }
    if (positivo.cobertura && positivo.cobertura.pct >= 55) {
      const c = positivo.cobertura
      out.push({
        Icon: Target,
        titulo: `${primeiroNome(c.nome)} etiqueta ${c.pct}% dos clientes que recebe`,
        motivo: `${n(c.com)} de ${n(c.total)} clientes passados têm etiqueta no WhatsApp dele.`,
      })
    }
    if (positivo.rNegoc > 0) {
      out.push({
        Icon: Flame,
        titulo: `${brl(positivo.rNegoc)} em negociação quente`,
        motivo: 'Proposta do período cujo cliente está em ORÇAMENTO ENVIADO, FOLLOW UP, AGENDAMENTO ou LEAD QUENTE. Prospecção, 2ª tentativa, interesse futuro e sem etiqueta não contam.',
      })
    }
    return out
  }, [positivo])

  const numeros = [
    { v: brl(positivo.rMontado),        l: 'em propostas montadas' },
    { v: n(positivo.qualificou),        l: 'leads qualificados' },
    { v: n(positivo.clientesComProposta), l: 'clientes com proposta' },
  ]

  return (
    <Card className={denso ? '2xl:absolute 2xl:inset-0 2xl:overflow-y-auto 2xl:p-4' : ''}>
      <CardHeader
        denso={denso}
        title="Decisões do gerente"
        subtitle="O que reforçar e o que cobrar agora. Clique num item de cobrança para abrir a lista de clientes."
        janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
      />

      <div className={`grid grid-cols-1 gap-5 lg:grid-cols-2${d('2xl:grid-cols-1 2xl:gap-3')}`}>
        {/* ── REFORÇAR ──────────────────────────────────────────────── */}
        <div>
          <h4 className="flex items-center gap-2 text-title text-ink">
            <TrendingUp className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            Reforçar
          </h4>
          <p className={`mt-1 text-label text-ink-faint${d('2xl:hidden')}`}>Está funcionando — dobre a aposta e diga isso em voz alta.</p>

          {reforcar.length === 0 ? (
            <p className={`mt-3 rounded-lg border border-border bg-surface-2 p-3 text-body text-ink-muted${d('2xl:mt-1.5 2xl:p-2 2xl:text-label')}`}>
              Sem destaque no período. Ninguém montou proposta com valor, nenhum vendedor com 50 clientes ou mais
              passou de 55% de etiquetagem e não há R$ em negociação quente.
            </p>
          ) : (
            <ul className={`mt-3 flex flex-col gap-2${d('2xl:mt-1.5 2xl:gap-1')}`}>
              {reforcar.map(r => (
                <li
                  key={r.titulo}
                  className={`flex items-start gap-3 rounded-lg border border-success/30 bg-success-bg p-3${d('2xl:gap-2 2xl:rounded-none 2xl:border-0 2xl:bg-transparent 2xl:p-0')}`}
                  title={denso ? r.motivo : undefined}
                >
                  <r.Icon className={`mt-0.5 h-4 w-4 shrink-0 text-success${d('2xl:h-3.5 2xl:w-3.5')}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-body font-medium text-ink${d('2xl:text-label')}`}>{r.titulo}</span>
                    <span className={`mt-0.5 block text-label text-ink-faint${d('2xl:hidden')}`}>{r.motivo}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── COBRAR ────────────────────────────────────────────────── */}
        <div className={denso ? '2xl:order-first' : undefined}>
          <h4 className="flex items-center gap-2 text-title text-ink">
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            Cobrar
          </h4>
          <p className={`mt-1 text-label text-ink-faint${d('2xl:hidden')}`}>Precisa de decisão hoje. Cada item abre a lista de clientes.</p>

          {acoes.length === 0 ? (
            <div className={`mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg p-3${d('2xl:mt-2 2xl:p-2')}`}>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <p className="text-body text-success">Nada urgente agora. Nenhum lead quente parado, nenhum vendedor sem proposta.</p>
            </div>
          ) : (
            <ul className={`mt-3 flex flex-col gap-2${d('2xl:mt-2 2xl:gap-1.5')}`}>
              {acoes.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onIr(a.destino.tab, a.destino.anchor)}
                    title={denso ? a.motivo : undefined}
                    className={`group flex min-h-[44px] w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-0${d('2xl:gap-2 2xl:px-2.5 2xl:py-2')}`}
                  >
                    <span className={`mt-0.5 shrink-0 rounded-sm border px-2 py-1 text-micro ${ESTILO[a.prioridade].pill}${d('2xl:mt-0 2xl:px-1.5 2xl:py-0.5')}`}>
                      {ESTILO[a.prioridade].label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-body font-medium text-ink${d('2xl:text-label')}`}>{a.titulo}</span>
                      <span className={`mt-0.5 block text-label text-ink-faint${d('2xl:hidden')}`}>{a.motivo}</span>
                      {(a.valor != null || a.responsavel) && (
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-muted">
                          {a.valor != null && <span className="tabular-nums">{brl(a.valor)} em jogo</span>}
                          {a.responsavel && <span>responsável: {a.responsavel}</span>}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint group-hover:text-accent"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Rodapé: o tamanho do jogo, para as duas metades acima terem escala. */}
      <div className={`mt-5 grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-3${d('2xl:mt-3 2xl:gap-1.5')}`}>
        {numeros.map(x => (
          <div key={x.l} className={`rounded-lg border border-border/60 bg-surface-2 p-3${d('2xl:p-2')}`}>
            <div className={`text-kpi-sm text-ink tabular-nums break-words${d('2xl:text-body 2xl:font-semibold')}`}>{x.v}</div>
            <div className="mt-1 text-micro text-ink-faint">{x.l}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
