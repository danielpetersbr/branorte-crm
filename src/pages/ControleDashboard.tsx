import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { QueryNotice } from '@/components/ui/QueryNotice'
import { useControleVendas, type Periodo, type ControleVendas } from '@/hooks/useControleDashboard'
import { ORIGEM_TODAS, ORIGEM_NAO_INFORMADA, rotuloOrigemVenda } from '@/lib/vendas-origem'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Flag, DollarSign, TrendingUp, Target, CalendarRange, BarChart3 } from 'lucide-react'

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mês' },
]

function fmtCompact(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}K`
  return `R$ ${v.toFixed(0)}`
}
function fmtFull(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

function barColor(pct: number): string {
  if (pct >= 100) return 'bg-green-500'
  if (pct >= 75) return 'bg-amber-500'
  return 'bg-accent'
}

function KpiCard({ title, value, icon: Icon }: { title: string; value: string; icon: typeof DollarSign }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{title}</span>
        <Icon className="h-4 w-4 text-text-muted" />
      </div>
      <p className="mt-2 text-2xl font-bold text-text-primary tabular-nums">{value}</p>
    </Card>
  )
}

function MetaCard({ title, realizado, meta, pct, falta, icon: Icon }: {
  title: string; realizado: number; meta: number; pct: number; falta: number; icon: typeof Target
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Realizado</p>
          <p className="text-lg font-bold text-accent tabular-nums">{fmtFull(realizado)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Meta</p>
          <p className="text-lg font-bold text-text-primary tabular-nums">{meta > 0 ? fmtFull(meta) : '—'}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-muted">Progresso</span>
        <span className="text-xs font-bold text-accent tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-surface-tertiary overflow-hidden">
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between rounded bg-surface-secondary px-2.5 py-2">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Falta</span>
        <span className="text-sm font-bold text-text-primary tabular-nums">{fmtFull(falta)}</span>
      </div>
    </Card>
  )
}

// Filtro por ORIGEM da venda (roadmap #80, pedido do marketing — 29/09/2026).
// Recorta TODOS os números da tela. A linha de cobertura fica sempre à vista e
// sempre sobre o total: a origem é a que o vendedor declarou no pedido e parte
// das vendas não tem nenhuma — somar os chips não dá o faturamento, e a tela não
// pode deixar parecer que dá.
function FiltroOrigem({ data, origem, onChange }: {
  data: ControleVendas; origem: string; onChange: (o: string) => void
}) {
  const { total, informada } = data.coberturaOrigem
  const pctValor = total.valor > 0 ? (informada.valor / total.valor) * 100 : 0
  const chips = [
    { chave: ORIGEM_TODAS, rotulo: 'Todas', vendas: total.vendas },
    ...data.origens,
  ]
  // Origem escolhida que sumiu da lista (ex.: pedido editado) continua visível
  // como chip ativo — senão a tela mostraria números recortados sem dizer por quê.
  if (origem !== ORIGEM_TODAS && !chips.some(c => c.chave === origem)) {
    chips.push({ chave: origem, rotulo: rotuloOrigemVenda(origem), vendas: 0 })
  }
  return (
    <Card className="p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted mr-1">Origem da venda</span>
        {chips.map(c => {
          const ativo = origem === c.chave
          const semOrigem = c.chave === ORIGEM_NAO_INFORMADA
          return (
            <button
              key={c.chave}
              type="button"
              aria-pressed={ativo}
              onClick={() => onChange(c.chave)}
              title={semOrigem ? 'Pedido sem origem, com "Não informado" ou "Não lembra"' : undefined}
              className={`inline-flex items-center gap-1 px-2.5 h-7 text-xs font-medium rounded-full border transition-colors ${
                ativo
                  ? 'bg-accent border-accent text-white'
                  : semOrigem
                    ? 'border-dashed border-surface-border text-text-muted hover:text-text-primary'
                    : 'border-surface-border bg-surface-secondary text-text-secondary hover:text-text-primary'
              }`}
            >
              {c.rotulo}
              {c.vendas > 0 && <span className={`tabular-nums ${ativo ? 'text-white/80' : 'text-text-muted'}`}>{c.vendas}</span>}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-text-muted">
        Origem informada em <span className="font-semibold text-text-secondary tabular-nums">{informada.vendas} de {total.vendas}</span> vendas
        do mês ({fmtFull(informada.valor)} de {fmtFull(total.valor)} · {pctValor.toFixed(0)}% do valor).
        É o que o vendedor marcou no pedido ("Como o cliente encontrou a empresa?"), não rastreio de lead.
        {origem !== ORIGEM_TODAS && (
          <span className="font-semibold text-text-secondary"> Todos os números abaixo são só de: {rotuloOrigemVenda(origem)}.</span>
        )}
      </p>
    </Card>
  )
}

export function ControleDashboard() {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [origem, setOrigem] = useState<string>(ORIGEM_TODAS)
  const { data, isLoading, error, refetch, isFetching } = useControleVendas(periodo, origem)

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-accent" />
            Painel de Vendas
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Espelho do controle.branorte.com · atualizado pelo sync
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-secondary p-0.5">
          {PERIODOS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriodo(p.key)}
              className={`px-3 h-7 text-xs font-medium rounded transition-colors ${
                periodo === p.key ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <QueryNotice error={error} loading={isFetching} onRetry={() => { void refetch() }} message="Não foi possível carregar o Painel de Vendas." /> : isLoading && !data ? <PageLoading /> : data && (
        <>
          <FiltroOrigem data={data} origem={origem} onChange={setOrigem} />

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard title="Valor Total (mês)" value={fmtFull(data.valorTotal)} icon={DollarSign} />
            <KpiCard title="Ticket Médio (mês)" value={fmtFull(data.ticketMedio)} icon={TrendingUp} />
            <KpiCard title="Vendas no Mês" value={String(data.totalVendasMes)} icon={Flag} />
            <KpiCard title="Meta do Mês" value={`${data.metaMes.pct.toFixed(1)}%`} icon={Target} />
          </div>

          {/* Corrida de Vendas */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Flag className="h-4 w-4 text-text-muted" /> Corrida de Vendas
              </h3>
              <span className="text-[11px] text-text-muted">
                Meta: <span className="font-semibold text-text-secondary">{fmtFull(data.metaCorrida)}</span>
              </span>
            </div>
            {data.ranking.length === 0 ? (
              <p className="text-center py-8 text-sm text-text-muted">Nenhuma venda no período.</p>
            ) : (
              <div className="space-y-1.5">
                {data.ranking.slice(0, 10).map((s, i) => {
                  const pctVisual = Math.min(Math.max(s.pctCorrida, 0), 100)
                  return (
                    <div key={s.vendedor} className="flex items-center gap-2 h-9">
                      <span className={`w-5 text-center text-xs font-bold shrink-0 ${
                        i === 0 ? 'text-amber-500' : i === 1 ? 'text-text-secondary' : i === 2 ? 'text-orange-400' : 'text-text-muted'
                      }`}>{i + 1}º</span>
                      <span className="text-xs font-medium text-text-primary w-24 truncate shrink-0">{s.vendedor}</span>
                      <div className="flex-1 h-5 rounded bg-surface-tertiary overflow-hidden relative">
                        <div className={`h-full rounded transition-all duration-700 ${barColor(s.pctCorrida)}`} style={{ width: `${pctVisual}%` }} />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-primary tabular-nums">
                          {s.pctCorrida.toFixed(1)}%
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-text-primary w-24 text-right shrink-0 tabular-nums hidden sm:block">{fmtCompact(s.realizado)}</span>
                      <span className="text-[10px] text-text-muted w-8 text-right shrink-0 hidden md:block">{s.vendas}v</span>
                    </div>
                  )
                })}
                <div className="flex items-center gap-4 pt-3 mt-2 border-t border-surface-border">
                  {[{ c: 'bg-accent', l: '< 75%' }, { c: 'bg-amber-500', l: '75–99%' }, { c: 'bg-green-500', l: '≥ 100%' }].map(x => (
                    <div key={x.l} className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-sm ${x.c}`} />
                      <span className="text-[10px] text-text-muted">{x.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Faturamento Mensal */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-text-muted" />
              <h3 className="text-sm font-semibold text-text-primary">Faturamento Mensal</h3>
              <span className="text-[11px] text-text-muted ml-1">Últimos 6 meses</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.faturamentoMensal} margin={{ top: 10, right: 16, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="fatFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(152 60% 40%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(152 60% 40%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-border" vertical={false} opacity={0.3} />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-text-muted" axisLine={false} tickLine={false} width={42}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: unknown) => [fmtFull(Number(value)), 'Faturamento'] as [string, string]}
                  contentStyle={{ background: 'hsl(240 6% 97%)', border: '1px solid hsl(240 6% 88%)', borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="valor" stroke="hsl(152 60% 40%)" strokeWidth={2.5} fill="url(#fatFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* Metas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <MetaCard title="Meta do Mês" {...data.metaMes} icon={Target} />
            <MetaCard title="Meta Semanal" {...data.metaSemanal} icon={CalendarRange} />
          </div>
        </>
      )}
    </div>
  )
}
