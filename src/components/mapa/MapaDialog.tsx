import { useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, X } from 'lucide-react'

/** Map overlays share keyboard dismissal, focus trapping and return to their opener. */
export function MapaDialog({
  children, title, description, onClose, className = '', sheet = false,
}: {
  children: ReactNode
  title: string
  description?: string
  onClose: () => void
  className?: string
  sheet?: boolean
}) {
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement)
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1300] bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content
          onCloseAutoFocus={event => {
            if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() }
          }}
          className={`fixed z-[1301] flex flex-col border border-border bg-surface text-ink shadow-2xl focus:outline-none ${sheet
            ? 'bottom-0 left-0 w-full max-h-[90dvh] rounded-t-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl'
            : 'left-1/2 top-1/2 w-[calc(100vw-1rem)] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 rounded-xl'} ${className}`}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description || title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Keep the map wide; the same legend and radius results open on every screen size. */
export function MapaPainel({ children, title, summary }: { children: ReactNode | ((close: () => void) => ReactNode); title: string; summary?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        className="absolute right-2 bottom-16 md:bottom-auto md:top-3 md:right-3 z-[1000] inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 text-[12px] font-semibold text-ink shadow backdrop-blur hover:border-accent hover:text-accent">
        {title}<ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <MapaDialog title={title} description={summary} onClose={() => setOpen(false)} sheet className="md:max-w-sm">
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              {summary && <p className="mt-0.5 text-[12px] text-ink-muted">{summary}</p>}
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar painel" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-2"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 overflow-y-auto p-4 pb-safe">{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>
        </MapaDialog>
      )}
    </>
  )
}
