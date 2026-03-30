import { useState } from 'react'
import { useVendors } from '@/hooks/useVendors'
import { useUpdateContact } from '@/hooks/useContacts'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { formatPhone, whatsappLink, formatRelative } from '@/lib/utils'
import { X, MessageCircle, Phone, User, MapPin, Tag, Building } from 'lucide-react'
import { STATUS_OPTIONS } from '@/types'
import type { Contact } from '@/types'

interface Props {
  contact: Contact
  onClose: () => void
}

export function ContactDetail({ contact, onClose }: Props) {
  const { data: vendors = [] } = useVendors()
  const updateContact = useUpdateContact()
  const [noteText, setNoteText] = useState('')

  const tel = contact.telefone_normalizado || contact.phone || ''
  const statusOpt = STATUS_OPTIONS.find(s => s.value === contact.status)

  const handleStatusChange = (status: string) => {
    updateContact.mutate({ id: contact.id, status })
  }

  const handleAssign = (vendorId: string) => {
    updateContact.mutate({ id: contact.id, vendor_id: vendorId || null })
  }

  const handleSaveNote = () => {
    if (!noteText.trim()) return
    const existing = contact.notes || ''
    const timestamp = new Date().toLocaleDateString('pt-BR')
    const newNote = `[${timestamp}] ${noteText.trim()}`
    const updated = existing ? `${newNote}\n${existing}` : newNote
    updateContact.mutate({ id: contact.id, notes: updated })
    setNoteText('')
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-surface-border p-4 flex items-center justify-between z-10">
          <h2 className="font-semibold text-lg text-text-primary">Detalhes do Contato</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-tertiary">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Contact info */}
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
              <User className="h-7 w-7 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-text-primary truncate">{contact.name || '(sem nome)'}</h3>
              <p className="text-sm text-text-secondary font-mono">{formatPhone(tel)}</p>
              {contact.email && <p className="text-xs text-text-muted">{contact.email}</p>}
            </div>
          </div>

          {/* Quick actions */}
          {tel && (
            <div className="flex gap-2">
              <a href={whatsappLink(tel)} target="_blank" rel="noopener" className="flex-1">
                <Button variant="primary" className="w-full bg-green-600 hover:bg-green-700">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </Button>
              </a>
              <a href={`tel:+${tel}`} className="flex-1">
                <Button variant="secondary" className="w-full">
                  <Phone className="h-4 w-4" /> Ligar
                </Button>
              </a>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-3 bg-surface-secondary rounded-lg">
              <MapPin className="h-4 w-4 text-text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Estado</p>
                <p className="text-sm font-medium truncate">{contact.state || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-surface-secondary rounded-lg">
              <Building className="h-4 w-4 text-text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Cidade</p>
                <p className="text-sm font-medium truncate">{contact.city || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-surface-secondary rounded-lg col-span-2">
              <Tag className="h-4 w-4 text-text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Origem</p>
                <p className="text-sm font-medium truncate">{contact.origin || '-'}</p>
              </div>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Status</label>
            <Select
              options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
              value={contact.status ?? ''}
              onChange={e => handleStatusChange(e.target.value)}
            />
          </div>

          {/* Assign vendor */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Vendedor</label>
            <Select
              options={vendors.map(v => ({ value: v.id, label: v.name }))}
              placeholder="Sem vendedor"
              value={contact.vendor_id ?? ''}
              onChange={e => handleAssign(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <h3 className="font-semibold text-text-primary mb-3">Anotacoes</h3>
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Adicionar anotacao..."
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveNote()}
              />
              <Button variant="primary" size="sm" onClick={handleSaveNote}>Salvar</Button>
            </div>
            {contact.notes ? (
              <div className="p-3 bg-surface-secondary rounded-lg whitespace-pre-wrap text-sm text-text-primary max-h-60 overflow-y-auto">
                {contact.notes}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Nenhuma anotacao</p>
            )}
          </div>

          {/* Meta */}
          <div className="text-xs text-text-muted pt-4 border-t border-surface-border">
            <p>Criado: {formatRelative(contact.created_at)}</p>
            <p>Atualizado: {formatRelative(contact.updated_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
