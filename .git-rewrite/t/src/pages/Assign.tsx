import { useState } from 'react'
import { useContacts, useBulkAssign } from '@/hooks/useContacts'
import { useVendors } from '@/hooks/useVendors'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatPhone } from '@/lib/utils'
import { Search, UserPlus, CheckSquare, Square } from 'lucide-react'
import { ESTADOS_BR } from '@/types'

export function Assign() {
  const [estado, setEstado] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetVendor, setTargetVendor] = useState('')
  const [page, setPage] = useState(0)

  const { data: vendors = [] } = useVendors()
  const { data, isLoading } = useContacts({ search, estado, vendor_id: 'unassigned', status: '', orcamento: false, orcamento_ano: '', orcamento_mes: '', temperatura: '', sort: 'recente', page })
  const bulkAssign = useBulkAssign()

  const contacts = data?.contacts ?? []
  const total = data?.total ?? 0

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(prev =>
      prev.size === contacts.length ? new Set() : new Set(contacts.map(c => c.id))
    )
  }

  const handleAssign = () => {
    if (!targetVendor || selectedIds.size === 0) return
    bulkAssign.mutate(
      { contactIds: Array.from(selectedIds), vendorId: targetVendor },
      { onSuccess: () => { setSelectedIds(new Set()); setTargetVendor('') } }
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Atribuir Contatos</h1>
        <p className="text-sm text-text-secondary">{formatNumber(total)} contatos sem vendedor</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <form className="flex-1" onSubmit={e => { e.preventDefault(); setSearch(searchInput); setPage(0) }}>
            <Input placeholder="Buscar..." leftIcon={<Search className="h-4 w-4" />}
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          </form>
          <Select options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))} placeholder="Estado"
            value={estado} onChange={e => { setEstado(e.target.value); setPage(0) }} className="lg:w-36" />
        </div>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="p-4 border-brand-200 bg-brand-50">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
            <Badge className="bg-brand-100 text-brand-700 text-sm px-3 py-1">{selectedIds.size} selecionados</Badge>
            <div className="flex items-center gap-2 flex-1">
              <Select options={vendors.map(v => ({ value: v.id, label: v.name }))} placeholder="Vendedor"
                value={targetVendor} onChange={e => setTargetVendor(e.target.value)} className="lg:w-48" />
              <Button variant="primary" size="sm" onClick={handleAssign} loading={bulkAssign.isPending} disabled={!targetVendor}>
                <UserPlus className="h-4 w-4" /> Atribuir
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? <PageLoading /> : (
        <Card className="overflow-hidden">
          <div className="p-3 border-b border-surface-border bg-surface-secondary flex items-center gap-3">
            <button onClick={selectAll} className="p-1">
              {selectedIds.size === contacts.length && contacts.length > 0
                ? <CheckSquare className="h-5 w-5 text-brand-600" />
                : <Square className="h-5 w-5 text-text-muted" />}
            </button>
            <span className="text-xs text-text-muted">Selecionar todos desta pagina</span>
          </div>
          <div className="divide-y divide-surface-border">
            {contacts.map(c => {
              const tel = c.telefone_normalizado || c.phone || ''
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary cursor-pointer"
                  onClick={() => toggleSelect(c.id)}>
                  {selectedIds.has(c.id)
                    ? <CheckSquare className="h-5 w-5 text-brand-600 shrink-0" />
                    : <Square className="h-5 w-5 text-text-muted shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name || '(sem nome)'}</p>
                    <p className="text-xs text-text-muted font-mono">{formatPhone(tel)}</p>
                  </div>
                  {c.state && <Badge className="bg-blue-50 text-blue-700">{c.state}</Badge>}
                </div>
              )
            })}
          </div>
          <div className="p-3 border-t border-surface-border flex items-center justify-between">
            <span className="text-xs text-text-muted">Pagina {page + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <Button size="sm" variant="ghost" disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}>Proxima</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
