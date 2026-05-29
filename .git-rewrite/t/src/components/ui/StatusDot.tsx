import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'

interface StatusDotProps {
  tone?: Tone
  label?: string
  pulse?: boolean
  className?: string
}

const TONE: Record<Tone, { bg: string; text: string; bgPill: string }> = {
  success: { bg: 'bg-success',          text: 'text-success',                bgPill: 'bg-success/8 text-success' },
  warning: { bg: 'bg-warning',          text: 'text-warning',                bgPill: 'bg-warning/10 text-warning' },
  danger:  { bg: 'bg-danger',           text: 'text-danger',                 bgPill: 'bg-danger/8 text-danger' },
  info:    { bg: 'bg-info',             text: 'text-info',                   bgPill: 'bg-info/8 text-info' },
  accent:  { bg: 'bg-accent',           text: 'text-accent',                 bgPill: 'bg-accent/8 text-accent' },
  neutral: { bg: 'bg-ink-faint',        text: 'text-ink-muted',              bgPill: 'bg-surface-2 text-ink-muted' },
}

export function StatusDot({ tone = 'neutral', label, pulse, className }: StatusDotProps) {
  const t = TONE[tone]
  if (!label) {
    return (
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', t.bg, className)}>
        {pulse && <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', t.bg)} />}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap', t.text, className)}>
      <span className={cn('relative h-1.5 w-1.5 rounded-full', t.bg)}>
        {pulse && <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', t.bg)} />}
      </span>
      {label}
    </span>
  )
}
