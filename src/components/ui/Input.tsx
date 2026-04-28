import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, className, ...props }, ref) => {
    return (
      <div className="relative">
        {leftIcon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">{leftIcon}</div>}
        <input
          ref={ref}
          className={cn(
            'w-full h-9 rounded-md border border-border bg-surface px-3 text-[13px]',
            'text-ink placeholder:text-ink-faint',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all',
            leftIcon && 'pl-9', className,
          )}
          {...props}
        />
      </div>
    )
  },
)
Input.displayName = 'Input'
