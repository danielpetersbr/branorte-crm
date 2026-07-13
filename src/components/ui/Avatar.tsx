import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string | null | undefined
  /** Foto do cliente (opcional). Ausente ou com erro de load → fallback de inicial colorida. */
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  pulse?: boolean
  className?: string
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-[11px]',
  lg: 'h-9 w-9 text-sm',
}

// Color from name hash (consistent per person)
function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 55% 88%)`
}
function inkFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 55% 32%)`
}

export function Avatar({ name, src, size = 'md', pulse, className }: AvatarProps) {
  // Reset do erro quando a foto muda — a lista do funil é virtualizada e recicla
  // DOM; sem isso um card poderia herdar o estado de erro/foto de outro contato.
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [src])

  const display = (name || '?').trim()
  const initial = display.charAt(0).toUpperCase() || '?'
  const bg = display && display !== '(sem nome)' ? colorFromName(display) : 'hsl(var(--surface-2))'
  const ink = display && display !== '(sem nome)' ? inkFromName(display) : 'hsl(var(--ink-faint))'
  const showImg = !!src && !broken

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn('inline-flex items-center justify-center rounded-full font-semibold overflow-hidden', SIZE[size])}
        style={showImg ? undefined : { backgroundColor: bg, color: ink }}
      >
        {showImg ? (
          <img
            src={src as string}
            alt={display}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initial
        )}
      </span>
      {pulse && (
        <span className="pulse-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-[hsl(var(--surface))]" />
      )}
    </span>
  )
}
