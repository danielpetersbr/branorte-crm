import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Camera, ImageOff, Loader2, X } from 'lucide-react'
import type { CatalogoItemAdmin } from '@/hooks/useCatalogoAdmin'
import { useFotoModeloCatalogo } from '@/hooks/useFotoModeloCatalogo'

export function CatalogoFabricaFotoModal({ item, onClose }: { item: CatalogoItemAdmin & { modelo_id: number }; onClose: () => void }) {
  const [foto, setFoto] = useState(item.foto_url)
  const input = useRef<HTMLInputElement>(null)
  const mutation = useFotoModeloCatalogo(item.modelo_id)
  async function atualizar(file: File | null) {
    try { setFoto(await mutation.mutateAsync(file)) } catch { /* O erro aparece no diálogo. */ }
  }
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !mutation.isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%_-_2rem)] max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-bg p-5 text-ink">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="min-w-0">
              <Dialog.Title className="font-semibold text-lg">Foto da fábrica</Dialog.Title>
              <Dialog.Description className="text-sm text-ink-muted mt-1">{item.nome_curto}</Dialog.Description>
            </div>
            <Dialog.Close disabled={mutation.isPending} aria-label="Fechar editor da fábrica" className="p-2 rounded-lg hover:bg-surface-2"><X className="w-5 h-5" /></Dialog.Close>
          </div>
          <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-5">
            <div>
              <div className="aspect-square max-w-[300px] mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center">
                {foto ? <img src={foto} alt={item.nome_curto} className="w-full h-full object-contain p-2" /> : <ImageOff className="w-10 h-10 text-gray-400" />}
              </div>
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Escolher foto da fábrica" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void atualizar(file) }} />
              <button disabled={mutation.isPending} onClick={() => input.current?.click()} className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white disabled:opacity-50">{mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Trocar foto</button>
              {foto && <button disabled={mutation.isPending} onClick={() => void atualizar(null)} className="mt-2 text-sm text-ink-muted hover:text-danger disabled:opacity-50">Remover foto</button>}
              <p className="text-xs text-ink-muted mt-3">JPG, PNG ou WEBP até 5 MB. A foto é salva ao concluir o envio e aparece nos novos orçamentos deste modelo.</p>
              {mutation.error && <p role="alert" className="text-sm text-danger mt-3">{mutation.error.message}</p>}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm mb-3">Equipamentos do pacote</h3>
              <ul className="space-y-2 text-sm text-ink-muted">{item.specs.map((spec, i) => <li key={i}>{spec}</li>)}</ul>
              <p className="mt-4 text-xs text-ink-faint">Para alterar a descrição de um equipamento, abra o cadastro dele no catálogo.</p>
            </div>
          </div>
          <div className="flex justify-end mt-5 pt-4 border-t border-border"><Dialog.Close disabled={mutation.isPending} className="px-4 py-2 rounded-lg border border-border hover:bg-surface-2 disabled:opacity-50">Concluir</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
