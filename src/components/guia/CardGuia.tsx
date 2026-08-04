/**
 * Card compacto da grade.
 *
 * O guia antigo era uma lista enorme de cards altos com texto corrido — o
 * vendedor rolava a página inteira procurando. Aqui o card é um ÍNDICE: foto,
 * nome, um resumo de uma linha e os selos que importam. O conteúdo vive na
 * página individual.
 */
import { Star } from 'lucide-react'
import { Foto } from './Foto'
import { SeloCompat, SeloPendente, SeloRisco, SeloStatus } from './Selos'
import { cn } from '@/lib/utils'
import type { GuiaImagem, ItemGuia } from '@/lib/guia/tipos'

interface Props {
  item: ItemGuia
  imagem?: GuiaImagem | null
  favorito: boolean
  onAbrir: () => void
  onFavoritar: () => void
  /** Modo comparação: mostra checkbox em vez de abrir direto. */
  selecionavel?: boolean
  selecionado?: boolean
  onSelecionar?: () => void
}

export function CardGuia({
  item, imagem, favorito, onAbrir, onFavoritar,
  selecionavel, selecionado, onSelecionar,
}: Props) {
  const risco = item.nivel_risco && item.nivel_risco !== 'informacao'
  const compat = item.compat_branorte && item.compat_branorte !== 'ok'

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-surface transition-all duration-150',
        selecionado ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:border-border-strong hover:shadow-sm',
      )}
    >
      <button
        type="button"
        onClick={selecionavel ? onSelecionar : onAbrir}
        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label={`Abrir ${item.nome}`}
      >
        <Foto imagem={imagem} emoji={item.emoji} nome={item.nome} semRetrato={item.semRetrato} />
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[14px] font-semibold leading-tight text-ink">{item.nome}</h3>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">{item.grupo}</p>
          <p className="line-clamp-2 text-[12.5px] leading-snug text-ink-muted">{item.resumo}</p>
          {(risco || compat || item.pendente_validacao || item.status !== 'aprovado') && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {compat && <SeloCompat compat={item.compat_branorte!} />}
              {risco && <SeloRisco nivel={item.nivel_risco!} />}
              {item.status !== 'aprovado' && <SeloStatus status={item.status} />}
              {item.pendente_validacao && item.status === 'aprovado' && <SeloPendente />}
            </div>
          )}
        </div>
      </button>

      {selecionavel ? (
        <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px]">
          <input
            type="checkbox"
            checked={!!selecionado}
            onChange={onSelecionar}
            aria-label={`Selecionar ${item.nome} para comparar`}
            className="h-4 w-4 accent-white"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onFavoritar}
          title={favorito ? 'Remover dos favoritos' : 'Salvar como favorito'}
          aria-label={favorito ? `Remover ${item.nome} dos favoritos` : `Salvar ${item.nome} como favorito`}
          aria-pressed={favorito}
          className={cn(
            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-[2px] transition-colors',
            favorito ? 'bg-black/45 text-yellow-300' : 'bg-black/35 text-white/70 hover:text-white',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', favorito && 'fill-current')} />
        </button>
      )}
    </div>
  )
}
