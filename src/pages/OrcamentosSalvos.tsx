import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Edit3, Search, FileText, Calendar, User, DollarSign } from 'lucide-react'
import { useOrcamentosGerados } from '@/hooks/useOrcamentoBuilder'
import { PageLoading } from '@/components/ui/LoadingSpinner'

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR')
  } catch {
    return iso
  }
}

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  rascunho:  { label: 'Rascunho',  class: 'bg-gray-100 text-gray-700 border-gray-300' },
  enviado:   { label: 'Enviado',   class: 'bg-blue-100 text-blue-700 border-blue-300' },
  aprovado:  { label: 'Aprovado',  class: 'bg-green-100 text-green-700 border-green-300' },
  perdido:   { label: 'Perdido',   class: 'bg-red-100 text-red-700 border-red-300' },
}

export function OrcamentosSalvos() {
  const { data, isLoading } = useOrcamentosGerados()
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('')

  const filtrados = useMemo(() => {
    if (!data) return []
    const buscaLower = busca.trim().toLowerCase()
    return data.filter(o => {
      if (filtroStatus && o.status !== filtroStatus) return false
      if (buscaLower) {
        const hay = `${o.numero} ${o.cliente_nome} ${o.vendedor_nome} ${o.modelo_basename ?? ''}`.toLowerCase()
        if (!hay.includes(buscaLower)) return false
      }
      return true
    })
  }, [data, busca, filtroStatus])

  if (isLoading) return <PageLoading />

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Orçamentos Salvos</h1>
          <p className="text-sm text-text-secondary mt-1">
            {data?.length ?? 0} orçamento(s) no sistema — clique em <strong>Editar</strong> pra alterar e salvar
          </p>
        </div>
        <Link
          to="/orcamentos/montar"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-accent text-white text-[13px] font-bold hover:bg-accent/90 shadow-sm transition-all"
        >
          <FileText className="h-4 w-4" />
          Novo orçamento
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar nº, cliente, vendedor..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
          />
        </div>
        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
        >
          <option value="">Todos status</option>
          <option value="rascunho">Rascunho</option>
          <option value="enviado">Enviado</option>
          <option value="aprovado">Aprovado</option>
          <option value="perdido">Perdido</option>
        </select>
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="text-center py-12 text-ink-faint">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Nenhum orçamento encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Nº</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Data</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Cliente</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Vendedor</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted">Total</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-ink-muted">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(o => {
                const st = STATUS_LABEL[o.status] ?? { label: o.status, class: 'bg-gray-100 text-gray-700' }
                return (
                  <tr key={o.id} className="border-b border-border/60 hover:bg-surface-2/40">
                    <td className="px-3 py-2 font-mono font-bold text-accent">{o.numero}</td>
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-ink-faint" />
                        {formatDate(o.data_emissao)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-ink-faint shrink-0" />
                        {o.cliente_nome || <span className="italic text-ink-faint">[sem nome]</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{o.vendedor_nome}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-success">
                      <span className="flex items-center justify-end gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 text-ink-faint" />
                        {formatBRL(Number(o.total_proposta))}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${st.class}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Link
                        to={`/orcamentos/montar?id=${o.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-[12px] font-bold transition"
                        title="Abrir e editar este orçamento"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Editar
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
