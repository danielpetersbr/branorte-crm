import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, AlertTriangle, Flame, TrendingDown, Clock, Loader2,
  ExternalLink, CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useGestao, useNegociosPeriodo, useAndamentos,
  type GestaoLinha, type NegocioPeriodo,
} from '@/hooks/useRelatorioGestao'

// ============================================================================
// /relatorio-lider/gestao — onde o gestor vê TUDO que os 3 líderes preencheram.
//
// A /relatorio-lider é a tela de ENTRADA (o líder responde). Esta é a de
// LEITURA. São 5 blocos, na ordem em que a decisão acontece:
//
//   1. Preencheu hoje?      → cobrar quem não preencheu, antes de tudo
//   2. Termômetro da semana → onde o clima azedou
//   3. Pipeline declarado   → o dinheiro que os líderes disseram estar perto
//   4. O que morreu         → o ranking de MOTIVO, que é o buraco do sistema
//   5. Andamentos marcados  → com a DATA, e há quantos dias está parado
//
// ⚠️ A AUSÊNCIA vem primeiro de propósito. Relatório que ninguém preenche vira
// dado enviesado em duas semanas, e o único jeito de perceber é a tela mostrar
// o buraco em vez de esconder o time que não respondeu.
// ============================================================================

const brl = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`

const dm = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }

const EMOJI: Record<string, string> = { verde: '🟢', amarelo: '🟡', vermelho: '🔴' }

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

function Secao({ icone, titulo, aviso, children }: {
  icone: React.ReactNode; titulo: string; aviso?: string; children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        {icone}
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">{titulo}</h2>
        {aviso && <span className="text-[11px] text-danger font-medium">{aviso}</span>}
      </div>
      {children}
    </section>
  )
}

export function RelatorioLiderGestao() {
  const [dias, setDias] = useState(7)
  const { data: linhas = [], isLoading } = useGestao(dias)
  const { data: negocios = [] } = useNegociosPeriodo(dias)
  const { data: andamentos = [] } = useAndamentos()

  const hoje = hojeSP()
  const doDia = useMemo(() => linhas.filter(l => l.dia === hoje), [linhas, hoje])
  const naoPreencheu = doDia.filter(l => !l.termometro).length

  // grade time × dia, pro termômetro da semana
  const times = useMemo(() => {
    const m = new Map<string, string>()
    linhas.forEach(l => m.set(l.time_slug, l.time_nome))
    return [...m.entries()]
  }, [linhas])
  const diasUnicos = useMemo(
    () => [...new Set(linhas.map(l => l.dia))].sort(), [linhas])

  const quentes = negocios.filter(n => n.tipo === 'quente')
  const perdidos = negocios.filter(n => n.tipo === 'perdido')

  // ranking de motivo de perda — o dado que não existia em lugar nenhum
  const porMotivo = useMemo(() => {
    const m = new Map<string, { n: number; valor: number; concorrentes: string[] }>()
    perdidos.forEach(p => {
      const k = p.motivo ?? '(sem motivo)'
      const cur = m.get(k) ?? { n: 0, valor: 0, concorrentes: [] }
      cur.n++; cur.valor += p.valor ?? 0
      if (p.concorrente) cur.concorrentes.push(p.concorrente)
      m.set(k, cur)
    })
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [perdidos])

  return (
    <div className="max-w-[1500px] mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="w-5 h-5 text-accent" />
            <h1 className="text-[20px] sm:text-[24px] font-bold text-ink">Relatórios dos Líderes</h1>
          </div>
          <p className="text-[13px] text-ink-muted">
            O que os 3 times reportaram. A tela que o líder preenche é a{' '}
            <Link to="/relatorio-lider" className="text-accent hover:underline inline-flex items-center gap-0.5">
              /relatorio-lider <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {[[7, '7 dias'], [15, '15 dias'], [30, '30 dias']].map(([v, l]) => (
            <button key={String(v)} onClick={() => setDias(Number(v))}
              className={cn('px-3 py-1.5 text-[12px] font-medium transition-colors',
                dias === v ? 'bg-accent text-accent-fg' : 'text-ink-muted hover:bg-surface-2')}>
              {l}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="h-40 grid place-items-center text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* 1 — PREENCHEU HOJE? */}
          <Secao icone={<CheckCircle2 className="w-4 h-4 text-ink-muted" />} titulo="Preencheu hoje?"
            aviso={naoPreencheu > 0 ? `${naoPreencheu} time${naoPreencheu > 1 ? 's' : ''} sem relatório` : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {doDia.map(l => (
                <CardDoDia key={l.time_slug} l={l} />
              ))}
            </div>
          </Secao>

          {/* 2 — TERMÔMETRO DA SEMANA */}
          <Secao icone={<Flame className="w-4 h-4 text-ink-muted" />} titulo={`Termômetro · ${dias} dias`}>
            <div className="rounded-lg border border-border bg-surface p-3 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-ink-muted">
                    <th className="text-left font-medium pb-2 pr-3">Time</th>
                    {diasUnicos.map(d => (
                      <th key={d} className="font-medium pb-2 px-1 whitespace-nowrap">{dm(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {times.map(([slug, nome]) => (
                    <tr key={slug} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium text-ink whitespace-nowrap">{nome}</td>
                      {diasUnicos.map(d => {
                        const l = linhas.find(x => x.time_slug === slug && x.dia === d)
                        const fds = [0, 6].includes(new Date(d + 'T12:00:00').getDay())
                        return (
                          <td key={d} className="text-center py-2 px-1"
                            title={l?.termometro_obs ?? (fds ? 'fim de semana' : 'não preencheu')}>
                            {l?.termometro
                              ? <span className="text-[15px]">{EMOJI[l.termometro]}</span>
                              : <span className={cn('text-[13px]', fds ? 'text-ink-muted/40' : 'text-danger')}>
                                  {fds ? '·' : '✕'}
                                </span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-ink-muted mt-2">
                ✕ = dia útil sem relatório · · = fim de semana · passe o mouse pra ler a observação
              </p>
            </div>
          </Secao>

          {/* 3 — PIPELINE DECLARADO */}
          <Secao icone={<TrendingDown className="w-4 h-4 rotate-180 text-ink-muted" />}
            titulo={`Perto de fechar · ${quentes.length} · ${brl(quentes.reduce((s, q) => s + (q.valor ?? 0), 0))}`}>
            {quentes.length === 0 ? (
              <Vazio texto="Nenhum negócio quente declarado no período." />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {quentes.map((q, i) => <LinhaNegocio key={i} n={q} />)}
              </div>
            )}
          </Secao>

          {/* 4 — O QUE MORREU */}
          <Secao icone={<TrendingDown className="w-4 h-4 text-ink-muted" />}
            titulo={`Por que perdemos · ${perdidos.length} · ${brl(perdidos.reduce((s, p) => s + (p.valor ?? 0), 0))}`}>
            {perdidos.length === 0 ? (
              <Vazio texto="Nenhuma perda registrada no período." />
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-surface p-3 space-y-1.5">
                  {porMotivo.map(([motivo, d]) => (
                    <div key={motivo} className="flex items-center gap-2 text-[12px]">
                      <span className="w-6 text-right font-bold text-ink">{d.n}</span>
                      <div className="flex-1 min-w-0">
                        <div className="h-4 rounded bg-danger/20 relative overflow-hidden">
                          <div className="h-full bg-danger/60"
                            style={{ width: `${(d.n / porMotivo[0][1].n) * 100}%` }} />
                          <span className="absolute inset-0 flex items-center px-2 text-[11px] text-ink truncate">
                            {motivo}
                            {d.concorrentes.length > 0 && (
                              <b className="ml-1.5">→ {[...new Set(d.concorrentes)].join(', ')}</b>
                            )}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] text-ink-muted whitespace-nowrap w-20 text-right">
                        {brl(d.valor)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {perdidos.map((p, i) => <LinhaNegocio key={i} n={p} />)}
                </div>
              </div>
            )}
          </Secao>

          {/* 5 — ANDAMENTOS MARCADOS (com a data) */}
          <Secao icone={<Clock className="w-4 h-4 text-ink-muted" />}
            titulo={`Andamento anotado · ${andamentos.length}`}>
            {andamentos.length === 0 ? (
              <Vazio texto="Nenhum cliente marcado ainda. O líder marca clicando nos números da tela dele." />
            ) : (
              <div className="rounded-lg border border-border bg-surface divide-y divide-border">
                {andamentos.map((a, i) => {
                  // parado há muito tempo no MESMO estado = ninguém mexeu
                  const velho = a.dias_no_status >= 3
                  return (
                    <div key={i} className="p-2.5 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate">{a.cliente}</div>
                        <div className="text-[11px] text-ink-muted">
                          {a.vendedor_nome} · {a.tipo === 'orcamento' ? 'orçamento' : 'lead quente'}
                          {a.mudancas > 1 && <> · mudou {a.mudancas}×</>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] px-2 py-0.5 rounded border border-border text-ink">
                          {a.status === 'negociando' ? 'Negociando'
                            : a.status === 'aguardando_cliente' ? 'Aguardando ele' : 'Cliente voltou'}
                        </span>
                        <span className={cn('text-[11px] whitespace-nowrap', velho ? 'text-danger font-medium' : 'text-ink-muted')}>
                          {a.dias_no_status === 0 ? 'hoje'
                            : `há ${a.dias_no_status} dia${a.dias_no_status === 1 ? '' : 's'}`}
                        </span>
                        <span className="text-[10px] text-ink-muted whitespace-nowrap">
                          {a.anotado_por ?? '—'} · {new Date(a.anotado_em).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                            timeZone: 'America/Sao_Paulo',
                          })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Secao>
        </>
      )}
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-5 text-center text-[12px] text-ink-muted">
      {texto}
    </div>
  )
}

function CardDoDia({ l }: { l: GestaoLinha }) {
  const vazio = !l.termometro
  return (
    <div className={cn('rounded-lg border p-3',
      vazio ? 'border-danger/50 bg-danger-bg/15' : 'border-border bg-surface')}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-semibold text-[14px] text-ink">{l.time_nome}</span>
        {vazio
          ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger">
              <AlertTriangle className="w-3.5 h-3.5" /> não preencheu
            </span>
          : <span className="text-[16px]">{EMOJI[l.termometro!]}</span>}
      </div>

      {vazio ? (
        <p className="text-[11px] text-ink-muted">Sem relatório hoje.</p>
      ) : (
        <>
          <p className="text-[11px] text-ink-muted mb-2">
            {l.lider_nome} · {l.preenchido_em && new Date(l.preenchido_em).toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
            })}
          </p>
          {l.termometro_obs && (
            <p className="text-[12px] text-ink bg-surface-2/50 rounded p-2 mb-2">“{l.termometro_obs}”</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            <span>{l.quentes_n} quente{l.quentes_n === 1 ? '' : 's'}
              {l.quentes_valor > 0 && ` · ${brl(l.quentes_valor)}`}</span>
            {l.perdidos_n > 0 && (
              <span className="text-danger">{l.perdidos_n} perdido{l.perdidos_n === 1 ? '' : 's'}
                {l.perdidos_valor > 0 && ` · ${brl(l.perdidos_valor)}`}</span>
            )}
            {l.qualidade_lead && <span>lead: {l.qualidade_lead}</span>}
          </div>
          {l.abaixo_vendedor && (
            <p className="text-[11px] text-warning mt-1.5">
              {l.abaixo_vendedor} abaixo — {l.abaixo_motivo}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function LinhaNegocio({ n }: { n: NegocioPeriodo }) {
  const perdido = n.tipo === 'perdido'
  return (
    <div className={cn('rounded-md border p-2.5',
      perdido ? 'border-danger/30 bg-danger-bg/10' : 'border-border bg-surface')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink truncate">{n.cliente}</div>
          <div className="text-[11px] text-ink-muted">
            {n.vendedor_nome} · {n.time_nome} · {dm(n.dia)}
          </div>
        </div>
        {!!n.valor && <span className="text-[13px] font-bold text-ink shrink-0">{brl(n.valor)}</span>}
      </div>
      <div className="text-[11px] mt-1.5">
        {perdido ? (
          <span className="text-danger">
            {n.motivo}{n.concorrente && <b> → {n.concorrente}</b>}
          </span>
        ) : (
          <span className="text-ink-muted">
            {n.previsao === 'hoje' ? 'fecha hoje'
              : n.previsao === 'semana' ? 'fecha esta semana'
              : n.previsao === 'proxima' ? 'fecha próxima semana' : 'sem data'}
            {n.obstaculo && <> · falta: <b className="text-ink">{n.obstaculo}</b></>}
          </span>
        )}
      </div>
    </div>
  )
}
