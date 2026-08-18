import type { ReactNode } from 'react'

/**
 * Card do dashboard — a ÚNICA caixa de nível 1.
 *
 * Regra de aninhamento (o dashboard antigo tinha 9 casos de card dentro de card
 * com o mesmo bg-surface, ou seja, contraste zero — a borda interna era a única
 * pista de que havia duas caixas):
 *
 *   nível 1 (Card)      bg-surface   border-border      rounded-xl  p-5
 *   nível 2 (Inner)     bg-surface-2 border-border/60   rounded-lg  p-3
 *   nível 3             NÃO EXISTE — use separador (border-t) ou uma tabela
 */
export function Card({
  children,
  className = '',
  id,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  id?: string
  as?: 'section' | 'div'
}) {
  return (
    <Tag id={id} className={`bg-surface border border-border rounded-xl p-5 ${className}`}>
      {children}
    </Tag>
  )
}

/**
 * Caixa interna. Sem bg-surface (senão some contra o Card) e sem borda quando
 * já houver um separador por perto.
 */
export function Inner({
  children,
  className = '',
  tone = 'neutro',
}: {
  children: ReactNode
  className?: string
  tone?: 'neutro' | 'atencao' | 'perigo' | 'positivo'
}) {
  const tones = {
    neutro:   'bg-surface-2 border-border/60',
    atencao:  'bg-warning-bg border-warning/30',
    perigo:   'bg-danger-bg border-danger/30',
    positivo: 'bg-success-bg border-success/30',
  }
  return <div className={`rounded-lg border p-3 ${tones[tone]} ${className}`}>{children}</div>
}

/**
 * Cabeçalho de Card. `janela` é OBRIGATÓRIO em qualquer bloco que mostre número:
 * o problema nº1 dos dados desta tela é a mesma palavra medindo janelas
 * diferentes (30d corridos × mês calendário × snapshot de todos os tempos).
 */
export function CardHeader({
  title,
  subtitle,
  titleHint,
  janela,
  right,
  nivel = 3,
}: {
  title: string
  subtitle?: string
  /** Ressalva que precisa existir mas não merece virar parágrafo na tela. */
  titleHint?: string
  janela?: ReactNode
  right?: ReactNode
  /**
   * Nível do heading. Padrão 3 (a página tem `<h1>Dashboard` e as abas põem
   * `<h2>` em alguns blocos). Só mexa aqui se o Card estiver aninhado dentro de
   * outro bloco que já tenha `<h3>` — pular nível (h2 → h4) faz o leitor de
   * tela relatar uma seção que não existe. O tamanho NÃO muda com o nível:
   * quem manda no visual é `text-title`, o número aqui é só a estrutura.
   */
  nivel?: 2 | 3 | 4
}) {
  const H = `h${nivel}` as 'h2' | 'h3' | 'h4'
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Heading vazio é pior que heading nenhum: entra na lista de títulos
              do leitor de tela como um item mudo. Se não veio texto, não vira
              heading — o carimbo de janela ainda aparece. */}
          {title ? <H className="text-title text-ink">{title}</H> : null}
          {janela}
        </div>
        {subtitle ? (
          <p className="text-label text-ink-faint mt-1" title={titleHint}>
            {subtitle}
            {titleHint && <span className="sr-only"> {titleHint}</span>}
          </p>
        ) : titleHint ? (
          // Sem subtítulo, a ressalva sumia INTEIRA: não virava title= nem
          // sr-only, porque os dois moravam dentro do <p> do subtítulo. Quem
          // passasse só `titleHint` escrevia no vazio.
          <span className="sr-only">{titleHint}</span>
        ) : null}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}
