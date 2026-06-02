import { useState, useMemo } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { useControleFinanceiro } from '@/hooks/useControleFinanceiro'
import { Wallet, TrendingDown, CheckCircle2, Search } from 'lucide-react'

type Filtro = 'todos' | 'receber' | 'quitados'
const PAGE_SIZE = 80

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function KpiCard({ title, value, icon: Icon, tone }: { title: string; value: string; icon: typeof Wallet; tone?: 'accent' | 'danger' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{title}</span>
        <Icon className={`h-4 w-4 ${tone === 'danger' ? 'text-red-500' : tone === 'accent' ? 'text-accent' : 'text-text-muted'}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-red-600' : tone === 'accent' ? 'text-accent' : 'text-text-primary'}`}>{value}</p>
    </Card>
  )
}

export function ControleFinanceiro() {
  const { data, isLoading } = useControleFinanceiro()
  const [filtro, setFiltro] = useState<Filtro>('receber')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    let r = data?.rows ?? []
    if (filtro === 'receber') r = r.filter(x => x.aReceber > 0.01)
    else if (filtro === 'quitados') r = r.filter(x => x.aReceber <= 0.01)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x => (x.cliente || '').toLowerCase().includes(q) || (x.pedido_numero || '').toLowerCase().includes(q) || (x.vendedor || '').toLowerCase().includes(q))
    }
    return r
  }, [data, filtro, search])

  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Wallet className="h-7 w-7 text-accent" />
          Financeiro · Recebíveis
        </h1>
        <p className="text-sm text-text-muted mt-1">Espelho do controle.branorte.com · a receber por pedido (devido − pago)</p>
      </div>

      {isLoading && !data ? <PageLoading /> : data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard title="Total Vendido" value={brl(data.totalDevido)} icon={Wallet} />
            <KpiCard title="Recebido" value={brl(data.totalPago)} icon={CheckCircle2} tone="accent" />
            <KpiCard title="A Receber" value={brl(data.totalAReceber)} icon={TrendingDown} tone="danger" />
            <KpiCard title="Pendentes / Quitados" value={`${data.qtdPendentes} / ${data.qtdPagos}`} icon={CheckCircle2} />
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-secondary p-0.5">
                {([['receber', 'A Receber'], ['quitados', 'Quitados'], ['todos', 'Todos']] as [Filtro, string][]).map(([k, l]) => (
                  <button key={k} onClick={() => { setFiltro(k); setPage(0) }}
                    className={`px-3 h-7 text-xs font-medium rounded transition-colors ${filtro === k ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <Input
                placeholder="Buscar cliente, pedido ou vendedor..."
                leftIcon={<Search className="h-4 w-4" />}
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="lg:w-80"
              />
              <span className="text-sm text-text-muted ml-auto">{rows.length.toLocaleString('pt-BR')} pedido{rows.length !== 1 ? 's' : ''}</span>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-secondary">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Pedido</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cliente</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Devido</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Pago</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">A Receber</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Pagamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {pageRows.map(r => (
                    <tr key={r.id} className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-3"><span className="text-sm font-medium text-text-primary font-mono">{r.pedido_numero || '-'}</span></td>
                      <td className="px-4 py-3"><span className="text-sm text-text-primary truncate max-w-[200px] block" title={r.cliente || ''}>{r.cliente || '(sem nome)'}</span></td>
                      <td className="px-4 py-3"><span className="text-sm text-text-secondary">{r.vendedor || '-'}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-sm text-text-primary tabular-nums">{brl(r.devido)}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-sm text-accent tabular-nums">{brl(r.pago)}</span></td>
                      <td className="px-4 py-3 text-right"><span className={`text-sm font-semibold tabular-nums ${r.aReceber > 0.01 ? 'text-red-600' : 'text-text-muted'}`}>{brl(r.aReceber)}</span></td>
                      <td className="px-4 py-3">
                        <Badge className={r.aReceber <= 0.01 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}>
                          {r.status_pagamento || (r.aReceber <= 0.01 ? 'PAGO' : 'PENDENTE')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">Nenhum pedido.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 h-8 text-sm rounded-md border border-surface-border text-text-secondary disabled:opacity-40 hover:bg-surface-secondary">Anterior</button>
              <span className="text-sm text-text-secondary">{page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="px-3 h-8 text-sm rounded-md border border-surface-border text-text-secondary disabled:opacity-40 hover:bg-surface-secondary">Próxima</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
