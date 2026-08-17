import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// "Ligações por dia (30d)" — o mesmo cartão de área do Dashboard (Leads por dia,
// Clientes orçados por dia), agora pro telefone.
//
// Mesma fonte da página /ligacoes: a RPC `ligacoes_serie_dia`, que lê o histórico
// do WhatsApp de cada vendedor. Não duplica regra — só desenha.
//
// Duas séries, na mesma lógica do card de leads (volume + qualidade):
//   • FEITAS      = quantas o time discou
//   • ATENDIDAS   = quantas dessas o cliente atendeu (inclui atendida no celular)
//
// ⚠️ Janela SEMPRE de 30 dias, independente do filtro do Dashboard — igual ao
// "Leads por dia". O cartão existe pra mostrar tendência, e tendência de 1 dia
// não é tendência.
// ============================================================================

interface DiaLig { dia: string; feitas: number; atendidas: number }

function inicio30d(): string {
  const d = new Date()
  d.setDate(d.getDate() - 29)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function useLigacoesPorDia30d() {
  return useQuery({
    queryKey: ['dash-ligacoes-por-dia-30d'],
    queryFn: async (): Promise<DiaLig[]> => {
      const { data, error } = await supabase.rpc('ligacoes_serie_dia', {
        p_from: inicio30d(), p_to: null, p_vendedor: null,
      })
      if (error) throw error
      return ((data ?? []) as DiaLig[])
        .map(d => ({ dia: d.dia, feitas: d.feitas, atendidas: d.atendidas }))
        .sort((a, b) => a.dia.localeCompare(b.dia))
    },
    staleTime: 5 * 60_000,
  })
}

const VERDE = 'hsl(var(--accent))'
const VERDE_CLARO = 'hsl(var(--success))'
const fmtDia = (dia: string) => { const [, m, d] = dia.split('-'); return `${d}/${m}` }

export function LigacoesPorDiaCard() {
  const { data = [], isLoading } = useLigacoesPorDia30d()

  const { total, media, taxa } = useMemo(() => {
    const t = data.reduce((s, d) => s + d.feitas, 0)
    const a = data.reduce((s, d) => s + d.atendidas, 0)
    // média por DIA ATIVO (dia sem ligação nenhuma não entra) — senão fim de
    // semana e feriado derrubam o número e ele deixa de significar ritmo.
    const ativos = data.filter(d => d.feitas > 0).length
    return { total: t, media: ativos ? Math.round(t / ativos) : 0, taxa: t ? Math.round((a / t) * 100) : null }
  }, [data])

  return (
    <div className="rounded-lg border border-border/60 bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-faint">Ligações por dia (30d)</span>
        <Link to="/ligacoes" className="text-[11px] text-accent hover:underline shrink-0">ver detalhe</Link>
      </div>

      <div className="flex items-end justify-between mb-1">
        <div>
          <div className="text-2xl font-mono tabular-nums text-ink leading-none">{total}</div>
          <div className="text-[11px] text-ink-faint mt-0.5">
            feitas{taxa !== null ? ` · ${taxa}% atendidas` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono tabular-nums text-ink-muted leading-none">{media}</div>
          <div className="text-[11px] text-ink-faint mt-0.5">média/dia ativo</div>
        </div>
      </div>

      <div style={{ height: 120 }}>
        {isLoading ? (
          <div className="h-full grid place-items-center text-[11px] text-ink-faint">Carregando…</div>
        ) : data.length === 0 ? (
          <div className="h-full grid place-items-center text-[11px] text-ink-faint">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="gradLigFeitas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VERDE} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={VERDE} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradLigAtend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VERDE_CLARO} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={VERDE_CLARO} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="dia" hide />
              <Tooltip
                cursor={{ stroke: VERDE, strokeOpacity: 0.3 }}
                contentStyle={{ background: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                labelFormatter={((v: string) => fmtDia(v)) as never}
                formatter={((v: number, n: string) => [v, n === 'feitas' ? 'Feitas' : 'Atendidas']) as never}
              />
              <Area type="monotone" dataKey="feitas" stroke={VERDE} strokeWidth={2} fill="url(#gradLigFeitas)"
                    dot={false} activeDot={{ r: 3, fill: VERDE }} isAnimationActive={false} />
              <Area type="monotone" dataKey="atendidas" stroke={VERDE_CLARO} strokeWidth={2} fill="url(#gradLigAtend)"
                    dot={false} activeDot={{ r: 3, fill: VERDE_CLARO }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
