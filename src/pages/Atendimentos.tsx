import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, Flame, AlarmClock, CheckCircle2, Inbox, Trash2, Calendar, Hand, ListChecks, MessageSquareDot, EyeOff, UserPlus, RefreshCw, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { StatusVendedorPicker } from '@/components/StatusVendedorPicker'
import { CriativoHoverBadge } from '@/components/CriativoHoverBadge'
import { PhoneCopyButton } from '@/components/PhoneCopyButton'
import { AtribuirVendedorPicker } from '@/components/AtribuirVendedorPicker'
import { StatusDot } from '@/components/ui/StatusDot'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatPhone, whatsappLink, formatRelative, formatNumber, formatDateTimeShort, estadoNome } from '@/lib/utils'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'
import { ESTADOS_BR } from '@/types'
import { ATENDIMENTO_PAGE_SIZE, STATUS_REAL_VALUES, type StatusReal } from '@/types/atendimento'
import { useAtendimentos, useAtendimentoKpis, useAtendimentoOrigens, useAtendimentoResponsaveis, useDeleteAtendimento, useWaLabelsByPhones, lookupWaLabels, useOrcamentosPorTelefone, lookupOrcamento, useVendasPorTelefone, lookupVenda, useSemRespostaPorTelefone, lookupSemResposta, type DataPreset } from '@/hooks/useAtendimentos'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'

function normalizarAnimal(v: string): string {
  const s = v.toLowerCase().replace(/[^\w\sáéíóúâêîôûãõç]/g, '').trim()
  if (/bovin|gado|boi|vaca|nelore|angus/.test(s)) return 'Bovinos'
  if (/su[ií]n|porco|leita/.test(s)) return 'Suínos'
  if (/ave|frango|galinha|poedeira|pinto/.test(s)) return 'Aves'
  if (/equin|cavalo|[ée]gua/.test(s)) return 'Equinos'
  if (/capr|cabr|ovino|ovelha|bode/.test(s)) return 'Caprinos/Ovinos'
  if (/peix|piscicult|til[aá]pia/.test(s)) return 'Peixes'
  if (/misto|diversos|v[aá]rios|tudo/.test(s)) return 'Diversos'
  if (s === 'null') return ''
  return v
}

const DATA_PRESETS: { value: DataPreset; label: string }[] = [
  { value: 'hoje',  label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d',    label: 'Últimos 7 dias' },
  { value: '30d',   label: 'Últimos 30 dias' },
  { value: 'mes',   label: 'Este mês' },
]

// Opções do filtro por etiqueta do WhatsApp (value = nome normalizado, casado
// server-side pela RPC atendimentos_telefones_por_etiqueta).
const ETIQUETA_OPCOES: { value: string; label: string }[] = [
  { value: 'NOVO LEAD',             label: '🆕 Novo lead' },
  { value: 'PROSPECCAO',            label: '🔍 Prospecção' },
  { value: '2A TENTATIVA',          label: '↩️ 2ª tentativa' },
  { value: 'INTERESSE FUTURO',      label: '⏳ Interesse futuro' },
  { value: 'FOLLOW UP',             label: '🔄 Follow-up' },
  { value: 'LEAD QUENTE',           label: '🔥 Lead quente' },
  { value: 'ORCAMENTO ENVIADO',     label: '📄 Orçamento enviado' },
  { value: 'VENDIDO',               label: '✅ Vendido' },
  { value: 'NUNCA RESPONDEU',       label: '💀 Nunca respondeu' },
  { value: 'NAO RESPONDEU MAIS',    label: '💀 Não respondeu mais' },
  { value: 'NAO TEM INTERESSE',     label: '🚫 Sem interesse' },
  { value: 'SO BASE DE PRECO',      label: '💲 Só base de preço' },
  { value: 'FORA DO ORCAMENTO',     label: '💸 Fora do orçamento' },
  { value: 'NAO FABRICAMOS',        label: '⚙️ Não fabricamos' },
  { value: 'COMPROU DO CONCORRENTE', label: '🏳️ Comprou concorrente' },
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

// Ana V16.24 nao pergunta mais "quando_investir", entao esse sinal nao eh
// mais confiavel — leads antigos ainda tem o campo preenchido, mas leads
// novos nao. Desligado pra evitar destaque vermelho enganoso.
function isHotLead(_quando: string | null): boolean {
  return false
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
  const [searchParams] = useSearchParams()
  // Aceita ?responsavel=, ?origem= e ?data= como filtros iniciais (drill-down do Dashboard)
  const [filters, setFilters] = useState<{
    search: string
    responsavel: string
    status_real: string
    uf: string
    data: DataPreset
    origem: string
    criativo: string
    etiqueta: string
    comOrcamento: boolean
    page: number
  }>(() => ({
    search: '',
    responsavel: searchParams.get('responsavel') || '',
    status_real: searchParams.get('status') || '',
    uf: searchParams.get('uf') || '',
    // Filtro de etiqueta ignora o filtro de data padrão (etiqueta é estado atual, não do dia)
    data: (searchParams.get('data') as DataPreset) ?? (searchParams.get('etiqueta') ? '' : 'hoje'),
    origem: searchParams.get('origem') || '',
    criativo: searchParams.get('criativo') || '',
    etiqueta: searchParams.get('etiqueta') || '',
    comOrcamento: searchParams.get('orc') === '1',
    page: 0,
  }))
  const [searchInput, setSearchInput] = useState('')

  // Fundo branco nesta tela (o padrão da página é cinza --bg). O CSS pinta `html, body`,
  // então whitena os DOIS; só no tema claro; restaura ao sair.
  useEffect(() => {
    if (document.documentElement.classList.contains('dark')) return
    const html = document.documentElement, body = document.body
    const prevHtml = html.style.backgroundColor, prevBody = body.style.backgroundColor
    html.style.backgroundColor = '#fff'
    body.style.backgroundColor = '#fff'
    return () => { html.style.backgroundColor = prevHtml; body.style.backgroundColor = prevBody }
  }, [])

  const { data, isLoading, isFetching, dataUpdatedAt, error: atendimentosError, refetch } = useAtendimentos(filters)
  const { data: kpis } = useAtendimentoKpis(filters)
  const { data: origens } = useAtendimentoOrigens(filters)
  const { data: responsaveis } = useAtendimentoResponsaveis()
  // Etiquetas WA por telefone — fetcha em paralelo aos atendimentos
  const phonesAtuais = (data?.rows ?? []).map(r => r.telefone)
  const { data: waLabelsMap } = useWaLabelsByPhones(phonesAtuais)
  // Indicador automático "orçamento gerado" cruzando o telefone com orcamentos_gerados.
  const { data: orcMap } = useOrcamentosPorTelefone(phonesAtuais)
  // Indicador automático "vendido" cruzando o telefone → orçamento → pedido (venda).
  const { data: vendaMap } = useVendasPorTelefone(phonesAtuais)
  // Marca "NUNCA RESPONDEU" (bot → auditoria.sem_resposta_em).
  const { data: semRespMap } = useSemRespostaPorTelefone(phonesAtuais)
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
  const hasFilters = filters.search || filters.responsavel || filters.status_real || filters.uf || filters.data || filters.origem || filters.criativo || filters.etiqueta || filters.comOrcamento

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

  // "NUNCA RESPONDEU": marca do bot (auditoria.sem_resposta_em). Mostra o selo
  // vermelho só ENQUANTO o lead não engaja — some sozinho quando ganha etiqueta
  // real do Zap ou é atribuído a um vendedor (a etiqueta/vendedor real ganha).
  function isSemResposta(r: typeof rows[number]): boolean {
    if (!lookupSemResposta(semRespMap, r.telefone)) return false
    if (r.responsavel && r.responsavel.trim()) return false
    if (lookupWaLabels(waLabelsMap, r.telefone).length > 0) return false
    return true
  }

  const clearFilters = () => {
    setFilters({ search: '', responsavel: '', status_real: '', uf: '', data: '', origem: '', criativo: '', etiqueta: '', comOrcamento: false, page: 0 })
    setSearchInput('')
  }

  return (
    <div className="flex flex-col h-[calc(100dvh)] overflow-hidden px-6 py-4 gap-3 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink tracking-tight leading-none">
              Atendimentos
            </h1>
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

      {/* KPIs - funil: ENTRADA → ENGAJAMENTO → QUALIFICAÇÃO → HANDOFF → CONTATO */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <KpiCard label="Hoje"           value={kpis.hoje}         hero tone="accent"
                   icon={Calendar}        hint={kpis.hoje === 0 ? 'Nenhum lead hoje' : 'leads novos'} />
          <KpiCard label="Não engajaram"  value={kpis.naoEngajaram}      tone="neutral"  icon={EyeOff}            hint="nem começou o bot" />
          <KpiCard label="Em andamento"   value={kpis.emAndamento}       tone="warning"  icon={MessageSquareDot}  hint="no meio do fluxo" />
          <KpiCard label="Qualificados"   value={kpis.qualificados} hero tone="info"     icon={ListChecks}        hint="fábrica completa ou equipamento do catálogo Branorte" />
          <KpiCard label="Pra pegar"      value={kpis.paraPegar}    hero tone="warning"
                   icon={UserPlus}        hint={kpis.paraPegar === 0 ? 'Fila vazia' : 'Sem vendedor — puxe!'} />
          <KpiCard label="Contatados"     value={kpis.contatados}        tone="success"  icon={Hand}              hint="vendedor já abordou" />
        </div>
      )}

      {/* Origens */}
      {origens && origens.length > 0 && (() => {
        const total = origens.reduce((s, o) => s + o.count, 0)
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-ink-faint">Origens</p>
              <p className="text-[11px] text-ink-faint tabular-nums">{total} leads</p>
            </div>
            {/* Stacked bar */}
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-2 border border-border/50">
              {origens.map(o => (
                <div
                  key={o.label}
                  className="h-full transition-all duration-300"
                  style={{ width: `${(o.count / total) * 100}%`, backgroundColor: o.color }}
                  title={`${o.label}: ${o.count} (${Math.round((o.count / total) * 100)}%)`}
                />
              ))}
            </div>
            {/* Legend — clicável pra filtrar */}
            <div className="flex flex-wrap gap-x-1.5 gap-y-1">
              {origens.map(o => {
                const active = filters.origem === o.label
                return (
                  <button
                    key={o.label}
                    onClick={() => setFilters(f => ({ ...f, origem: active ? '' : o.label, page: 0 }))}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all text-[11px] ${
                      active
                        ? 'ring-2 ring-accent bg-accent/15 text-ink font-bold'
                        : 'hover:bg-surface-3 text-ink-muted'
                    }`}
                    title={active ? 'Clique pra remover filtro' : `Filtrar por ${o.label}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: o.color }} />
                    <span>{o.label}</span>
                    <span className="tabular-nums font-medium text-ink-faint">{o.count}</span>
                  </button>
                )
              })}
              {filters.origem && (
                <button
                  onClick={() => setFilters(f => ({ ...f, origem: '', page: 0 }))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger/15 text-danger text-[11px] hover:bg-danger/25 transition-all"
                  title="Limpar filtro de origem"
                >
                  <X className="h-3 w-3" /> Limpar
                </button>
              )}
            </div>
          </div>
        )
      })()}

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
          options={ETIQUETA_OPCOES}
          placeholder="Etiqueta WhatsApp"
          value={filters.etiqueta}
          onChange={e => setFilters(f => ({ ...f, etiqueta: e.target.value, page: 0 }))}
          className="lg:w-48"
        />
        <Select
          options={(origens ?? []).map(o => ({ value: o.label, label: `${o.label} (${o.count})` }))}
          placeholder="Origem"
          value={filters.origem}
          onChange={e => setFilters(f => ({ ...f, origem: e.target.value, page: 0 }))}
          className="lg:w-52"
        />
        {/* #17: filtro por código de criativo (M0023, F1234, etc) */}
        <input
          type="text"
          placeholder="Criativo (M0023)"
          value={filters.criativo}
          onChange={e => setFilters(f => ({ ...f, criativo: e.target.value, page: 0 }))}
          className="px-2.5 py-1.5 rounded-md border border-border bg-surface-2 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none lg:w-32"
          maxLength={20}
        />
        <Select
          options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
          placeholder="UF"
          value={filters.uf}
          onChange={e => setFilters(f => ({ ...f, uf: e.target.value, page: 0 }))}
          className="lg:w-24"
        />
        {/* Filtro: só atendimentos cujo telefone já tem orçamento montado */}
        <button
          type="button"
          onClick={() => setFilters(f => f.comOrcamento
            ? { ...f, comOrcamento: false, page: 0 }
            // Ao ligar, limpa a data pra mostrar TODOS os leads com orçamento (cobertura completa).
            : { ...f, comOrcamento: true, data: '', page: 0 })}
          className={`px-2.5 py-1.5 rounded-md border text-[12px] font-medium transition-colors whitespace-nowrap ${
            filters.comOrcamento
              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
              : 'bg-surface-2 text-ink-muted border-border hover:text-ink'
          }`}
          title="Mostrar só os atendimentos cujo telefone já tem orçamento montado (todas as datas)"
        >
          📄 {filters.comOrcamento ? 'Com orçamento ✓' : 'Com orçamento'}
        </button>
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
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center justify-between shrink-0">
            <p className="text-[12px] text-ink-faint tabular-nums">
              {formatNumber(total)} resultado{total !== 1 ? 's' : ''}
              {/* Cobertura: quantos dos atendimentos mostrados já têm orçamento montado */}
              {!filters.comOrcamento && (() => {
                const n = (data?.rows ?? []).filter(r => lookupOrcamento(orcMap, r.telefone)).length
                return n > 0 ? <span className="text-emerald-500"> · 📄 {n} com orçamento</span> : null
              })()}
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
          <div className="md:hidden space-y-2 flex-1 min-h-0 overflow-y-auto">
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
              const semResp = isSemResposta(r)
              return (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${
                    semResp
                      ? 'bg-red-500/10 border-red-500/40'
                      : isHot
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
                        {semResp && (
                          <Badge className="text-[10px] font-semibold" style={{
                            background: 'rgba(239,68,68,0.14)',
                            color: '#ef4444',
                            border: '1px solid rgba(239,68,68,0.4)',
                          }}>NUNCA RESPONDEU</Badge>
                        )}
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

          {/* ─── DESKTOP: tabela completa (sem scroll horizontal — cabe na tela) ─── */}
          <Card className="hidden md:flex md:flex-col flex-1 min-h-0 overflow-hidden p-0">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10 bg-surface backdrop-blur-sm">
                  <tr className="border-b border-border bg-surface-2/40 [&>th]:text-left [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:font-bold [&>th]:text-ink-muted [&>th]:px-1.5 [&>th]:py-3 [&>th]:whitespace-nowrap">
                    <th className="w-[72px]">Chegou</th>
                    <th className="w-[110px]">Lead</th>
                    <th className="hidden md:table-cell w-[48px]">UF</th>
                    <th className="w-[132px]">Telefone</th>
                    <th className="hidden lg:table-cell w-[88px]">Origem</th>
                    <th className="hidden 2xl:table-cell w-[100px]">Criativo</th>
                    <th className="hidden lg:table-cell w-[140px]">Motivo</th>
                    <th className="hidden 2xl:table-cell w-[100px]" title="Pra que serve a fábrica: consumo, venda ou os dois (Ana V16.24)">Finalidade</th>
                    <th className="hidden 2xl:table-cell w-[60px]">Animal</th>
                    <th className="hidden 2xl:table-cell w-[50px]" title="Cabeças (consumo) — vazio se for venda (ver Produção/h)">Qtd</th>
                    <th className="hidden 2xl:table-cell w-[64px]" title="Produção desejada quando é venda (kg/h)">Kg/h</th>
                    <th className="w-[88px]">Vendedor</th>
                    <th className="hidden 2xl:table-cell w-[110px]" title="Etiqueta atribuída no WhatsApp do vendedor">Etiqueta WA</th>
                    <th className="w-[76px]" title="Já foi montado orçamento pra esse telefone? (match automático pelo número)">Orçamento</th>
                    <th className="w-[60px]" title="Esse lead virou venda? (orçamento dele virou pedido não-cancelado)">Vendido</th>
                    <th className="hidden lg:table-cell w-[96px] !text-right" title="Valor da venda fechada (soma dos pedidos do lead)">Valor</th>
                    <th className="!text-right w-[40px]"></th>
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
                    const semResp = isSemResposta(r)
                    return (
                      <tr key={r.id}
                          className={`group border-b border-border/30 last:border-0 transition-all duration-150
                                     ${semResp
                                        ? 'bg-red-500/10 hover:bg-red-500/[0.16]'
                                        : isHot
                                          ? 'bg-danger-bg/30 hover:bg-danger-bg/50'
                                          : 'odd:bg-surface even:bg-surface-2/20 hover:bg-surface-2/60 hover:shadow-sm'}`}
                          style={semResp
                            ? { boxShadow: 'inset 3px 0 0 0 rgb(239 68 68)' }
                            : isHot ? { boxShadow: 'inset 3px 0 0 0 hsl(var(--danger))' } : undefined}>
                        {/* CHEGOU */}
                        <td className="px-2 py-2.5 whitespace-nowrap" title={r.primeira_data ?? r.created_at ?? ''}>
                          <span className="text-[11px] text-ink-muted font-mono tabular-nums">
                            {formatDateTimeShort(r.primeira_data ?? r.created_at)}
                          </span>
                        </td>
                        {/* LEAD — só primeiro nome pra não esticar a coluna */}
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <div className="flex items-center max-w-[110px]">
                            <div className="leading-tight min-w-0">
                              <span className="text-[13px] font-medium text-ink truncate block" title={nomeReal ?? ''}>
                                {nomeReal ? nomeReal.trim().split(/\s+/)[0] : (
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
                        {/* ESTADO — só a sigla (com nome completo no tooltip) */}
                        <td className="hidden md:table-cell px-1.5 py-2.5 whitespace-nowrap">
                          {uf && uf !== '—' && uf !== 'INTL' ? (
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted"
                              title={estadoNome(uf)}
                            >
                              {uf}
                            </span>
                          ) : (() => {
                            const pais = paisDoTelefone(r.telefone)
                            if (!pais) return <EmptyCell />
                            return (
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info/10 text-info"
                                title={`Internacional: ${pais.nome}`}
                              >
                                {pais.sigla}
                              </span>
                            )
                          })()}
                        </td>
                        {/* TELEFONE — formato cru +5548... com botão de copiar */}
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <PhoneCopyButton telefone={r.telefone} />
                        </td>
                        {/* ORIGEM */}
                        <td className="hidden lg:table-cell px-1.5 py-2.5 whitespace-nowrap">
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
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5">
                          {r.criativo_codigo || criativoNome ? (
                            <div className="flex items-center gap-1.5 min-w-0 max-w-[200px]">
                              {r.criativo_codigo && (
                                <CriativoHoverBadge
                                  codigo={r.criativo_codigo}
                                  fallback={r.criativo_facebook ? {
                                    codigo: r.criativo_codigo,
                                    nome_oficial: r.criativo_facebook.nome_oficial ?? null,
                                    headline: r.criativo_facebook.headline ?? null,
                                    image_url: null,
                                    source_url: null,
                                    total_leads: null,
                                  } : null}
                                />
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
                        {/* MOTIVO DO CONTATO + nome do equipamento (o_que_precisa OU criativo) */}
                        <td className="hidden lg:table-cell px-1.5 py-2.5">
                          {(() => {
                            const motivo = humanizeMotivo(r.motivo_contato)
                            if (!motivo) return <EmptyCell />
                            const tone = MOTIVO_TONE[r.motivo_contato!] ?? MOTIVO_TONE[motivo] ?? 'neutral'
                            // Quando motivo='equipamento', mostra o equipamento específico:
                            // Prioridade 1: o_que_precisa (Ana V16.24 grava 'misturador 150 kg')
                            // Prioridade 2: nome do criativo do anúncio (fallback)
                            const ehUmEquipamento = /equipamento/i.test(motivo)
                            const equipamento = ehUmEquipamento ? (r.o_que_precisa || criativoNome) : null
                            return (
                              <div className="flex flex-col gap-0.5 min-w-0 max-w-[220px]">
                                <Badge style={{
                                  background: `hsl(var(--${tone}-bg))`,
                                  color: `hsl(var(--${tone}))`,
                                }} className="w-fit">
                                  {motivo}
                                </Badge>
                                {equipamento && (
                                  <span className="text-[10.5px] text-ink-faint truncate capitalize" title={equipamento}>
                                    {equipamento}
                                  </span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        {/* FINALIDADE — Ana V16.24 pergunta isso logo após o nome.
                            consumo_proprio / revenda / misto. Substitui a coluna antiga "Tipo de Ração". */}
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5 whitespace-nowrap">
                          {(() => {
                            const fin = r.finalidade_fabrica
                            if (!fin) return <EmptyCell />
                            const label = humanizeTipoRacao(fin) ?? fin
                            const tone = FINALIDADE_TONE[fin] ?? FINALIDADE_TONE[label] ?? 'neutral'
                            return (
                              <Badge style={{
                                background: `hsl(var(--${tone}-bg))`,
                                color: `hsl(var(--${tone}))`,
                              }} className="capitalize">
                                {label}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* ANIMAL */}
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5 whitespace-nowrap">
                          {r.qual_animal && r.qual_animal !== 'null' ? (
                            <span className="text-[12px] text-ink-muted">{normalizarAnimal(r.qual_animal)}</span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* QTD (cabeças) — V16.24: vazio quando finalidade=revenda (vendedor não pergunta qtd nesse caso) */}
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5 whitespace-nowrap">
                          {r.quantos_animais && r.quantos_animais !== 'null' ? (
                            <span className="text-[12px] text-ink-muted tabular-nums">{r.quantos_animais}</span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* PRODUÇÃO/H (kg/h) — V16.24: usado quando finalidade=venda (substitui Momento) */}
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5 max-w-[100px]">
                          {r.capacidade_producao ? (
                            <span className="text-[12px] text-ink-muted tabular-nums block truncate" title={r.capacidade_producao}>{r.capacidade_producao}</span>
                          ) : (
                            <EmptyCell />
                          )}
                        </td>
                        {/* VENDEDOR — só primeiro nome (sem avatar) */}
                        <td className="px-1.5 py-2.5 whitespace-nowrap w-[72px]">
                          {(() => {
                            const ids = (r.auditoria_ids && r.auditoria_ids.length > 0) ? r.auditoria_ids : [r.id]
                            const v = vendedorEfetivo(r)
                            if (v) {
                              const firstName = v.name.trim().split(/\s+/)[0]
                              return (
                                <span
                                  className="text-[12px] text-ink-muted truncate block max-w-[70px] capitalize"
                                  title={`${v.name}${v.source === 'wa' ? ' (via etiqueta WA)' : ''}`}
                                >
                                  {firstName.toLowerCase()}
                                </span>
                              )
                            }
                            return (
                              <div className="flex items-center justify-center">
                                <AtribuirVendedorPicker auditoriaIds={ids} compact />
                              </div>
                            )
                          })()}
                        </td>
                        {/* ETIQUETA WA — etiquetas do VENDEDOR RESPONSÁVEL apenas.
                            Antes mostrava etiquetas de qualquer vendedor que tivesse
                            o cliente no Zap (ex: aparecia "NAO RESPONDEU MAIS" do
                            Pedro quando o responsável real era o Gustavo). Agora
                            filtra pelo first-name UPPERCASE do vendedor efetivo. */}
                        <td className="hidden 2xl:table-cell px-1.5 py-2.5 whitespace-nowrap">
                          {(() => {
                            // Selo sintético "NUNCA RESPONDEU" (marca do bot). Prioridade
                            // baixa: isSemResposta já é false se houver etiqueta real ou vendedor.
                            if (semResp) {
                              return (
                                <div className="flex flex-wrap gap-1 max-w-[180px]">
                                  <Badge
                                    className="text-[10px] font-semibold"
                                    style={{
                                      background: 'rgba(239,68,68,0.14)',
                                      color: '#ef4444',
                                      border: '1px solid rgba(239,68,68,0.4)',
                                    }}
                                    title="O contato nunca respondeu — marcado automaticamente pelo bot"
                                  >
                                    NUNCA RESPONDEU
                                  </Badge>
                                </div>
                              )
                            }
                            const allLabels = lookupWaLabels(waLabelsMap, r.telefone)
                            if (allLabels.length === 0) return <EmptyCell />
                            const v = vendedorEfetivo(r)
                            const respFirstUp = v ? v.name.trim().split(/\s+/)[0]?.toUpperCase() : null
                            // Se há vendedor responsável, filtra só as etiquetas dele.
                            // Se não há (lead "Pra Pegar"), mostra todas (comportamento antigo).
                            const labels = respFirstUp
                              ? allLabels.filter(l => l.vendedor?.toUpperCase() === respFirstUp)
                              : allLabels
                            if (labels.length === 0) return <EmptyCell />
                            return (
                              <div className="flex flex-wrap gap-1 max-w-[180px]">
                                {labels.slice(0, 3).map(l => (
                                  <Badge
                                    key={l.id + ':' + l.vendedor}
                                    className="text-[10px] font-semibold"
                                    style={{
                                      background: 'rgba(16,185,129,0.12)',
                                      color: '#10b981',
                                      border: '1px solid rgba(16,185,129,0.3)',
                                    }}
                                    title={`${l.name}${l.vendedor ? ` (${l.vendedor})` : ''}`}
                                  >
                                    {l.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()}
                                  </Badge>
                                ))}
                                {labels.length > 3 && (
                                  <span className="text-[10px] text-ink-faint">+{labels.length - 3}</span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        {/* ORÇAMENTO — foi montado orçamento pra esse telefone? (match automático pelo número) */}
                        <td className="px-1.5 py-2.5 whitespace-nowrap">
                          {(() => {
                            const orc = lookupOrcamento(orcMap, r.telefone)
                            if (!orc) return <EmptyCell />
                            const title = `Orçamento ${orc.numero ?? ''} montado`
                              + (orc.em ? ` em ${new Date(orc.em).toLocaleDateString('pt-BR')}` : '')
                              + (orc.valor ? ` · ${orc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '')
                              + (orc.qtd > 1 ? ` · ${orc.qtd} orçamentos pra este número` : '')
                            return (
                              <Badge
                                className="text-[10px] font-semibold"
                                style={{ background: 'rgba(16,185,129,0.14)', color: '#10b981', border: '1px solid rgba(16,185,129,0.35)' }}
                                title={title}
                              >
                                ✓ Sim{orc.qtd > 1 ? ` (${orc.qtd})` : ''}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* VENDIDO — o orçamento desse lead virou pedido (venda não-cancelada)? */}
                        <td className="px-1.5 py-2.5 whitespace-nowrap">
                          {(() => {
                            const venda = lookupVenda(vendaMap, r.telefone)
                            if (!venda) return <span className="text-[10px] text-ink-faint">Não</span>
                            const title = `Vendido${venda.ultimoPedido ? ` · ${venda.ultimoPedido}` : ''}`
                              + (venda.ultimaVenda ? ` em ${new Date(venda.ultimaVenda + 'T00:00:00').toLocaleDateString('pt-BR')}` : '')
                              + (venda.valor ? ` · ${venda.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '')
                              + (venda.qtd > 1 ? ` · ${venda.qtd} pedidos` : '')
                            return (
                              <Badge
                                className="text-[10px] font-semibold"
                                style={{ background: 'rgba(59,130,246,0.14)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.35)' }}
                                title={title}
                              >
                                ✓ Sim{venda.qtd > 1 ? ` (${venda.qtd})` : ''}
                              </Badge>
                            )
                          })()}
                        </td>
                        {/* VALOR — soma das vendas fechadas do lead */}
                        <td className="hidden lg:table-cell px-1.5 py-2.5 whitespace-nowrap text-right">
                          {(() => {
                            const venda = lookupVenda(vendaMap, r.telefone)
                            if (!venda || !venda.valor) return <span className="text-[10px] text-ink-faint">—</span>
                            return (
                              <span className="text-[11px] font-semibold tabular-nums text-ink" title={venda.ultimoPedido ?? undefined}>
                                {venda.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                              </span>
                            )
                          })()}
                        </td>
                        {/* AÇÕES */}
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">
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
                      <td colSpan={19} className="px-4 py-16 text-center">
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
