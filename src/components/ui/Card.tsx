import { cn } from '@/lib/utils'

interface CardProps { children: React.ReactNode; className?: string; hover?: boolean; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void }

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div onClick={onClick} className={cn(
      'bg-surface rounded-lg border border-border',
      hover && 'cursor-pointer transition-all duration-150 hover:border-border-strong hover:shadow-sm',
      onClick && 'cursor-pointer', className,
    )}>{children}</div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4 border-b border-border', className)}>{children}</div>
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
