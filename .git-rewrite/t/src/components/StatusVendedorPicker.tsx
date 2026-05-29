import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { STATUS_VENDEDOR_VALUES, STATUS_VENDEDOR_MAP, type StatusVendedor } from '@/types/atendimento'
import { useUpdateStatusVendedor } from '@/hooks/useAtendimentos'

interface Props {
  value: StatusVendedor | null
  auditoriaIds: string[]
  size?: 'sm' | 'md'
}

export function StatusVendedorPicker({ value, auditoriaIds, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const update = useUpdateStatusVendedor()

  const meta = value ? STATUS_VENDEDOR_MAP[value] : null

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (status: StatusVendedor | null) => {
    setOpen(false)
    if (status === value) return
    update.mutate({ auditoria_ids: auditoriaIds, status })
  }

  const sizeCls = size === 'sm' ? 'text-[10px] px-2 py-0.5 h-6' : 'text-[11px] px-2.5 py-1 h-7'

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={update.isPending}
        className={
          `inline-flex items-center gap-1 rounded font-medium transition-opacity hover:opacity-80 ${sizeCls} ` +
          (update.isPending ? 'opacity-50 cursor-wait ' : 'cursor-pointer ') +
          (meta ? '' : 'border border-dashed')
        }
        style={meta ? { background: meta.bg, color: meta.fg } : { background: 'transparent', color: 'hsl(240 4% 65%)', borderColor: 'hsl(240 6% 25%)' }}
        title={meta ? `Status: ${meta.label}` : 'Definir status'}
      >
        {meta ? (
          <>
            <span>{meta.emoji}</span>
            <span className="truncate max-w-[110px]">{meta.label}</span>
          </>
        ) : (
          <span className="italic">— sem status —</span>
        )}
        <ChevronDown className="h-3 w-3 opacity-70 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 top-full mt-1 min-w-[180px] bg-surface border border-border rounded-md shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_VENDEDOR_VALUES.map(s => {
            const m = STATUS_VENDEDOR_MAP[s]
            const active = value === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleSelect(s)}
                className={
                  'w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] hover:bg-surface-2 transition-colors ' +
                  (active ? 'bg-surface-2' : '')
                }
              >
                <span className="text-base leading-none">{m.emoji}</span>
                <span className="flex-1 text-ink">{m.label}</span>
                {active && <Check className="h-3 w-3 text-accent" />}
              </button>
            )
          })}
          {value && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] hover:bg-surface-2 transition-colors text-ink-faint"
              >
                <X className="h-3 w-3" />
                <span>Limpar</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
