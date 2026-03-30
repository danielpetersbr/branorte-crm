import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, className, ...props }, ref) => {
    return (
      <div className="relative">
        {leftIcon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">{leftIcon}</div>}
        <input
          ref={ref}
          className={cn(
            'w-full h-9 rounded-lg border border-surface-border bg-white px-3 text-sm',
            'text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors',
            leftIcon && 'pl-9', className
          )}
          {...props}
        />
      </div>
    )
  }
)
Input.displayName = 'Input'
