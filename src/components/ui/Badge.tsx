import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'outline'
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap',
      'ring-1 ring-inset ring-black/[0.04]',
      variant === 'outline' && 'border bg-transparent ring-0',
      className,
    )}>
      {children}
    </span>
  )
}
