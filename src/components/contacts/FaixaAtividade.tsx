import { CheckCircle2, CircleDashed, Clock, History, AlertTriangle, HelpCircle } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { useAtividadeContatos, type FaixaAtividade as Faixa } from '@/hooks/useAtividadeContatos'
import type { ContactFilters } from '@/types'

/**
 * "Atividade dos contatos": 6 cards no topo de /contatos, por tempo desde a
 * última interação. Clicar num card filtra a lista, SOMANDO aos filtros que já
 * estiverem ativos (vendedor, estado, etiqueta, temperatura, orçamento).
 *
 * ⚠️ A data é GLOBAL: é o último contato com QUALQUER vendedor, não com o
 * vendedor filtrado. 566 de 7.791 telefones com conversa (7,3%) falaram com 2+
 * vendedores. Está dito no tooltip porque, calado, inverteria a decisão que o
 * painel existe pra apoiar — o gestor cobraria o vendedor errado.
 */

const FAIXAS: Array<{
  v: Faixa; label: string; curto: string; icon: typeof Clock
  cor: string; barra: string; ativo: string; ajuda: string
}> = [
  {
    v: 'd30', label: 'Últimos 30 dias', curto: '30 dias', icon: CheckCircle2,
    cor: 'text-success', barra: 'bg-success', ativo: 'border-success/50 bg-success-bg',
    ajuda: 'Última interação há 30 dias ou menos.',
  },
  {
    v: 'd60', label: '31 a 60 dias', curto: '31-60 d', icon: Clock,
    cor: 'text-info', barra: 'bg-info', ativo: 'border-info/50 bg-info-bg',
    ajuda: 'Última interação entre 31 e 60 dias atrás.',
  },
  {
    v: 'd100', label: '61 a 100 dias', curto: '61-100 d', icon: CircleDashed,
    cor: 'text-warning', barra: 'bg-warning', ativo: 'border-warning/50 bg-warning-bg',
    ajuda: 'Última interação entre 61 e 100 dias atrás.',
  },
  {
    v: 'd365', label: '101 dias a 1 ano', curto: '101 d–1 ano', icon: History,
    cor: 'text-warning', barra: 'bg-warning/70', ativo: 'border-warning/50 bg-warning-bg',
    ajuda: 'Última interação entre 101 e 365 dias atrás.',
  },
  {
    v: 'mais', label: 'Mais de 1 ano', curto: '+1 ano', icon: AlertTriangle,
    cor: 'text-danger', barra: 'bg-danger', ativo: 'border-danger/50 bg-danger-bg',
    ajuda: 'Última interação há mais de 365 dias.',
  },
  {
    v: 'sem', label: 'Sem histórico', curto: 'Sem hist.', icon: HelpCircle,
    cor: 'text-ink-faint', barra: 'bg-ink-faint', ativo: 'border-border-strong bg-surface-2',
    // "Nunca contatados" seria falso: 6.193 desses já receberam orçamento.
    ajuda: 'Não temos mensagem, etiqueta ou atendimento datado. NÃO quer dizer que ninguém falou com eles: a maior parte entrou na importação de base, que trouxe o contato e não a conversa.',
  },
]

// Interação = mensagem no WhatsApp, atendimento, etiqueta aplicada ou movimentada.
const BASE_AJUDA =
  'Interação = mensagem no WhatsApp, atendimento, etiqueta aplicada ou etiqueta movimentada. '
  + 'A data é a do último contato com QUALQUER vendedor, não só com o vendedor filtrado. '
  + 'Contado por dia de calendário (Brasília).'

export function FaixaAtividadeContatos({
  filters, onEscolher,
}: {
  filters: ContactFilters
  onEscolher: (faixa: string) => void
}) {
  const { data, isLoading, isError } = useAtividadeContatos(filters)

  // Erro não pode virar "tudo zero": número inventado é pior que ausência.
  if (isError) return null

  const mapa = new Map((data ?? []).map(l => [l.faixa, l.contatos]))
  const total = (data ?? []).reduce((a, l) => a + l.contatos, 0)
  // Raiz quadrada porque uma faixa concentra ~89% da base: em escala linear as
  // outras cinco barras ficariam invisíveis. O NÚMERO e o percentual seguem
  // exatos — a barra é ordem de grandeza, não medida.
  const maior = Math.max(...(data ?? []).map(l => l.contatos), 1)

  return (
    <section aria-label="Atividade dos contatos" className="mt-4">
      <div className="flex items-baseline gap-2 mb-1.5">
        <h2 className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ink-faint">
          Atividade dos contatos
        </h2>
        {filters.faixa && (
          <button
            onClick={() => onEscolher('')}
            className="text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            limpar faixa
          </button>
        )}
      </div>

      {/* 6 numa linha no monitor; quebra em 3 e 2 conforme aperta. Scroll
          horizontal foi descartado: esconde card e o gestor não sabe que existe. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-1.5">
        {FAIXAS.map(f => {
          const n = mapa.get(f.v) ?? 0
          const pct = total > 0 ? (n / total) * 100 : 0
          const ativo = filters.faixa === f.v
          const Icon = f.icon
          if (isLoading && !data) {
            return (
              <div key={f.v} aria-hidden
                className="h-[62px] rounded-lg border border-border bg-surface-2/50 animate-pulse" />
            )
          }
          return (
            <button
              key={f.v}
              onClick={() => onEscolher(ativo ? '' : f.v)}
              aria-pressed={ativo}
              title={`${f.label} — ${formatNumber(n)} contatos (${pct.toFixed(1)}%)\n\n${f.ajuda}\n\n${BASE_AJUDA}`}
              className={cn(
                'group text-left rounded-lg border px-2.5 py-2 min-w-0',
                'transition-colors duration-100 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                ativo ? f.ativo : 'border-border bg-surface hover:bg-surface-2/60 hover:border-border-strong',
              )}
            >
              <span className="flex items-center gap-1 min-w-0">
                <Icon aria-hidden className={cn('h-3 w-3 shrink-0', f.cor)} />
                <span className="truncate text-[10.5px] font-medium uppercase tracking-[0.03em] text-ink-muted">
                  <span className="2xl:hidden">{f.curto}</span>
                  <span className="hidden 2xl:inline">{f.label}</span>
                </span>
              </span>
              <span className="mt-0.5 flex items-baseline gap-1">
                <span className="text-[16px] font-semibold tabular-nums text-ink leading-none">
                  {formatNumber(n)}
                </span>
                <span className="text-[10px] tabular-nums text-ink-faint">{pct.toFixed(1)}%</span>
              </span>
              <span aria-hidden className="mt-1.5 block h-[3px] rounded-full bg-surface-2 overflow-hidden">
                <span
                  className={cn('block h-full rounded-full', f.barra)}
                  style={{ width: `${Math.max(2, Math.sqrt(n / maior) * 100)}%` }}
                />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
