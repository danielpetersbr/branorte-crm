import { useState } from 'react'
import { useVendors } from '@/hooks/useVendors'
import { useUpdateContact } from '@/hooks/useContacts'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { formatPhone, whatsappLink, formatRelative } from '@/lib/utils'
import { parseCrmMeta, getHumanNotes, updateCrmMeta, addHumanNote } from '@/lib/crm-fields'
import type { CrmMeta } from '@/lib/crm-fields'
import { X, MessageCircle, Phone, User, MapPin, Building, Thermometer, Send, DollarSign, Calendar, Hash } from 'lucide-react'
import { TEMPERATURA_OPTIONS, FUNIL_OPTIONS, MOTIVO_PERDA_OPTIONS } from '@/types'
import type { Contact } from '@/types'

interface Props {
  contact: Contact
  onClose: () => void
}

export function ContactDetail({ contact, onClose }: Props) {
  const { data: vendors = [] } = useVendors()
  const updateContact = useUpdateContact()

  const meta = parseCrmMeta(contact.notes)
  const humanNotes = getHumanNotes(contact.notes)

  const [noteText, setNoteText] = useState('')
  const [valorInput, setValorInput] = useState(String(meta.valor || ''))
  const [followupDate, setFollowupDate] = useState(meta.followup || '')

  const tel = contact.telefone_normalizado || contact.phone || ''

  function getOrcamento(origin: string | null): string | null {
    if (!origin) return null
    const m = origin.match(/^Orcamento\s+(.+)$/)
    return m ? m[1] : null
  }
  function getOrcDescricao(notes: string | null): string | null {
    const human = getHumanNotes(notes)
    if (!human) return null
    const firstLine = human.split('\n')[0].trim()
    if (firstLine && !firstLine.startsWith('Orcamento') && !firstLine.startsWith('[')) return firstLine
    return null
  }

  const orc = getOrcamento(contact.origin)
  const orcDesc = getOrcDescricao(contact.notes)

  const saveNotes = (newNotes: string) => {
    updateContact.mutate({ id: contact.id, notes: newNotes })
  }

  const handleTempChange = (temp: string) => {
    saveNotes(updateCrmMeta(contact.notes, { temp }))
  }

  const handleFunilChange = (funil: string) => {
    saveNotes(updateCrmMeta(contact.notes, { funil }))
  }

  const handleRegistrarTentativa = (resultado: string) => {
    const tentativas = (meta.tentativas || 0) + 1
    const ultimo = new Date().toISOString()
    let updated = updateCrmMeta(contact.notes, { tentativas, ultimo })
    // Add human note
    const m2 = parseCrmMeta(updated)
    const h2 = getHumanNotes(updated)
    const dateStr = new Date().toLocaleDateString('pt-BR')
    const newNote = `[${dateStr}] ${resultado}`
    const newHuman = h2 ? `${newNote}\n${h2}` : newNote
    const metaLine = JSON.stringify(m2)
    saveNotes(`${metaLine}\n${newHuman}`)

    if (resultado.includes('Atendeu')) {
      // Also update funil to primeiro_contato if still novo_lead
      if (!meta.funil || meta.funil === 'novo_lead') {
        setTimeout(() => {
          const fresh = updateCrmMeta(contact.notes, { tentativas, ultimo, funil: 'primeiro_contato' })
          // Re-add the note
          const fm = parseCrmMeta(fresh)
          fm.tentativas = tentativas
          fm.ultimo = ultimo
          fm.funil = 'primeiro_contato'
          const fh = getHumanNotes(fresh)
          const finalHuman = fh ? `${newNote}\n${fh}` : newNote
          saveNotes(`${JSON.stringify(fm)}\n${finalHuman}`)
        }, 500)
      }
    }
  }

  const handleSaveNote = () => {
    if (!noteText.trim()) return
    saveNotes(addHumanNote(contact.notes, noteText.trim()))
    setNoteText('')
  }

  const handleSaveValor = () => {
    const val = parseFloat(valorInput.replace(/[^\d.,]/g, '').replace(',', '.'))
    if (!isNaN(val)) saveNotes(updateCrmMeta(contact.notes, { valor: val }))
  }

  const handleSaveFollowup = () => {
    if (followupDate) saveNotes(updateCrmMeta(contact.notes, { followup: followupDate }))
  }

  const handleMotivo = (motivo: string) => {
    saveNotes(updateCrmMeta(contact.notes, { motivo }))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
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

          {/* Registrar tentativa */}
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
            {meta.tentativas ? (
              <p className="text-xs text-text-muted mt-1">
                {meta.tentativas} tentativa(s) | Ultimo: {meta.ultimo ? formatRelative(meta.ultimo) : 'nunca'}
              </p>
            ) : null}
          </div>

          {/* Orcamento */}
          {orc && (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <Hash className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">Orcamento {orc}</span>
              </div>
              {orcDesc && <p className="text-sm text-amber-700">{orcDesc}</p>}
            </div>
          )}

          {/* Location */}
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
            <label className="text-sm font-medium text-text-primary mb-2 flex items-center gap-1">
              <Thermometer className="h-4 w-4" /> Temperatura
            </label>
            <div className="flex gap-2 flex-wrap">
              {TEMPERATURA_OPTIONS.map(t => (
                <button
                  key={t.value}
                  onClick={() => handleTempChange(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    meta.temp === t.value
                      ? t.color + ' ring-2 ring-offset-1 ring-current'
                      : 'bg-white text-text-muted border-surface-border hover:bg-surface-secondary'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Funil */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 block">Estagio do Funil</label>
            <Select
              options={FUNIL_OPTIONS.map(f => ({ value: f.value, label: f.label }))}
              placeholder="Selecionar"
              value={meta.funil ?? ''}
              onChange={e => handleFunilChange(e.target.value)}
            />
          </div>

          {/* Valor */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-1">
              <DollarSign className="h-4 w-4" /> Valor Estimado (R$)
            </label>
            <div className="flex gap-2">
              <input type="text"
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="0,00" value={valorInput}
                onChange={e => setValorInput(e.target.value)} />
              <Button variant="secondary" size="sm" onClick={handleSaveValor}>Salvar</Button>
            </div>
          </div>

          {/* Follow-up */}
          <div>
            <label className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-1">
              <Calendar className="h-4 w-4" /> Proximo Follow-up
            </label>
            <div className="flex gap-2">
              <input type="date"
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={followupDate} onChange={e => setFollowupDate(e.target.value)} />
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
              onChange={e => updateContact.mutate({ id: contact.id, vendor_id: e.target.value || null })}
            />
          </div>

          {/* Motivo perda */}
          {(meta.funil === 'fechado_perdido' || meta.temp === 'perdido') && (
            <div>
              <label className="text-sm font-medium text-text-primary mb-1.5 block">Motivo da Perda</label>
              <Select options={MOTIVO_PERDA_OPTIONS} placeholder="Selecionar motivo"
                value={meta.motivo ?? ''} onChange={e => handleMotivo(e.target.value)} />
            </div>
          )}

          {/* Notes */}
          <div>
            <h3 className="font-semibold text-text-primary mb-3">Anotacoes</h3>
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 h-9 rounded-lg border border-surface-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Adicionar anotacao..." value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveNote()} />
              <Button variant="primary" size="sm" onClick={handleSaveNote}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {humanNotes ? (
              <div className="p-3 bg-surface-secondary rounded-lg whitespace-pre-wrap text-sm text-text-primary max-h-48 overflow-y-auto">
                {humanNotes}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Nenhuma anotacao</p>
            )}
          </div>

          <div className="text-xs text-text-muted pt-4 border-t border-surface-border space-y-0.5">
            <p>Origem: {contact.origin || '-'}</p>
            <p>Criado: {formatRelative(contact.created_at)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
