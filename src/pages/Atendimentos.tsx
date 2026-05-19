import { useEffect, useState } from 'react'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, Flame, AlarmClock, CheckCircle2, Inbox, Trash2, Calendar, Hand, ListChecks, MessageSquareDot, EyeOff, UserPlus, RefreshCw, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { StatusVendedorPicker } from '@/components/StatusVendedorPicker'
import { AtribuirVendedorPicker } from '@/components/AtribuirVendedorPicker'
import { StatusDot } from '@/components/ui/StatusDot'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatPhone, whatsappLink, formatRelative, formatNumber, formatDateTimeShort, estadoNome } from '@/lib/utils'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'
import { ESTADOS_BR } from '@/types'
import { ATENDIMENTO_PAGE_SIZE, STATUS_REAL_VALUES, type StatusReal } from '@/types/atendimento'
import { useAtendimentos, useAtendimentoKpis, useAtendimentoResponsaveis, useDeleteAtendimento, useWaLabelsByPhones, lookupWaLabels, type DataPreset } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'

const DATA_PRESETS: { value: DataPreset; label: string }[] = [
  { value: 'hoje',  label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',    label: 'Últimos 7 dias' },
  { value: '30d',   label: 'Últimos 30 dias' },
  { value: 'mes',   label: 'Este mês' },
]

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral'

const STATUS_TONE: Record<StatusReal, { tone: Tone; label: string }> = {
  'Vendido':              { tone: 'success', label: 'Vendido' },
  'Em-andamento':         { tone: 'info',    label: 'Em andamento' },
  'Aguardando-Vendedor':  { tone: 'warning', label: 'Aguardando' },
  'Abandonado':           { tone: 'neutral', label: 'Abandonado' },
  'Sem-Resposta':         { tone: 'danger',  label: 'Sem resposta' },
  'Perdido':              { tone: 'danger',  label: 'Perdido' },
}

// Coluna "Tipo de Ração" — agora exibe formulação (o_que_precisa) ao invés de consumo/revenda
const FINALIDADE_TONE: Record<string, Tone> = {
  // Formulações (Ana V16.22)
  'ração completa':       'info',
  'proteinado':           'warning',
  'sal mineral':           'accent',
  'postura':              'info',
  'corte':                'warning',
  'ração':                'info',
  // Legacy (consumo/revenda — backwards compat)
  'Fábrica para consumo':  'info',
  'Fábrica para vender':   'warning',
  'Fábrica para revenda':  'warning',
  'Consumo e vender':      'success',
}

const QUANDO_TONE: Record<string, Tone> = {
  'Agora':              'danger',
  'Em até 3 meses':     'warning',
  'Estou pesquisando':  'neutral',
}

const MOTIVO_TONE: Record<string, Tone> = {
  'Montar uma Fábrica': 'success',
  'Só um equipamento':  'info',
  'Outros assuntos':    'neutral',
  // Raw values vindas da Ana V16.22 (caso de webhook antigo que ainda não rodou v23)
  'fabrica_racao':      'success',
  'equipamento':        'info',
}

// Humaniza valores raw que vêm da Ana V16.22 caso o webhook não tenha traduzido
function humanizeMotivo(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim()
  if (s === 'fabrica_racao' || s === 'fábrica_ração') return 'Montar uma Fábrica'
  if (s === 'equipamento') return 'Só um equipamento'
  return raw
}

function humanizeTipoRacao(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim()
  // Finalidade (legacy) — humanize underscores
  if (s === 'consumo_proprio' || s === 'consumo_próprio') return 'Consumo próprio'
  if (s === 'revenda') return 'Revenda'
  if (s === 'misto') return 'Consumo e revenda'
  return raw
}

function humanizeQuando(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim()
  if (s === 'agora') return 'Agora'
  if (s === 'pesquisando' || s === 'estou pesquisando') return 'Estou pesquisando'
  if (s === 'em até 3 meses' || s === 'em ate 3 meses') return 'Em até 3 meses'
  return raw
}

// Empty cell estilizada — mais discreta
function EmptyCell() {
  return <span className="text-[11px] text-ink-faint/40">—</span>
}

function isHotLead(quando: string | null): boolean {
  return quando === 'Agora'
}

function isFreshLead(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const minutesAgo = (Date.now() - new Date(dateStr).getTime()) / 60000
  return minutesAgo < 30
}

interface PerfilFabricaCellProps {
  finalidade: string | null
  quantos: string | null
  capacidade: string | null
  quando: string | null
}

function PerfilFabricaCell({ finalidade, quantos, capacidade, quando }: PerfilFabricaCellProps) {
  if (!finalidade && !quantos && !capacidade && !quando) {
    return <EmptyCell />
  }
  return (
    <div className="flex flex-col gap-1 min-w-[170px]">
      {finalidade && (
        <Badge className={`bg-${FINALIDADE_TONE[finalidade] ?? 'neutral'}-bg text-${FINALIDADE_TONE[finalidade] ?? 'neutral'} self-start`}
               style={{ background: `hsl(var(--${FINALIDADE_TONE[finalidade] ?? 'surface-2'}-bg))`, color: `hsl(var(--${FINALIDADE_TONE[finalidade] ?? 'ink-muted'}))` }}>
          {finalidade}
        </Badge>
      )}
      {(quantos || capacidade) && (
        <span className="text-[11px] text-ink-muted leading-tight tabular-nums">
          {[quantos && `${quantos} animais`, capacidade].filter(Boolean).join(' · ')}
        </span>
      )}
      {quando && (
        <Badge style={{ background: `hsl(var(--${QUANDO_TONE[quando] ?? 'surface-2'}-bg))`, color: `hsl(var(--${QUANDO_TONE[quando] ?? 'ink-muted'}))` }}
               className="self-start gap-1">
          {quando === 'Agora' && <Flame className="h-2.5 w-2.5" />}
          {quando === 'Em até 3 meses' && <AlarmClock className="h-2.5 w-2.5" />}
          {quando}
        </Badge>
      )}
    </div>
  )
}

interface KpiCardProps {
  label: string
  value: number
  hero?: boolean
  tone?: Tone
  icon?: typeof Flame
  hint?: string
}

function KpiCard({ label, value, hero, tone = 'neutral', icon: Icon, hint }: KpiCardProps) {
  const accentClass: Record<Tone, string> = {
    success: 'before:bg-success',
    warning: 'before:bg-warning',
    danger:  'before:bg-danger',
    info:    'before:bg-info',
    accent:  'before:bg-accent',
    neutral: 'before:bg-border',
  }
  // Gradiente sutil + hover lift pra dar profundidade
  const gradientStyle = tone !== 'neutral'
    ? {
        background: `linear-gradient(135deg, hsl(var(--surface)) 0%, hsl(var(--surface)) 60%, hsl(var(--${tone}-bg)) 100%)`,
      }
    : undefined
  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-surface border border-border ${hero ? 'p-5' : 'p-4'}
                  before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accentClass[tone]}
                  transition-all duration-200 hover:border-${tone === 'neutral' ? 'border' : tone}/40
                  hover:shadow-lg hover:shadow-${tone === 'neutral' ? 'black' : tone}/5 hover:-translate-y-0.5`}
      style={gradientStyle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-semibold ${tone === 'neutral' ? 'text-ink-faint' : `text-${tone}`}`}
             style={{ color: tone !== 'neutral' ? `hsl(var(--${tone}))` : undefined }}>
            {label}
          </p>
          <p className={`mt-1 font-bold tabular-nums tracking-tight text-ink ${hero ? 'text-3xl' : 'text-2xl'}`}>
            {formatNumber(value)}
          </p>
          {hint && <p className="text-[11px] text-ink-faint mt-0.5 leading-tight">{hint}</p>}
        </div>
        {Icon && (
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110
                          ${tone === 'neutral' ? 'bg-surface-2' : ''}`}
               style={tone !== 'neutral' ? {
                 background: `hsl(var(--${tone}-bg))`,
                 color: `hsl(var(--${tone}))`,
                 boxShadow: `inset 0 0 0 1px hsl(var(--${tone}) / 0.15)`,
               } : undefined}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  )
}

interface SyncIndicatorProps {
  isFetching: boolean
  dataUpdatedAt: number
  error: Error | null
  onRefetch: () => void
}

function SyncIndicator({ isFetching, dataUpdatedAt, error, onRefetch }: SyncIndicatorProps) {
  // Re-renderiza a cada 5s pra atualizar o "há Xs"
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const ageMs = dataUpdatedAt ? Date.now() - dataUpdatedAt : null
  const ageLabel = ageMs == null
    ? '—'
    : ageMs < 5000  ? 'agora'
    : ageMs < 60000 ? `${Math.floor(ageMs/1000)}s atrás`
    : ageMs < 3600000 ? `${Math.floor(ageMs/60000)}min atrás`
    : `${Math.floor(ageMs/3600000)}h atrás`

  // Vermelho se >2min sem atualizar (algo travou)
  const isStale = ageMs != null && ageMs > 2 * 60_000
  const isError = !!error

  let cls = 'border-border bg-surface text-ink-muted'
  let dot = 'bg-emerald-500'
  if (isError) { cls = 'border-red-500/40 bg-red-500/5 text-red-300'; dot = 'bg-red-500' }
  else if (isStale) { cls = 'border-amber-500/40 bg-amber-500/5 text-amber-300'; dot = 'bg-amber-500' }
  else if (isFetching) { dot = 'bg-blue-400 animate-pulse' }

  return (
    <div className={`flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-md border ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {isError ? (
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          erro: {error.message.slice(0, 60)}
        </span>
      ) : (
        <span>{isFetching ? 'atualizando…' : `atualizado ${ageLabel}`}</span>
      )}
      <button
        onClick={onRefetch}
        title="Forçar atualização"
        className="ml-1 hover:text-ink transition-colors"
      >
        <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}

export function Atendimentos() {
  const [filters, setFilters] = useState<{
    search: string
    responsavel: string
    status_real: string
    uf: string
    data: DataPreset
    page: number
  }>({
    search: '',
    responsavel: '',
    status_real: '',
    uf: '',
    data: '',
    page: 0,
  })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading, isFetching, dataUpdatedAt, error: atendimentosError, refetch } = useAtendimentos(filters)
  const { data: kpis } = useAtendimentoKpis(filters)
  const { data: responsaveis } = useAtendimentoResponsaveis()
  // Etiquetas WA por telefone — fetcha em paralelo aos atendimentos
  const phonesAtuais = (data?.rows ?? []).map(r => r.telefone)
  const { data: waLabelsMap } = useWaLabelsByPhones(phonesAtuais)
  const deleteMut = useDeleteAtendimento()
  const { profile } = useAuth()
  const { data: vendorsData } = useVendors()
  // Nome de exibição do vendedor logado para gravar em auditoria.responsavel.
  const myVendorName = profile?.vendor_id
    ? (vendorsData ?? []).find(v => v.id === profile.vendor_id)?.name
    : (profile?.display_name || profile?.email?.split('@')[0])

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / ATENDIMENTO_PAGE_SIZE)
  const hasFilters = filters.search || filters.responsavel || filters.status_real || filters.uf || filters.data

  // Resolve o "vendedor efetivo" do lead. Prioridade:
  // 1. auditoria.responsavel (atribuido manualmente no CRM)
  // 2. wa_chat_labels.vendedor (lead esta no WhatsApp de um vendedor com etiqueta)
  // Returns { name, source } ou null. 'source=wa' indica origem WhatsApp
  // (vendedor ja esta atendendo no Zap mas ninguem clicou "Pegar pra mim" no CRM)
  function vendedorEfetivo(r: typeof rows[number]): { name: string; source: 'crm' | 'wa' } | null {
    if (r.responsavel && r.responsavel.trim()) return { name: r.responsavel, source: 'crm' }
    const labels = lookupWaLabels(waLabelsMap, r.telefone)
    const vendedorFromWa = labels.find(l => l.vendedor)?.vendedor
    if (vendedorFromWa) return { name: vendedorFromWa, source: 'wa' }
    return null
  }

  const clearFilters = () => {
    setFilters({ search: '', responsavel: '', status_real: '', uf: '', data: '', page: 0 })
    setSearchInput('')
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink tracking-tight leading-none">
              Atendimentos
            </h1>
            {kpis && kpis.quentes > 0 && (
              <Badge className="gap-1 px-2 py-0.5" style={{ background: 'hsl(var(--danger-bg))', color: 'hsl(var(--danger))' }}>
                <Flame className="h-3 w-3" />
                <span className="text-[11px] font-semibold">{kpis.quentes} quente{kpis.quentes !== 1 ? 's' : ''}</span>
              </Badge>
            )}
          </div>
          <p className="text-[13px] text-ink-muted mt-1.5">
            {kpis ? (
              <>
                <span className="font-semibold text-ink tabular-nums">{formatNumber(kpis.total)}</span>
                <span className="text-ink-faint"> conversas · 1 por cliente · atualização automática</span>
              </>
            ) : 'Carregando...'}
          </p>
        </div>
        <SyncIndicator
          isFetching={isFetching}
          dataUpdatedAt={dataUpdatedAt}
          error={atendimentosError as Error | null}
          onRefetch={() => refetch()}
        />
      </div>

      {/* KPIs - hierarquia: 3 hero + 4 small */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
          <KpiCard label="Pra pegar" value={kpis.paraPegar}     hero tone="warning"
                   icon={UserPlus}  hint={kpis.paraPegar === 0 ? 'Fila vazia' : 'Sem vendedor — puxe!'} />
          <KpiCard label="Hoje"     value={kpis.hoje}          hero tone="accent"
                   icon={Calendar}  hint={kpis.hoje === 0 ? 'Nenhum lead hoje' : 'leads novos'} />
          <KpiCard label="Quentes"  value={kpis.quentes}       hero tone="danger"
                   icon={Flame}     hint={kpis.quentes ? 'Quer comprar agora' : undefined} />
          <KpiCard label="Não engajaram"      value={kpis.naoEngajaram}    tone="neutral"  icon={EyeOff}            hint="nem começou o bot" />
          <KpiCard label="Em andamento"       value={kpis.emAndamento}     tone="warning"  icon={MessageSquareDot}  hint="no meio do fluxo" />
          <KpiCard label="Clicaram botão"     value={kpis.clicaramBotao}   tone="success"  icon={Hand}              hint="completaram fluxo" />
          <KpiCard label="Qualificados"       value={kpis.qualificados}    tone="info"     icon={ListChecks}        hint="dados completos" />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
          <input
            placeholder="Buscar nome ou telefone..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            className="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-[13px]
                       focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all
                       placeholder:text-ink-faint"
          />
        </div>
        <Select
          options={DATA_PRESETS.map(p => ({ value: p.value, label: p.label }))}
          placeholder="Qualquer data"
          value={filters.data}
          onChange={e => setFilters(f => ({ ...f, data: e.target.value as DataPreset, page: 0 }))}
          className="lg:w-44"
        />
        <Select
          options={(responsaveis ?? []).map(r => ({ value: r, label: r }))}
          placeholder="Vendedor"
          value={filters.responsavel}
          onChange={e => setFilters(f => ({ ...f, responsavel: e.target.value, page: 0 }))}
          className="lg:w-44"
        />
        <Select
          options={STATUS_REAL_VALUES.map(s => ({ value: s, label: STATUS_TONE[s].label }))}
          placeholder="Status"
          value={filters.status_real}
          onChange={e => setFilters(f => ({ ...f, status_real: e.target.value, page: 0 }))}
          className="lg:w-40"
        />
        <Select
          options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
          placeholder="UF"
          value={filters.uf}
          onChange={e => setFilters(f => ({ ...f, uf: e.target.value, page: 0 }))}
          className="lg:w-24"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Limpar
          </Button>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <PageLoading />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-ink-faint tabular-nums">
              {formatNumber(total)} resultado{total !== 1 ? 's' : ''}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={filters.page === 0}
                        onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-[12px] text-ink-muted tabular-nums px-2">
                  {filters.page + 1} / {totalPages}
                </span>
                <Button variant="ghost" size="sm" disabled={filters.page >= totalPages - 1}
                        onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* ─── MOBILE: cards verticais ─── */}
          <div className="md:hidden space-y-2">
            {rows.map(r => {
              const tel = (r.telefone || '').replace(/\D/g, '')
              const uf = ufFromTelefone(r.telefone)
              const isHot = isHotLead(r.quando_investir ?? null)
              // isFresh removido
              const status = STATUS_TONE[r.status_real]
              const ids = (r.auditoria_ids && r.auditoria_ids.length > 0) ? r.auditoria_ids : [r.id]
              const isFechado = !!r.finished_at
              // Trata "(sem nome)" do webhook como nome vazio pra UI ficar consistente
              const nomeReal = r.nome && !/^\(sem nome\)$/i.test(r.nome.trim()) ? r.nome : null
              return (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${
                    isHot
                      ? 'bg-danger-bg/40 border-danger/30'
                      : 'bg-surface border-border'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-ink truncate">
                            {nomeReal ?? (
                              <span className="text-ink-faint italic font-normal">
                                {tel ? `+${tel.slice(-4)}` : 'Sem nome'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-faint font-mono tabular-nums mt-0.5">
                            {tel ? formatPhone(tel) : '—'}
                            {uf && uf !== '—' && uf !== 'INTL' && (
                              <span className="ml-1.5 px-1 rounded bg-surface-2 text-ink-muted">{uf}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-ink-faint shrink-0 mt-0.5">
                          {formatRelative(r.last_message_at ?? r.primeira_data ?? r.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {status && (
                          <Badge style={{
                            background: `hsl(var(--${status.tone}-bg))`,
                            color: `hsl(var(--${status.tone}))`,
                          }} className="text-[10px]">{status.label}</Badge>
                        )}
                        {isHot && (
                          <span className="text-[10px] font-semibold text-danger inline-flex items-center gap-0.5">
                            <Flame className="h-3 w-3" />Quente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                    {(() => {
                      const v = vendedorEfetivo(r)
                      if (v) return (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Avatar name={v.name} size="sm" />
                          <span className="text-[12px] text-ink-muted truncate">{v.name}</span>
                          {v.source === 'wa' && (
                            <span title="Etiqueta no WhatsApp do vendedor" className="text-[9px] px-1 py-px rounded bg-success-bg/40 text-success font-mono">WA</span>
                          )}
                        </div>
                      )
                      return <div className="flex-1"><AtribuirVendedorPicker auditoriaIds={ids} /></div>
                    })()}
                    <div className="flex items-center gap-1 shrink-0">
                      {tel && (
                        <a
                          href={whatsappLink(tel)}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir WhatsApp"
                          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-success hover:bg-success-bg"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {rows.length === 0 && (
              <Card className="p-8 text-center">
                <Inbox className="h-6 w-6 text-ink-faint mx-auto mb-2" />
                <p className="text-[13px] text-ink-muted">Nenhum atendimento encontrado</p>
                {hasFilters && (
                  <button onClick={clearFilters} className="text-[12px] text-accent hover:underline mt-2">
                    Limpar filtros
                  </button>
                )}
              </Card>
            )}
          </div>

          {/* ─── DESKTOP: tabela completa ─── */}
          <Card className="hidden md:block overflow-hidden p-0">
            <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-surface backdrop-blur-sm">
                  <tr className="border-b border-border bg-surface-2/40 [&>th]:text-left [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:font-bold [&>th]:text-ink-muted [&>th]:px-2 [&>th]:py-3 [&>th]:whitespace-nowrap">
                    <th>Chegou</th>
                    <th>Lead</th>
                    <th className="hidden md:table-cell">Estado</th>
                    <th>Telefone</th>
                    <th className="hidden lg:table-cell">Origem</th>
                    <th className="hidden 2xl:table-cell">Criativo</th>
                    <th className="hidden lg:table-cell">Motivo</th>
                    <th className="hidden 2xl:table-cell" title="Tipo de ração que o cliente quer produzir (ou equipamento)">Tipo de Ração</th>
                    <th className="hidden xl:table-cell">Animal</th>
                    <th className="hidden xl:table-cell">Qtd</th>
                    <th className="hidden lg:table-cell">Momento</th>
                    <th className="hidden xl:table-cell" title="Etiqueta atribuída no WhatsApp do vendedor">Etiqueta WA</th>
                    <th className="hidden 2xl:table-cell" title="Cliente clicou no botão FALAR COM CONSULTOR">Botão</th>
                    <th>Vendedor</th>
                    <th className="!text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const tel = (r.telefone || '').replace(/\D/g, '')
                    const uf = ufFromTelefone(r.telefone)
                    const criativoNome = r.criativo_facebook?.nome_oficial || r.criativo_facebook?.headline
                    const isHot = isHotLead(r.quando_investir ?? null)
                    // isFresh removido
                    const finTone = r.finalidade_fabrica ? FINALIDADE_TONE[r.finalidade_fabrica] : null
                    const quandoTone = r.quando_investir ? QUANDO_TONE[r.quando_investir] : null
                    // Trata "(sem nome)" do webhook como nome vazio (UI fallback fica consistente)
                    const nomeReal = r.nome && !/^\(sem nome\)$/i.test(r.nome.trim()) ? r.nome : null
                    return (
                      <tr key={r.id}
                          className={`group border-b border-border/30 last:border-0 transition-all duration-150
                                     ${isHot
                                        ? 'bg-danger-bg/30 hover:bg-danger-bg/50'
                                        : 'odd:bg-surface even:bg-surface-2/20 hover:bg-surface-2/60 hover:shadow-sm'}`}
                          style={isHot ? { boxShadow: 'inset 3px 0 0 0 hsl(var(--danger))' } : undefined}>
                        {/* CHEGOU */}
                        <td className="px-3 py-2.5 whitespace-nowrap" title={r.primeira_data ?? r.created_at ?? ''}>
                          <span className="text-[11px] text-ink-muted font-mono tabular-nums">
                            {formatDateTimeShort(r.primeira_data ?? r.created_at)}
                          </span>
                        </td>
                        {/* LEAD */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center min-w-[170px]">
                            <div className="leading-tight">
                              <span className="text-[13px] font-medium text-ink">
                                {nomeReal ?? (
                                  <span className="text-ink-faint italic font-normal">
                                    {tel ? `+${tel.slice(-4)}` : 'Sem nome'}
                                  </span>
                                )}
                              </span>
                              {isHot && (
                                <span className="block text-[10px] font-medium text-danger mt-0.5">
                                  <Flame className="inline h-2.5 w-2.5 mr-0.5" /> Lead quente
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* ESTADO */}
                        <td className="hidden md:table-cell px-2 py-2.5 whitespace-nowrap">
                          {uf && uf !== '—' && uf !== 'INTL' ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted">
                                {uf}
                              </span>
                              <span className="text-[12px] text-ink-muted">{estadoNome(uf)}</span>
                            </div>
                          ) : (() => {
                            const pais = paisDoTelefone(r.telefone)
                            if (!pais) return <EmptyCell />
                            return (
                              <div className="flex items-center gap-1.5" title="Lead internacional">
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info/10 text-info">
                                  {pais.sigla}
                                </span>
                                <span className="text-[12px] text-ink-muted">{pais.nome}</span>
                              </div>
                            )
                          })()}
                        </td>
                        {/* TELEFONE */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="text-[12px] text-ink-muted font-mono tabular-nums">
                            {tel ? formatPhone(tel) : '—'}
                          </span>
                        </td>
                        {/* ORIGEM */}
                        <td className="hidden lg:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.origem ? (() => {
                            const o = r.origem.toLowerCase()
                            const tone =
                              o.includes('whatsapp') ? 'success' :
                              o.includes('instagram') ? 'danger' :
                              o.includes('site') || o.includes('web') ? 'info' :
                              o.includes('facebook') ? 'info' :
                              'neutral'
                            return (
                              <Badge style={{
                                background: `hsl(var(--${tone}-bg))`,
                                color: `hsl(var(--${tone}))`,
                              }}>
                                {r.origem}
                              </Badge>
                            )
                          })() : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* CRIATIVO */}
                        <td className="hidden 2xl:table-cell px-2 py-2.5">
                          {r.criativo_codigo || criativoNome ? (
                            <div className="flex items-center gap-1.5 min-w-0 max-w-[200px]">
                              {r.criativo_codigo && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted shrink-0">
                                  {r.criativo_codigo}
                                </span>
                              )}
                              {criativoNome && (
                                <span className="text-[11px] text-ink-faint truncate" title={criativoNome}>
                                  {criativoNome}
                                </span>
                              )}
                            </div>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* MOTIVO DO CONTATO */}
                        <td className="hidden lg:table-cell px-2 py-2.5 whitespace-nowrap">
                          {(() => {
                            const motivo = humanizeMotivo(r.motivo_contato)
                            if (!motivo) return <EmptyCell />
                            const tone = MOTIVO_TONE[r.motivo_contato!] ?? MOTIVO_TONE[motivo] ?? 'neutral'
                            return (
                              <Badge style={{
                                background: `hsl(var(--${tone}-bg))`,
                                color: `hsl(var(--${tone}))`,
                              }}>
                                {motivo}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* TIPO DE RAÇÃO (ou equipamento) — Ana V16.22 não pergunta finalidade,
                            pergunta o TIPO (ração completa, proteinado, sal mineral, postura, corte) */}
                        <td className="hidden 2xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {(() => {
                            const rawTipo = r.o_que_precisa || r.finalidade_fabrica
                            const tipo = humanizeTipoRacao(rawTipo)
                            if (!tipo) return <EmptyCell />
                            const tone = FINALIDADE_TONE[rawTipo!] ?? FINALIDADE_TONE[tipo] ?? 'neutral'
                            return (
                              <Badge style={{
                                background: `hsl(var(--${tone}-bg))`,
                                color: `hsl(var(--${tone}))`,
                              }} className="capitalize">
                                {tipo}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* ANIMAL */}
                        <td className="hidden xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.qual_animal ? (
                            <span className="text-[12px] text-ink-muted">{r.qual_animal}</span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* QTD */}
                        <td className="hidden xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.quantos_animais ? (
                            <span className="text-[12px] text-ink-muted tabular-nums">{r.quantos_animais}</span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* MOMENTO DE COMPRA */}
                        <td className="hidden lg:table-cell px-2 py-2.5 whitespace-nowrap">
                          {(() => {
                            const quando = humanizeQuando(r.quando_investir)
                            if (!quando) return <EmptyCell />
                            const tone = QUANDO_TONE[r.quando_investir!] ?? QUANDO_TONE[quando] ?? 'neutral'
                            return (
                              <Badge style={{
                                background: `hsl(var(--${tone}-bg))`,
                                color: `hsl(var(--${tone}))`,
                              }} className="gap-1">
                                {quando === 'Agora' && <Flame className="h-2.5 w-2.5" />}
                                {quando === 'Em até 3 meses' && <AlarmClock className="h-2.5 w-2.5" />}
                                {quando}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* ETIQUETA WA — sincronizada do WhatsApp do vendedor */}
                        <td className="hidden xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {(() => {
                            const labels = lookupWaLabels(waLabelsMap, r.telefone)
                            if (labels.length === 0) return <EmptyCell />
                            return (
                              <div className="flex flex-wrap gap-1 max-w-[180px]">
                                {labels.slice(0, 3).map(l => (
                                  <Badge
                                    key={l.id}
                                    className="text-[10px] font-semibold"
                                    style={{
                                      background: 'rgba(16,185,129,0.12)',
                                      color: '#10b981',
                                      border: '1px solid rgba(16,185,129,0.3)',
                                    }}
                                    title={`${l.name}${l.vendedor ? ` (${l.vendedor})` : ''}`}
                                  >
                                    {l.name}
                                  </Badge>
                                ))}
                                {labels.length > 3 && (
                                  <span className="text-[10px] text-ink-faint">+{labels.length - 3}</span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        {/* TOCOU NO BOTAO */}
                        <td className="hidden 2xl:table-cell px-2 py-2.5 whitespace-nowrap" title={r.tocou_botao_em ? `Em ${formatRelative(r.tocou_botao_em)}` : ''}>
                          {r.tocou_botao_em ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Sim
                            </span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* VENDEDOR — fallback de wa_chat_labels quando responsavel vazio */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {(() => {
                            const ids = (r.auditoria_ids && r.auditoria_ids.length > 0) ? r.auditoria_ids : [r.id]
                            const v = vendedorEfetivo(r)
                            if (v) {
                              return (
                                <div className="flex items-center gap-1.5">
                                  <Avatar name={v.name} size="sm" />
                                  <span className="text-[12px] text-ink-muted">{v.name}</span>
                                  {v.source === 'wa' && (
                                    <span title="Vendedor identificado por etiqueta no WhatsApp dele (ainda nao 'pego' formalmente no CRM)" className="text-[9px] px-1 py-px rounded bg-success-bg/40 text-success font-mono">WA</span>
                                  )}
                                </div>
                              )
                            }
                            // Lead sem vendedor (nem CRM nem WA): dropdown (admin) ou "Pegar pra mim"
                            return <AtribuirVendedorPicker auditoriaIds={ids} />
                          })()}
                        </td>
                        {/* AÇÕES */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {(() => {
                            const ids = (r.auditoria_ids && r.auditoria_ids.length > 0) ? r.auditoria_ids : [r.id]
                            return (
                              <div className="inline-flex items-center gap-1">
                                {/* EXCLUIR */}
                                <button
                                  type="button"
                                  disabled={deleteMut.isPending}
                                  onClick={() => {
                                    const label = r.nome || r.telefone || 'lead'
                                    if (window.confirm(`Excluir lead "${label}"?\n\nEssa ação remove ${ids.length} ${ids.length === 1 ? 'registro' : 'registros'} do banco. Não pode ser desfeita.`)) {
                                      deleteMut.mutate(ids)
                                    }
                                  }}
                                  title="Excluir lead"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-faint/60 hover:text-danger hover:bg-danger-bg transition-all"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={16} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center">
                            <Inbox className="h-5 w-5 text-ink-faint" />
                          </div>
                          <p className="text-[13px] text-ink-muted font-medium">Nenhum atendimento encontrado</p>
                          {hasFilters && (
                            <button onClick={clearFilters} className="text-[12px] text-accent hover:underline">
                              Limpar filtros
                            </button>
                          )}
                        </div>
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
