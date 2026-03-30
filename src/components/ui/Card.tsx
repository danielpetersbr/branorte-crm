import { cn } from '@/lib/utils'

interface CardProps { children: React.ReactNode; className?: string; hover?: boolean; onClick?: () => void }

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div onClick={onClick} className={cn(
      'bg-white rounded-xl border border-surface-border',
      hover && 'cursor-pointer transition-shadow hover:shadow-md',
      onClick && 'cursor-pointer', className
    )}>{children}</div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-5 border-b border-surface-border', className)}>{children}</div>
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-5', className)}>{children}</div>
}
