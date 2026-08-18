import { Clock, CalendarDays, Camera } from 'lucide-react'

/**
 * Carimbo de janela temporal.
 *
 * Este selo existe por um motivo específico: a maior fonte de confusão do
 * dashboard antigo não era conta errada, era a MESMA palavra medindo janelas
 * diferentes na mesma tela. "Orçamentos 237" (30 dias) ficava a 300px de
 * "Orçamento 513" (snapshot de todos os tempos), sem nada avisando.
 *
 * Regra: todo bloco que mostra número carrega um destes. Sem exceção.
 */
export type TipoJanela = 'periodo' | 'mes' | 'snapshot' | 'fixo'

const META: Record<TipoJanela, { Icon: typeof Clock; hint: string }> = {
  periodo:  { Icon: Clock,        hint: 'Segue o filtro de período selecionado no topo.' },
  mes:      { Icon: CalendarDays, hint: 'Mês calendário corrente — ignora o filtro do topo.' },
  snapshot: { Icon: Camera,       hint: 'Estado de agora, acumulado de todos os tempos — ignora o filtro do topo.' },
  fixo:     { Icon: Clock,        hint: 'Janela fixa — ignora o filtro do topo.' },
}

export function JanelaBadge({
  tipo,
  label,
  className = '',
}: {
  tipo: TipoJanela
  /** Texto visível: "30 dias", "agosto", "estado de agora", "últimos 30 dias" */
  label: string
  className?: string
}) {
  const { Icon, hint } = META[tipo]
  // Cinza para tudo. A cor aqui seria ruído: a janela não é boa nem ruim,
  // é só um fato sobre o número. Quem diferencia é o ícone + o texto.
  return (
    <span
      title={hint}
      className={`inline-flex items-center gap-1 shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-micro text-ink-muted ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only"> — {hint}</span>
    </span>
  )
}
