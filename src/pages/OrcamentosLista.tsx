import { useState } from 'react'
import { Search, Copy, Check, ChevronLeft, ChevronRight, X, FileText, Filter } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber, formatRelative } from '@/lib/utils'

/**
 * Normaliza e formata qualquer phone bruto pra padrão +55 (DD) XXXXX-XXXX.
 * Se não conseguir interpretar como BR, retorna { display: raw, copyable: rawDigits, isBR: false }.
 */
function normalizeBRPhone(raw: string | null | undefined): { display: string; copyable: string; isBR: boolean } | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length === 0) return null
  // Se 13 dígitos e começa com 55 → BR completo
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4), mid = digits.slice(4, 9), end = digits.slice(9)
    return { display: `+55 (${ddd}) ${mid}-${end}`, copyable: `+${digits}`, isBR: true }
  }
  // 12 dígitos com 55 (faltando 9 do celular) → insere 9
  if (digits.length === 12 && digits.startsWith('55')) {
    const fixed = digits.slice(0, 4) + '9' + digits.slice(4)
    const ddd = fixed.slice(2, 4), mid = fixed.slice(4, 9), end = fixed.slice(9)
    return { display: `+55 (${ddd}) ${mid}-${end}`, copyable: `+${fixed}`, isBR: true }
  }
  // 11 dígitos sem 55 → assume BR celular (DDD+9+8)
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2), mid = digits.slice(2, 7), end = digits.slice(7)
    return { display: `+55 (${ddd}) ${mid}-${end}`, copyable: `+55${digits}`, isBR: true }
  }
  // 10 dígitos sem 55 → BR fixo OU celular antigo sem 9 (insere 9)
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2), rest = digits.slice(2)
    const fixed = '9' + rest  // assume celular faltando 9
    return { display: `+55 (${ddd}) ${fixed.slice(0, 5)}-${fixed.slice(5)}`, copyable: `+55${ddd}${fixed}`, isBR: true }
  }
  // Não interpretável como BR → mostra raw, copiable só dígitos
  return { display: raw, copyable: digits, isBR: false }
}

function StatusEditable({ orcamento, effectiveStatus }: { orcamento: OrcamentoFile; effectiveStatus: string }) {
  const [open, setOpen] = useState(false)
  const updateMut = useUpdateOrcamentoStatus()
  const meta = STATUS_LABELS[effectiveStatus] ?? { label: effectiveStatus, color: 'bg-gray-50 text-gray-700 border-gray-200' }
  const isManual = !!orcamento.status_manual

  const change = (newStatus: string | null) => {
    setOpen(false)
    updateMut.mutate({ id: orcamento.id, status: newStatus })
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        title={isManual ? `Definido manualmente (cancele pra voltar ao kanban da pasta)` : `Status auto da pasta · clique pra mudar manualmente`}
        className="inline-flex items-center"
      >
        <Badge className={`${meta.color} cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-offset-bg hover:ring-current/30 transition-all ${isManual ? 'border-dashed' : ''}`}>
          {meta.label}
          {isManual && <span className="ml-1 text-[9px] opacity-70">✎</span>}
        </Badge>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-48 rounded-md border border-surface-border bg-bg shadow-lg py-1 max-h-72 overflow-auto">
            {STATUS_ALL.map(s => (
              <button
                key={s}
                onClick={() => change(s)}
                disabled={updateMut.isPending}
                className={`w-full text-left text-xs px-3 py-1.5 hover:bg-surface-2 transition-colors ${effectiveStatus === s ? 'bg-accent-bg text-accent font-medium' : ''}`}
              >
                {STATUS_LABELS[s]?.label ?? s}
              </button>
            ))}
            {isManual && (
              <>
                <div className="border-t border-surface-border my-1" />
                <button
                  onClick={() => change(null)}
                  className="w-full text-left text-xs px-3 py-1.5 text-text-muted hover:bg-surface-2 transition-colors"
                >
                  Voltar ao auto (pasta)
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function CopyContatoButton({ value, ariaLabel, onCopy }: { value: string; ariaLabel: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false)
  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopy?.()
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt(ariaLabel, value)
    }
  }
  return (
    <button
      onClick={handle}
      title={copied ? 'Copiado!' : `Copiar ${value}`}
      className={`p-1 rounded hover:bg-surface-tertiary transition-colors ${
        copied ? 'text-green-600' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
import {
  useOrcamentosFiles,
  useUpdateOrcamentoStatus,
  ORCAMENTOS_PAGE_SIZE,
  type OrcamentoFile,
} from '@/hooks/useOrcamentosFiles'
import { useVendorMap } from '@/hooks/useVendorMap'
import { useVendors } from '@/hooks/useVendors'
import { useAuth } from '@/hooks/useAuth'
import { useOrcamentosChamados } from '@/hooks/useOrcamentosChamados'

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
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

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
    mes: string
    vendor_id: string
    comContato: '' | 'sim' | 'nao'
    page: number
  }>({
    search: '',
    ano: '',
    mes: '',
    vendor_id: '',
    comContato: '',
    page: 0,
  })
  const [searchInput, setSearchInput] = useState('')

  // Suprime warning de prop não usada (statusInicial herdado de versão anterior)
  void statusInicial

  const { data, isLoading } = useOrcamentosFiles(filters)
  const vendorMap = useVendorMap()
  const { data: vendorsData } = useVendors()
  const { chamados, marcar, desmarcar } = useOrcamentosChamados()
  const { profile } = useAuth()
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / ORCAMENTOS_PAGE_SIZE)

  // Vendor só vê seu nome no filtro; admin vê todos
  const isVendor = profile?.role === 'vendor'
  const vendorOpts = isVendor && profile?.vendor_id
    ? (vendorsData ?? []).filter(v => v.id === profile.vendor_id)
    : (vendorsData ?? [])
  const vendorSelectOptions = [
    { value: 'unassigned', label: 'Sem vendedor' },
    ...vendorOpts.map(v => ({ value: v.id, label: v.name })),
  ]

  const hasFilters = filters.search || filters.ano || filters.mes || filters.vendor_id || filters.comContato

  const clear = () => {
    setFilters({ search: '', ano: '', mes: '', vendor_id: '', comContato: '', page: 0 })
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
            onChange={e => setFilters(f => ({ ...f, ano: e.target.value, mes: '', page: 0 }))}
            className="lg:w-28"
          />
          <Select
            options={MESES.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))}
            placeholder="Mês"
            value={filters.mes}
            onChange={e => setFilters(f => ({
              ...f,
              mes: e.target.value,
              // Se selecionou Mês sem Ano, assume ano atual
              ano: e.target.value && !f.ano ? String(new Date().getFullYear()) : f.ano,
              page: 0,
            }))}
            className="lg:w-28"
          />
          <Select
            options={vendorSelectOptions}
            placeholder="Vendedor"
            value={filters.vendor_id}
            onChange={e => setFilters(f => ({ ...f, vendor_id: e.target.value, page: 0 }))}
            className="lg:w-44"
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
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">A/C</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Contato</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Ano · Nº</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Formatos</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Modificado</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {rows.map((r: OrcamentoFile) => {
                    // Status efetivo: manual override > kanban-de-pasta
                    const effectiveStatus = r.status_manual ?? r.status_kanban
                    const meta = STATUS_LABELS[effectiveStatus] ?? { label: effectiveStatus, color: 'bg-gray-50 text-gray-700 border-gray-200' }
                    const jaChamado = chamados.has(r.id)
                    return (
                      <tr key={r.id} className={`transition-colors ${jaChamado ? 'bg-green-50/60 hover:bg-green-100/60 dark:bg-green-900/30 dark:hover:bg-green-900/40' : 'hover:bg-green-50/30 dark:hover:bg-green-900/15'}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-text-muted mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-text-primary">
                                {r.cliente}
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
                        <td className="px-4 py-3">
                          {r.docx_ac ? (
                            <span className="text-sm text-text-secondary">{r.docx_ac}</span>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const phone = normalizeBRPhone(r.docx_phone || r.docx_phone_normalizado)
                            if (!phone) return <span className="text-xs text-text-muted">—</span>
                            return (
                              <div className="flex items-center gap-1">
                                <span className={`text-xs font-mono tabular-nums ${phone.isBR ? 'text-text-secondary' : 'text-text-muted'}`}>
                                  {phone.display}
                                </span>
                                <CopyContatoButton
                                  value={phone.copyable}
                                  ariaLabel="Copiar telefone:"
                                  onCopy={() => marcar(r.id)}
                                />
                                {jaChamado && (
                                  <button
                                    onClick={e => { e.stopPropagation(); desmarcar(r.id) }}
                                    title="Desmarcar como chamado"
                                    className="p-0.5 rounded text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-800/50 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-text-secondary tabular-nums">
                          {r.ano} · {r.numero}
                        </td>
                        <td className="px-4 py-3">
                          {r.vendor_id && vendorMap[r.vendor_id] ? (
                            <span className="text-sm text-text-secondary">{vendorMap[r.vendor_id]}</span>
                          ) : r.vendor_raw ? (
                            <span className="text-xs text-text-muted italic" title="Não mapeado a vendedor cadastrado">{r.vendor_raw}</span>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusEditable orcamento={r} effectiveStatus={effectiveStatus} />
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
                      <td colSpan={9} className="px-4 py-8 text-center text-text-muted">
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
