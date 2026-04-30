import { useState } from 'react'
import { Filter, TrendingUp, Users, MessageSquare, Hand, FileText, CheckCircle, EyeOff, Tag } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Select } from '@/components/ui/Select'
import { formatNumber } from '@/lib/utils'
import { useFunilPorVendedor, type FunilStage } from '@/hooks/useFunilPorVendedor'
import { useEtiquetas, groupEtiquetasByVendedor, type WascriptEtiqueta } from '@/hooks/useEtiquetas'

const PERIODO_OPTS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '60', label: 'Últimos 60 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '365', label: 'Último ano' },
]

interface StageDef {
  key: keyof FunilStage
  label: string
  icon: typeof Users
  tone: 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'
}

const STAGES: StageDef[] = [
  { key: 'total_leads',          label: 'Leads totais',     icon: Users,           tone: 'neutral' },
  { key: 'sem_resposta',         label: 'Sem resposta',     icon: EyeOff,          tone: 'danger' },
  { key: 'ia_atendendo',         label: 'IA atendendo',     icon: MessageSquare,   tone: 'info' },
  { key: 'aguardando_vendedor',  label: 'Aguardando',       icon: Hand,            tone: 'warning' },
  { key: 'vendedor_atendendo',   label: 'Em atendimento',   icon: MessageSquare,   tone: 'accent' },
  { key: 'orcamento_enviado',    label: 'Orçamento',        icon: FileText,        tone: 'info' },
  { key: 'vendido',              label: 'Vendido',          icon: CheckCircle,     tone: 'success' },
]

function FunilCard({ stage, etiquetas }: { stage: FunilStage; etiquetas?: WascriptEtiqueta[] }) {
  const max = stage.total_leads || 1
  const isAdefinir = stage.vendedor === 'A DEFINIR'

  return (
    <Card className={`p-4 space-y-3 transition-all ${isAdefinir ? 'border-warning/40 bg-warning-bg/10' : ''}`}>
      {/* Header: vendedor + conversão */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={stage.vendedor} size="md" />
          <div className="leading-tight min-w-0">
            <h3 className={`text-[13px] font-semibold truncate ${isAdefinir ? 'text-warning' : 'text-ink'}`}>
              {stage.vendedor}
            </h3>
            <p className="text-[10px] text-ink-faint uppercase tracking-wider mt-0.5">
              {formatNumber(stage.total_leads)} leads
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 text-success">
            <TrendingUp className="h-3 w-3" />
            <span className="text-[16px] font-bold tabular-nums">
              {stage.conversao_pct.toFixed(1)}%
            </span>
          </div>
          <p className="text-[9px] text-ink-faint uppercase tracking-wider">conversão</p>
        </div>
      </div>

      {/* Funil em barras */}
      <div className="space-y-1.5">
        {STAGES.map(s => {
          const value = (stage[s.key] as number) || 0
          if (s.key === 'total_leads') return null  // já mostrado no header
          const pct = max > 0 ? (value / max) * 100 : 0
          const Icon = s.icon
          return (
            <div key={s.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-ink-muted">
                  <Icon className="h-3 w-3" />
                  <span>{s.label}</span>
                </div>
                <span className="font-mono tabular-nums text-ink font-medium">
                  {formatNumber(value)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: `hsl(var(--${s.tone}))`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Etiquetas Wascript do vendedor */}
      {!isAdefinir && (() => {
        const visiveis = (etiquetas ?? []).filter(
          e => !['NAO LIDAS','FAVORITOS','GRUPOS'].includes(e.etiqueta_nome_normalizado)
        )
        const totalContatos = visiveis.reduce((acc, e) => acc + (e.total_contatos ?? 0), 0)
        return (
          <div className="pt-2 border-t border-border/60 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3 w-3" />
                <span>Etiquetas WhatsApp</span>
                <span className="font-mono">({visiveis.length})</span>
              </div>
              {totalContatos > 0 && (
                <span className="font-mono text-ink tabular-nums normal-case">
                  {formatNumber(totalContatos)} <span className="text-ink-faint lowercase">contatos</span>
                </span>
              )}
            </div>
            {visiveis.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {visiveis.map(e => (
                  <Badge
                    key={e.id}
                    title={`ID Wascript: ${e.etiqueta_id_wascript}${e.is_canonica ? ' · canônica' : ' · custom'}`}
                    className={
                      e.is_canonica
                        ? 'text-[10px] bg-info-bg/40 text-info border border-info/20 inline-flex items-center gap-1'
                        : 'text-[10px] bg-surface-2 text-ink-muted border border-border inline-flex items-center gap-1'
                    }
                  >
                    <span>{e.etiqueta_nome}</span>
                    {e.total_contatos > 0 && (
                      <span className="font-mono tabular-nums text-ink font-semibold">
                        {formatNumber(e.total_contatos)}
                      </span>
                    )}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-warning italic">
                ⚠ Sem etiquetas configuradas no WhatsApp dele
              </p>
            )}
          </div>
        )
      })()}
    </Card>
  )
}

export function FunilRelatorio() {
  const [periodoDias, setPeriodoDias] = useState('30')
  const { data, isLoading } = useFunilPorVendedor(Number(periodoDias))
  const { data: etiquetasAll } = useEtiquetas()
  const etiquetasByVendedor = etiquetasAll ? groupEtiquetasByVendedor(etiquetasAll) : null

  const totals = (data ?? []).reduce(
    (acc, s) => ({
      leads: acc.leads + s.total_leads,
      vendidos: acc.vendidos + s.vendido,
      vendedores: acc.vendedores + (s.vendedor !== 'A DEFINIR' ? 1 : 0),
    }),
    { leads: 0, vendidos: 0, vendedores: 0 }
  )

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight leading-tight">
            Funil por Vendedor
          </h1>
          <p className="text-[13px] text-ink-muted mt-0.5">
            {data ? (
              <>
                <span className="font-medium text-ink tabular-nums">{formatNumber(totals.leads)}</span>
                <span className="text-ink-faint"> leads · </span>
                <span className="font-medium text-success tabular-nums">{formatNumber(totals.vendidos)}</span>
                <span className="text-ink-faint"> vendidos · </span>
                <span className="font-medium text-ink tabular-nums">{totals.vendedores}</span>
                <span className="text-ink-faint"> vendedores ativos</span>
              </>
            ) : 'Carregando...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-ink-faint" />
          <Select
            options={PERIODO_OPTS}
            value={periodoDias}
            onChange={e => setPeriodoDias(e.target.value)}
            className="w-44"
          />
        </div>
      </div>

      {/* Grid de funis */}
      {isLoading ? (
        <PageLoading />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {(data ?? []).map(stage => {
            // Match: tenta nome exato (PEDRO DELLA GIUSTINA -> tenta PEDRO DELLA GIUSTINA, depois PEDRO)
            const firstName = stage.vendedor.split(' ')[0].toUpperCase()
            const etiquetas = etiquetasByVendedor?.get(stage.vendedor.toUpperCase())
              ?? etiquetasByVendedor?.get(firstName)
            return <FunilCard key={stage.vendedor} stage={stage} etiquetas={etiquetas} />
          })}
        </div>
      )}

      {data && data.length === 0 && (
        <Card className="p-8 text-center text-ink-faint text-sm">
          Sem dados de atendimento no período selecionado.
        </Card>
      )}
    </div>
  )
}
