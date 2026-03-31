import { useState } from 'react'
import { useVendors } from '@/hooks/useVendors'
import { useUpdateContact } from '@/hooks/useContacts'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { formatPhone, whatsappLink, formatRelative } from '@/lib/utils'
import { X, MessageCircle, Phone, User, MapPin, Tag, Building, Thermometer, Send, DollarSign, Calendar, Hash } from 'lucide-react'
import { TEMPERATURA_OPTIONS, FUNIL_OPTIONS, MOTIVO_PERDA_OPTIONS } from '@/types'
import type { Contact } from '@/types'

interface Props {
  contact: Contact
  onClose: () => void
}

export function ContactDetail({ contact, onClose }: Props) {
  const { data: vendors = [] } = useVendors()
  const updateContact = useUpdateContact()
  const [noteText, setNoteText] = useState('')
  const [valorEstimado, setValorEstimado] = useState(String(contact.valor_estimado || ''))
  const [followupDate, setFollowupDate] = useState(contact.proximo_followup || '')

  const tel = contact.telefone_normalizado || contact.phone || ''
  const tempOpt = TEMPERATURA_OPTIONS.find(t => t.value === contact.temperatura)
  const funilOpt = FUNIL_OPTIONS.find(f => f.value === contact.estagio_funil)

  function getOrcamento(origin: string | null): string | null {
    if (!origin) return null
    const match = origin.match(/^Orcamento\s+(.+)$/)
    return match ? match[1] : null
  }
  function getOrcDescricao(notes: string | null): string | null {
    if (!notes) return null
    const firstLine = notes.split('\n')[0].trim()
    if (firstLine && !firstLine.startsWith('Orcamento')) return firstLine
    return null
  }

  const orc = getOrcamento(contact.origin)
  const orcDesc = getOrcDescricao(contact.notes)

  const handleUpdate = (updates: Record<string, unknown>) => {
    updateContact.mutate({ id: contact.id, ...updates } as any)
  }

  const handleRegistrarTentativa = (resultado: string) => {
    const now = new Date().toISOString()
    const existing = contact.notes || ''
    const dateStr = new Date().toLocaleDateString('pt-BR')
    const newNote = `[${dateStr}] ${resultado}`
    const updatedNotes = existing ? `${newNote}\n${existing}` : newNote

    handleUpdate({
      notes: updatedNotes,
      ultimo_contato: now,
      tentativas: (contact.tentativas || 0) + 1,
      ...(resultado.includes('Atendeu') ? { estagio_funil: 'primeiro_contato' } : {}),
    })
  }

  const handleSaveNote = () => {
    if (!noteText.trim()) return
    const existing = contact.notes || ''
    const dateStr = new Date().toLocaleDateString('pt-BR')
    const newNote = `[${dateStr}] ${noteText.trim()}`
    handleUpdate({ notes: existing ? `${newNote}\n${existing}` : newNote })
    setNoteText('')
  }

  const handleSaveValor = () => {
    const val = parseFloat(valorEstimado.replace(/[^\d.,]/g, '').replace(',', '.'))
    if (!isNaN(val)) handleUpdate({ valor_estimado: val })
  }

  const handleSaveFollowup = () => {
    if (followupDate) handleUpdate({ proximo_followup: followupDate })
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

        <div className="p-4 space-y-5">
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

          {/* Registrar tentativa - quick buttons */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-2 block">Registrar Tentativa</label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={() => handleRegistrarTentativa('Atendeu - Conversa realizada')}>
                Atendeu
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleRegistrarTentativa('Nao atendeu')}>
                Nao atendeu
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleRegistrarTentativa('Retornar depois')}>
                Retornar depois
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleRegistrarTentativa('Sem interesse')}>
                Sem interesse
              </Button>
            </div>
            {contact.tentativas ? (
              <p className="text-xs text-text-muted mt-1">
                {contact.tentativas} tentativa(s) | Ultimo contato: {contact.ultimo_contato ? formatRelative(contact.ultimo_contato) : 'nunca'}
              </p>
            ) : null}
          </div>

          {/* Orcamento info */}
          {orc && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <Hash className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">Orcamento {orc}</span>
              </div>
              {orcDesc && <p className="text-sm text-amber-700">{orcDesc}</p>}
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
          </div>

          {/* Temperatura */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-1">
              <Thermometer className="h-4 w-4" /> Temperatura
            </label>
            <div className="flex gap-2 flex-wrap">
              {TEMPERATURA_OPTIONS.map(t => (
                <button
                  key={t.value}
                  onClick={() => handleUpdate({ temperatura: t.value })}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    contact.temperatura === t.value
                      ? t.color + ' ring-2 ring-offset-1 ring-current'
                      : 'bg-white text-text-muted border-surface-border hover:bg-surface-secondary'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Estagio do Funil */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Estagio do Funil</label>
            <Select
              options={FUNIL_OPTIONS.map(f => ({ value: f.value, label: f.label }))}
              value={contact.estagio_funil ?? ''}
              onChange={e => handleUpdate({ estagio_funil: e.target.value })}
            />
          </div>

          {/* Valor estimado */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-1">
              <DollarSign className="h-4 w-4" /> Valor Estimado (R$)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="0,00"
                value={valorEstimado}
                onChange={e => setValorEstimado(e.target.value)}
              />
              <Button variant="secondary" size="sm" onClick={handleSaveValor}>Salvar</Button>
            </div>
          </div>

          {/* Proximo follow-up */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-1">
              <Calendar className="h-4 w-4" /> Proximo Follow-up
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={followupDate}
                onChange={e => setFollowupDate(e.target.value)}
              />
              <Button variant="secondary" size="sm" onClick={handleSaveFollowup}>Salvar</Button>
            </div>
          </div>

          {/* Vendedor */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Vendedor</label>
            <Select
              options={vendors.map(v => ({ value: v.id, label: v.name }))}
              placeholder="Sem vendedor"
              value={contact.vendor_id ?? ''}
              onChange={e => handleUpdate({ vendor_id: e.target.value || null })}
            />
          </div>

          {/* Motivo de perda */}
          {(contact.estagio_funil === 'fechado_perdido' || contact.temperatura === 'perdido') && (
            <div>
              <label className="text-sm font-medium text-text-primary mb-1.5 block">Motivo da Perda</label>
              <Select
                options={MOTIVO_PERDA_OPTIONS}
                placeholder="Selecionar motivo"
                value={contact.motivo_perda ?? ''}
                onChange={e => handleUpdate({ motivo_perda: e.target.value })}
              />
            </div>
          )}

          {/* Notas */}
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
              <Button variant="primary" size="sm" onClick={handleSaveNote}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {contact.notes ? (
              <div className="p-3 bg-surface-secondary rounded-lg whitespace-pre-wrap text-sm text-text-primary max-h-48 overflow-y-auto">
                {contact.notes}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Nenhuma anotacao</p>
            )}
          </div>

          {/* Meta */}
          <div className="text-xs text-text-muted pt-4 border-t border-surface-border space-y-0.5">
            <p>Origem: {contact.origin || '-'}</p>
            <p>Criado: {formatRelative(contact.created_at)}</p>
            <p>Atualizado: {formatRelative(contact.updated_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
