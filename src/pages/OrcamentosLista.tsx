import { useState } from 'react'
import { Search, Copy, Check, ChevronLeft, ChevronRight, X, FileText, Filter } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatRelative } from '@/lib/utils'
import {
  useOrcamentosFiles,
  ORCAMENTOS_PAGE_SIZE,
  type OrcamentoFile,
} from '@/hooks/useOrcamentosFiles'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'Em-andamento':         { label: 'Em andamento',           color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'Em-producao':          { label: 'Em produção',            color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Pronto-carregamento':  { label: 'Pronto p/ carregamento', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  'Enviado':              { label: 'Enviado',                color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'Contrato-fechado':     { label: 'Contrato fechado',       color: 'bg-green-50 text-green-700 border-green-200' },
  'Desistiu':             { label: 'Desistiu',               color: 'bg-gray-50 text-gray-600 border-gray-200' },
  'Perdido-concorrente':  { label: 'Perdido p/ concorrente', color: 'bg-red-50 text-red-700 border-red-200' },
  'Proforma':             { label: 'Proforma',               color: 'bg-violet-50 text-violet-700 border-violet-200' },
  'Em-andamento-silos':   { label: 'Em andamento (silos)',   color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'Historico':            { label: 'Histórico',              color: 'bg-stone-50 text-stone-600 border-stone-200' },
}

const STATUS_ALL = Object.keys(STATUS_LABELS)
const ANOS = Array.from({ length: 15 }, (_, i) => String(2026 - i))

// Converte path interno (Z:/foo/bar) pra formato Windows (Z:\foo\bar) — o que cola no Explorer.
function toWindowsPath(p: string): string {
  return p.replace(/\//g, '\\')
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(toWindowsPath(path))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // fallback se clipboard API falhar (raro em https)
      window.prompt('Copie o caminho:', toWindowsPath(path))
    }
  }
  return (
    <button
      onClick={handle}
      title={`Copiar caminho: ${toWindowsPath(path)}`}
      className={`p-1.5 rounded-lg transition-colors ${
        copied
          ? 'bg-green-50 text-green-600'
          : 'text-text-muted hover:bg-surface-tertiary hover:text-text-primary'
      }`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

interface Props {
  // Permite predefinir o filtro de status quando o user clica num card no painel.
  statusInicial?: string
}

export function OrcamentosLista({ statusInicial = '' }: Props) {
  const [filters, setFilters] = useState<{
    search: string
    ano: string
    status: string
    comContato: '' | 'sim' | 'nao'
    page: number
  }>({
    search: '',
    ano: '',
    status: statusInicial,
    comContato: '',
    page: 0,
  })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useOrcamentosFiles(filters)
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / ORCAMENTOS_PAGE_SIZE)

  const hasFilters = filters.search || filters.ano || filters.status || filters.comContato

  const clear = () => {
    setFilters({ search: '', ano: '', status: '', comContato: '', page: 0 })
    setSearchInput('')
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Buscar cliente ou equipamento..."
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            className="lg:w-[420px]"
          />
          <Select
            options={ANOS.map(a => ({ value: a, label: a }))}
            placeholder="Ano"
            value={filters.ano}
            onChange={e => setFilters(f => ({ ...f, ano: e.target.value, page: 0 }))}
            className="lg:w-28"
          />
          <Select
            options={STATUS_ALL.map(s => ({ value: s, label: STATUS_LABELS[s].label }))}
            placeholder="Status"
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 0 }))}
            className="lg:w-56"
          />
          <Select
            options={[{ value: 'sim', label: 'Com contato' }, { value: 'nao', label: 'Sem contato' }]}
            placeholder="Contato"
            value={filters.comContato}
            onChange={e => setFilters(f => ({ ...f, comContato: e.target.value as '' | 'sim' | 'nao', page: 0 }))}
            className="lg:w-40"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
          {searchInput !== filters.search && (
            <Button
              size="sm"
              onClick={() => setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            >
              <Filter className="h-4 w-4" /> Aplicar busca
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              {formatNumber(total)} resultado{total !== 1 ? 's' : ''}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={filters.page === 0}
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-secondary">
                  {filters.page + 1} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={filters.page >= totalPages - 1}
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                >
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
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cliente · Equipamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Ano · Nº</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Formatos</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Modificado</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {rows.map((r: OrcamentoFile) => {
                    const meta = STATUS_LABELS[r.status_kanban] ?? { label: r.status_kanban, color: 'bg-gray-50 text-gray-700 border-gray-200' }
                    return (
                      <tr key={r.id} className="hover:bg-green-50/30 transition-colors">
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-text-muted mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text-primary">
                                {r.cliente}
                                {r.contact_id && (
                                  <Badge className="bg-emerald-50 text-emerald-700 ml-2 text-[10px]">
                                    contato
                                  </Badge>
                                )}
                              </p>
                              {r.equipamento && (
                                <p
                                  className="text-xs text-text-muted truncate max-w-[420px]"
                                  title={r.equipamento + (r.fase_eletrica ? ` (${r.fase_eletrica})` : '')}
                                >
                                  {r.equipamento}
                                  {r.fase_eletrica && <span className="ml-1 text-text-muted">· {r.fase_eletrica}</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-text-secondary tabular-nums">
                          {r.ano} · {r.numero}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={meta.color}>{meta.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(r.extensoes_disponiveis ?? []).map(ext => (
                              <span
                                key={ext}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-tertiary text-text-secondary uppercase"
                              >
                                {ext}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted">
                          {r.mtime_iso ? formatRelative(r.mtime_iso) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <CopyPathButton path={r.path_principal} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                        Nenhum orçamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
