import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Phone, Flame, X, AlertCircle, BarChart3 } from 'lucide-react'
import { useAtendimentosFunil, useAtendimentoResponsaveis, useUpdateStatusVendedor, type DataPreset } from '@/hooks/useAtendimentos'
import { STATUS_VENDEDOR_VALUES, STATUS_VENDEDOR_MAP, type StatusVendedor, type Atendimento } from '@/types/atendimento'
import { ESTADOS_BR } from '@/types'
import { ufFromTelefone } from '@/lib/ddd-uf'
import { Avatar } from '@/components/ui/Avatar'

const DATE_PRESETS: { value: DataPreset; label: string }[] = [
  { value: '',     label: 'Tudo' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',   label: '7 dias' },
  { value: '30d',  label: '30 dias' },
  { value: 'mes',  label: 'Este mês' },
]

interface ColMeta {
  key: 'sem_atribuir' | StatusVendedor
  label: string
  emoji: string
  bg: string
}

// 8 colunas: 1 inicial "sem atribuir" + 7 status do vendedor
const COLUNAS: ColMeta[] = [
  { key: 'sem_atribuir', label: 'Sem atribuir', emoji: '⚪', bg: 'hsl(240 5% 30%)' },
  ...STATUS_VENDEDOR_VALUES.map(s => ({
    key: s,
    label: STATUS_VENDEDOR_MAP[s].label,
    emoji: STATUS_VENDEDOR_MAP[s].emoji,
    bg: STATUS_VENDEDOR_MAP[s].bg,
  })),
]

function colunaDoLead(a: Atendimento): ColMeta['key'] {
  if (!a.responsavel || a.responsavel.trim() === '' || a.responsavel === 'a definir') {
    return 'sem_atribuir'
  }
  const status = (a as Atendimento & { status_vendedor?: StatusVendedor | null }).status_vendedor
  if (!status) return 'atendendo'
  if (STATUS_VENDEDOR_VALUES.includes(status)) return status
  return 'atendendo'
}

export function Funil() {
  const [filters, setFilters] = useState({ search: '', responsavel: '', uf: '', data: '' as DataPreset })
  const [searchInput, setSearchInput] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const { data: rows, isLoading, error } = useAtendimentosFunil(filters)
  const { data: vendedores } = useAtendimentoResponsaveis()
  const updateStatus = useUpdateStatusVendedor()

  const grouped = useMemo(() => {
    const map = new Map<ColMeta['key'], Atendimento[]>()
    COLUNAS.forEach(c => map.set(c.key, []))
    for (const r of (rows ?? [])) {
      const k = colunaDoLead(r)
      map.get(k)?.push(r)
    }
    return map
  }, [rows])

  const totalLeads = rows?.length ?? 0
  const hasFilters = !!filters.search || !!filters.responsavel || !!filters.uf || !!filters.data

  const onDragStart = (id: string) => setDraggingId(id)
  const onDragEnd = () => setDraggingId(null)

  const onDropOnColuna = (col: ColMeta['key'], lead: Atendimento) => {
    setDraggingId(null)
    if (col === 'sem_atribuir') return
    const auditoriaIds = (lead.auditoria_ids && lead.auditoria_ids.length > 0) ? lead.auditoria_ids : [lead.id]
    const currentCol = colunaDoLead(lead)
    if (currentCol === col) return
    updateStatus.mutate({ auditoria_ids: auditoriaIds, status: col as StatusVendedor })
  }

  return (
    <div className="px-4 lg:px-6 py-5 space-y-4 h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight leading-tight">Funil de vendas</h1>
          <p className="text-[13px] text-ink-muted mt-0.5">
            <span className="font-medium text-ink tabular-nums">{totalLeads}</span>
            <span className="text-ink-faint"> leads · arraste pra mover entre colunas</span>
          </p>
        </div>
        <Link
          to="/funil/relatorio"
          className="text-[12px] text-ink-muted hover:text-ink inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border hover:border-border-strong transition-colors"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Relatório por vendedor
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input
            type="search"
            placeholder="Buscar nome ou telefone..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setFilters(f => ({ ...f, search: searchInput })) }}
            onBlur={() => setFilters(f => ({ ...f, search: searchInput }))}
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
          />
        </div>

        <select
          value={filters.responsavel}
          onChange={e => setFilters(f => ({ ...f, responsavel: e.target.value }))}
          className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink"
        >
          <option value="">Vendedor</option>
          {(vendedores ?? []).map(v => (<option key={v} value={v}>{v}</option>))}
        </select>

        <select
          value={filters.uf}
          onChange={e => setFilters(f => ({ ...f, uf: e.target.value }))}
          className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink"
        >
          <option value="">UF</option>
          {ESTADOS_BR.map(uf => (<option key={uf} value={uf}>{uf}</option>))}
        </select>

        <div className="flex gap-1.5 flex-wrap">
          {DATE_PRESETS.map(p => {
            const active = filters.data === p.value
            return (
              <button
                key={p.value}
                onClick={() => setFilters(f => ({ ...f, data: p.value }))}
                className={
                  'h-9 px-3 rounded-md text-[12px] font-medium border transition-colors ' +
                  (active
                    ? 'bg-accent-bg text-accent border-accent/30'
                    : 'bg-surface text-ink-muted border-border hover:text-ink hover:border-border-strong')
                }
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {hasFilters && (
          <button
            onClick={() => { setFilters({ search: '', responsavel: '', uf: '', data: '' }); setSearchInput('') }}
            className="h-9 px-3 inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-danger"
          >
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>

      {error && (
        <div className="border border-danger/30 bg-danger-bg rounded-md p-3 text-[12px] text-danger flex items-center gap-2 shrink-0">
          <AlertCircle className="h-4 w-4" /> Erro ao carregar leads.
        </div>
      )}

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden -mx-4 lg:-mx-6 px-4 lg:px-6 pb-2 min-h-0">
        <div className="flex gap-3 h-full">
          {COLUNAS.map(col => {
            const items = grouped.get(col.key) ?? []
            const fechouValor = col.key === 'fechou'
              ? items.reduce((s, x) => s + (x.orcamento_valor ?? 0), 0)
              : 0
            return (
              <div
                key={col.key}
                onDragOver={e => { if (col.key !== 'sem_atribuir' && draggingId) e.preventDefault() }}
                onDrop={e => {
                  e.preventDefault()
                  const id = draggingId
                  if (!id) return
                  const lead = (rows ?? []).find(r => r.id === id)
                  if (lead) onDropOnColuna(col.key, lead)
                }}
                className={
                  'w-[260px] shrink-0 flex flex-col rounded-lg bg-surface border border-border ' +
                  (draggingId && col.key !== 'sem_atribuir' ? 'ring-1 ring-accent/30' : '')
                }
              >
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: col.bg }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] uppercase tracking-widest font-semibold truncate block" style={{ color: col.bg }}>
                      {col.emoji} {col.label}
                    </span>
                    {col.key === 'fechou' && fechouValor > 0 && (
                      <p className="text-[10px] text-accent font-mono tabular-nums">
                        R$ {fechouValor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded bg-surface-2 text-ink-faint font-mono shrink-0">
                    {items.length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
                  {items.length === 0 && (
                    <div className="text-center py-4 text-[11px] text-ink-faint italic">vazio</div>
                  )}
                  {items.map(lead => (
                    <LeadCard key={lead.id} lead={lead} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {isLoading && totalLeads === 0 && (
        <div className="text-center py-8 text-ink-faint text-[12px]">Carregando…</div>
      )}
    </div>
  )
}

// ============================================================================
function LeadCard({ lead, onDragStart, onDragEnd }: {
  lead: Atendimento
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  const phone = (lead.telefone || '').trim()
  const ufNome = phone ? ufFromTelefone(phone) : ''
  const criativo = lead.criativo_codigo
  const criativoNome = lead.criativo_facebook?.nome_oficial ?? lead.criativo_facebook?.headline
  const isQuente = (lead.quando_investir ?? '').toLowerCase().includes('agora')
  const ageMs = lead.last_message_at ? Date.now() - new Date(lead.last_message_at).getTime() : 0
  const isFresh = ageMs < 12 * 3600_000

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(lead.id)
      }}
      onDragEnd={onDragEnd}
      className="bg-surface-2 border border-border rounded-md p-2.5 cursor-grab active:cursor-grabbing hover:border-border-strong transition-colors space-y-1.5"
    >
      <div className="flex items-start gap-2">
        <Avatar name={lead.nome ?? '?'} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-ink truncate">
              {lead.nome ?? <span className="italic text-ink-faint">sem nome</span>}
            </span>
            {isQuente && <Flame className="h-3 w-3 text-danger shrink-0" />}
            {isFresh && <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shrink-0" />}
          </div>
          {phone && (
            <div className="flex items-center gap-1 text-[10px] text-ink-faint mt-0.5 font-mono">
              <Phone className="h-2.5 w-2.5" />
              <span className="truncate">{phone}</span>
              {ufNome && <span className="ml-auto px-1 rounded bg-surface text-ink-muted">{ufNome}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-ink-faint">
        {lead.responsavel && (
          <span className="text-ink-muted truncate">{lead.responsavel}</span>
        )}
        {criativo && (
          <span className="ml-auto font-mono text-info truncate" title={criativoNome ?? ''}>
            {criativo}
          </span>
        )}
      </div>

      {(lead.qual_animal || lead.quantos_animais || lead.capacidade_producao) && (
        <div className="text-[10px] text-ink-muted truncate border-t border-border pt-1">
          {[lead.qual_animal, lead.quantos_animais, lead.capacidade_producao].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
}
