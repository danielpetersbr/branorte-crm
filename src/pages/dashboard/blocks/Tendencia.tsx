import { useMemo, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useLigacoesSerie } from '@/hooks/useLigacoes'
import { Card, CardHeader } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { CHART, TOOLTIP_STYLE, AXIS_TICK } from '../ui/chart-tokens'
import { n } from '../ui/format'

type SerieId = 'leads' | 'qualificados' | 'propostas' | 'ligacoes'

const SERIES: { id: SerieId; label: string; cor: string; ajuda: string }[] = [
  { id: 'leads',        label: 'Leads',        cor: CHART.s2, ajuda: 'Contatos que chegaram, por dia.' },
  { id: 'qualificados', label: 'Qualificados', cor: CHART.s1, ajuda: 'Leads que disseram o que precisam e é algo que a Branorte fabrica.' },
  { id: 'propostas',    label: 'Propostas',    cor: CHART.s3, ajuda: 'Clientes distintos com orçamento montado no dia.' },
  { id: 'ligacoes',     label: 'Ligações',     cor: CHART.s5, ajuda: 'Chamadas feitas pelos vendedores no dia. É piso: só conta o que ficou registrado no histórico do WhatsApp.' },
]

/** Janela fixa de 30 dias, no fuso de Brasília — casa com as outras séries. */
function janela30d(): { from: string; to: string | null } {
  const agora = new Date()
  const s = agora.toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [y, m, d] = s.split('-').map(Number)
  const meiaNoite = new Date(Date.UTC(y, m - 1, d, 3, 0, 0))
  const inicio = new Date(meiaNoite)
  inicio.setUTCDate(inicio.getUTCDate() - 29)
  return { from: inicio.toISOString(), to: null }
}

function rotuloDia(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
}

/**
 * UM gráfico de evolução com seletor — no lugar de cinco gráficos pequenos
 * disputando a mesma faixa da tela.
 *
 * Só entram séries que existem de verdade na base. "Vendas por dia" ficou de
 * fora de propósito: o próprio hook marca `fechados_por_dia` como sinal poluído
 * por sincronização, então a linha subiria e desceria por causa de sync, não de
 * venda. Inventar a série seria pior do que não ter.
 */
export function Tendencia({
  leadsPorDia,
  orcamentosPorDia,
}: {
  leadsPorDia: { dia: string; total: number; qualificados: number }[] | undefined
  orcamentosPorDia: { dia: string; total: number }[] | undefined
}) {
  const [ativas, setAtivas] = useState<SerieId[]>(['leads', 'qualificados'])
  const [j] = useState(janela30d)
  const { data: ligacoes } = useLigacoesSerie(j, null)

  const dados = useMemo(() => {
    type Linha = { dia: string; leads: number; qualificados: number; propostas: number; ligacoes: number }
    const vazio = (dia: string): Linha => ({ dia, leads: 0, qualificados: 0, propostas: 0, ligacoes: 0 })
    const porDia = new Map<string, Linha>()
    for (const l of leadsPorDia ?? []) {
      porDia.set(l.dia, { ...vazio(l.dia), leads: l.total, qualificados: l.qualificados })
    }
    for (const o of orcamentosPorDia ?? []) {
      const atual = porDia.get(o.dia) ?? vazio(o.dia)
      atual.propostas = o.total
      porDia.set(o.dia, atual)
    }
    for (const c of ligacoes ?? []) {
      // a série de ligações vem com o dia em ISO completo às vezes; corta em YYYY-MM-DD
      const dia = String(c.dia).slice(0, 10)
      const atual = porDia.get(dia) ?? vazio(dia)
      atual.ligacoes = c.feitas
      porDia.set(dia, atual)
    }
    return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia))
  }, [leadsPorDia, orcamentosPorDia, ligacoes])

  function alternar(id: SerieId) {
    setAtivas(prev => (prev.includes(id)
      ? (prev.length > 1 ? prev.filter(x => x !== id) : prev)  // nunca zerar o gráfico
      : [...prev, id]))
  }

  const vazio = dados.length === 0 || dados.every(d => d.leads === 0 && d.qualificados === 0 && d.propostas === 0 && d.ligacoes === 0)

  return (
    <Card>
      <CardHeader
        title="Evolução diária"
        subtitle="Quantidade por dia. Clique numa série para mostrar ou esconder."
        janela={<JanelaBadge tipo="fixo" label="últimos 30 dias" />}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Séries do gráfico">
        {SERIES.map(s => {
          const on = ativas.includes(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => alternar(s.id)}
              aria-pressed={on}
              title={s.ajuda}
              className={[
                'inline-flex min-h-[44px] md:min-h-0 items-center gap-2 rounded-full border px-3 py-2 text-micro transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                on ? 'border-border-strong bg-surface-2 text-ink' : 'border-border text-ink-faint hover:text-ink-muted',
              ].join(' ')}
            >
              {/* série desligada usa o token de cor (bg-ink-faint), não hsl() solto */}
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${on ? '' : 'bg-ink-faint'}`}
                style={on ? { background: s.cor } : undefined}
              />
              {s.label}
            </button>
          )
        })}
      </div>

      <div className="h-[260px]">
        {vazio ? (
          <div className="grid h-full place-items-center rounded-lg border border-dashed border-border">
            <p className="text-body text-ink-faint">Sem dados para o período.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dados} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                {SERIES.map(s => (
                  <linearGradient key={s.id} id={`grad-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.cor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.cor} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="dia"
                tickFormatter={rotuloDia}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: CHART.grid }}
                minTickGap={28}
              />
              <YAxis
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={((l: unknown) => rotuloDia(String(l ?? ''))) as never}
                formatter={((v: number, key: string) => [n(v), SERIES.find(s => s.id === key)?.label ?? key]) as never}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: CHART.ink, paddingTop: 8 }}
                formatter={(value: string) => SERIES.find(s => s.id === value)?.label ?? value}
              />
              {SERIES.filter(s => ativas.includes(s.id)).map(s => (
                <Area
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  name={s.id}
                  stroke={s.cor}
                  strokeWidth={2}
                  fill={`url(#grad-${s.id})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
