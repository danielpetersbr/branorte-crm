import { CircleDot, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Os três estados do contato no funil do CRM, como botão na própria linha.
 *
 * ⚠️ Grava SÓ em `contacts.status`. NÃO encosta em `is_closed`, que parece ser a
 * mesma coisa e não é: `is_closed` é DERIVADO de etiqueta (existe etiqueta ativa
 * do grupo ENCERRAMENTO — ver recompute_contact_closed no banco) e alimenta o
 * pool de prospecção. Espelhar um no outro devolveria ao pool gente já
 * encerrada. Os dois divergem em 745 contatos hoje, legitimamente.
 *
 * 'ANALISAR' entrou no CHECK de contacts_status_check em 06/08/2026. Sem isso o
 * clique salvaria e o banco recusaria — sem erro visível pro vendedor.
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
  {
    v: 'ANALISAR',
    label: 'Falta analisar',
    curto: 'An.',
    icon: HelpCircle,
    titulo: 'Falta analisar — precisa de uma decisão',
    on: 'bg-warning-bg text-warning ring-1 ring-warning/30',
  },
] as const

export type StatusContato = typeof STATUS_CONTATO[number]['v']

export function BotoesStatus({
  valor, onEscolher, salvando, erro, compacto,
}: {
  valor: string | null
  onEscolher: (novo: StatusContato) => void
  salvando?: boolean
  erro?: boolean
  compacto?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Status do contato"
      /* A linha inteira abre a ficha no clique; sem isto, marcar o status
         abriria o drawer por cima. */
      onClick={e => e.stopPropagation()}
      className={cn('inline-flex items-center rounded-md border border-border overflow-hidden',
        erro && 'border-danger')}
    >
      {STATUS_CONTATO.map((s, i) => {
        const ativo = (valor ?? 'ABERTO') === s.v
        const Icon = s.icon
        return (
          <button
            key={s.v}
            type="button"
            disabled={salvando}
            aria-pressed={ativo}
            aria-label={s.label}
            title={s.titulo}
            onClick={e => { e.stopPropagation(); if (!ativo) onEscolher(s.v) }}
            className={cn(
              'inline-flex items-center justify-center gap-1 h-[22px] px-1.5',
              'text-[10px] font-semibold uppercase tracking-[0.02em]',
              'transition-colors duration-100 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
              'disabled:opacity-60 disabled:cursor-wait',
              i > 0 && 'border-l border-border',
              ativo ? s.on : 'text-ink-faint hover:text-ink hover:bg-surface-2',
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
