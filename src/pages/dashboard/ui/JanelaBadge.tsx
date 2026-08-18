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

/**
 * A ressalva da janela em texto puro, para quem precisa COMPOR um rótulo falado
 * em vez de renderizar o selo.
 *
 * Existe porque `aria-label` num elemento SUBSTITUI o conteúdo dele na árvore de
 * acessibilidade: um KPI clicável com `aria-label` engolia o selo inteiro — e
 * com ele a única pista de que aquele número ignora o filtro do topo. Quem põe
 * aria-label num container que contém um JanelaBadge tem que trazer isto junto.
 */
export function janelaHint(tipo: TipoJanela): string {
  return META[tipo].hint
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
      {/* Vírgula e não travessão: o travessão é anunciado como "traço" por
          parte dos leitores, e a ressalva soava como um item separado do selo.
          Dentro do MESMO span, é lido em sequência com o rótulo visível. */}
      <span className="sr-only">, {hint}</span>
    </span>
  )
}
