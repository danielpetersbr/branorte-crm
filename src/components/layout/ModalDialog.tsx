import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** showModal torna o restante da página inerte e mantém o foco dentro do diálogo. */
export function ModalDialog({ label, children, onClose, locked = false, className }: {
  label: string
  children: ReactNode
  onClose: () => void
  locked?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-modal="true"
      className={cn('fixed inset-0 m-0 h-full w-full max-h-none max-w-none border-0 bg-transparent text-ink flex [&:not([open])]:hidden backdrop:bg-transparent', className)}
      onCancel={event => {
        event.preventDefault()
        if (!locked) onClose()
      }}
      onClick={event => {
        if (!locked && (event.target === event.currentTarget || (event.target as HTMLElement).dataset.dialogBackdrop === 'true')) onClose()
      }}
    >
      <div data-dialog-backdrop="true" aria-hidden="true" className="absolute inset-0 bg-black/50" />
      {children}
    </dialog>
  )
}
