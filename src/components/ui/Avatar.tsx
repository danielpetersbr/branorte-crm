import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string | null | undefined
  size?: 'sm' | 'md' | 'lg'
  pulse?: boolean
  className?: string
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
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

export function Avatar({ name, size = 'md', pulse, className }: AvatarProps) {
  const display = (name || '?').trim()
  const initial = display.charAt(0).toUpperCase() || '?'
  const bg = display && display !== '(sem nome)' ? colorFromName(display) : 'hsl(var(--surface-2))'
  const ink = display && display !== '(sem nome)' ? inkFromName(display) : 'hsl(var(--ink-faint))'
  return (
    <span className={cn('relative inline-flex items-center justify-center rounded-full font-semibold shrink-0', SIZE[size], className)}
          style={{ backgroundColor: bg, color: ink }}>
      {initial}
      {pulse && <span className="pulse-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success" />}
    </span>
  )
}
