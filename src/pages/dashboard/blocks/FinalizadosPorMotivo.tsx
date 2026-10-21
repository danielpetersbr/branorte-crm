import { useMemo } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { CHART } from '../ui/chart-tokens'
import { n, pct } from '../ui/format'
import { useJanela } from '../DashboardFilterContext'
import { useDashboardFinalizados, type Finalizados } from '@/hooks/useDashboardFinalizados'

/**
 * ATENDIMENTOS FINALIZADOS — quantos atendimentos foram encerrados no período e por quê (21/10/2026, Daniel: "um gráfico mostrando
 * quantos atendimentos finalizamos e qual foi o motivo, que seria a etiqueta que foi colocada"). Ocupa o lugar do funil do período,
 * que foi pra aba Funil.
 *
 * Um atendimento = uma conversa (conta do WhatsApp + cliente). Conta quando a etiqueta MUDA para uma de encerramento; quando a extensão
 * relê o WhatsApp do zero ou duas cópias ficam trocando etiqueta, não conta de novo (ver a migração 20261021130000).
 */

// cor por tipo de motivo: venda verde, sem resposta cinza, perda vermelha, adiado âmbar, não era venda azul
const GRUPO: Record<string, string> = {
  'Vendido': CHART.s1,
  'Nunca respondeu': 'hsl(var(--ink-faint))',
  'Não respondeu mais': 'hsl(var(--ink-faint))',
  'Comprou do concorrente': CHART.s4,
  'Não tem interesse': CHART.s4,
  'Fora do orçamento': CHART.s4,
  'Só base de preço': CHART.s4,
  'Interesse futuro': CHART.s3,
}
const cor = (motivo: string) => GRUPO[motivo] ?? CHART.s2

export function FinalizadosPorMotivo() {
  const { preset, periodoLabel } = useJanela()
  const { data, isPending, isPlaceholderData, isError } = useDashboardFinalizados(preset)
  return <FinalizadosPorMotivoView periodoLabel={periodoLabel} data={data ?? null} pendente={isPending || isPlaceholderData} erro={isError} />
}

export function FinalizadosPorMotivoView({ periodoLabel, data, pendente, erro }: {
  periodoLabel: string; data: Finalizados | null; pendente: boolean; erro: boolean
}) {
  const maior = useMemo(() => Math.max(1, ...(data?.porMotivo ?? []).map(m => m.total)), [data])
  return (
    <Card className="h-full 2xl:p-4">
      <CardHeader
        denso
        title="Atendimentos finalizados"
        subtitle="Por motivo: a etiqueta de encerramento que foi colocada no WhatsApp"
        titleHint="Conta cada conversa (conta do WhatsApp + cliente) uma vez, quando a etiqueta MUDA para uma de encerramento. Releitura do WhatsApp e troca repetida por cópia duplicada da extensão não contam de novo. A parte clara da barra é da Ana."
        janela={<JanelaBadge tipo="periodo" label={periodoLabel} />}
      />
      {pendente && !data ? (
        <div className="h-[260px] animate-pulse rounded-lg bg-surface-2" aria-label="Carregando atendimentos finalizados" />
      ) : erro || !data ? (
        <p className="text-body text-ink-faint">Não deu para ler os encerramentos agora. Use Atualizar dados.</p>
      ) : (
        <div className={`transition-opacity duration-200 ${pendente ? 'opacity-50' : ''}`} aria-busy={pendente}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-kpi tabular-nums text-ink">{n(data.total)}</span>
            <span className="text-label text-ink-faint">
              {data.total === 1 ? 'atendimento finalizado' : 'atendimentos finalizados'}
              {data.ana > 0 ? ` · ${n(data.ana)} pela Ana` : ''}
            </span>
          </div>
          {data.porMotivo.length === 0 ? (
            <p className="mt-4 text-body text-ink-faint">Nenhum atendimento finalizado no período.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2 2xl:mt-2.5 2xl:gap-1.5" aria-label="Atendimentos finalizados por motivo">
              {data.porMotivo.map(m => {
                const vend = m.total - m.ana
                const c = cor(m.motivo)
                return (
                  <li key={m.motivo} className="grid grid-cols-[136px_1fr_auto] items-center gap-2"
                    title={`${m.motivo}: ${n(m.total)} (${pct((m.total / Math.max(1, data.total)) * 100, 0)})${m.ana > 0 ? ` · vendedores ${n(vend)} · Ana ${n(m.ana)}` : ''}`}>
                    <span className="truncate text-micro text-ink-muted">{m.motivo}</span>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                      <div className="h-full" style={{ width: `${(vend / maior) * 100}%`, background: c }} />
                      <div className="h-full" style={{ width: `${(m.ana / maior) * 100}%`, background: c, opacity: 0.4 }} />
                    </div>
                    <span className="min-w-[44px] text-right text-micro tabular-nums">
                      <b className="font-semibold text-ink">{n(m.total)}</b>
                      <span className="text-ink-faint"> {pct((m.total / Math.max(1, data.total)) * 100, 0)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
