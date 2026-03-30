import { cn } from '@/lib/utils'

export function LoadingSpinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const s = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' }
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <svg className={cn('animate-spin text-brand-500', s[size])} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label && <p className="text-sm text-text-secondary">{label}</p>}
    </div>
  )
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <LoadingSpinner size="lg" label="Carregando..." />
    </div>
  )
}
