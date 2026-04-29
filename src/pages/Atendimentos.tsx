import { useState } from 'react'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, ExternalLink, Flame, AlarmClock, CheckCircle2, Inbox, Trash2, Calendar, Hand, ListChecks, MessageSquareDot, EyeOff } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { StatusDot } from '@/components/ui/StatusDot'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatPhone, whatsappLink, formatRelative, formatNumber, formatDateTimeShort, estadoNome } from '@/lib/utils'
import { ufFromTelefone, paisDoTelefone } from '@/lib/ddd-uf'
import { ESTADOS_BR } from '@/types'
import { ATENDIMENTO_PAGE_SIZE, STATUS_REAL_VALUES, type StatusReal } from '@/types/atendimento'
import { useAtendimentos, useAtendimentoKpis, useAtendimentoResponsaveis, useDeleteAtendimento, type DataPreset } from '@/hooks/useAtendimentos'

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

const FINALIDADE_TONE: Record<string, Tone> = {
  'Fábrica para consumo':  'info',
  'Fábrica para vender':   'warning',
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
}

const AUDITORIA_BASE = 'https://branorte-auditoria.vercel.app'

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
    return <span className="text-[11px] text-ink-faint">—</span>
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
  return (
    <div className={`relative overflow-hidden rounded-lg bg-surface border border-border ${hero ? 'p-5' : 'p-4'}
                     before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accentClass[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-medium ${tone === 'neutral' ? 'text-ink-faint' : `text-${tone}`}`}
             style={{ color: tone !== 'neutral' ? `hsl(var(--${tone}))` : undefined }}>
            {label}
          </p>
          <p className={`mt-1 font-semibold tabular-nums tracking-tight text-ink ${hero ? 'text-3xl' : 'text-2xl'}`}>
            {formatNumber(value)}
          </p>
          {hint && <p className="text-[11px] text-ink-faint mt-0.5">{hint}</p>}
        </div>
        {Icon && (
          <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0
                          ${tone === 'neutral' ? 'bg-surface-2' : ''}`}
               style={tone !== 'neutral' ? { background: `hsl(var(--${tone}-bg))`, color: `hsl(var(--${tone}))` } : undefined}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
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

  const { data, isLoading } = useAtendimentos(filters)
  const { data: kpis } = useAtendimentoKpis(filters)
  const { data: responsaveis } = useAtendimentoResponsaveis()
  const deleteMut = useDeleteAtendimento()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / ATENDIMENTO_PAGE_SIZE)
  const hasFilters = filters.search || filters.responsavel || filters.status_real || filters.uf || filters.data

  const clearFilters = () => {
    setFilters({ search: '', responsavel: '', status_real: '', uf: '', data: '', page: 0 })
    setSearchInput('')
  }

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight leading-tight">
            Atendimentos
          </h1>
          <p className="text-[13px] text-ink-muted mt-0.5">
            {kpis ? (
              <>
                <span className="font-medium text-ink tabular-nums">{formatNumber(kpis.total)}</span>
                <span className="text-ink-faint"> conversas · 1 por cliente</span>
              </>
            ) : 'Carregando...'}
          </p>
        </div>
        <a
          href={`${AUDITORIA_BASE}/atendimentos`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors"
        >
          Versão completa <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* KPIs - hierarquia: 2 hero + 4 small */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
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

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface/50 [&>th]:text-left [&>th]:text-[10px] [&>th]:uppercase [&>th]:tracking-wider [&>th]:font-semibold [&>th]:text-ink-faint [&>th]:px-2 [&>th]:py-2.5 [&>th]:whitespace-nowrap">
                    <th>Chegou</th>
                    <th>Lead</th>
                    <th className="hidden md:table-cell">Estado</th>
                    <th>Telefone</th>
                    <th className="hidden lg:table-cell">Origem</th>
                    <th className="hidden 2xl:table-cell">Criativo</th>
                    <th className="hidden lg:table-cell">Motivo</th>
                    <th className="hidden 2xl:table-cell">Finalidade</th>
                    <th className="hidden xl:table-cell">Animal</th>
                    <th className="hidden xl:table-cell">Qtd</th>
                    <th className="hidden lg:table-cell">Momento</th>
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
                    const isFresh = isFreshLead(r.primeira_data ?? r.created_at)
                    const finTone = r.finalidade_fabrica ? FINALIDADE_TONE[r.finalidade_fabrica] : null
                    const quandoTone = r.quando_investir ? QUANDO_TONE[r.quando_investir] : null
                    return (
                      <tr key={r.id}
                          className={`group border-b border-border/60 last:border-0 transition-colors
                                     ${isHot ? 'bg-danger-bg/40 hover:bg-danger-bg/60' : 'hover:bg-surface'}`}
                          style={isHot ? { boxShadow: 'inset 3px 0 0 0 hsl(var(--danger))' } : undefined}>
                        {/* CHEGOU */}
                        <td className="px-3 py-2.5 whitespace-nowrap" title={r.primeira_data ?? r.created_at ?? ''}>
                          <span className="text-[11px] text-ink-muted font-mono tabular-nums">
                            {formatDateTimeShort(r.primeira_data ?? r.created_at)}
                          </span>
                        </td>
                        {/* LEAD */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5 min-w-[170px]">
                            <Avatar name={r.nome} size="md" pulse={isFresh} />
                            <div className="leading-tight">
                              <span className="text-[13px] font-medium text-ink">
                                {r.nome || <span className="text-ink-faint italic font-normal">sem nome</span>}
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
                            if (!pais) return <span className="text-[11px] text-ink-faint">—</span>
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
                            <span className="text-[11px] text-ink-faint">—</span>
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
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* MOTIVO DO CONTATO */}
                        <td className="hidden lg:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.motivo_contato ? (
                            <Badge style={{
                              background: `hsl(var(--${MOTIVO_TONE[r.motivo_contato] ?? 'surface-2'}-bg))`,
                              color: `hsl(var(--${MOTIVO_TONE[r.motivo_contato] ?? 'ink-muted'}))`,
                            }}>
                              {r.motivo_contato}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* FINALIDADE DA FÁBRICA */}
                        <td className="hidden 2xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.finalidade_fabrica ? (
                            <Badge style={{
                              background: `hsl(var(--${finTone ?? 'surface-2'}-bg))`,
                              color: `hsl(var(--${finTone ?? 'ink-muted'}))`,
                            }}>
                              {r.finalidade_fabrica}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* ANIMAL */}
                        <td className="hidden xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.qual_animal ? (
                            <span className="text-[12px] text-ink-muted">{r.qual_animal}</span>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* QTD */}
                        <td className="hidden xl:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.quantos_animais ? (
                            <span className="text-[12px] text-ink-muted tabular-nums">{r.quantos_animais}</span>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* MOMENTO DE COMPRA */}
                        <td className="hidden lg:table-cell px-2 py-2.5 whitespace-nowrap">
                          {r.quando_investir ? (
                            <Badge style={{
                              background: `hsl(var(--${quandoTone ?? 'surface-2'}-bg))`,
                              color: `hsl(var(--${quandoTone ?? 'ink-muted'}))`,
                            }} className="gap-1">
                              {r.quando_investir === 'Agora' && <Flame className="h-2.5 w-2.5" />}
                              {r.quando_investir === 'Em até 3 meses' && <AlarmClock className="h-2.5 w-2.5" />}
                              {r.quando_investir}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* TOCOU NO BOTAO */}
                        <td className="hidden 2xl:table-cell px-2 py-2.5 whitespace-nowrap" title={r.tocou_botao_em ? `Em ${formatRelative(r.tocou_botao_em)}` : ''}>
                          {r.tocou_botao_em ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Sim
                            </span>
                          ) : (
                            <span className="text-[11px] text-ink-faint">—</span>
                          )}
                        </td>
                        {/* VENDEDOR */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.responsavel ? (
                            <div className="flex items-center gap-1.5">
                              <Avatar name={r.responsavel} size="sm" />
                              <span className="text-[12px] text-ink-muted">{r.responsavel}</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-ink-faint italic">a definir</span>
                          )}
                        </td>
                        {/* AÇÕES */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            disabled={deleteMut.isPending}
                            onClick={() => {
                              const ids = (r.auditoria_ids && r.auditoria_ids.length > 0) ? r.auditoria_ids : [r.id]
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
                        </td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-4 py-16 text-center">
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
