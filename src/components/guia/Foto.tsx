/**
 * Foto do guia — com fallback profissional e rótulo de honestidade.
 *
 * Três regras que saíram direto da auditoria:
 *
 *  1. Imagem REPROVADA não aparece. Some, e entra o fallback. Foto genérica
 *     apresentada como prova de raça é o pior defeito que o guia tinha.
 *  2. Imagem que NÃO identifica o item ganha rótulo visível "imagem
 *     ilustrativa". Linhagem de ave é o caso clássico: Cobb e Ross são ambos
 *     frangos brancos — nenhuma foto prova qual é qual.
 *  3. O crédito (autor + licença) fica sempre visível, e `alt` nunca é vazio.
 *     As 44 imagens antigas tinham alt="" — acessibilidade zero.
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { GuiaImagem } from '@/lib/guia/tipos'

interface Props {
  imagem?: GuiaImagem | null
  emoji?: string | null
  nome: string
  className?: string
  /** Card usa 'card' (baixo); página individual usa 'detalhe'. */
  variante?: 'card' | 'detalhe'
  mostrarCredito?: boolean
  /**
   * O item é do tipo que NÃO tem retrato (uma fase produtiva, um sistema de
   * criação). Nesse caso o fallback não acusa ausência: não existe "foto de
   * confinamento" a ser verificada. O aviso fica só onde faz sentido — raça,
   * linhagem e ingrediente, que têm sim uma imagem esperada.
   */
  semRetrato?: boolean
}

function Fallback({ emoji, nome, className, semRetrato }: {
  emoji?: string | null; nome: string; className?: string; semRetrato?: boolean
}) {
  return (
    <div
      role="img"
      aria-label={semRetrato ? nome : `${nome} — sem foto verificada`}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1.5 overflow-hidden',
        'bg-gradient-to-br from-surface-2 to-bg border-b border-border',
        className,
      )}
    >
      {/* Marca d'água discreta, pra não parecer imagem quebrada */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 10px)',
        }}
      />
      <span aria-hidden className="text-4xl leading-none opacity-70">{emoji ?? '📄'}</span>
      {!semRetrato && (
        <span className="relative text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Sem foto verificada
        </span>
      )}
    </div>
  )
}

export function Foto({
  imagem, emoji, nome, className, variante = 'card', mostrarCredito = false, semRetrato,
}: Props) {
  const [quebrou, setQuebrou] = useState(false)
  const altura = variante === 'card' ? 'h-36' : 'h-56 sm:h-72'

  const usavel = imagem && imagem.status !== 'reprovada' && imagem.arquivo_url && !quebrou

  if (!usavel) {
    return (
      <Fallback
        emoji={emoji}
        nome={nome}
        semRetrato={semRetrato}
        className={cn('w-full', variante === 'card' && semRetrato ? 'h-24' : altura, className)}
      />
    )
  }

  return (
    <figure className={cn('relative w-full', className)}>
      <img
        src={imagem!.arquivo_url!}
        alt={imagem!.alt || nome}
        loading="lazy"
        decoding="async"
        onError={() => setQuebrou(true)}
        className={cn('w-full object-cover border-b border-border bg-surface-2', altura)}
      />
      {!imagem!.identifica_item && (
        <figcaption
          className="absolute bottom-0 inset-x-0 bg-black/55 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-[2px]"
          title={imagem!.legenda ?? undefined}
        >
          Imagem ilustrativa — não identifica {variante === 'card' ? 'o item' : 'a raça/linhagem'}
        </figcaption>
      )}
      {mostrarCredito && (imagem!.autor || imagem!.licenca) && (
        <figcaption className="px-1 pt-1.5 text-[10px] text-ink-faint">
          Foto: {imagem!.autor ?? 'autoria não identificada'}
          {imagem!.licenca ? ` · ${imagem!.licenca}` : ''}
          {/* Crédito tem que ser CONFERÍVEL. Texto solto não prova procedência —
              foi assim que uma foto de fabricante de peletizadora passou batida
              no guia antigo. Os dois links levam à obra e ao arquivo original. */}
          {imagem!.fonte_url && (
            <>
              {' · '}
              <a href={imagem!.fonte_url} target="_blank" rel="noopener noreferrer"
                 className="underline hover:text-ink">obra</a>
            </>
          )}
          {imagem!.url_original && (
            <>
              {' · '}
              <a href={imagem!.url_original} target="_blank" rel="noopener noreferrer"
                 className="underline hover:text-ink">arquivo original</a>
            </>
          )}
          {imagem!.status === 'pendente' && ' · verificação pendente'}
        </figcaption>
      )}
    </figure>
  )
}
