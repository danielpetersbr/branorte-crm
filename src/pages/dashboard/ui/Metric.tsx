import { useId, type ReactNode } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from 'lucide-react'
import { JanelaBadge, janelaHint, type TipoJanela } from './JanelaBadge'
import { VAZIO, VAZIO_FALADO } from './format'

type DeltaBom = 'subir' | 'cair'

/**
 * Lê o delta UMA vez: o visual e o texto falado saem da mesma conta.
 *
 * `falado` carrega o julgamento ("melhora"/"piora") porque no visual quem diz
 * isso é só a cor — verde/vermelho. A seta indica DIREÇÃO, não se a direção é
 * boa: subir 20% em "leads sem dono" é péssimo e a seta é a mesma. Sem esta
 * palavra, um daltônico vê "+20%" e não tem como saber de que lado está.
 */
function lerDelta(valor: number | null | undefined, bom: DeltaBom) {
  if (valor == null || !Number.isFinite(valor)) return null
  const zero = Math.abs(valor) < 0.5
  const subiu = valor > 0
  const positivo = zero ? null : bom === 'subir' ? subiu : !subiu
  const inteiro = Math.abs(Math.round(valor))
  return {
    zero,
    subiu,
    positivo,
    visivel: zero ? 'estável' : `${subiu ? '+' : ''}${Math.round(valor)}%`,
    falado: zero
      ? 'estável'
      : `${subiu ? 'subiu' : 'caiu'} ${inteiro}%, ${positivo ? 'melhora' : 'piora'}`,
  }
}

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
  bom?: DeltaBom
  sufixo?: string
}) {
  const d = lerDelta(pct, bom)
  if (!d) return null
  const Icon = d.zero ? Minus : d.subiu ? ArrowUpRight : ArrowDownRight
  const cor = d.positivo === null ? 'text-ink-faint' : d.positivo ? 'text-success' : 'text-danger'
  return (
    <span className={`inline-flex items-center gap-0.5 text-micro tabular-nums ${cor}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {/* O visível fica aria-hidden e o falado vem completo logo abaixo: senão
          o leitor anuncia "mais 12 por cento" e em seguida "subiu 12%", duas
          vezes o mesmo número. */}
      <span aria-hidden="true">{d.visivel}</span>
      <span className="sr-only">
        {d.falado} {sufixo}
      </span>
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
  deltaBom?: DeltaBom
  janela: TipoJanela
  janelaLabel: string
  /** Vira o title= (mouse) e a descrição acessível — origem e cálculo em uma frase. */
  ajuda: string
  onClick?: () => void
  id?: string
}) {
  const clicavel = typeof onClick === 'function'
  const Tag = clicavel ? 'button' : 'div'
  const descId = useId()
  const d = lerDelta(delta, deltaBom)

  // "R$ —" não existe; quando o formatador devolve o travessão, o leitor de
  // tela anuncia "traço" ou nada — e o usuário não sabe se é zero ou falha.
  const valorFalado = valor === VAZIO ? VAZIO_FALADO : valor

  /**
   * `aria-label` num <button> SUBSTITUI todo o conteúdo dele na árvore de
   * acessibilidade. O rótulo anterior era "label: valor. Ver detalhamento." e
   * com isso sumiam, para quem usa leitor de tela, TRÊS coisas que estão na
   * tela: o delta, a linha secundária e o carimbo de janela — justamente a
   * pista de que aquele número pode ignorar o filtro do topo.
   *
   * Agora o NOME fica curto (rótulo + valor) e todo o resto vira DESCRIÇÃO
   * (aria-describedby), que é anunciada depois do nome e o usuário pode pular.
   */
  const descricaoClicavel = [
    d ? `${d.falado} vs. período anterior` : '',
    typeof secundario === 'string' ? secundario : '',
    `Janela: ${janelaLabel}, ${janelaHint(janela)}`,
    ajuda,
    'Ativar para ver a origem do número.',
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <Tag
      id={id}
      type={clicavel ? 'button' : undefined}
      onClick={onClick}
      title={ajuda}
      aria-label={clicavel ? `${label}: ${valorFalado}` : undefined}
      aria-describedby={clicavel ? descId : undefined}
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

      {/* `ajuda` só existia no title=, que o teclado nunca alcança (tooltip de
          title não abre no foco) e que o leitor de tela pode estar configurado
          para ignorar. Aqui ela é texto de verdade: no tile clicável entra como
          descrição do botão; no tile estático é lida na sequência do conteúdo. */}
      <span id={descId} className="sr-only">
        {clicavel ? descricaoClicavel : ajuda}
      </span>
    </Tag>
  )
}
