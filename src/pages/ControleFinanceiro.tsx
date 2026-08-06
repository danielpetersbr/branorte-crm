import { useState, useMemo, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useControleFinanceiro, useControleFinanceiroPedido, FinanceiroErro,
  type PedidoFinanceiro, type StatusPedido, type StatusParcela, type Parcela,
} from '@/hooks/useControleFinanceiro'
import {
  Wallet, TrendingDown, CheckCircle2, Search, AlertTriangle, FileWarning,
  CalendarClock, X, Paperclip, Receipt, ShieldAlert, Clock,
} from 'lucide-react'

const PAGE_SIZE = 60

type Atalho = 'todos' | 'vencidos' | 'receber' | 'quitados' | 'sem_comprovante' | 'boleto_pendente' | 'sem_plano' | 'divergente'

function brl(v: number, casas = 0): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: casas })
}

function dataBR(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : '—'
}

// ── vocabulário visual (item 15: cor com significado) ────────────────────────

const PEDIDO_ROTULO: Record<StatusPedido, string> = {
  QUITADO: 'Quitado', EM_DIA: 'Em dia', PARCIAL: 'Pagamento parcial',
  VENCIDO: 'Com parcela vencida', SEM_PLANO: 'Sem condição de pagamento', CANCELADO: 'Cancelado',
}
const PEDIDO_COR: Record<StatusPedido, string> = {
  QUITADO: 'bg-success-bg text-success',
  EM_DIA: 'bg-info-bg text-info',
  PARCIAL: 'bg-warning-bg text-warning',
  VENCIDO: 'bg-danger-bg text-danger',
  SEM_PLANO: 'bg-surface-2 text-text-muted',
  CANCELADO: 'bg-surface-2 text-text-muted',
}

const PARCELA_ROTULO: Record<StatusParcela, string> = {
  PAGO: 'Pago', PARCIAL: 'Parcial', VENCIDO: 'Vencido', VENCE_HOJE: 'Vence hoje',
  BOLETO_ENVIADO: 'Boleto enviado', PENDENTE: 'Pendente', CANCELADA: 'Cancelada',
}
const PARCELA_COR: Record<StatusParcela, string> = {
  PAGO: 'bg-success-bg text-success',
  PARCIAL: 'bg-warning-bg text-warning',
  VENCIDO: 'bg-danger-bg text-danger',
  VENCE_HOJE: 'bg-warning-bg text-warning',
  BOLETO_ENVIADO: 'bg-info-bg text-info',
  PENDENTE: 'bg-surface-2 text-text-muted',
  CANCELADA: 'bg-surface-2 text-text-muted',
}

// ── blocos ───────────────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, icon: Icon, tone }: {
  title: string; value: string; sub?: string; icon: typeof Wallet
  tone?: 'accent' | 'danger' | 'warning'
}) {
  const cor = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-accent' : 'text-text-primary'
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{title}</span>
        <Icon className={`h-4 w-4 ${tone ? cor : 'text-text-muted'}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${cor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-text-muted">{sub}</p>}
    </Card>
  )
}

/** Chip de pendência: mostra o número E filtra a tabela quando clicado. */
function ChipPendencia({ n, label, ativo, onClick, icon: Icon, tone }: {
  n: number; label: string; ativo: boolean; onClick: () => void; icon: typeof Wallet
  tone: 'danger' | 'warning' | 'info' | 'muted'
}) {
  const cores = {
    danger: 'text-danger border-danger/30 bg-danger-bg',
    warning: 'text-warning border-warning/30 bg-warning-bg',
    info: 'text-info border-info/30 bg-info-bg',
    muted: 'text-text-muted border-border bg-surface-2',
  }[tone]
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`flex items-center gap-2 rounded-md border px-3 h-9 text-xs font-medium transition-all
        ${cores} ${ativo ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : 'hover:brightness-110'}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums font-bold">{n}</span>
      <span className="font-normal opacity-90">{label}</span>
    </button>
  )
}

function LinhaParcela({ p }: { p: Parcela }) {
  return (
    <div className={`rounded-md border p-3 ${p.cancelada ? 'border-border opacity-60' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-text-muted">
              {p.numero}/{p.totalParcelas}
            </span>
            <span className="text-sm font-medium text-text-primary">{p.descricao}</span>
            <Badge className={PARCELA_COR[p.status]}>{PARCELA_ROTULO[p.status]}</Badge>
            {p.boletoEnviado && p.status !== 'BOLETO_ENVIADO' && (
              <Badge className="bg-info-bg text-info">boleto enviado</Badge>
            )}
            {p.aguardandoComprovante && (
              <Badge className="bg-warning-bg text-warning">
                <ShieldAlert className="h-3 w-3" /> sem comprovante
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-muted flex-wrap">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" /> vence {dataBR(p.vencimento)}
            </span>
            {p.diasAtraso > 0 && (
              <span className="text-danger font-medium">{p.diasAtraso} dia{p.diasAtraso > 1 ? 's' : ''} em atraso</span>
            )}
            {p.boletoEnviadoEm && <span>boleto em {dataBR(p.boletoEnviadoEm)}</span>}
            {p.cancelada && p.motivoCancelamento && <span>cancelada: {p.motivoCancelamento}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums text-text-primary">{brl(p.valor, 2)}</p>
          {p.recebido > 0.01 && (
            <p className="text-xs tabular-nums text-success">recebido {brl(p.recebido, 2)}</p>
          )}
          {p.saldo > 0.01 && p.recebido > 0.01 && (
            <p className="text-xs tabular-nums text-danger">falta {brl(p.saldo, 2)}</p>
          )}
        </div>
      </div>

      {p.recebimentos.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {p.recebimentos.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <Receipt className="h-3 w-3 text-text-muted shrink-0" />
              <span className="tabular-nums text-text-secondary">{brl(r.valor, 2)}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">{r.meio}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">{dataBR(r.pagoEm)}</span>
              {r.comprovanteUrl ? (
                <a href={r.comprovanteUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
                  <Paperclip className="h-3 w-3" /> comprovante
                </a>
              ) : (
                <span className="ml-auto text-warning">sem comprovante</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PainelPedido({ pedidoId, onClose }: { pedidoId: string; onClose: () => void }) {
  const { data: p, isLoading, error } = useControleFinanceiroPedido(pedidoId)

  // Esc fecha o painel
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Detalhe financeiro do pedido"
        className="relative w-full max-w-2xl bg-bg border-l border-border overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-sm text-text-muted">{p?.pedidoNumero || '...'}</p>
            <h2 className="text-lg font-bold text-text-primary truncate">{p?.cliente || 'Carregando…'}</h2>
            {p && <p className="text-xs text-text-muted mt-0.5">{p.vendedor} · venda em {dataBR(p.dataVenda)}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && <PageLoading />}
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
              {error instanceof FinanceiroErro ? error.message : 'Falha ao carregar o pedido.'}
            </div>
          )}

          {p && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">Valor do pedido</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">{brl(p.valorTotal)}</p></div>
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">Recebido</p>
                  <p className="text-lg font-bold tabular-nums text-success">{brl(p.recebido)}</p></div>
                <div><p className="text-[11px] uppercase tracking-wider text-text-muted">A receber</p>
                  <p className="text-lg font-bold tabular-nums text-danger">{brl(p.aReceber)}</p></div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={PEDIDO_COR[p.status]}>{PEDIDO_ROTULO[p.status]}</Badge>
                {p.proximoVencimento && (
                  <Badge className="bg-surface-2 text-text-secondary">
                    próximo vencimento {dataBR(p.proximoVencimento)}
                  </Badge>
                )}
              </div>

              {/* item 1 do spec: a soma das parcelas tem que fechar com o pedido */}
              {Math.abs(p.divergenciaPlano) > 0.01 && (
                <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-bg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                  <div className="text-xs text-warning">
                    <p className="font-semibold">A soma da condição de pagamento está diferente do valor total do pedido.</p>
                    <p className="mt-1 opacity-90">
                      Parcelas somam <strong>{brl(p.somaParcelas)}</strong> e o pedido vale <strong>{brl(p.valorTotal)}</strong> —
                      diferença de <strong>{brl(Math.abs(p.divergenciaPlano))}</strong>{p.divergenciaPlano > 0 ? ' a mais' : ' a menos'}.
                    </p>
                  </div>
                </div>
              )}

              {p.parcelas.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-2 p-4 text-center">
                  <FileWarning className="mx-auto h-5 w-5 text-text-muted" />
                  <p className="mt-2 text-sm text-text-secondary">Este pedido não tem condição de pagamento cadastrada.</p>
                </div>
              ) : (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Parcelas ({p.parcelas.length})
                  </h3>
                  <div className="space-y-2">
                    {p.parcelas.map(pc => <LinhaParcela key={pc.id} p={pc} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

// ── página ───────────────────────────────────────────────────────────────────

export function ControleFinanceiro() {
  const { data, isLoading, error } = useControleFinanceiro()
  const [atalho, setAtalho] = useState<Atalho>('vencidos')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [aberto, setAberto] = useState<string | null>(null)

  const filtra = (r: PedidoFinanceiro): boolean => {
    switch (atalho) {
      case 'vencidos': return r.vencido > 0.01
      case 'receber': return r.aReceber > 0.01 && r.status !== 'CANCELADO'
      case 'quitados': return r.status === 'QUITADO'
      case 'sem_comprovante': return r.pagamentosSemComprovante > 0
      case 'boleto_pendente': return r.boletosPendentes > 0
      case 'sem_plano': return r.status === 'SEM_PLANO'
      case 'divergente': return Math.abs(r.divergenciaPlano) > 0.01
      default: return true
    }
  }

  const rows = useMemo(() => {
    let r = (data?.pedidos ?? []).filter(filtra)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        (x.cliente || '').toLowerCase().includes(q) ||
        (x.pedidoNumero || '').toLowerCase().includes(q) ||
        (x.vendedor || '').toLowerCase().includes(q))
    }
    return r
  }, [data, atalho, search])

  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const k = data?.kpis
  const escopado = data?.escopo.vendedores !== null

  const ir = (a: Atalho) => { setAtalho(a); setPage(0) }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Wallet className="h-7 w-7 text-accent" />
          Financeiro · Recebíveis
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Parcelas e recebimentos ao vivo do controle.branorte.com
          {escopado && data && <> · mostrando <strong>{data.escopo.vendedores?.join(', ')}</strong></>}
        </p>
      </div>

      {error && (
        <Card className="border-danger/30 p-4">
          <div className="flex gap-2 text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Não deu pra carregar o financeiro.</p>
              <p className="mt-0.5 opacity-90">
                {error instanceof FinanceiroErro ? error.message : (error as Error).message}
              </p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && !data ? <PageLoading /> : data && k && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard title="Total Vendido" value={brl(k.totalVendido)} icon={Wallet}
              sub={`${data.pedidos.length} pedido${data.pedidos.length !== 1 ? 's' : ''}`} />
            <KpiCard title="Recebido" value={brl(k.totalRecebido)} icon={CheckCircle2} tone="accent"
              sub={`${k.pedidosQuitados} quitado${k.pedidosQuitados !== 1 ? 's' : ''} · ${k.pedidosParciais} parcial`} />
            <KpiCard title="A Receber" value={brl(k.totalAReceber)} icon={TrendingDown} />
            <KpiCard title="Vencido" value={brl(k.totalVencido)} icon={Clock} tone="danger"
              sub={`em ${k.pedidosComVencido} pedido${k.pedidosComVencido !== 1 ? 's' : ''}`} />
          </div>

          {/* Pendências: cada chip é também um filtro (item 9 — atalhos rápidos) */}
          <div className="flex flex-wrap gap-2">
            <ChipPendencia n={k.pedidosComVencido} label="com parcela vencida" tone="danger"
              icon={Clock} ativo={atalho === 'vencidos'} onClick={() => ir('vencidos')} />
            <ChipPendencia n={k.pagamentosSemComprovante} label="pagamentos sem comprovante" tone="warning"
              icon={ShieldAlert} ativo={atalho === 'sem_comprovante'} onClick={() => ir('sem_comprovante')} />
            <ChipPendencia n={k.boletosPendentes} label="boletos a enviar" tone="info"
              icon={Paperclip} ativo={atalho === 'boleto_pendente'} onClick={() => ir('boleto_pendente')} />
            <ChipPendencia n={k.pedidosSemPlano} label="sem condição de pagamento" tone="muted"
              icon={FileWarning} ativo={atalho === 'sem_plano'} onClick={() => ir('sem_plano')} />
            <ChipPendencia n={k.planosDivergentes} label="plano ≠ valor do pedido" tone="warning"
              icon={AlertTriangle} ativo={atalho === 'divergente'} onClick={() => ir('divergente')} />
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
                {([['receber', 'A Receber'], ['quitados', 'Quitados'], ['todos', 'Todos']] as [Atalho, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => ir(key)}
                    className={`px-3 h-7 text-xs font-medium rounded transition-colors ${
                      atalho === key ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <Input
                placeholder="Buscar cliente, pedido ou vendedor..."
                leftIcon={<Search className="h-4 w-4" />}
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="lg:w-80"
              />
              <span className="text-sm text-text-muted ml-auto">
                {rows.length.toLocaleString('pt-BR')} pedido{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
          </Card>

          {/* Tabela (desktop) */}
          <Card className="overflow-hidden hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Pedido</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cliente</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Total</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Recebido</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">A Receber</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Vencido</th>
                    <th className="text-center text-xs font-medium text-text-muted px-4 py-3">Parc.</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Próx. venc.</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map(r => (
                    <tr key={r.id} onClick={() => setAberto(r.id)}
                      className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                      <td className="px-4 py-3"><span className="text-sm font-medium text-text-primary font-mono">{r.pedidoNumero || '—'}</span></td>
                      <td className="px-4 py-3"><span className="text-sm text-text-primary truncate max-w-[200px] block" title={r.cliente || ''}>{r.cliente || '(sem nome)'}</span></td>
                      <td className="px-4 py-3"><span className="text-sm text-text-secondary">{r.vendedor || '—'}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-sm text-text-primary tabular-nums">{brl(r.valorTotal)}</span></td>
                      <td className="px-4 py-3 text-right"><span className={`text-sm tabular-nums ${r.recebido > 0.01 ? 'text-success' : 'text-text-muted'}`}>{brl(r.recebido)}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-sm font-semibold tabular-nums text-text-primary">{brl(r.aReceber)}</span></td>
                      <td className="px-4 py-3 text-right"><span className={`text-sm tabular-nums ${r.vencido > 0.01 ? 'text-danger font-semibold' : 'text-text-muted'}`}>{r.vencido > 0.01 ? brl(r.vencido) : '—'}</span></td>
                      <td className="px-4 py-3 text-center"><span className="text-sm tabular-nums text-text-secondary">{r.qtdParcelas || '—'}</span></td>
                      <td className="px-4 py-3"><span className="text-sm text-text-secondary">{dataBR(r.proximoVencimento)}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge className={PEDIDO_COR[r.status]}>{PEDIDO_ROTULO[r.status]}</Badge>
                          {r.pagamentosSemComprovante > 0 && (
                            <Badge className="bg-warning-bg text-warning" title="pagamento lançado sem comprovante anexado">
                              <ShieldAlert className="h-3 w-3" />{r.pagamentosSemComprovante}
                            </Badge>
                          )}
                          {Math.abs(r.divergenciaPlano) > 0.01 && (
                            <Badge className="bg-warning-bg text-warning" title="a soma das parcelas não fecha com o valor do pedido">
                              <AlertTriangle className="h-3 w-3" />
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-text-muted">Nenhum pedido neste filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Cards (mobile) — item 15: no celular vira card mantendo as ações */}
          <div className="space-y-2 lg:hidden">
            {pageRows.map(r => (
              <Card key={r.id} hover onClick={() => setAberto(r.id)} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-text-muted">{r.pedidoNumero || '—'}</p>
                    <p className="text-sm font-medium text-text-primary truncate">{r.cliente || '(sem nome)'}</p>
                    <p className="text-xs text-text-muted">{r.vendedor || '—'}</p>
                  </div>
                  <Badge className={PEDIDO_COR[r.status]}>{PEDIDO_ROTULO[r.status]}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
                  <div><p className="text-[10px] uppercase text-text-muted">Total</p>
                    <p className="text-xs font-semibold tabular-nums text-text-primary">{brl(r.valorTotal)}</p></div>
                  <div><p className="text-[10px] uppercase text-text-muted">Recebido</p>
                    <p className="text-xs font-semibold tabular-nums text-success">{brl(r.recebido)}</p></div>
                  <div><p className="text-[10px] uppercase text-text-muted">Vencido</p>
                    <p className={`text-xs font-semibold tabular-nums ${r.vencido > 0.01 ? 'text-danger' : 'text-text-muted'}`}>
                      {r.vencido > 0.01 ? brl(r.vencido) : '—'}</p></div>
                </div>
              </Card>
            ))}
            {pageRows.length === 0 && (
              <Card className="p-6 text-center text-text-muted text-sm">Nenhum pedido neste filtro.</Card>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 h-8 text-sm rounded-md border border-border text-text-secondary disabled:opacity-40 hover:bg-surface-2">Anterior</button>
              <span className="text-sm text-text-secondary">{page + 1} / {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="px-3 h-8 text-sm rounded-md border border-border text-text-secondary disabled:opacity-40 hover:bg-surface-2">Próxima</button>
            </div>
          )}
        </>
      )}

      {aberto && <PainelPedido pedidoId={aberto} onClose={() => setAberto(null)} />}
    </div>
  )
}
