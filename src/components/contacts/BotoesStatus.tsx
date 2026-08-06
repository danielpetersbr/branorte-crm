import { CircleDot, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Os dois estados do contato no funil do CRM, como botão na própria linha.
 *
 * ⚠️ Grava SÓ em `contacts.status`. NÃO encosta em `is_closed`, que parece ser a
 * mesma coisa e não é: `is_closed` é DERIVADO de etiqueta (existe etiqueta ativa
 * do grupo ENCERRAMENTO — ver recompute_contact_closed no banco) e alimenta o
 * pool de prospecção. Espelhar um no outro devolveria ao pool gente já
 * encerrada. Os dois divergem em 745 contatos hoje, legitimamente.
 *
 * Existiu um terceiro estado 'ANALISAR' ("Falta analisar") por algumas horas em
 * 06/08/2026 — o Daniel pediu pra tirar: aqui é aberto ou fechado, ponto.
 * Removido também do CHECK `contacts_status_check`, senão voltaria por qualquer
 * escrita fora desta tela e a linha ficaria SEM botão aceso (o `ativo` abaixo
 * compara por igualdade — valor fora da lista não acende nenhum).
 */
export const STATUS_CONTATO = [
  {
    v: 'ABERTO',
    label: 'Aberto',
    curto: 'Ab.',
    icon: CircleDot,
    titulo: 'Aberto — em andamento',
    on: 'bg-info-bg text-info ring-1 ring-info/30',
  },
  {
    v: 'FECHADO',
    label: 'Fechado',
    curto: 'Fe.',
    icon: CheckCircle2,
    titulo: 'Fechado — encerrado no CRM (não confundir com etiqueta de encerramento do WhatsApp)',
    on: 'bg-success-bg text-success ring-1 ring-success/30',
  },
] as const

export type StatusContato = typeof STATUS_CONTATO[number]['v']

export function BotoesStatus({
  valor, onEscolher, salvando, erro, compacto, derivadoDe,
}: {
  valor: string | null
  onEscolher: (novo: StatusContato) => void
  salvando?: boolean
  erro?: boolean
  compacto?: boolean
  /**
   * Preenchido quando a ETIQUETA do WhatsApp decide o status deste contato.
   * Nesse caso o botão vira leitura: quem grava é o job
   * `recompute-contact-status-5min`, e um clique aqui seria desfeito em até 5
   * minutos — pior que não ter botão, porque parece que funcionou.
   */
  derivadoDe?: { etiqueta: string; vendedor: string | null } | null
}) {
  const travado = !!derivadoDe
  const explicacao = derivadoDe
    ? `Definido pela etiqueta "${derivadoDe.etiqueta}"${derivadoDe.vendedor ? ` no WhatsApp do ${derivadoDe.vendedor}` : ''}. `
      + `Pra mudar aqui, mude a etiqueta no WhatsApp — o CRM acompanha sozinho.`
    : null
  return (
    <div
      role="group"
      aria-label={travado ? `Status do contato (definido pela etiqueta ${derivadoDe!.etiqueta})` : 'Status do contato'}
      title={explicacao ?? undefined}
      /* A linha inteira abre a ficha no clique; sem isto, marcar o status
         abriria o drawer por cima. */
      onClick={e => e.stopPropagation()}
      className={cn('inline-flex items-center rounded-md border border-border overflow-hidden',
        erro && 'border-danger',
        travado && 'border-dashed opacity-90')}
    >
      {STATUS_CONTATO.map((s, i) => {
        const ativo = (valor ?? 'ABERTO') === s.v
        const Icon = s.icon
        return (
          <button
            key={s.v}
            type="button"
            disabled={salvando || travado}
            aria-pressed={ativo}
            aria-label={s.label}
            title={explicacao ?? s.titulo}
            onClick={e => { e.stopPropagation(); if (!ativo) onEscolher(s.v) }}
            className={cn(
              'inline-flex items-center justify-center gap-1 h-[22px] px-1.5',
              'text-[10px] font-semibold uppercase tracking-[0.02em]',
              'transition-colors duration-100 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
              // `cursor-wait` só faz sentido enquanto grava. No travado é
              // `cursor-default`: não está carregando, é assim mesmo.
              salvando && 'disabled:opacity-60 disabled:cursor-wait',
              travado && 'disabled:cursor-default',
              i > 0 && 'border-l border-border',
              ativo ? s.on
                : travado ? 'text-ink-faint/50'
                : 'text-ink-faint hover:text-ink hover:bg-surface-2',
            )}
          >
            {salvando && ativo
              ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              : <Icon aria-hidden className="h-3 w-3 shrink-0" />}
            {/* O rótulo só aparece no ativo e em tela larga: 3 palavras por linha
                em 50 linhas viraria uma parede. O `title` e o aria-label
                carregam o significado nos outros casos. */}
            {ativo && !compacto && <span className="hidden 2xl:inline">{s.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
