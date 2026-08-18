import { ArrowRight, AlertTriangle } from 'lucide-react'
import type { CorridaVendedor } from '@/hooks/useVendasReais'
import { Card, CardHeader } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { brl, n, pct, primeiroNome } from '../ui/format'

const MEDALHA = ['🥇', '🥈', '🥉']

/**
 * Top 5 do mês. O ranking completo, o placar por time e o painel individual
 * moram na aba Equipe — aqui é só o suficiente pra saber quem está entregando.
 *
 * Antes, a Visão geral trazia corrida individual + placar de times + propostas
 * por vendedor + tabela completa, tudo aberto ao mesmo tempo: o mesmo vendedor
 * aparecia quatro vezes na mesma rolagem.
 */
export function TopEquipe({
  corrida,
  metaVendedor,
  degradado,
  onVerTodos,
}: {
  corrida: CorridaVendedor[] | undefined
  metaVendedor: number
  degradado: boolean
  onVerTodos: () => void
}) {
  const linhas = [...(corrida ?? [])].sort((a, b) => b.valor - a.valor)
  const top = linhas.slice(0, 5)
  const mesLabel = new Date().toLocaleDateString('pt-BR', { month: 'long' })

  return (
    <Card>
      <CardHeader
        title="Quem está entregando"
        subtitle={metaVendedor > 0 ? `Meta individual de ${brl(metaVendedor)} no mês.` : undefined}
        janela={<JanelaBadge tipo="mes" label={mesLabel} />}
        right={
          <button
            type="button"
            onClick={onVerTodos}
            className="inline-flex min-h-[44px] md:min-h-0 items-center gap-1 rounded-lg px-2 py-1 text-label text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver equipe completa
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      />

      {degradado && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg p-3 text-micro text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>O Controle não respondeu. Sem ranking por vendedor no espelho local — a lista abaixo pode estar vazia por isso, não por falta de vendas.</span>
        </p>
      )}

      {top.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-faint">Nenhuma venda registrada no mês.</p>
      ) : (
        <ol className="flex flex-col">
          {top.map((v, i) => (
            <li
              key={v.vendedor}
              className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0"
            >
              <span className="w-6 shrink-0 text-center text-label tabular-nums text-ink-faint" aria-hidden="true">
                {MEDALHA[i] ?? i + 1}
              </span>
              <span className="sr-only">{i + 1}º lugar:</span>

              {/* break-words e sem truncate: nome de vendedor não pode ser cortado */}
              <span className="min-w-0 flex-1 break-words text-body text-ink">
                {primeiroNome(v.vendedor) || v.vendedor}
              </span>

              <span className="hidden w-28 shrink-0 text-right text-label tabular-nums text-ink-muted sm:block">
                {n(v.numVendas)} {v.numVendas === 1 ? 'venda' : 'vendas'}
              </span>

              <span className="w-24 shrink-0 text-right text-body tabular-nums text-ink sm:w-28">
                {brl(v.valor)}
              </span>

              <span className="hidden w-32 shrink-0 items-center gap-2 sm:flex">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className={`block h-full rounded-full ${v.pct >= 100 ? 'bg-success' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, Math.max(v.pct, 1))}%` }}
                  />
                </span>
                <span className="w-10 text-right text-micro tabular-nums text-ink-muted">{pct(v.pct, 0)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
