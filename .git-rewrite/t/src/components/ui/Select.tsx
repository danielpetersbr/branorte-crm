import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, className, ...props }, ref) => {
    const hasValue = !!props.value
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'h-9 rounded-md border bg-surface px-3 pr-8 text-[13px] appearance-none cursor-pointer transition-all',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
            hasValue ? 'border-accent/40 text-ink' : 'border-border text-ink-muted',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
      </div>
    )
  },
)
Select.displayName = 'Select'
