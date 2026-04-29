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
import { useContactsOrcamentos } from '@/hooks/useContactsOrcamentos'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react'
import { ESTADOS_BR, STATUS_OPTIONS, TEMPERATURA_OPTIONS, FUNIL_OPTIONS, PAGE_SIZE } from '@/types'
import { parseCrmMeta } from '@/lib/crm-fields'
import type { ContactFilters, Contact } from '@/types'
import { ContactDetail } from '@/components/contacts/ContactDetail'

function getOrcamento(origin: string | null): string | null {
  if (!origin) return null
  const match = origin.match(/^Orcamento\s+(.+)$/)
  return match ? match[1] : null
}

function getOrcDescricao(notes: string | null): string | null {
  if (!notes) return null
  const lines = notes.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('{')) continue        // Skip JSON metadata
    if (trimmed.startsWith('Orcamento')) continue // Skip "Orcamento 2026-XXXX"
    if (trimmed.startsWith('[')) continue          // Skip "[31/03/2026] Atendeu..."
    if (trimmed.startsWith('Auto-criado')) continue // Skip stub auto-link notes
    if (trimmed.startsWith('Bucket pra')) continue  // Skip bucket "[Sem cliente]"
    return trimmed
  }
  return null
}

// Phones placeholder: 'ORC-...' (legacy) e 'AUTO-...' (stubs auto-link) não são fones reais.
function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  return phone.startsWith('ORC-') || phone.startsWith('AUTO-')
}

export function Contacts() {
  const currentYear = new Date().getFullYear()
  const orcamentoAnos = Array.from({ length: currentYear - 2011 }, (_, i) => String(currentYear - i))

  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const [filters, setFilters] = useState<ContactFilters>({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', page: 0 })
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

  // Cruzamento com orcamentos_files: traz nº dos orçamentos pra cada contato visível.
  const contactIds = contacts.map(c => c.id)
  const { data: orcamentosMap } = useContactsOrcamentos(contactIds)

  const handleSearch = useCallback(() => {
    setFilters(f => ({ ...f, search: searchInput, page: 0 }))
  }, [searchInput])

  const clearFilters = () => {
    setFilters({ search: '', estado: '', vendor_id: '', status: '', orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', page: 0 })
    setSearchInput('')
  }

  const hasFilters = filters.search || filters.estado || filters.vendor_id || filters.status || filters.orcamento || filters.orcamento_ano || filters.temperatura

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
            value={filters.temperatura} onChange={e => setFilters(f => ({ ...f, temperatura: e.target.value, page: 0 }))} className="lg:w-40" />
          <Button
            variant={filters.orcamento || filters.orcamento_ano ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setFilters(f => ({ ...f, orcamento: !f.orcamento, orcamento_ano: '', page: 0 }))}
            className="shrink-0"
          >
            <FileText className="h-4 w-4" />
            Orcamentos
          </Button>
          <Select
            options={orcamentoAnos.map(y => ({ value: y, label: y }))}
            placeholder="Ano"
            value={filters.orcamento_ano}
            onChange={e => setFilters(f => ({ ...f, orcamento_ano: e.target.value, orcamento_mes: '', orcamento: false, page: 0 }))}
            className="lg:w-24"
          />
          {filters.orcamento_ano && (
            <Select
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="Mês"
              value={filters.orcamento_mes}
              onChange={e => setFilters(f => ({ ...f, orcamento_mes: e.target.value, page: 0 }))}
              className="lg:w-24"
            />
          )}
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
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cidade</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Estado</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Orcamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Data orcamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {contacts.map(c => {
                    const placeholder = isPlaceholderPhone(c.phone)
                    const tel = placeholder ? '' : (c.telefone_normalizado || c.phone || '')
                    const orc = getOrcamento(c.origin)
                    const orcsLinkados = orcamentosMap?.get(c.id) ?? []
                    const meta = parseCrmMeta(c.notes)
                    const tempOpt = TEMPERATURA_OPTIONS.find(t => t.value === meta.temp)
                    const funilOpt = FUNIL_OPTIONS.find(f => f.value === meta.funil)
                    return (
                      <tr key={c.id} className="hover:bg-surface-secondary cursor-pointer transition-colors"
                        onClick={() => setSelectedContact(c)}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">{c.name || '(sem nome)'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary font-mono">{formatPhone(tel)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {c.city ? (
                            <span className="text-sm text-text-secondary">{c.city}</span>
                          ) : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.state ? (
                            <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>
                          ) : <span className="text-text-muted">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">{(c.vendor_id ? vendorMap[c.vendor_id] : null) ?? '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {orcsLinkados.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge
                                className="bg-amber-50 text-amber-700 border border-amber-200 w-fit"
                                title={`${orcsLinkados[0].cliente} · ${orcsLinkados[0].path_principal}`}
                              >
                                <FileText className="h-3 w-3" /> {orcsLinkados[0].ano}-{orcsLinkados[0].numero}
                              </Badge>
                              {orcsLinkados.length > 1 && (
                                <Badge
                                  className="bg-stone-100 text-stone-600 text-[10px]"
                                  title={orcsLinkados.slice(1).map(o => `${o.ano}-${o.numero}`).join(', ')}
                                >
                                  +{orcsLinkados.length - 1}
                                </Badge>
                              )}
                            </div>
                          ) : orc ? (
                            <Badge className="bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                              <FileText className="h-3 w-3" /> {orc}
                            </Badge>
                          ) : (
                            <span className="text-sm text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const dateStr = orcsLinkados[0]?.mtime_iso || c.data_orcamento
                            if (!dateStr) return <span className="text-sm text-text-muted">-</span>
                            const d = new Date(dateStr)
                            if (isNaN(d.getTime())) return <span className="text-sm text-text-muted">-</span>
                            const dd = String(d.getDate()).padStart(2, '0')
                            const mm = String(d.getMonth() + 1).padStart(2, '0')
                            const yy = d.getFullYear()
                            return <span className="text-sm text-text-secondary font-mono tabular-nums">{`${dd}/${mm}/${yy}`}</span>
                          })()}
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
              const placeholder2 = isPlaceholderPhone(c.phone)
              const tel = placeholder2 ? '' : (c.telefone_normalizado || c.phone || '')
              const orc = getOrcamento(c.origin)
              const orcsLinkadosM = orcamentosMap?.get(c.id) ?? []
              const mobileM = parseCrmMeta(c.notes)
              const mobileTempOpt = TEMPERATURA_OPTIONS.find(t => t.value === mobileM.temp)
              const mobileFunilOpt = FUNIL_OPTIONS.find(f => f.value === mobileM.funil)
              return (
                <Card key={c.id} hover onClick={() => setSelectedContact(c)} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text-primary truncate">{c.name || '(sem nome)'}</p>
                      <p className="text-sm text-text-secondary font-mono mt-0.5">{formatPhone(tel)}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {mobileTempOpt && <Badge className={mobileTempOpt.color}>{mobileTempOpt.icon}</Badge>}
                        {c.state && <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>}
                        {mobileFunilOpt && <Badge className={mobileFunilOpt.color}>{mobileFunilOpt.label}</Badge>}
                        {orcsLinkadosM.length > 0 ? (
                          <Badge className="bg-amber-50 text-amber-700 border border-amber-200" title={orcsLinkadosM.slice(1, 4).map(o => `${o.ano}-${o.numero}`).join(', ')}>
                            <FileText className="h-3 w-3" /> {orcsLinkadosM[0].ano}-{orcsLinkadosM[0].numero}
                            {orcsLinkadosM.length > 1 && <span className="ml-1 text-[10px] opacity-70">+{orcsLinkadosM.length - 1}</span>}
                          </Badge>
                        ) : orc ? (
                          <Badge className="bg-amber-50 text-amber-700 border border-amber-200"><FileText className="h-3 w-3" /> {orc}</Badge>
                        ) : null}
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
