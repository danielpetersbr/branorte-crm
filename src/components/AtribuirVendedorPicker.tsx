import { useEffect, useRef, useState } from 'react'
import { ChevronDown, UserPlus, Check } from 'lucide-react'
import { useVendors } from '@/hooks/useVendors'
import { useAtribuirAtendimento, useAtribuirVendedor } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  auditoriaIds: string[]
}

/**
 * Botao de atribuir lead. Comportamento varia por role:
 * - vendor: botao simples "Pegar pra mim" (atribui ao proprio user)
 * - admin:  botao "Pegar pra mim" + setinha pra dropdown com TODOS vendedores
 */
export function AtribuirVendedorPicker({ auditoriaIds }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { profile } = useAuth()
  const { data: vendors } = useVendors()
  const atribuirSelf = useAtribuirAtendimento()
  const atribuirOutro = useAtribuirVendedor()

  const isAdmin = profile?.role === 'admin'
  const myVendorName = profile?.vendor_id
    ? (vendors ?? []).find(v => v.id === profile.vendor_id)?.name
    : (profile?.display_name || profile?.email?.split('@')[0])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelf = () => {
    setOpen(false)
    if (!profile?.id || !myVendorName) return
    atribuirSelf.mutate({ auditoria_ids: auditoriaIds, user_id: profile.id, user_name: myVendorName })
  }

  const handleOutro = (vendorName: string) => {
    setOpen(false)
    atribuirOutro.mutate({ auditoria_ids: auditoriaIds, vendor_name: vendorName, vendor_user_id: null })
  }

  const isPending = atribuirSelf.isPending || atribuirOutro.isPending

  // Vendedor (nao admin): botao simples
  if (!isAdmin) {
    if (!myVendorName || !profile?.id) {
      return <span className="text-[11px] text-ink-faint italic">a definir</span>
    }
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={handleSelf}
        title={`Atribuir este atendimento pra ${myVendorName}`}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md
                   bg-info-bg/60 text-info border border-info/30
                   hover:bg-info-bg hover:border-info/60 hover:shadow-sm
                   transition-all text-[11px] font-medium
                   disabled:opacity-50 disabled:cursor-wait"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Pegar pra mim
      </button>
    )
  }

  // Admin: split button (pegar pra mim + dropdown)
  const vendorList = vendors ?? []

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        disabled={isPending || !myVendorName}
        onClick={handleSelf}
        title={myVendorName ? `Atribuir pra ${myVendorName}` : 'Atribuir'}
        className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-l-md
                   bg-info-bg/60 text-info border border-info/30
                   hover:bg-info-bg hover:border-info/60 hover:shadow-sm
                   transition-all text-[11px] font-medium
                   disabled:opacity-50 disabled:cursor-wait"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Pegar pra mim
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title="Atribuir pra outro vendedor"
        className="h-7 px-1.5 rounded-r-md border border-l-0 border-info/30
                   bg-info-bg/40 text-info hover:bg-info-bg hover:border-info/60
                   transition-all disabled:opacity-50"
      >
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          className="absolute z-50 right-0 top-full mt-1 min-w-[200px] bg-surface border border-border rounded-md shadow-lg py-1 max-h-[280px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-widest text-ink-faint">
            Atribuir pra…
          </div>
          {vendorList.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-ink-faint">Nenhum vendedor.</p>
          )}
          {vendorList.map(v => {
            const isSelf = v.name === myVendorName
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => handleOutro(v.name)}
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-[12px] hover:bg-surface-2 transition-colors text-ink"
              >
                <span className="h-5 w-5 rounded-full bg-accent/20 text-accent text-[10px] font-semibold flex items-center justify-center shrink-0">
                  {v.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{v.name}</span>
                {isSelf && <Check className="h-3 w-3 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
