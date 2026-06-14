import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Edit3, Search, FileText, Calendar, User, DollarSign, ChevronRight } from 'lucide-react'
import { useOrcamentosGerados, type OrcamentoGerado } from '@/hooks/useOrcamentoBuilder'
import { supabase } from '@/lib/supabase'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Filtro por estágio ATUAL do funil (etiqueta WhatsApp do cliente) — casado pelo telefone
// na RPC propostas_ids_por_categoria. 'aberto' = proposta viva (não vendida/perdida).
const ETIQUETA_PROP_OPCOES: { value: string; label: string }[] = [
  { value: 'aberto',       label: '🟡 Em aberto (não vendido)' },
  { value: 'orcamento',    label: '📄 Orçamento enviado' },
  { value: 'quente',       label: '🔥 Quente / follow-up' },
  { value: 'lead_quente',  label: '🌡️ Lead quente' },
  { value: 'novo',         label: '🆕 Novo (sem mexer)' },
  { value: 'sem_etiqueta', label: '⚪ Sem etiqueta' },
  { value: 'vendido',      label: '✅ Vendido' },
  { value: 'perdido',      label: '❌ Perdido' },
]

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

interface OrcamentoGroup {
  parent: OrcamentoGerado
  alts: OrcamentoGerado[]
}

function OrcamentoRow({ o, isAlt }: { o: OrcamentoGerado; isAlt?: boolean }) {
  const st = STATUS_LABEL[o.status] ?? { label: o.status, class: 'bg-gray-100 text-gray-700' }
  return (
    <tr className={`border-b border-border/60 hover:bg-surface-2/40 ${isAlt ? 'bg-surface-2/20' : ''}`}>
      <td className="px-3 py-2 font-mono font-bold text-accent">
        <span className={`flex items-center gap-1.5 ${isAlt ? 'pl-5' : ''}`}>
          {o.numero}
          {o.versao_alt != null && (
            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300">
              ALT{o.versao_alt}
            </span>
          )}
        </span>
      </td>
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
}

function OrcamentoGroupRow({ group }: { group: OrcamentoGroup }) {
  const [expanded, setExpanded] = useState(false)
  const hasAlts = group.alts.length > 0

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-surface-2/40">
        <td className="px-3 py-2 font-mono font-bold text-accent">
          <span className="flex items-center gap-1.5">
            {hasAlts && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-0.5 rounded hover:bg-surface-3 transition-colors"
                title={expanded ? 'Recolher versões' : `${group.alts.length} versão(ões) alternativa(s)`}
              >
                <ChevronRight className={`h-3.5 w-3.5 text-ink-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
              </button>
            )}
            {group.parent.numero}
            {hasAlts && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                +{group.alts.length} ALT
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-ink-faint" />
            {formatDate(group.parent.data_emissao)}
          </span>
        </td>
        <td className="px-3 py-2 font-medium">
          <span className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-ink-faint shrink-0" />
            {group.parent.cliente_nome || <span className="italic text-ink-faint">[sem nome]</span>}
          </span>
        </td>
        <td className="px-3 py-2 text-ink-muted">{group.parent.vendedor_nome}</td>
        <td className="px-3 py-2 text-right font-bold tabular-nums text-success">
          <span className="flex items-center justify-end gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-ink-faint" />
            {formatBRL(Number(group.parent.total_proposta))}
          </span>
        </td>
        <td className="px-3 py-2">
          {(() => {
            const st = STATUS_LABEL[group.parent.status] ?? { label: group.parent.status, class: 'bg-gray-100 text-gray-700' }
            return (
              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${st.class}`}>
                {st.label}
              </span>
            )
          })()}
        </td>
        <td className="px-3 py-2 text-center">
          <Link
            to={`/orcamentos/montar?id=${group.parent.id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-[12px] font-bold transition"
            title="Abrir e editar este orçamento"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Editar
          </Link>
        </td>
      </tr>
      {expanded && group.alts.map(alt => (
        <OrcamentoRow key={alt.id} o={alt} isAlt />
      ))}
    </>
  )
}

export function OrcamentosSalvos() {
  const { data, isLoading } = useOrcamentosGerados()
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('')
  const [filtroVendedor, setFiltroVendedor] = useState<string>('')
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<string>('')

  // IDs das propostas no estágio de funil selecionado (vem da RPC, casado por telefone).
  const { data: idsEtiqueta } = useQuery({
    queryKey: ['propostas-ids-categoria', filtroEtiqueta],
    queryFn: async (): Promise<Set<number>> => {
      const { data: ids, error } = await supabase.rpc('propostas_ids_por_categoria', { p_categoria: filtroEtiqueta })
      if (error) throw error
      return new Set(((ids ?? []) as number[]).map(Number))
    },
    enabled: !!filtroEtiqueta,
    staleTime: 60_000,
  })

  // Lista de vendedores únicos (pra popular o filtro), ordenada alfabeticamente.
  const vendedores = useMemo(
    () => Array.from(new Set((data ?? []).map(o => (o.vendedor_nome || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [data],
  )

  // Pré-filtra por vendedor vindo da URL (?vendedor=PEDRO, do dashboard), casando por
  // PRIMEIRO nome — os nomes variam aqui ("GUSTAVO", "PEDRO DELA GIUSTINA ").
  const [searchParams] = useSearchParams()
  const vendParam = searchParams.get('vendedor')
  useEffect(() => {
    if (!vendParam || vendedores.length === 0) return
    const alvo = vendParam.trim().split(/\s+/)[0]?.toUpperCase()
    const match = vendedores.find(v => v.split(/\s+/)[0]?.toUpperCase() === alvo)
    if (match) setFiltroVendedor(match)
  }, [vendParam, vendedores])

  // Pré-filtra por etiqueta de funil vinda da URL (?etiqueta=aberto, do dashboard).
  const etqParam = searchParams.get('etiqueta')
  useEffect(() => {
    if (etqParam && ETIQUETA_PROP_OPCOES.some(o => o.value === etqParam)) setFiltroEtiqueta(etqParam)
  }, [etqParam])

  // Group by numero_base: parent rows + ALT sub-rows
  const grouped = useMemo((): OrcamentoGroup[] => {
    if (!data) return []
    const buscaLower = busca.trim().toLowerCase()

    // Filter first
    const filtered = data.filter(o => {
      if (filtroStatus && o.status !== filtroStatus) return false
      if (filtroVendedor && (o.vendedor_nome || '').trim() !== filtroVendedor) return false
      if (filtroEtiqueta && idsEtiqueta && !idsEtiqueta.has(Number(o.id))) return false
      if (buscaLower) {
        const hay = `${o.numero} ${o.cliente_nome} ${o.vendedor_nome} ${o.modelo_basename ?? ''}`.toLowerCase()
        if (!hay.includes(buscaLower)) return false
      }
      return true
    })

    // Group by numero_base
    const map = new Map<string, OrcamentoGroup>()
    const order: string[] = []

    for (const o of filtered) {
      const key = o.numero_base || o.numero
      if (!map.has(key)) {
        map.set(key, { parent: o, alts: [] })
        order.push(key)
      } else {
        const group = map.get(key)!
        if (o.versao_alt == null && group.parent.versao_alt != null) {
          // This is the real parent, swap
          group.alts.push(group.parent)
          group.parent = o
        } else if (o.versao_alt != null) {
          group.alts.push(o)
        } else {
          // Both are non-ALT with same numero_base (shouldn't happen but handle gracefully)
          // Keep the one with earlier date as parent
          if (o.created_at < group.parent.created_at) {
            group.alts.push(group.parent)
            group.parent = o
          } else {
            group.alts.push(o)
          }
        }
      }
    }

    // Sort ALTs within each group by versao_alt
    for (const group of map.values()) {
      group.alts.sort((a, b) => (a.versao_alt ?? 0) - (b.versao_alt ?? 0))
    }

    return order.map(k => map.get(k)!)
  }, [data, busca, filtroStatus, filtroVendedor, filtroEtiqueta, idsEtiqueta])

  const totalCount = data?.length ?? 0

  if (isLoading) return <PageLoading />

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Orçamentos Salvos</h1>
          <p className="text-sm text-text-secondary mt-1">
            {totalCount} orçamento(s) no sistema — clique em <strong>Editar</strong> pra alterar e salvar
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
            placeholder="Buscar numero, cliente, vendedor..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
          />
        </div>
        <select
          value={filtroVendedor}
          onChange={e => setFiltroVendedor(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
          title="Filtrar por vendedor"
        >
          <option value="">Todos vendedores</option>
          {vendedores.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select
          value={filtroEtiqueta}
          onChange={e => setFiltroEtiqueta(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
          title="Filtrar pelo estágio atual do funil (etiqueta WhatsApp do cliente)"
        >
          <option value="">Todas etapas do funil</option>
          {ETIQUETA_PROP_OPCOES.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
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
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-ink-faint">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Nenhum orçamento encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Numero</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Data</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Cliente</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Vendedor</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted">Total</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-ink-muted">Acao</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <OrcamentoGroupRow key={group.parent.id} group={group} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
