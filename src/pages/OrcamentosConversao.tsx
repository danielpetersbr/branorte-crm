import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { useOrcamentosConversao } from '@/hooks/useOrcamentosConversao'
import { TrendingUp, FileText, CheckCircle, XCircle, Clock, Trophy, DollarSign, Send } from 'lucide-react'

const JANELAS = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '180 dias' },
  { dias: 365, label: '1 ano' },
]

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatBRLPrecise(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function OrcamentosConversao() {
  const [janela, setJanela] = useState(90)
  const { data, isLoading } = useOrcamentosConversao(janela)

  if (isLoading || !data) return <PageLoading />
  const { summary, ranking } = data

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-accent" /> Conversão de Orçamentos
          </h1>
          <p className="text-ink-muted text-sm">
            Funil de orçamento → venda. Ticket médio, taxa de conversão e ranking por vendedor.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-1">
          {JANELAS.map(j => (
            <button
              key={j.dias}
              onClick={() => setJanela(j.dias)}
              className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition-colors ${
                janela === j.dias
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-3'
              }`}
            >{j.label}</button>
          ))}
        </div>
      </header>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total criados"
          icon={FileText}
          valor={summary.total.toString()}
          sub={`${summary.rascunhos} rascunhos`}
        />
        <KpiCard
          label="Enviados"
          icon={Send}
          valor={summary.enviados.toString()}
          sub={formatBRL(summary.totalEnviadoBRL)}
          tone="info"
        />
        <KpiCard
          label="Aprovados"
          icon={CheckCircle}
          valor={summary.aprovados.toString()}
          sub={formatBRL(summary.totalAprovadoBRL)}
          tone="success"
        />
        <KpiCard
          label="Conversão"
          icon={TrendingUp}
          valor={`${summary.conversaoPct.toFixed(1)}%`}
          sub={`${summary.aprovados}/${summary.aprovados + summary.perdidos} decididos`}
          tone={summary.conversaoPct >= 30 ? 'success' : summary.conversaoPct >= 15 ? 'warning' : 'danger'}
        />
      </div>

      {/* KPIs secundários */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          label="Ticket médio enviado"
          icon={DollarSign}
          valor={formatBRL(summary.ticketMedioEnviado)}
          sub="média de todos enviados"
        />
        <KpiCard
          label="Ticket médio aprovado"
          icon={DollarSign}
          valor={formatBRL(summary.ticketMedioAprovado)}
          sub="média dos fechados"
          tone="success"
        />
        <KpiCard
          label="Tempo médio até decisão"
          icon={Clock}
          valor={summary.tempoMedioDias != null ? `${summary.tempoMedioDias.toFixed(1)} dias` : '—'}
          sub="enviado → aprovado/perdido"
        />
      </div>

      {/* Funil visual */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" /> Funil
        </h2>
        <FunilBar
          stages={[
            { label: 'Criados', value: summary.total, color: 'bg-ink-muted' },
            { label: 'Enviados', value: summary.enviados, color: 'bg-info' },
            { label: 'Aprovados', value: summary.aprovados, color: 'bg-success' },
          ]}
        />
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-ink-muted">
          <div>Rascunho → Enviado: <strong className="text-ink">{summary.total > 0 ? ((summary.enviados / summary.total) * 100).toFixed(0) : 0}%</strong></div>
          <div>Enviado → Aprovado: <strong className="text-ink">{summary.enviados > 0 ? ((summary.aprovados / summary.enviados) * 100).toFixed(0) : 0}%</strong></div>
          <div>Total → Aprovado: <strong className="text-ink">{summary.total > 0 ? ((summary.aprovados / summary.total) * 100).toFixed(0) : 0}%</strong></div>
        </div>
      </Card>

      {/* Ranking de vendedores */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent" /> Ranking por vendedor
        </h2>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Vendedor</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Total</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Aprovados</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Perdidos</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Conversão</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">R$ Aprovado</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((v, idx) => (
                <tr key={v.vendedor_nome} className="border-t border-border/40 hover:bg-surface-2/30">
                  <td className="px-3 py-2 font-medium text-ink flex items-center gap-2">
                    {idx === 0 && <Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                    {idx === 1 && <Trophy className="h-3.5 w-3.5 text-gray-400" />}
                    {idx === 2 && <Trophy className="h-3.5 w-3.5 text-amber-700" />}
                    {v.vendedor_nome}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{v.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-success font-bold">{v.aprovados}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">{v.perdidos}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    v.conversaoPct >= 30 ? 'text-success' : v.conversaoPct >= 15 ? 'text-warning' : 'text-ink-muted'
                  }`}>
                    {v.conversaoPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{formatBRLPrecise(v.totalAprovadoBRL)}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-ink-faint italic">Sem orçamentos no período selecionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

interface KpiCardProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  valor: string
  sub?: string
  tone?: 'success' | 'info' | 'warning' | 'danger' | 'default'
}

function KpiCard({ label, icon: Icon, valor, sub, tone = 'default' }: KpiCardProps) {
  const toneClass = {
    success: 'text-success',
    info: 'text-info',
    warning: 'text-warning',
    danger: 'text-danger',
    default: 'text-ink',
  }[tone]
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-faint uppercase tracking-wider font-medium">{label}</span>
        <Icon className="h-3.5 w-3.5 text-ink-faint" />
      </div>
      <div className={`mt-1.5 font-semibold text-[26px] leading-none tabular-nums ${toneClass}`}>{valor}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-faint">{sub}</div>}
    </Card>
  )
}

interface FunilBarProps {
  stages: Array<{ label: string; value: number; color: string }>
}

function FunilBar({ stages }: FunilBarProps) {
  const max = Math.max(...stages.map(s => s.value), 1)
  return (
    <div className="space-y-2">
      {stages.map(s => {
        const pct = (s.value / max) * 100
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-24 text-[12px] text-ink-muted shrink-0">{s.label}</div>
            <div className="flex-1 h-7 bg-surface-2 rounded-md overflow-hidden relative">
              <div
                className={`h-full ${s.color} transition-all duration-300`}
                style={{ width: `${pct}%` }}
              />
              <div className="absolute inset-0 flex items-center px-3 text-[12px] font-bold text-ink">
                {s.value}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
