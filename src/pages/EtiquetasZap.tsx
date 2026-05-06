import { useMemo, useState } from 'react'
import { Search, Tag, RefreshCw, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Input } from '@/components/ui/Input'
import { formatNumber } from '@/lib/utils'
import { useEtiquetas, groupEtiquetasByVendedor, type WascriptEtiqueta } from '@/hooks/useEtiquetas'

function fmtSyncedAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`
  const diffD = Math.round(diffH / 24)
  return `há ${diffD}d`
}

interface VendedorBlockProps {
  vendedor: string
  etiquetas: WascriptEtiqueta[]
  filterTerm: string
}

function VendedorBlock({ vendedor, etiquetas, filterTerm }: VendedorBlockProps) {
  const total = etiquetas.reduce((s, e) => s + e.total_contatos, 0)
  const lastSync = etiquetas.reduce(
    (max, e) => (e.synced_at > max ? e.synced_at : max),
    etiquetas[0]?.synced_at ?? '',
  )

  const term = filterTerm.trim().toLowerCase()
  const filtered = term
    ? etiquetas.filter(e =>
        e.etiqueta_nome.toLowerCase().includes(term) ||
        e.etiqueta_nome_normalizado.toLowerCase().includes(term),
      )
    : etiquetas

  const max = filtered.reduce((m, e) => Math.max(m, e.total_contatos), 0) || 1

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={vendedor} size="md" />
          <div className="leading-tight min-w-0">
            <h3 className="text-[14px] font-semibold text-ink truncate">{vendedor}</h3>
            <p className="text-[10px] text-ink-faint uppercase tracking-wider mt-0.5">
              {etiquetas.length} etiquetas · {formatNumber(total)} contatos
            </p>
          </div>
        </div>
        {lastSync && (
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 text-ink-faint text-[10px]">
              <RefreshCw className="h-3 w-3" />
              <span>{fmtSyncedAt(lastSync)}</span>
            </div>
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-[12px] text-ink-faint italic py-2">
          {term ? 'Nenhuma etiqueta corresponde ao filtro.' : 'Sem etiquetas.'}
        </p>
      )}

      <div className="space-y-1.5">
        {filtered.map(e => {
          const pct = (e.total_contatos / max) * 100
          return (
            <div key={e.id} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <div className="flex items-center gap-1.5 text-ink min-w-0">
                  <Tag className="h-3 w-3 text-ink-faint shrink-0" />
                  <span className="truncate" title={e.etiqueta_nome}>
                    {e.etiqueta_nome}
                  </span>
                  {e.is_canonica && (
                    <span className="text-[9px] uppercase tracking-wider text-accent bg-accent-bg px-1 py-0.5 rounded shrink-0">
                      canônica
                    </span>
                  )}
                </div>
                <span className="text-[12px] font-semibold tabular-nums text-ink shrink-0">
                  {formatNumber(e.total_contatos)}
                </span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/70 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function EtiquetasZap() {
  const { data, isLoading, error } = useEtiquetas()
  const [filterTerm, setFilterTerm] = useState('')

  const grupos = useMemo(() => {
    if (!data) return [] as { vendedor: string; etiquetas: WascriptEtiqueta[] }[]
    const map = groupEtiquetasByVendedor(data)
    return Array.from(map.entries())
      .map(([vendedor, etiquetas]) => ({ vendedor, etiquetas }))
      .sort((a, b) => {
        const totalA = a.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        const totalB = b.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        return totalB - totalA
      })
  }, [data])

  const totals = useMemo(() => {
    if (!data) return { vendedores: 0, etiquetas: 0, contatos: 0 }
    return {
      vendedores: new Set(data.map(e => e.vendedor_nome)).size,
      etiquetas: data.length,
      contatos: data.reduce((s, e) => s + e.total_contatos, 0),
    }
  }, [data])

  if (isLoading) return <PageLoading />

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6 border-danger/40 bg-danger-bg/10">
          <p className="text-danger font-medium">Erro ao carregar etiquetas</p>
          <p className="text-[12px] text-ink-muted mt-1">{(error as Error).message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink flex items-center gap-2">
            <Tag className="h-4 w-4 text-accent" />
            Etiquetas Zap
          </h1>
          <p className="text-[12px] text-ink-muted mt-0.5">
            Etiquetas do WhatsApp de cada vendedor (sincronizadas via Wascript)
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-faint">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>{totals.vendedores} vendedores</span>
          </div>
          <span className="text-border">·</span>
          <div className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            <span>{totals.etiquetas} etiquetas</span>
          </div>
          <span className="text-border">·</span>
          <span className="tabular-nums">{formatNumber(totals.contatos)} contatos</span>
        </div>
      </header>

      <div className="max-w-md">
        <Input
          leftIcon={<Search className="h-3.5 w-3.5" />}
          placeholder="Filtrar por nome de etiqueta…"
          value={filterTerm}
          onChange={e => setFilterTerm(e.target.value)}
        />
      </div>

      {grupos.length === 0 ? (
        <Card className="p-6">
          <p className="text-ink-muted">Nenhuma etiqueta sincronizada ainda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {grupos.map(g => (
            <VendedorBlock
              key={g.vendedor}
              vendedor={g.vendedor}
              etiquetas={g.etiquetas}
              filterTerm={filterTerm}
            />
          ))}
        </div>
      )}
    </div>
  )
}
