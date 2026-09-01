import { useState, useRef, useEffect } from 'react'
import { Check, X, Pencil, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Célula que vira input no clique. Usada em Nome e Cidade da /contatos.
 *
 * A linha inteira da tabela é clicável (abre a ficha), então TODO evento aqui
 * precisa de `stopPropagation` — sem isso, clicar pra editar abriria o drawer
 * por cima do input.
 *
 * Salva no Enter, cancela no Esc, e também salva no blur (é o que o usuário
 * espera de célula de planilha, e evita perder o que digitou ao clicar fora).
 * Espaço em branco vira `null`, não string vazia: a coluna aceita null e a tela
 * já sabe desenhar "(sem nome)".
 */
export function CelulaEditavel({
  valor, onSalvar, placeholder, className, inputClassName, titulo, ariaLabel, salvando, erro, maxLength = 120,
}: {
  valor: string | null
  onSalvar: (novo: string | null) => void
  placeholder: string
  className?: string
  inputClassName?: string
  titulo?: string
  ariaLabel: string
  salvando?: boolean
  erro?: boolean
  /** 120 serve pra nome e cidade; a anotacao de negociacao pede mais. */
  maxLength?: number
}) {
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editando) inputRef.current?.select()
  }, [editando])

  function abrir(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    setRascunho(valor ?? '')
    setEditando(true)
  }

  function confirmar() {
    const limpo = rascunho.trim()
    setEditando(false)
    // Só grava se MUDOU: sem isto, abrir e fechar sem digitar dispararia um
    // UPDATE por linha e sujaria o updated_at de contatos que ninguém tocou.
    if ((limpo || null) !== (valor || null)) onSalvar(limpo || null)
  }

  if (editando) {
    return (
      <div className={cn('flex items-center gap-1', className)} onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          defaultValue={rascunho}
          onChange={e => setRascunho(e.target.value)}
          aria-label={ariaLabel}
          maxLength={maxLength}
          onKeyDown={e => {
            e.stopPropagation()   // a linha escuta Enter/Espaço pra abrir a ficha
            if (e.key === 'Enter') { e.preventDefault(); confirmar() }
            if (e.key === 'Escape') { e.preventDefault(); setEditando(false) }
          }}
          onBlur={confirmar}
          className={cn(
            'min-w-0 flex-1 h-7 rounded-md border border-accent bg-surface px-1.5',
            'text-[13px] text-ink outline-none ring-2 ring-accent/25',
            inputClassName,
          )}
        />
        <span aria-hidden className="shrink-0 text-ink-faint">
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={abrir}
      title={titulo ?? (valor || placeholder)}
      aria-label={`${ariaLabel}. Clique para editar.`}
      className={cn(
        'group/edit flex w-full items-center gap-1 rounded-md px-1 -mx-1 py-0.5 text-left',
        'transition-colors duration-100 motion-reduce:transition-none hover:bg-accent-bg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        erro && 'ring-1 ring-danger',
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {valor || <span className="text-ink-faint font-normal">{placeholder}</span>}
      </span>
      {salvando
        ? <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin text-accent" />
        : erro
          ? <X aria-hidden className="h-3 w-3 shrink-0 text-danger" />
          : (
            /* O lápis só aparece no hover/foco pra não poluir 50 linhas de uma
               vez — mas `opacity-0` puro deixaria a coluna sem nenhuma pista de
               que é editável em aparelho sem ponteiro. Por isso ele fica
               VISÍVEL onde não há hover, mesma regra do botão de copiar. */
            <Pencil
              aria-hidden
              className="h-3 w-3 shrink-0 text-ink-faint opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/edit:opacity-100 [@media(hover:hover)]:group-focus-visible/edit:opacity-100"
            />
          )}
    </button>
  )
}
