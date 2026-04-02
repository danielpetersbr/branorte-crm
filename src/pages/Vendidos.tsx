import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatPhone, whatsappLink } from '@/lib/utils'
import { useVendorMap } from '@/hooks/useVendorMap'
import { useVendors } from '@/hooks/useVendors'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, CheckCircle, FileText } from 'lucide-react'
import type { Contact } from '@/types'

const PAGE_SIZE = 50
const currentYear = new Date().getFullYear()
const ANOS = Array.from({ length: currentYear - 2018 }, (_, i) => String(currentYear - i))
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function getOrcamento(origin: string | null): string | null {
  if (!origin) return null
  const match = origin.match(/^Orcamento\s+(.+)$/)
  return match ? match[1] : null
}

function useSoldContacts(filters: { search: string; vendor_id: string; ano: string; mes: string; page: number }) {
  return useQuery({
    queryKey: ['vendidos', filters],
    queryFn: async () => {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('status', 'FECHADO')
        .like('origin', 'Orcamento%')
        .order('updated_at', { ascending: false })

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,descricao_orcamento.ilike.%${filters.search}%`)
      }
      if (filters.vendor_id) query = query.eq('vendor_id', filters.vendor_id)
      if (filters.ano) {
        query = query.like('origin', `Orcamento ${filters.ano}-%`)
      }
      if (filters.ano && filters.mes) {
        const m = Number(filters.mes)
        const month = String(m).padStart(2, '0')
        const yr = Number(filters.ano)
        const nextMonth = m === 12 ? `${yr + 1}-01-01` : `${yr}-${String(m + 1).padStart(2, '0')}-01`
        query = query.gte('data_orcamento', `${yr}-${month}-01`).lt('data_orcamento', nextMonth)
      }

      const from = filters.page * PAGE_SIZE
      query = query.range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return { contacts: (data ?? []) as Contact[], total: count ?? 0 }
    },
    placeholderData: (prev) => prev,
  })
}

function useSoldStats() {
  return useQuery({
    queryKey: ['vendidos-stats'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'FECHADO')
        .like('origin', 'Orcamento%')
      if (error) throw error
      return count ?? 0
    },
  })
}

export function Vendidos() {
  const [filters, setFilters] = useState({ search: '', vendor_id: '', ano: '', mes: '', page: 0 })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useSoldContacts(filters)
  const { data: totalSold } = useSoldStats()
  const { data: vendorsData } = useVendors()
  const vendorMap = useVendorMap()

  const contacts = data?.contacts ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = filters.search || filters.vendor_id || filters.ano || filters.mes

  const clearFilters = () => {
    setFilters({ search: '', vendor_id: '', ano: '', mes: '', page: 0 })
    setSearchInput('')
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <CheckCircle className="h-7 w-7 text-green-600" />
            Vendidos
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {totalSold != null ? (
              <><span className="font-semibold text-green-600">{totalSold.toLocaleString('pt-BR')}</span> vendas fechadas</>
            ) : 'Carregando...'}
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Buscar por nome, telefone ou produto..."
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            className="lg:w-96"
          />
          <Select
            options={(vendorsData ?? []).map(v => ({ value: v.id, label: v.name }))}
            placeholder="Vendedor"
            value={filters.vendor_id}
            onChange={e => setFilters(f => ({ ...f, vendor_id: e.target.value, page: 0 }))}
            className="lg:w-44"
          />
          <Select
            options={ANOS.map(y => ({ value: y, label: y }))}
            placeholder="Ano"
            value={filters.ano}
            onChange={e => setFilters(f => ({ ...f, ano: e.target.value, mes: '', page: 0 }))}
            className="lg:w-24"
          />
          {filters.ano && (
            <Select
              options={MESES.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="Mês"
              value={filters.mes}
              onChange={e => setFilters(f => ({ ...f, mes: e.target.value, page: 0 }))}
              className="lg:w-24"
            />
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-4 w-4" /> Limpar</Button>
          )}
        </div>
      </Card>

      {isLoading ? <PageLoading /> : (
        <div className="space-y-4">
          {/* Results count */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              {total.toLocaleString('pt-BR')} resultado{total !== 1 ? 's' : ''}
              {filters.ano && <span className="ml-1 font-medium text-text-secondary">em {filters.ano}</span>}
              {filters.mes && <span className="ml-1 font-medium text-text-secondary">/ {MESES[Number(filters.mes) - 1]}</span>}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={filters.page === 0}
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-secondary">{filters.page + 1} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={filters.page >= totalPages - 1}
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-secondary">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Nome</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Telefone</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Orçamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Produto</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {contacts.map(c => {
                    const isOrcPhone = (c.phone || '').startsWith('ORC-')
                    const tel = isOrcPhone ? '' : (c.telefone_normalizado || c.phone || '')
                    const orc = getOrcamento(c.origin)
                    return (
                      <tr key={c.id} className="hover:bg-green-50/30 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">{c.name || '(sem nome)'}</span>
                          {c.state && <Badge className="bg-blue-50 text-blue-700 ml-2">{c.state}</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary font-mono">{tel ? formatPhone(tel) : '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">{(c.vendor_id ? vendorMap[c.vendor_id] : null) ?? '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {orc && (
                            <Badge className="bg-green-50 text-green-700 border border-green-200 w-fit">
                              <CheckCircle className="h-3 w-3" /> {orc}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-text-muted truncate max-w-[250px] block" title={c.descricao_orcamento || ''}>
                            {c.descricao_orcamento || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {tel && (
                              <>
                                <a href={whatsappLink(tel)} target="_blank" rel="noopener"
                                  className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors">
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                                <a href={`tel:${tel}`}
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
                  {contacts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                        Nenhum resultado encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
