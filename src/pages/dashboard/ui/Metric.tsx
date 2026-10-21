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
  denso = false,
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
  /** (21/10/2026) Visão geral numa tela só: a partir de 2xl o tile encolhe (menos padding, número 22 px com o delta ao lado,
   *  sem "ver origem" — o tile inteiro continua clicável). A reserva de 2 linhas do rótulo só cai a partir de 1800 px, onde
   *  "Atendimentos hoje" + carimbo cabem numa linha; entre 1536 e 1800 o rótulo longo ainda quebra e a reserva segura a
   *  linha de base dos números. Abaixo de 2xl nada muda. */
  denso?: boolean
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
        // `justify-between` distribuía o espaço livre ENTRE os filhos — e como
        // uns tiles têm "ver origem" e outros não, o número caía em altura
        // diferente em cada card e a fileira perdia a linha de base. Agora o
        // topo é fixo (cabeçalho + número) e só o rodapé é empurrado pro fim.
        'group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 text-left',
        denso ? '2xl:gap-1 2xl:px-4 2xl:py-3' : '',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        clicavel ? 'cursor-pointer transition-colors hover:border-border-strong' : '',
      ].join(' ')}
    >
      {/* flex-wrap + min-w-0: em 360px o tile fica com 161px e o carimbo de
          janela (shrink-0, ~78px) não cabe ao lado do rótulo. Sem o wrap ele
          vazava 6px e o overflow-x:clip da página cortava o texto EM SILÊNCIO
          — pior que rolar, porque ninguém vê que faltou. Agora ele desce. */}
      {/* min-h reserva a altura de DUAS linhas em todos os tiles. Sem isso, o
          tile de rótulo longo ("Clientes com proposta") empurra o carimbo pra
          segunda linha e o número desce ~25px em relação aos vizinhos —
          a fileira perde a linha de base e o olho para de varrer na
          horizontal. Alinhar custa altura; desalinhar custa a leitura. */}
      <div className={`flex min-h-[3rem] flex-wrap items-start justify-between gap-2${denso ? ' min-[1800px]:min-h-0' : ''}`}>
        <span className="min-w-0 text-label text-ink-muted">{label}</span>
        <JanelaBadge tipo={janela} label={janelaLabel} />
      </div>

      <div className="min-w-0">
        {/* break-words + leading apertado: "R$ 22.218.198" não pode cortar */}
        <div className={denso ? '2xl:flex 2xl:flex-wrap 2xl:items-baseline 2xl:gap-x-2' : undefined}>
          <div className={`text-kpi text-ink tabular-nums break-words${denso ? ' 2xl:text-kpi-sm' : ''}`}>{valor}</div>
          {/* denso: a partir de 2xl o delta sobe pra linha do número (uma linha a menos no tile). As duas cópias nunca
              aparecem juntas: `hidden` tira a outra também do leitor de tela. */}
          {denso && delta != null && <span className="hidden 2xl:inline-flex"><Delta pct={delta} bom={deltaBom} /></span>}
        </div>
        <div className={`mt-1.5 flex items-center gap-2 flex-wrap min-h-[18px]${denso ? ' 2xl:mt-1 2xl:min-h-0' : ''}`}>
          {delta != null && (denso
            ? <span className="inline-flex 2xl:hidden"><Delta pct={delta} bom={deltaBom} /></span>
            : <Delta pct={delta} bom={deltaBom} />)}
          {secundario && <span className="text-micro text-ink-faint">{secundario}</span>}
        </div>
      </div>

      {clicavel && (
        <span className={`mt-auto inline-flex items-center gap-0.5 text-micro text-ink-faint group-hover:text-accent${denso ? ' 2xl:hidden' : ''}`}>
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
