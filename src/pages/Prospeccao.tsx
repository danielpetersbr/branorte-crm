import { useMemo, useState } from 'react'
import { Search, Target, Hand, MessageCircle, Copy, Check, RotateCw, Undo2, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { StatusDot } from '@/components/ui/StatusDot'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import {
  usePoolProspeccao, usePoolCount, useMinhaCota, usePegarContatos,
  useAtualizarStatusClaim, useRenovarClaim, useSalvarNotaProspeccao, useSalvarNotaContato,
  useMinhaCarteira, useMinhaCarteiraCount,
  useMetricasProspeccao, useProspeccaoConfig, useSalvarProspeccaoConfig,
  PROSPECCAO_STATUS_ATIVOS, PROSPECCAO_STATUS_TERMINAIS, PROSPECCAO_STATUS_LABELS,
  POOL_PAGE_SIZE, CARTEIRA_PAGE_SIZE, type CarteiraContato, type PoolContato,
} from '@/hooks/useProspeccao'
import { ESTADOS_BR, MOTIVO_PERDA_OPTIONS } from '@/types'
import { cn, formatPhone, formatNumber, formatRelative, whatsappLink } from '@/lib/utils'
import { getHumanNotes } from '@/lib/crm-fields'
import { FichaContatoDrawer } from '@/components/prospeccao/FichaContatoDrawer'

// ============================================================================
// /prospeccao — Pool de Prospecção
// Vendedor pega contatos livres (aba Pool), trabalha e anota status
// (aba Meus contatos); admin acompanha métricas e configura (aba Gestão).
// ============================================================================

type Tab = 'pool' | 'meus' | 'gestao'

// ---------------------------------------------------------------------------
// Toast mínimo local (o app não tem provider global de toast)
// ---------------------------------------------------------------------------
interface ToastMsg { id: number; texto: string; tone: 'success' | 'danger' | 'info' }

function useToast(): [ToastMsg[], (texto: string, tone?: ToastMsg['tone']) => void] {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const push = (texto: string, tone: ToastMsg['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }
  return [toasts, push]
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (!toasts.length) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-[1100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cn(
          'px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border backdrop-blur bg-surface/95',
          t.tone === 'success' && 'border-success/30 text-success',
          t.tone === 'danger' && 'border-danger/30 text-danger',
          t.tone === 'info' && 'border-border text-ink',
        )}>
          {t.texto}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra de cota (usados / limite)
// ---------------------------------------------------------------------------
function QuotaMeter({ ativos, cota }: { ativos: number; cota: number }) {
  const pct = cota > 0 ? Math.min(100, Math.round((ativos / cota) * 100)) : 0
  const cheia = ativos >= cota
  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 flex flex-col gap-1.5',
      cheia ? 'border-warning/40 bg-warning/5' : 'border-accent/30 bg-accent-bg/40',
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
          <Target className="h-4 w-4 text-accent" />
          {cheia
            ? 'Cota cheia — finalize contatos pra pegar mais'
            : `Você pode pegar mais ${cota - ativos} contato${cota - ativos === 1 ? '' : 's'}`}
        </span>
        <span className="text-[12px] tabular-nums text-ink-muted font-mono shrink-0">{ativos} de {cota}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', cheia ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tag de prazo — só p/ contatos que vieram do pool (têm claim ativo).
// ("há X sem interação — volta pro pool em Y")
// ---------------------------------------------------------------------------
function DeadlineTag({ item }: { item: CarteiraContato }) {
  if (!item.expires_at) return null
  const diasRestantes = Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / 86_400_000)
  const ultimaInteracao = item.last_action_at ?? item.claimed_at ?? item.expires_at
  if (item.claim_status === 'negociando') {
    return <StatusDot tone="accent" label="Negociando — não expira" />
  }
  if (diasRestantes <= 0) {
    return <StatusDot tone="danger" label="Vencido — volta pro pool hoje" />
  }
  if (diasRestantes <= 2) {
    return (
      <StatusDot
        tone="warning"
        label={`Sem interação ${formatRelative(ultimaInteracao)} — volta pro pool em ${diasRestantes}d`}
      />
    )
  }
  return <StatusDot tone="success" label={`Interação ${formatRelative(ultimaInteracao)}`} />
}

// ---------------------------------------------------------------------------
// Chips de status (1 toque)
// ---------------------------------------------------------------------------
function StatusChips({ atual, onChange, disabled }: {
  atual: string
  onChange: (status: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PROSPECCAO_STATUS_ATIVOS.map(s => (
        <button
          key={s.value}
          disabled={disabled || atual === s.value}
          onClick={() => onChange(s.value)}
          className={cn(
            'h-8 px-3 rounded-full text-[12px] font-medium border transition-all duration-150',
            'disabled:cursor-default',
            atual === s.value
              ? 'bg-accent text-white border-accent shadow-sm'
              : 'bg-surface-2 text-ink-muted border-border hover:border-accent/40 hover:text-ink',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Botão copiar telefone
// ---------------------------------------------------------------------------
function CopyPhone({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      title="Copiar telefone"
      onClick={() => {
        navigator.clipboard?.writeText(phone).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="h-6 w-6 inline-flex items-center justify-center rounded text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ icon, title, sub, cta }: {
  icon: string; title: string; sub?: string; cta?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {sub && <p className="text-[13px] text-ink-muted max-w-sm">{sub}</p>}
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}

// ===========================================================================
// ABA POOL
// ===========================================================================
function PoolTab({ push, onIrMeus }: { push: (t: string, tone?: ToastMsg['tone']) => void; onIrMeus: () => void }) {
  const [search, setSearch] = useState('')
  const [uf, setUf] = useState('')
  const [page, setPage] = useState(0)
  const filtros = { search, uf, origem: '', page }

  const { data: cota } = useMinhaCota()
  const { data: contatos, isLoading } = usePoolProspeccao(filtros)
  const { data: total } = usePoolCount(filtros)
  const pegar = usePegarContatos()
  const { profile } = useAuth()

  const semVendedor = !profile?.vendor_id
  const cotaCheia = !!cota && cota.ativos >= cota.cota
  const loteRapido = Math.min(5, cota ? cota.cota - cota.ativos : 5)

  const handlePegar = (ids: string[]) => {
    pegar.mutate(ids, {
      onSuccess: res => {
        if (!res.ok) {
          if (res.erro === 'cota_cheia') push('Cota cheia — finalize contatos pra pegar mais', 'danger')
          else if (res.erro === 'sem_vendedor') push('Seu usuário não está vinculado a um vendedor', 'danger')
          else push('Não foi possível pegar', 'danger')
          return
        }
        const nPegos = res.pegos?.length ?? 0
        const nPerdidos = res.perdidos?.length ?? 0
        if (nPegos > 0) push(`✋ ${nPegos} contato${nPegos === 1 ? '' : 's'} agora ${nPegos === 1 ? 'é seu' : 'são seus'}`, 'success')
        if (nPerdidos > 0) push(`${nPerdidos} já ${nPerdidos === 1 ? 'foi pego' : 'foram pegos'} por outro vendedor`, 'info')
      },
      onError: () => push('Erro ao pegar contato', 'danger'),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {cota && <QuotaMeter ativos={cota.ativos} cota={cota.cota} />}
      {semVendedor && (
        <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-2.5 text-[13px] text-ink-muted">
          Seu usuário não está vinculado a um vendedor — você pode ver o pool, mas não pegar contatos.
        </div>
      )}

      {/* Toolbar: busca + UF + contador + pegar lote (uma linha no desktop) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            leftIcon={<Search className="h-3.5 w-3.5" />}
            placeholder="Buscar nome ou telefone…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
          />
        </div>
        <Select
          value={uf}
          onChange={e => { setUf(e.target.value); setPage(0) }}
          placeholder="Todos os estados"
          options={ESTADOS_BR.map(e => ({ value: e, label: e }))}
          className="min-h-[44px] sm:min-h-0"
        />
        <p className="text-[12px] text-ink-muted tabular-nums shrink-0 sm:px-2">
          {total !== undefined ? `${formatNumber(total)} livres` : '…'}
        </p>
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          disabled={semVendedor || cotaCheia || !contatos?.length}
          loading={pegar.isPending}
          onClick={() => contatos && handlePegar(contatos.slice(0, loteRapido).map(c => c.id))}
        >
          <Hand className="h-3.5 w-3.5" /> Pegar {loteRapido > 0 ? loteRapido : ''} de uma vez
        </Button>
      </div>

      {isLoading ? <PageLoading /> : !contatos?.length ? (
        <EmptyState
          icon="🔍"
          title="Nenhum contato livre com esses filtros"
          sub={search || uf ? 'Tenta limpar a busca ou trocar o estado.' : 'O pool está vazio no momento.'}
          cta={(search || uf) ? <Button size="sm" onClick={() => { setSearch(''); setUf(''); setPage(0) }}>Limpar filtros</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
            {contatos.map((c: PoolContato) => (
              <Card key={c.id}>
                <CardContent className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink truncate">
                        {c.name?.trim() || <span className="text-ink-faint font-normal">(sem nome)</span>}
                      </p>
                      <p className="text-[12.5px] text-ink-muted font-mono">{formatPhone(c.phone ?? '')}</p>
                    </div>
                    {c.state && <Badge className="bg-surface-2 text-ink-muted shrink-0">{c.state}</Badge>}
                  </div>
                  <p className="text-[11.5px] text-ink-faint truncate">
                    {c.data_orcamento
                      ? `📄 Orçou em ${new Date(c.data_orcamento + 'T12:00:00').toLocaleDateString('pt-BR')}${c.city ? ` · ${c.city}` : ''}`
                      : [c.city, c.origin].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={semVendedor || cotaCheia}
                      onClick={() => handlePegar([c.id])}
                    >
                      <Hand className="h-3.5 w-3.5" /> Pegar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 py-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </Button>
            <span className="text-[12px] text-ink-muted tabular-nums px-2">Página {page + 1}</span>
            <Button
              size="sm"
              disabled={!!total && (page + 1) * POOL_PAGE_SIZE >= total}
              onClick={() => setPage(p => p + 1)}
            >
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
      <div className="hidden">{onIrMeus && null}</div>
    </div>
  )
}

// ===========================================================================
// ABA MEUS CONTATOS — carteira completa do vendedor
// Ativos = em aberto · Finalizados = vendas fechadas.
// Contatos que vieram do pool (têm claim) mantêm os controles de prazo.
// ===========================================================================
const brl = (v: number | null) =>
  v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : ''

function MeusTab({ push, onIrPool }: { push: (t: string, tone?: ToastMsg['tone']) => void; onIrPool: () => void }) {
  const [mostrarAtivos, setMostrarAtivos] = useState(true)
  const [search, setSearch] = useState('')
  const [uf, setUf] = useState('')
  const [page, setPage] = useState(0)
  const filtros = { search, uf, ativos: mostrarAtivos, page }

  const { data: itens, isLoading } = useMinhaCarteira(filtros)
  const { data: total } = useMinhaCarteiraCount({ search, uf, ativos: mostrarAtivos })
  const atualizarStatus = useAtualizarStatusClaim()
  const renovar = useRenovarClaim()
  const salvarNota = useSalvarNotaProspeccao()
  const salvarNotaContato = useSalvarNotaContato()

  const [notaDraft, setNotaDraft] = useState<Record<string, string>>({})
  const [finalizando, setFinalizando] = useState<string | null>(null) // claim_id com painel de finalizar aberto
  const [motivoSel, setMotivoSel] = useState('')
  const [fichaContact, setFichaContact] = useState<{ id: string; phone: string | null } | null>(null)

  const trocarAba = (ativos: boolean) => { setMostrarAtivos(ativos); setPage(0) }

  // Só é chamado em contatos que têm claim ativo (item.claim_id != null)
  const mudarStatus = (item: CarteiraContato, status: string, motivo?: string) => {
    if (!item.claim_id) return
    atualizarStatus.mutate({ claimId: item.claim_id, status, motivo }, {
      onSuccess: res => {
        if (res.terminal) {
          if (status === 'convertido') push('🎉 Convertido! O contato agora é seu no CRM.', 'success')
          else if (status === 'devolvido') push('Contato devolvido ao pool', 'info')
          else push(`Finalizado: ${PROSPECCAO_STATUS_LABELS[status]}`, 'info')
        }
        setFinalizando(null)
        setMotivoSel('')
      },
      onError: (e: Error) => {
        if (e.message === 'devolucao_bloqueada') push('Depois que o cliente respondeu não dá mais pra devolver', 'danger')
        else push('Não salvou, tenta de novo', 'danger')
      },
    })
  }

  const salvarNotaDo = (item: CarteiraContato) => {
    const texto = (notaDraft[item.contact_id] ?? '').trim()
    if (!texto) return
    const onSuccess = () => {
      setNotaDraft(d => ({ ...d, [item.contact_id]: '' }))
      push('Anotado ✓', 'success')
    }
    const onError = () => push('Não salvou a anotação', 'danger')
    if (item.claim_id) {
      salvarNota.mutate({ contactId: item.contact_id, claimId: item.claim_id, notesAtual: item.notes, texto }, { onSuccess, onError })
    } else {
      salvarNotaContato.mutate({ contactId: item.contact_id, notesAtual: item.notes, texto }, { onSuccess, onError })
    }
  }

  const ultimaNota = (item: CarteiraContato): string | null => {
    const human = getHumanNotes(item.notes)
    if (!human) return null
    return human.split('\n')[0] || null
  }

  const totalPaginas = total !== undefined ? Math.max(1, Math.ceil(total / CARTEIRA_PAGE_SIZE)) : 1

  return (
    <div className="flex flex-col gap-3">
      {/* Abas Ativos / Finalizados + contador */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border border-border overflow-hidden">
          {[{ v: true, l: 'Ativos' }, { v: false, l: 'Finalizados' }].map(o => (
            <button
              key={o.l}
              onClick={() => trocarAba(o.v)}
              className={cn(
                'h-8 px-3.5 text-[12.5px] font-medium transition-colors',
                mostrarAtivos === o.v ? 'bg-accent text-white' : 'bg-surface text-ink-muted hover:bg-surface-2',
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
        {total !== undefined && (
          <span className="text-[12px] text-ink-muted tabular-nums">
            {formatNumber(total)} {mostrarAtivos ? 'em aberto' : 'finalizado' + (total === 1 ? '' : 's')}
          </span>
        )}
      </div>

      {/* Busca + UF */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            leftIcon={<Search className="h-3.5 w-3.5" />}
            placeholder="Buscar nome, empresa ou telefone…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
          />
        </div>
        <Select
          value={uf}
          onChange={e => { setUf(e.target.value); setPage(0) }}
          placeholder="Todos os estados"
          options={ESTADOS_BR.map(e => ({ value: e, label: e }))}
          className="min-h-[44px] sm:min-h-0"
        />
      </div>

      {isLoading ? <PageLoading /> : !itens?.length ? (
        (search || uf) ? (
          <EmptyState
            icon="🔍"
            title="Nenhum contato com esses filtros"
            sub="Tenta limpar a busca ou trocar o estado."
            cta={<Button size="sm" onClick={() => { setSearch(''); setUf(''); setPage(0) }}>Limpar filtros</Button>}
          />
        ) : mostrarAtivos ? (
          <EmptyState
            icon="🎯"
            title="Sua carteira está vazia"
            sub="Você ainda não tem contatos em aberto. Pegue no Pool ou aguarde a chegada de novos leads."
            cta={<Button variant="primary" size="sm" onClick={onIrPool}><Hand className="h-3.5 w-3.5" /> Ir pro Pool</Button>}
          />
        ) : (
          <EmptyState icon="📁" title="Nenhuma venda finalizada ainda" />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {itens.map(item => {
              const nota = ultimaNota(item)
              const temClaim = !!item.claim_id
              const finalizado = !mostrarAtivos
              return (
                <Card key={item.contact_id}>
                  <CardContent className="px-4 py-3 flex flex-col gap-2">
                    {/* Cabeçalho: nome + estado + chamar */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-ink truncate">
                          {item.name?.trim() || <span className="text-ink-faint font-normal">(sem nome)</span>}
                          {item.city && <span className="text-ink-faint font-normal text-[12px]"> · {item.city}</span>}
                        </p>
                        <p className="text-[12.5px] text-ink-muted font-mono flex items-center gap-1">
                          {formatPhone(item.phone ?? '')}
                          {item.phone && <CopyPhone phone={item.phone} />}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.state && <Badge className="bg-surface-2 text-ink-muted">{item.state}</Badge>}
                        {!finalizado && item.telefone_normalizado && (
                          <a
                            href={whatsappLink(item.telefone_normalizado)}
                            target="_blank"
                            rel="noreferrer"
                            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-accent text-white text-[12.5px] font-medium hover:bg-accent/90 shadow-sm transition-all"
                          >
                            <MessageCircle className="h-3.5 w-3.5" /> Chamar
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Linha de contexto: orçamento / valor */}
                    <p className="text-[11.5px] text-ink-faint truncate">
                      {item.data_orcamento
                        ? `📄 Orçou em ${new Date(item.data_orcamento + 'T12:00:00').toLocaleDateString('pt-BR')}`
                        : (item.descricao_orcamento?.trim() || item.origin || '—')}
                      {item.valor_negociacao ? ` · 💰 ${brl(item.valor_negociacao)}` : ''}
                    </p>

                    {finalizado ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-success/10 text-success">
                          {temClaim ? (PROSPECCAO_STATUS_LABELS[item.claim_status ?? ''] ?? 'Fechado') : 'Venda fechada'}
                        </Badge>
                        {item.updated_at && <span className="text-[11.5px] text-ink-faint">{formatRelative(item.updated_at)}</span>}
                      </div>
                    ) : (
                      <>
                        {/* Prazo + status só p/ quem veio do pool */}
                        {temClaim && <DeadlineTag item={item} />}
                        {temClaim && (
                          <StatusChips
                            atual={item.claim_status ?? 'em_contato'}
                            disabled={atualizarStatus.isPending}
                            onChange={s => mudarStatus(item, s)}
                          />
                        )}

                        {/* Nota rápida (com ou sem claim) */}
                        <div className="flex gap-1.5">
                          <input
                            value={notaDraft[item.contact_id] ?? ''}
                            onChange={e => setNotaDraft(d => ({ ...d, [item.contact_id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') salvarNotaDo(item) }}
                            placeholder="✏️ Anotar… (ex: pediu preço da Compacta 02)"
                            className="flex-1 min-w-0 h-9 rounded-md border border-border bg-surface px-3 text-[12.5px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                          />
                          <Button size="sm" className="h-9" loading={salvarNota.isPending || salvarNotaContato.isPending} onClick={() => salvarNotaDo(item)}>
                            Salvar
                          </Button>
                        </div>
                        {nota && <p className="text-[11.5px] text-ink-faint truncate">🕐 {nota}</p>}

                        {/* Rodapé de prospecção: só p/ quem veio do pool */}
                        {temClaim && (finalizando === item.claim_id ? (
                          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2/50 p-2.5">
                            <p className="text-[12px] font-medium text-ink">Finalizar como:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {PROSPECCAO_STATUS_TERMINAIS.map(s => (
                                <button
                                  key={s.value}
                                  disabled={atualizarStatus.isPending || (s.value === 'sem_interesse' && !motivoSel)}
                                  onClick={() => mudarStatus(item, s.value, s.value === 'sem_interesse' ? motivoSel : undefined)}
                                  className={cn(
                                    'h-8 px-3 rounded-full text-[12px] font-medium border transition-all',
                                    'disabled:opacity-40 disabled:cursor-not-allowed',
                                    s.value === 'convertido'
                                      ? 'bg-success/10 text-success border-success/30 hover:bg-success/20'
                                      : 'bg-surface text-ink-muted border-border hover:border-border-strong',
                                  )}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                            <Select
                              value={motivoSel}
                              onChange={e => setMotivoSel(e.target.value)}
                              placeholder="Motivo (obrigatório p/ Sem interesse)"
                              options={MOTIVO_PERDA_OPTIONS}
                            />
                            <button onClick={() => { setFinalizando(null); setMotivoSel('') }} className="text-[11.5px] text-ink-faint hover:text-ink self-start">
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <div className="flex items-center gap-1">
                              {item.claim_status === 'em_contato' && (
                                <button
                                  title="Devolver ao pool (só antes do cliente responder)"
                                  disabled={atualizarStatus.isPending}
                                  onClick={() => mudarStatus(item, 'devolvido')}
                                  className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11.5px] text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
                                >
                                  <Undo2 className="h-3 w-3" /> Devolver
                                </button>
                              )}
                              {!item.renovado && item.claim_status !== 'negociando' && (
                                <button
                                  title="Renovar prazo (1x por contato)"
                                  disabled={renovar.isPending}
                                  onClick={() => renovar.mutate(item.claim_id!, {
                                    onSuccess: () => push('Prazo renovado ✓', 'success'),
                                    onError: () => push('Não deu pra renovar', 'danger'),
                                  })}
                                  className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11.5px] text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
                                >
                                  <RotateCw className="h-3 w-3" /> +prazo
                                </button>
                              )}
                            </div>
                            <button
                              onClick={() => setFinalizando(item.claim_id)}
                              className="h-7 px-2.5 rounded text-[11.5px] font-medium text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
                            >
                              Finalizar…
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Ficha completa do cliente (ativo ou finalizado) */}
                    <button
                      onClick={() => setFichaContact({ id: item.contact_id, phone: item.phone })}
                      className="w-full h-8 mt-0.5 inline-flex items-center justify-center gap-1.5 rounded-md border border-border text-[12px] font-medium text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
                    >
                      📋 Ficha completa
                    </button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Paginação */}
          {total !== undefined && total > CARTEIRA_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </Button>
              <span className="text-[12px] text-ink-muted tabular-nums px-2">Página {page + 1} de {totalPaginas}</span>
              <Button
                size="sm"
                disabled={(page + 1) * CARTEIRA_PAGE_SIZE >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Próxima <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      )}

      {fichaContact && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setFichaContact(null)} />
      )}
      <FichaContatoDrawer
        contactId={fichaContact?.id ?? null}
        phone={fichaContact?.phone ?? null}
        onClose={() => setFichaContact(null)}
        push={push}
      />
    </div>
  )
}

// ===========================================================================
// ABA GESTÃO (admin)
// ===========================================================================
function FunnelRow({ label, valor, base, tone, sub }: {
  label: string; valor: number; base: number; tone: string; sub?: string
}) {
  const pct = base > 0 ? Math.max(valor > 0 ? 4 : 0, Math.round((valor / base) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-right text-[12px] font-medium text-ink-muted">{label}</span>
      <div className="flex-1 h-7 rounded-md bg-surface-2 overflow-hidden relative">
        <div className={cn('h-full rounded-md transition-all duration-500', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 text-[13px] font-semibold text-ink tabular-nums text-right">
        {formatNumber(valor)}
        {sub && <span className="text-[11px] font-normal text-ink-faint ml-1">{sub}</span>}
      </span>
    </div>
  )
}

function GestaoTab({ push }: { push: (t: string, tone?: ToastMsg['tone']) => void }) {
  const [dias, setDias] = useState(30)
  const { data: metricas, isLoading } = useMetricasProspeccao(dias)
  const { data: config } = useProspeccaoConfig()
  const { data: poolTotal } = usePoolCount({ search: '', uf: '', origem: '' })
  const salvarConfig = useSalvarProspeccaoConfig()
  const [cfgDraft, setCfgDraft] = useState<{ cota: string; prazo: string; lote: string } | null>(null)
  const [ordenar, setOrdenar] = useState<'convertidos' | 'pegos' | 'trabalhados'>('convertidos')

  const totais = useMemo(() => {
    const m = metricas ?? []
    return {
      pegos: m.reduce((a, x) => a + Number(x.pegos), 0),
      trabalhados: m.reduce((a, x) => a + Number(x.trabalhados), 0),
      negociando: m.reduce((a, x) => a + Number(x.negociando), 0),
      convertidos: m.reduce((a, x) => a + Number(x.convertidos), 0),
      semInteresse: m.reduce((a, x) => a + Number(x.sem_interesse), 0),
      devolvidos: m.reduce((a, x) => a + Number(x.devolvidos), 0),
      ativos: m.reduce((a, x) => a + Number(x.ativos), 0),
    }
  }, [metricas])

  const metricasOrd = useMemo(() => {
    const m = [...(metricas ?? [])]
    return m.sort((a, b) => Number(b[ordenar]) - Number(a[ordenar]))
  }, [metricas, ordenar])

  const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—')

  const kpis = [
    { label: 'Pegos', valor: totais.pegos, sub: 'no período', bar: null as number | null, tone: 'bg-accent' },
    { label: 'Trabalhados', valor: totais.trabalhados, sub: `${pct(totais.trabalhados, totais.pegos)} dos pegos`, bar: totais.pegos ? totais.trabalhados / totais.pegos : 0, tone: 'bg-info' },
    { label: 'Convertidos', valor: totais.convertidos, sub: `conversão ${pct(totais.convertidos, totais.pegos)}`, bar: totais.pegos ? totais.convertidos / totais.pegos : 0, tone: 'bg-success' },
    { label: 'Devolvidos', valor: totais.devolvidos, sub: `${pct(totais.devolvidos, totais.pegos)} · devolv+expir`, bar: totais.pegos ? totais.devolvidos / totais.pegos : 0, tone: 'bg-warning' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Barra superior: período + resumo do pool ocupando a largura */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border overflow-hidden">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn(
                'h-8 px-4 text-[12.5px] font-medium transition-colors',
                dias === d ? 'bg-accent text-white' : 'bg-surface text-ink-muted hover:bg-surface-2',
              )}
            >
              {d} dias
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-accent-bg text-accent gap-1">
            <Target className="h-3 w-3" /> {poolTotal !== undefined ? formatNumber(poolTotal) : '…'} livres no pool
          </Badge>
          <Badge className="bg-surface-2 text-ink-muted">{formatNumber(totais.ativos)} em trabalho agora</Badge>
        </div>
      </div>

      {/* KPIs com mini-barra de contexto */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="px-4 py-3.5 flex flex-col gap-2">
              <p className="text-[11px] uppercase tracking-wider text-ink-faint font-medium">{k.label}</p>
              <p className="text-[26px] font-semibold text-ink tabular-nums leading-none">{formatNumber(k.valor)}</p>
              {k.bar !== null && (
                <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div className={cn('h-full rounded-full', k.tone)} style={{ width: `${Math.min(100, Math.round((k.bar ?? 0) * 100))}%` }} />
                </div>
              )}
              <p className="text-[11px] text-ink-faint">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funil + Config lado a lado (preenche a largura) */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
        <Card className="xl:col-span-3">
          <CardContent className="px-5 py-4 flex flex-col gap-3">
            <p className="text-[12.5px] font-semibold text-ink">Funil de prospecção · últimos {dias} dias</p>
            <div className="flex flex-col gap-2.5 pt-1">
              <FunnelRow label="Pegos" valor={totais.pegos} base={totais.pegos} tone="bg-accent" />
              <FunnelRow label="Trabalhados" valor={totais.trabalhados} base={totais.pegos} tone="bg-info" sub={pct(totais.trabalhados, totais.pegos)} />
              <FunnelRow label="Negociando" valor={totais.negociando} base={totais.pegos} tone="bg-accent/70" sub={pct(totais.negociando, totais.pegos)} />
              <FunnelRow label="Convertidos" valor={totais.convertidos} base={totais.pegos} tone="bg-success" sub={pct(totais.convertidos, totais.pegos)} />
            </div>
            <div className="flex items-center gap-4 pt-2 mt-1 border-t border-border text-[11.5px] text-ink-muted">
              <span>Sem interesse: <b className="text-ink tabular-nums">{formatNumber(totais.semInteresse)}</b></span>
              <span>Devolvidos/expirados: <b className="text-ink tabular-nums">{formatNumber(totais.devolvidos)}</b></span>
            </div>
          </CardContent>
        </Card>

        {config && (
          <Card className="xl:col-span-2">
            <CardContent className="px-5 py-4 flex flex-col gap-3">
              <p className="text-[12.5px] font-semibold text-ink flex items-center gap-1.5">
                <Settings2 className="h-3.5 w-3.5 text-ink-faint" /> Configurações do Pool
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'cota' as const, label: 'Cota / vendedor', atual: config.cota_ativos },
                  { key: 'prazo' as const, label: 'Prazo (dias)', atual: config.prazo_dias },
                  { key: 'lote' as const, label: 'Lote máx.', atual: config.lote_max },
                ].map(f => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-[11px] text-ink-faint leading-tight">{f.label}</span>
                    <input
                      type="number"
                      min={1}
                      value={cfgDraft ? cfgDraft[f.key] : String(f.atual)}
                      onChange={e => setCfgDraft(d => ({
                        cota: d?.cota ?? String(config.cota_ativos),
                        prazo: d?.prazo ?? String(config.prazo_dias),
                        lote: d?.lote ?? String(config.lote_max),
                        [f.key]: e.target.value,
                      }))}
                      className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                    />
                  </label>
                ))}
              </div>
              <Button
                variant="primary"
                size="sm"
                className="h-9 self-start"
                disabled={!cfgDraft}
                loading={salvarConfig.isPending}
                onClick={() => cfgDraft && salvarConfig.mutate(
                  { cota: Number(cfgDraft.cota) || 1, prazo: Number(cfgDraft.prazo) || 1, lote: Number(cfgDraft.lote) || 1 },
                  {
                    onSuccess: () => { setCfgDraft(null); push('Configuração salva ✓', 'success') },
                    onError: () => push('Não salvou a configuração', 'danger'),
                  },
                )}
              >
                Salvar configuração
              </Button>
              <p className="text-[11px] text-ink-faint leading-relaxed">
                Contatos sem interação por {config.prazo_dias} dias voltam pro pool sozinhos (exceto em Negociando).
                Quarentena de {config.quarentena_dias} dias pra quem terminou como sem interesse / incontactável / já é cliente.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabela por vendedor (largura total) */}
      <Card>
        <CardContent className="px-0 py-0">
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
            <p className="text-[12.5px] font-semibold text-ink">Por vendedor</p>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ink-faint">ordenar:</span>
              {([['convertidos', 'Convertidos'], ['pegos', 'Pegos'], ['trabalhados', 'Trabalhados']] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setOrdenar(k)}
                  className={cn(
                    'h-7 px-2.5 rounded-md text-[11.5px] font-medium transition-colors',
                    ordenar === k ? 'bg-accent-bg text-accent' : 'text-ink-muted hover:bg-surface-2',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <div className="py-10"><PageLoading /></div>
          ) : !metricas?.length ? (
            <div className="py-10">
              <EmptyState icon="📊" title="Nenhuma prospecção registrada ainda" sub="Assim que os vendedores pegarem contatos do pool, os números aparecem aqui." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">Vendedor</th>
                    <th className="px-3 py-2.5 font-medium text-right">Pegos</th>
                    <th className="px-3 py-2.5 font-medium text-right">Trabalhados</th>
                    <th className="px-3 py-2.5 font-medium text-right">Negociando</th>
                    <th className="px-3 py-2.5 font-medium text-right">Convertidos</th>
                    <th className="px-3 py-2.5 font-medium text-right">Sem interesse</th>
                    <th className="px-3 py-2.5 font-medium text-right">Devolvidos</th>
                    <th className="px-5 py-2.5 font-medium text-right">Ativos agora</th>
                  </tr>
                </thead>
                <tbody>
                  {metricasOrd.map(m => {
                    const pegos = Number(m.pegos)
                    const trab = Number(m.trabalhados)
                    const dev = Number(m.devolvidos)
                    const taxaTrabalhoBaixa = pegos >= 5 && trab / pegos < 0.7
                    const devolucaoAlta = pegos >= 5 && dev / pegos > 0.2
                    return (
                      <tr key={m.vendor_id} className="border-b border-border last:border-0 hover:bg-surface-2/50 transition-colors">
                        <td className="px-5 py-2.5 font-medium text-ink">{m.vendor_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pegos}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', taxaTrabalhoBaixa && 'text-warning font-medium')}>
                          {trab} ({pct(trab, pegos)}){taxaTrabalhoBaixa && ' ⚠'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{m.negociando}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-success font-medium">{m.convertidos}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{m.sem_interesse}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', devolucaoAlta && 'text-warning font-medium')}>
                          {dev}{devolucaoAlta && ' ⚠'}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{m.ativos}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===========================================================================
// PÁGINA
// ===========================================================================
export function Prospeccao() {
  const { profile } = useAuth()
  const can = useCan()
  const podeGestao = can('prospeccao.gestao') || profile?.role === 'admin'
  const [tab, setTab] = useState<Tab>(() => (profile?.role === 'admin' ? 'gestao' : 'pool'))
  const [toasts, push] = useToast()

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'pool', label: 'Pool', show: true },
    { id: 'meus', label: 'Meus contatos', show: true },
    { id: 'gestao', label: 'Gestão', show: podeGestao },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-[18px] font-semibold text-ink flex items-center gap-2">
          <Target className="h-5 w-5 text-accent" /> Prospecção
        </h1>
        <p className="text-[12.5px] text-ink-muted">
          Pegue contatos livres, chame no WhatsApp e anote como foi — o que ficar parado volta pro pool.
        </p>
      </div>

      <div className="flex rounded-lg border border-border overflow-hidden self-start">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-9 px-4 text-[13px] font-medium transition-colors',
              tab === t.id ? 'bg-accent text-white' : 'bg-surface text-ink-muted hover:bg-surface-2',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pool' && <PoolTab push={push} onIrMeus={() => setTab('meus')} />}
      {tab === 'meus' && <MeusTab push={push} onIrPool={() => setTab('pool')} />}
      {tab === 'gestao' && podeGestao && <GestaoTab push={push} />}

      <ToastStack toasts={toasts} />
    </div>
  )
}
