import { useState, useCallback } from 'react'
import { useContacts, useUpdateContact } from '@/hooks/useContacts'
import { useVendors } from '@/hooks/useVendors'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatPhone, whatsappLink } from '@/lib/utils'
import { useVendorMap } from '@/hooks/useVendorMap'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react'
import { ESTADOS_BR, STATUS_OPTIONS, TEMPERATURA_OPTIONS, FUNIL_OPTIONS, PAGE_SIZE } from '@/types'
import type { ContactFilters, Contact } from '@/types'
import { ContactDetail } from '@/components/contacts/ContactDetail'

function getOrcamento(origin: string | null): string | null {
  if (!origin) return null
  const match = origin.match(/^Orcamento\s+(.+)$/)
  return match ? match[1] : null
}

function getOrcDescricao(notes: string | null): string | null {
  if (!notes) return null
  const firstLine = notes.split('\n')[0].trim()
  // Se a primeira linha NAO comeca com "Orcamento" eh a descricao do produto
  if (firstLine && !firstLine.startsWith('Orcamento')) return firstLine
  return null
}

export function Contacts() {
  const [filters, setFilters] = useState<ContactFilters>({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, temperatura: '', page: 0 })
  const [searchInput, setSearchInput] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const { data: vendorsData } = useVendors()
  const { data, isLoading } = useContacts(filters)
  const updateContact = useUpdateContact()
  const vendorMap = useVendorMap()

  const vendors = vendorsData ?? []
  const contacts = data?.contacts ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = useCallback(() => {
    setFilters(f => ({ ...f, search: searchInput, page: 0 }))
  }, [searchInput])

  const clearFilters = () => {
    setFilters({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, temperatura: '', page: 0 })
    setSearchInput('')
  }

  const hasFilters = filters.search || filters.estado || filters.vendor_id || filters.status || filters.orcamento || filters.temperatura

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Contatos</h1>
          <p className="text-sm text-text-secondary">{formatNumber(total)} contatos encontrados</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1">
            <form onSubmit={e => { e.preventDefault(); handleSearch() }}>
              <Input placeholder="Buscar por nome ou telefone..." leftIcon={<Search className="h-4 w-4" />}
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </form>
          </div>
          <Select options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))} placeholder="Estado"
            value={filters.estado} onChange={e => setFilters(f => ({ ...f, estado: e.target.value, page: 0 }))} className="lg:w-28" />
          <Select options={vendors.map(v => ({ value: v.id, label: v.name }))} placeholder="Vendedor"
            value={filters.vendor_id} onChange={e => setFilters(f => ({ ...f, vendor_id: e.target.value, page: 0 }))} className="lg:w-48" />
          <Select options={TEMPERATURA_OPTIONS.map(t => ({ value: t.value, label: `${t.icon} ${t.label}` }))} placeholder="Temperatura"
            value={filters.temperatura} onChange={e => setFilters(f => ({ ...f, temperatura: e.target.value, page: 0 }))} className="lg:w-36" />
          <Select options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))} placeholder="Status"
            value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 0 }))} className="lg:w-36" />
          <Button
            variant={filters.orcamento ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setFilters(f => ({ ...f, orcamento: !f.orcamento, page: 0 }))}
            className="shrink-0"
          >
            <FileText className="h-4 w-4" />
            Orcamentos
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-4 w-4" /> Limpar</Button>
          )}
        </div>
      </Card>

      {isLoading ? <PageLoading /> : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Card className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-secondary border-b border-surface-border">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Nome</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Telefone</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Temp</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Funil</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Orcamento</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {contacts.map(c => {
                    const tel = c.telefone_normalizado || c.phone || ''
                    const orc = getOrcamento(c.origin)
                    const tempOpt = TEMPERATURA_OPTIONS.find(t => t.value === c.temperatura)
                    const funilOpt = FUNIL_OPTIONS.find(f => f.value === c.estagio_funil)
                    return (
                      <tr key={c.id} className="hover:bg-surface-secondary cursor-pointer transition-colors"
                        onClick={() => setSelectedContact(c)}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">{c.name || '(sem nome)'}</span>
                          {c.city && <span className="text-xs text-text-muted ml-2">{c.city}</span>}
                          {c.state && <Badge className="bg-blue-50 text-blue-700 ml-1">{c.state}</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary font-mono">{formatPhone(tel)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {tempOpt ? <Badge className={tempOpt.color}>{tempOpt.icon} {tempOpt.label}</Badge> : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          {funilOpt ? <Badge className={funilOpt.color}>{funilOpt.label}</Badge> : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">{(c.vendor_id ? vendorMap[c.vendor_id] : null) ?? '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {orc ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge className="bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                                <FileText className="h-3 w-3" /> {orc}
                              </Badge>
                              {getOrcDescricao(c.notes) && (
                                <span className="text-xs text-text-muted truncate max-w-[200px]" title={getOrcDescricao(c.notes)!}>
                                  {getOrcDescricao(c.notes)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {tel && (
                              <>
                                <a href={whatsappLink(tel)} target="_blank" rel="noopener"
                                  className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors">
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                                <a href={`tel:+${tel}`}
                                  className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors">
                                  <Phone className="h-4 w-4" />
                                </a>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-2">
            {contacts.map(c => {
              const statusOpt = STATUS_OPTIONS.find(s => s.value === c.status)
              const tel = c.telefone_normalizado || c.phone || ''
              const orc = getOrcamento(c.origin)
              return (
                <Card key={c.id} hover onClick={() => setSelectedContact(c)} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text-primary truncate">{c.name || '(sem nome)'}</p>
                      <p className="text-sm text-text-secondary font-mono mt-0.5">{formatPhone(tel)}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {c.state && <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>}
                        {orc && (
                          <Badge className="bg-amber-50 text-amber-700 border border-amber-200">
                            <FileText className="h-3 w-3" /> {orc}
                          </Badge>
                        )}
                        {orc && getOrcDescricao(c.notes) && (
                          <span className="text-xs text-text-muted">{getOrcDescricao(c.notes)}</span>
                        )}
                        {statusOpt && <Badge className={statusOpt.color}>{statusOpt.label}</Badge>}
                        {c.vendor_id && vendorMap[c.vendor_id] && <span className="text-xs text-text-muted">{vendorMap[c.vendor_id!]}</span>}
                      </div>
                    </div>
                    {tel && (
                      <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                        <a href={whatsappLink(tel)} target="_blank" rel="noopener"
                          className="p-2 rounded-lg bg-green-50 text-green-600">
                          <MessageCircle className="h-5 w-5" />
                        </a>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-text-muted">Pagina {filters.page + 1} de {formatNumber(totalPages)}</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={filters.page === 0}
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </Button>
                <Button variant="secondary" size="sm" disabled={filters.page >= totalPages - 1}
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                  Proxima <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedContact && (
        <ContactDetail contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
    </div>
  )
}
