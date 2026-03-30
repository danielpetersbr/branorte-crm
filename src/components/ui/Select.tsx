import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, className, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'w-full h-9 rounded-lg border border-surface-border bg-white px-3 pr-8 text-sm',
            'text-text-primary appearance-none cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors', className
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
      </div>
    )
  }
)
Select.displayName = 'Select'
