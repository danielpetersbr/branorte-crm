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
import { useContactsOrcamentos } from '@/hooks/useContactsOrcamentos'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, CheckCircle, FileText } from 'lucide-react'
import { ESTADOS_BR } from '@/types'
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

function useSoldContacts(filters: { search: string; vendor_id: string; estado: string; ano: string; mes: string; page: number }) {
  return useQuery({
    queryKey: ['vendidos', filters],
    queryFn: async () => {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('status', 'FECHADO')
        .or('origin.ilike.Orcamento%,origin.ilike.Orçamento%')
        .order('origin', { ascending: false })

      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,descricao_orcamento.ilike.%${filters.search}%`)
      }
      if (filters.vendor_id) query = query.eq('vendor_id', filters.vendor_id)
      if (filters.estado) query = query.eq('state', filters.estado)
      if (filters.ano) {
        // Cruza com orcamentos_files: pega contact_ids que têm orçamento neste ano
        // (eventualmente filtrando por mês via mtime_iso).
        let orcQ = supabase
          .from('orcamentos_files')
          .select('contact_id')
          .eq('ano', Number(filters.ano))
          .not('contact_id', 'is', null)
          .limit(10000)
        if (filters.mes) {
          const m = Number(filters.mes)
          const month = String(m).padStart(2, '0')
          const yr = Number(filters.ano)
          const nextYr = m === 12 ? yr + 1 : yr
          const nextM = m === 12 ? '01' : String(m + 1).padStart(2, '0')
          orcQ = orcQ
            .gte('mtime_iso', `${yr}-${month}-01T00:00:00Z`)
            .lt('mtime_iso', `${nextYr}-${nextM}-01T00:00:00Z`)
        }
        const { data: orcRows, error: orcErr } = await orcQ
        if (orcErr) throw orcErr
        const idsSet = new Set<string>()
        for (const r of (orcRows ?? []) as { contact_id: string | null }[]) {
          if (r.contact_id) idsSet.add(r.contact_id)
        }
        const ids = Array.from(idsSet)
        if (ids.length === 0) {
          return { contacts: [], total: 0 }
        }
        query = query.in('id', ids)
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
  const [filters, setFilters] = useState({ search: '', vendor_id: '', estado: '', ano: '', mes: '', page: 0 })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useSoldContacts(filters)
  const { data: totalSold } = useSoldStats()
  const { data: vendorsData } = useVendors()
  const vendorMap = useVendorMap()

  const contacts = data?.contacts ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const contactIds = contacts.map(c => c.id)
  const { data: orcamentosMap } = useContactsOrcamentos(contactIds)
  const hasFilters = filters.search || filters.vendor_id || filters.estado || filters.ano || filters.mes

  const clearFilters = () => {
    setFilters({ search: '', vendor_id: '', estado: '', ano: '', mes: '', page: 0 })
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
            options={ESTADOS_BR.map(e => ({ value: e, label: e }))}
            placeholder="Estado"
            value={filters.estado}
            onChange={e => setFilters(f => ({ ...f, estado: e.target.value, page: 0 }))}
            className="lg:w-24"
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
                    const phoneStr = c.phone || ''
                    const placeholder = phoneStr.startsWith('ORC-') || phoneStr.startsWith('AUTO-')
                    const tel = placeholder ? '' : (c.telefone_normalizado || c.phone || '')
                    const orc = getOrcamento(c.origin)
                    const orcsLinkados = orcamentosMap?.get(c.id) ?? []
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
                          {orcsLinkados.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge
                                className="bg-green-50 text-green-700 border border-green-200 w-fit"
                                title={`${orcsLinkados[0].cliente} · ${orcsLinkados[0].path_principal}`}
                              >
                                <CheckCircle className="h-3 w-3" /> {orcsLinkados[0].ano}-{orcsLinkados[0].numero}
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
                            <Badge className="bg-green-50 text-green-700 border border-green-200 w-fit">
                              <CheckCircle className="h-3 w-3" /> {orc}
                            </Badge>
                          ) : null}
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
