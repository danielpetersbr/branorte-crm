import { useMemo } from 'react'
import { AlertTriangle, ChevronRight, CheckCircle2, Flame, Target, TrendingUp, Trophy } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboard'
import type { useDashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import type { VendedorFunilRow } from '@/hooks/useDashboardVendedorFunil'
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
  onIr,
}: {
  data: DashboardData
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
  vendFunil: VendedorFunilRow[] | undefined
  positivo: PositivoDestaques
  onIr: (tab: TabId, anchor?: string) => void
}) {
  const { periodoLabel } = useJanela()

  const acoes = useMemo<Acao[]>(() => {
    const out: Acao[] = []

    // 1. Lead quente sumido — o mais caro de perder.
    if (data.leadsEmRisco.length > 0) {
      const qtd = data.leadsEmRisco.length
      const valor = data.leadsEmRisco.reduce((s, l) => s + (l.valor ?? 0), 0)
      const dono = data.leadsEmRisco.find(l => l.vendedor)?.vendedor ?? undefined
      out.push({
        prioridade: 'critica',
        // o hook corta a lista em 8 — não afirmar que são exatamente 8
        titulo: `${qtd >= 8 ? '8+' : n(qtd)} lead${qtd > 1 ? 's' : ''} quente${qtd > 1 ? 's' : ''} sem resposta há mais de 24h`,
        motivo: 'Já pediram proposta e pararam de responder. Cada hora esfria.',
        quantidade: qtd,
        valor: valor > 0 ? valor : undefined,
        responsavel: dono,
        destino: { tab: 'funil', anchor: 'leads-resgatar' },
      })
    }

    // 2. Lead sem etiqueta = invisível no funil.
    const semEtq = (vendFunil ?? []).reduce((s, v) => s + v.sem_etiqueta, 0)
    if (semEtq >= 20) {
      const piores = [...(vendFunil ?? [])]
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
    if (etq && etq.sem_orc_vendedores.length > 0) {
      out.push({
        prioridade: 'alta',
        titulo: `${etq.sem_orc_vendedores.length} vendedor(es) com lead e nenhuma proposta enviada`,
        motivo: 'Recebeu lead no período e não montou um orçamento sequer.',
        quantidade: etq.sem_orc_vendedores.length,
        responsavel: etq.sem_orc_vendedores.slice(0, 3).join(', '),
        destino: { tab: 'equipe' },
      })
    }

    // 4. Órfãos parados no começo do funil.
    if (etq && etq.alertas.leads_orfaos > 0) {
      out.push({
        prioridade: 'media',
        titulo: `${n(etq.alertas.leads_orfaos)} leads órfãos parados há mais de 7 dias`,
        motivo: 'Entraram, ninguém assumiu, e continuam no começo do funil.',
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
  }, [data.leadsEmRisco, etq, vendFunil])

  // Metade "reforçar". Mesmos cortes do original: cobertura só entra a partir de
  // 55% (abaixo disso não é destaque, é o normal) e negociação só com R$ > 0.
  const reforcar = useMemo(() => {
    const out: { Icon: typeof Trophy; titulo: string; motivo: string }[] = []
    if (positivo.topOrc) {
      out.push({
        Icon: Trophy,
        titulo: `${primeiroNome(positivo.topOrc.vendedor)} lidera em propostas montadas`,
        motivo: `${brl(positivo.topOrc.brl)} em ${n(positivo.topOrc.n)} ${positivo.topOrc.n === 1 ? 'cliente' : 'clientes'}.`,
      })
    }
    if (positivo.cobertura && positivo.cobertura.pct >= 55) {
      const c = positivo.cobertura
      out.push({
        Icon: Target,
        titulo: `${primeiroNome(c.nome)} etiqueta ${c.pct}% dos clientes que recebe`,
        motivo: `${n(c.com)} de ${n(c.total)} clientes passados entraram no funil — o resto do time some com o lead.`,
      })
    }
    if (positivo.rNegoc > 0) {
      out.push({
        Icon: Flame,
        titulo: `${brl(positivo.rNegoc)} em negociação quente`,
        motivo: "Propostas com etiqueta orçamento / quente / lead quente — não conta 'novo' nem sem-etiqueta.",
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
    <Card>
      <CardHeader
        title="Decisões do gerente"
        subtitle="O que reforçar e o que cobrar agora. Clique num item de cobrança para abrir a lista de clientes."
        janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── REFORÇAR ──────────────────────────────────────────────── */}
        <div>
          <h4 className="flex items-center gap-2 text-title text-ink">
            <TrendingUp className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            Reforçar
          </h4>
          <p className="mt-1 text-label text-ink-faint">Está funcionando — dobre a aposta e diga isso em voz alta.</p>

          {reforcar.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-body text-ink-muted">
              Sem destaque no período. Ninguém montou proposta com valor, ninguém passou de 55% de cobertura de
              etiqueta e não há R$ em negociação quente.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {reforcar.map(r => (
                <li
                  key={r.titulo}
                  className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-bg p-3"
                >
                  <r.Icon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">{r.titulo}</span>
                    <span className="mt-0.5 block text-label text-ink-faint">{r.motivo}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── COBRAR ────────────────────────────────────────────────── */}
        <div>
          <h4 className="flex items-center gap-2 text-title text-ink">
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            Cobrar
          </h4>
          <p className="mt-1 text-label text-ink-faint">Precisa de decisão hoje. Cada item abre a lista de clientes.</p>

          {acoes.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <p className="text-body text-success">Nada urgente agora. Nenhum lead quente parado, nenhum vendedor sem proposta.</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {acoes.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onIr(a.destino.tab, a.destino.anchor)}
                    className="group flex min-h-[44px] w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-0"
                  >
                    <span className={`mt-0.5 shrink-0 rounded-sm border px-2 py-1 text-micro ${ESTILO[a.prioridade].pill}`}>
                      {ESTILO[a.prioridade].label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium text-ink">{a.titulo}</span>
                      <span className="mt-0.5 block text-label text-ink-faint">{a.motivo}</span>
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
      <div className="mt-5 grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-3">
        {numeros.map(x => (
          <div key={x.l} className="rounded-lg border border-border/60 bg-surface-2 p-3">
            <div className="text-kpi-sm text-ink tabular-nums break-words">{x.v}</div>
            <div className="mt-1 text-micro text-ink-faint">{x.l}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
