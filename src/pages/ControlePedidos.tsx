import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Search, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react'

const PAGE_SIZE = 50

interface PedidoRow {
  id: string
  pedido_numero: string | null
  numero_orcamento: string | null
  cliente: string | null
  vendedor: string | null
  vendedor_2: string | null
  valor_total: number | null
  ajuste_valor: number | null
  payment_plan_json: { total?: number | string } | null
  status: string | null
  status_pagamento: string | null
  data_venda: string | null
  cidade: string | null
  estado: string | null
}

function valorPedido(p: PedidoRow): number {
  const raw = p.payment_plan_json?.total
  const pt = raw != null ? Number(raw) : 0
  const base = pt > 0 ? pt : Number(p.valor_total) || 0
  return base + (Number(p.ajuste_valor) || 0)
}

const STATUS_BADGE: Record<string, string> = {
  FECHADO: 'bg-green-50 text-green-700 border border-green-200',
  ABERTO: 'bg-blue-50 text-blue-700 border border-blue-200',
  CANCELADO: 'bg-red-50 text-red-700 border border-red-200',
}

function usePedidos(filters: { search: string; status: string; page: number }) {
  return useQuery({
    queryKey: ['controle-pedidos', filters],
    queryFn: async () => {
      let query = supabase
        .from('mirror_pedidos_venda')
        .select('id, pedido_numero, numero_orcamento, cliente, vendedor, vendedor_2, valor_total, ajuste_valor, payment_plan_json, status, status_pagamento, data_venda, cidade, estado', { count: 'exact' })
        .order('data_venda', { ascending: false, nullsFirst: false })

      if (filters.search) {
        query = query.or(`cliente.ilike.%${filters.search}%,pedido_numero.ilike.%${filters.search}%,vendedor.ilike.%${filters.search}%`)
      }
      if (filters.status) query = query.eq('status', filters.status)

      const from = filters.page * PAGE_SIZE
      query = query.range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return { pedidos: (data ?? []) as PedidoRow[], total: count ?? 0 }
    },
    placeholderData: (prev) => prev,
  })
}

export function ControlePedidos() {
  const [filters, setFilters] = useState({ search: '', status: '', page: 0 })
  const [searchInput, setSearchInput] = useState('')
  const { data, isLoading } = usePedidos(filters)

  const pedidos = data?.pedidos ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasFilters = filters.search || filters.status

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <FileText className="h-7 w-7 text-accent" />
          Pedidos de Venda
        </h1>
        <p className="text-sm text-text-muted mt-1">Espelho do controle.branorte.com (somente leitura)</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Buscar por cliente, nº do pedido ou vendedor..."
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            className="lg:w-96"
          />
          <Select
            options={[
              { value: 'ABERTO', label: 'Aberto' },
              { value: 'FECHADO', label: 'Fechado' },
              { value: 'CANCELADO', label: 'Cancelado' },
            ]}
            placeholder="Status"
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 0 }))}
            className="lg:w-40"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setFilters({ search: '', status: '', page: 0 }); setSearchInput('') }}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </Card>

      {isLoading && !data ? <PageLoading /> : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">{total.toLocaleString('pt-BR')} pedido{total !== 1 ? 's' : ''}</p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={filters.page === 0} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-secondary">{filters.page + 1} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={filters.page >= totalPages - 1} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-secondary">
                    <th className="text-left text-xs font-medium text-text-muted px-3 py-3">Data</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Pedido</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cliente</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-3 py-3 w-12">UF</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Valor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {pedidos.map(p => {
                    const dataFmt = p.data_venda ? new Date(p.data_venda + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-'
                    const vendedor = [p.vendedor, p.vendedor_2].filter(Boolean).join(' + ')
                    return (
                      <tr key={p.id} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-3 py-3"><span className="text-xs text-text-muted font-mono whitespace-nowrap">{dataFmt}</span></td>
                        <td className="px-4 py-3"><span className="text-sm font-medium text-text-primary font-mono">{p.pedido_numero || p.numero_orcamento || '-'}</span></td>
                        <td className="px-4 py-3"><span className="text-sm text-text-primary truncate max-w-[220px] block" title={p.cliente || ''}>{p.cliente || '(sem nome)'}</span></td>
                        <td className="px-4 py-3"><span className="text-sm text-text-secondary">{vendedor || '-'}</span></td>
                        <td className="px-3 py-3">{p.estado ? <Badge className="bg-blue-50 text-blue-700 font-mono text-[11px]">{p.estado}</Badge> : <span className="text-xs text-text-muted">-</span>}</td>
                        <td className="px-4 py-3 text-right"><span className="text-sm font-semibold text-text-primary tabular-nums">{valorPedido(p).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</span></td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_BADGE[p.status || ''] || 'bg-surface-tertiary text-text-secondary'}>{p.status || '-'}</Badge>
                        </td>
                      </tr>
                    )
                  })}
                  {pedidos.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">Nenhum pedido encontrado.</td></tr>
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
