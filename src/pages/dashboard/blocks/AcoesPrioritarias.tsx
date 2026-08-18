import { useMemo } from 'react'
import { ChevronRight, CheckCircle2 } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboard'
import type { useDashboardEtiquetas } from '@/hooks/useDashboardEtiquetas'
import type { VendedorFunilRow } from '@/hooks/useDashboardVendedorFunil'
import { Card, CardHeader } from '../ui/Card'
import { brl, n } from '../ui/format'
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

const ORDEM: Record<Prioridade, number> = { critica: 0, alta: 1, media: 2 }

const ESTILO: Record<Prioridade, { pill: string; label: string }> = {
  critica: { pill: 'border-danger/40 bg-danger-bg text-danger',   label: 'Crítica' },
  alta:    { pill: 'border-warning/40 bg-warning-bg text-warning', label: 'Alta' },
  media:   { pill: 'border-border bg-surface-2 text-ink-muted',    label: 'Média' },
}

/**
 * O que o gerente precisa cobrar HOJE.
 *
 * Esta lógica já existia no dashboard antigo (calculava `acoesTop` e nunca
 * renderizava — era jogada fora todo render). Aqui ela vira o bloco que o
 * gerente lê antes de qualquer gráfico.
 *
 * Regra: no máximo 5 itens, cada um com quantidade, motivo e destino clicável.
 * Alerta sem número e sem link é ruído.
 */
export function AcoesPrioritarias({
  data,
  etq,
  vendFunil,
  onIr,
}: {
  data: DashboardData
  etq: ReturnType<typeof useDashboardEtiquetas>['data']
  vendFunil: VendedorFunilRow[] | undefined
  onIr: (tab: TabId, anchor?: string) => void
}) {
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

  return (
    <Card>
      <CardHeader
        title="Ações prioritárias"
        subtitle="O que precisa de decisão hoje. Clique para abrir a lista de clientes."
      />

      {acoes.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg p-4">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <p className="text-body text-success">Nada urgente agora. Nenhum lead quente parado, nenhum vendedor sem proposta.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {acoes.map((a, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onIr(a.destino.tab, a.destino.anchor)}
                className="group flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className={`mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-micro ${ESTILO[a.prioridade].pill}`}>
                  {ESTILO[a.prioridade].label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{a.titulo}</span>
                  <span className="mt-0.5 block text-label text-ink-faint">{a.motivo}</span>
                  {(a.valor != null || a.responsavel) && (
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-ink-muted">
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
    </Card>
  )
}
