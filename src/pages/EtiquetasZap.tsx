import { useMemo, useState } from 'react'
import { Search, Tag, RefreshCw, Users, Handshake } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Input } from '@/components/ui/Input'
import { formatNumber } from '@/lib/utils'
import { useEtiquetas, groupEtiquetasByVendedor, type WascriptEtiqueta } from '@/hooks/useEtiquetas'
import { classificarEtiquetas, CATEGORIA_META, type EtiquetaCategoria } from '@/lib/etiquetas-classify'

// Vendedores esperados na integração Wascript. Mostra card mesmo sem etiquetas.
const VENDEDORES_ESPERADOS = ['EDILSON JR', 'PEDRO', 'JARDEL', 'EDER', 'ALVARO', 'RAMON', 'GUSTAVO', 'DANIEL']

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

// Ordem de exibição do dashboard (em negociação primeiro, mortos por último)
const CATEGORIAS_ORDEM: EtiquetaCategoria[] = ['novo', 'quente', 'orcamento', 'vendido', 'morto', 'outros']

interface DashboardProps {
  data: WascriptEtiqueta[] | undefined
}

function DashboardEtiquetas({ data }: DashboardProps) {
  const resumo = useMemo(() => classificarEtiquetas(data), [data])

  const negociacao = resumo.porCategoria.novo + resumo.porCategoria.quente + resumo.porCategoria.orcamento
  const total = resumo.totalContatos

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Big card: Em negociação */}
        <Card className="p-4 md:col-span-1 border-accent/30 bg-accent-bg/20">
          <div className="flex items-center gap-2 text-accent text-[11px] uppercase tracking-wider font-medium">
            <Handshake className="h-3.5 w-3.5" />
            <span>Em negociação</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-bold text-ink tabular-nums">{formatNumber(negociacao)}</span>
            <span className="text-[12px] text-ink-muted">contatos</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1">
            Novos + Quentes + Orçamento
          </p>
          {total > 0 && (
            <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${(negociacao / total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-[10px] text-ink-faint mt-1 tabular-nums">
            {total > 0 ? `${Math.round((negociacao / total) * 100)}% de ${formatNumber(total)} totais` : '—'}
          </p>
        </Card>

        {/* Health score */}
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-faint font-medium">
            Saúde do funil
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-[28px] font-bold tabular-nums ${
              resumo.scoreSaude >= 60 ? 'text-success' : resumo.scoreSaude >= 30 ? 'text-warning' : 'text-danger'
            }`}>
              {resumo.scoreSaude}
            </span>
            <span className="text-[12px] text-ink-muted">/ 100</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1">
            (Vivos + Vendidos) / Total
          </p>
          <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                resumo.scoreSaude >= 60 ? 'bg-success' : resumo.scoreSaude >= 30 ? 'bg-warning' : 'bg-danger'
              }`}
              style={{ width: `${resumo.scoreSaude}%` }}
            />
          </div>
        </Card>

        {/* Vendidos destaque */}
        <Card className="p-4 border-success/30 bg-success-bg/10">
          <div className="flex items-center gap-2 text-success text-[11px] uppercase tracking-wider font-medium">
            <span>{CATEGORIA_META.vendido.emoji}</span>
            <span>Vendidos</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[28px] font-bold text-ink tabular-nums">{formatNumber(resumo.porCategoria.vendido)}</span>
            <span className="text-[12px] text-ink-muted">contatos</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1">
            Fecharam — somatório de todos os vendedores
          </p>
          {total > 0 && (
            <div className="mt-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{ width: `${(resumo.porCategoria.vendido / total) * 100}%` }}
              />
            </div>
          )}
          <p className="text-[10px] text-ink-faint mt-1 tabular-nums">
            {total > 0 ? `${Math.round((resumo.porCategoria.vendido / total) * 100)}% de conversão` : '—'}
          </p>
        </Card>
      </div>

      {/* Por categoria — barra empilhada + grid */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold text-ink uppercase tracking-wider">
            Distribuição por categoria
          </h3>
          <span className="text-[11px] text-ink-faint tabular-nums">
            {formatNumber(total)} contatos no total
          </span>
        </div>

        {/* Barra empilhada horizontal */}
        {total > 0 && (
          <div className="flex h-6 rounded-md overflow-hidden border border-border mb-3">
            {CATEGORIAS_ORDEM.map(cat => {
              const v = resumo.porCategoria[cat]
              if (v === 0) return null
              const pct = (v / total) * 100
              const meta = CATEGORIA_META[cat]
              const colorMap: Record<EtiquetaCategoria, string> = {
                novo: 'bg-info',
                quente: 'bg-warning',
                orcamento: 'bg-accent',
                vendido: 'bg-success',
                morto: 'bg-danger',
                outros: 'bg-ink-faint',
              }
              return (
                <div
                  key={cat}
                  className={`${colorMap[cat]} flex items-center justify-center text-[10px] font-medium text-white transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${meta.label}: ${formatNumber(v)} (${pct.toFixed(1)}%)`}
                >
                  {pct >= 6 && `${pct.toFixed(0)}%`}
                </div>
              )
            })}
          </div>
        )}

        {/* Grid de cards por categoria */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {CATEGORIAS_ORDEM.map(cat => {
            const v = resumo.porCategoria[cat]
            const meta = CATEGORIA_META[cat]
            const pct = total > 0 ? (v / total) * 100 : 0
            return (
              <div key={cat} className={`rounded-md p-2.5 ${meta.bgClass}`}>
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium">
                  <span>{meta.emoji}</span>
                  <span className={meta.textClass}>{meta.label}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className={`text-[18px] font-bold tabular-nums ${meta.textClass}`}>
                    {formatNumber(v)}
                  </span>
                  <span className="text-[10px] text-ink-faint tabular-nums">
                    {pct > 0 ? `${pct.toFixed(0)}%` : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
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
          {term
            ? 'Nenhuma etiqueta corresponde ao filtro.'
            : etiquetas.length === 0
              ? 'Sem etiquetas configuradas no WhatsApp ou token desconectado.'
              : 'Sem etiquetas.'}
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
    const map = data ? groupEtiquetasByVendedor(data) : new Map<string, WascriptEtiqueta[]>()
    // Une vendedores que vieram da query com a lista esperada (garante que GUSTAVO/DANIEL apareçam)
    const nomes = new Set<string>([...map.keys(), ...VENDEDORES_ESPERADOS.map(v => v.toUpperCase())])
    return Array.from(nomes)
      .map(vendedor => ({ vendedor, etiquetas: map.get(vendedor) ?? [] }))
      .sort((a, b) => {
        const totalA = a.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        const totalB = b.etiquetas.reduce((s, e) => s + e.total_contatos, 0)
        return totalB - totalA
      })
  }, [data])

  const totals = useMemo(() => {
    return {
      vendedores: grupos.length,
      etiquetas: grupos.reduce((s, g) => s + g.etiquetas.length, 0),
      contatos: grupos.reduce((s, g) => s + g.etiquetas.reduce((ss, e) => ss + e.total_contatos, 0), 0),
    }
  }, [grupos])

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

      <DashboardEtiquetas data={data} />

      <div className="max-w-md pt-2">
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
