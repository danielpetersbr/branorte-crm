import type { ReactNode } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from 'lucide-react'
import { JanelaBadge, type TipoJanela } from './JanelaBadge'

/**
 * Delta vs período anterior.
 *
 * Nunca só cor: seta + sinal + texto. Daltônico e print em P&B leem igual.
 * `bom` diz qual direção é boa — cair 20% em "leads sem dono" é ótimo.
 */
export function Delta({
  pct,
  bom = 'subir',
  sufixo = 'vs. período anterior',
}: {
  pct: number | null | undefined
  bom?: 'subir' | 'cair'
  sufixo?: string
}) {
  if (pct == null || !Number.isFinite(pct)) return null
  const zero = Math.abs(pct) < 0.5
  const subiu = pct > 0
  const positivo = zero ? null : (bom === 'subir' ? subiu : !subiu)
  const Icon = zero ? Minus : subiu ? ArrowUpRight : ArrowDownRight
  const cor = positivo === null ? 'text-ink-faint' : positivo ? 'text-success' : 'text-danger'
  return (
    <span className={`inline-flex items-center gap-0.5 text-micro tabular-nums ${cor}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{zero ? 'estável' : `${subiu ? '+' : ''}${Math.round(pct)}%`}</span>
      <span className="sr-only"> {sufixo}</span>
    </span>
  )
}

/**
 * KPI do topo.
 *
 * Contrato fixo, aprendido do que dava errado antes: UM número grande, UM
 * secundário menor, e o carimbo da janela. Nunca dois números do mesmo peso
 * (era assim que "14 vendas" e "54 vendas" apareciam lado a lado sem hierarquia
 * e o gerente não sabia qual era o número da empresa).
 */
export function Metric({
  label,
  valor,
  secundario,
  delta,
  deltaBom = 'subir',
  janela,
  janelaLabel,
  ajuda,
  onClick,
  id,
}: {
  label: string
  /** Já formatado (brl/n/pct) — o card não decide formato. */
  valor: string
  /** Linha de baixo: o outro recorte do mesmo assunto, em cinza. */
  secundario?: ReactNode
  delta?: number | null
  deltaBom?: 'subir' | 'cair'
  janela: TipoJanela
  janelaLabel: string
  /** Vira o title= — explica origem e cálculo em uma frase. */
  ajuda: string
  onClick?: () => void
  id?: string
}) {
  const clicavel = typeof onClick === 'function'
  const Tag = clicavel ? 'button' : 'div'

  return (
    <Tag
      id={id}
      type={clicavel ? 'button' : undefined}
      onClick={onClick}
      title={ajuda}
      aria-label={clicavel ? `${label}: ${valor}. Ver detalhamento.` : undefined}
      className={[
        'group flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-5 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        clicavel ? 'cursor-pointer transition-colors hover:border-border-strong' : '',
      ].join(' ')}
    >
      {/* flex-wrap + min-w-0: em 360px o tile fica com 161px e o carimbo de
          janela (shrink-0, ~78px) não cabe ao lado do rótulo. Sem o wrap ele
          vazava 6px e o overflow-x:clip da página cortava o texto EM SILÊNCIO
          — pior que rolar, porque ninguém vê que faltou. Agora ele desce. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 text-label text-ink-muted">{label}</span>
        <JanelaBadge tipo={janela} label={janelaLabel} />
      </div>

      <div className="min-w-0">
        {/* break-words + leading apertado: "R$ 22.218.198" não pode cortar */}
        <div className="text-kpi text-ink tabular-nums break-words">{valor}</div>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap min-h-[18px]">
          {delta != null && <Delta pct={delta} bom={deltaBom} />}
          {secundario && <span className="text-micro text-ink-faint">{secundario}</span>}
        </div>
      </div>

      {clicavel && (
        <span className="inline-flex items-center gap-0.5 text-micro text-ink-faint group-hover:text-accent">
          ver origem
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </Tag>
  )
}
