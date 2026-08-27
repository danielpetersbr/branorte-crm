import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, Phone, FileText, Flame, AlertTriangle, TrendingDown, Check,
  Plus, X, Loader2, ExternalLink, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TIMES, type TimeSlug } from '@/hooks/useRelatorioLider'
import {
  usePautaNumeros, useVendidoMes, useReuniaoDoDia, useSalvarReuniao,
  useReuniaoHistorico, MOTIVOS_PERDA, type PerdaForm,
} from '@/hooks/useReuniaoTime'

// ============================================================================
// /reuniao-time — a tela que o Daniel abre AO SENTAR COM O TIME.
//
// Substituiu o relatório diário do líder (modelo encerrado em 27/08/2026).
// A pauta é exatamente o que ele anunciou no grupo:
//
//   ligações · orçamentos · negociações em andamento · oportunidades ·
//   o que precisa melhorar
//
// Os números já vêm prontos — ninguém preenche nada antes da reunião. O que se
// digita aqui é só o que saiu da CONVERSA: o que está funcionando, o que
// melhorar, os próximos passos e — o mais importante — os negócios PERDIDOS
// com o motivo.
//
// ⚠️ O motivo de perda é o único dado que explica por que um time vende menos,
// e não existe em campo nenhum do sistema. Ele vivia no relatório diário; sem
// líder, esta reunião virou o gatilho dele.
// ============================================================================

const brl = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`

const META_VENDA = 833_000

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] sm:text-[13px] ' +
  'text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/40'

function Bloco({ n, icone, titulo, children }: {
  n: number; icone: React.ReactNode; titulo: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-[12px] font-bold grid place-items-center">
          {n}
        </span>
        {icone}
        <h2 className="font-semibold text-[14px] text-ink">{titulo}</h2>
      </div>
      {children}
    </section>
  )
}

function Num({ label, valor, sub, alerta }: {
  label: string; valor: string; sub?: string; alerta?: boolean
}) {
  return (
    <div className={cn('rounded-md border p-2.5',
      alerta ? 'border-danger/40 bg-danger-bg/15' : 'border-border bg-surface-2/30')}>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={cn('text-[20px] font-bold leading-tight', alerta ? 'text-danger' : 'text-ink')}>
        {valor}
      </div>
      {sub && <div className="text-[10px] text-ink-muted">{sub}</div>}
    </div>
  )
}

export function ReuniaoTime() {
  const [slug, setSlug] = useState<TimeSlug | null>(null)
  const time = TIMES.find(t => t.slug === slug) ?? null

  const { data: pauta, isLoading } = usePautaNumeros(slug, 7)
  const { data: vendas } = useVendidoMes(slug)
  const { data: jaFeita } = useReuniaoDoDia(slug)
  const { data: historico = [] } = useReuniaoHistorico(30)
  const salvar = useSalvarReuniao()

  const [funcionando, setFuncionando] = useState('')
  const [melhorar, setMelhorar] = useState('')
  const [proximos, setProximos] = useState('')
  const [perdas, setPerdas] = useState<PerdaForm[]>([])

  // reabriu no mesmo dia? carrega o que já foi anotado, pra corrigir
  useEffect(() => {
    if (!jaFeita) { setFuncionando(''); setMelhorar(''); setProximos(''); setPerdas([]); return }
    setFuncionando(jaFeita.funcionando ?? '')
    setMelhorar(jaFeita.melhorar ?? '')
    setProximos(jaFeita.proximos_passos ?? '')
    setPerdas((jaFeita.perdas ?? []).map(p => ({
      cliente: p.cliente, vendedor_nome: p.vendedor_nome ?? '',
      valor: p.valor ? Number(p.valor) : null,
      motivo: p.motivo ?? '', concorrente: p.concorrente ?? '',
    })))
  }, [jaFeita])

  // ── Escolher o time ───────────────────────────────────────────────────────
  if (!time) {
    const perdasMes = historico.flatMap(h => h.perdas ?? [])
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-5 h-5 text-accent" />
          <h1 className="text-[22px] font-bold text-ink">Reunião do Time</h1>
        </div>
        <p className="text-[13px] text-ink-muted mb-5">
          Escolha o time. Os números já vêm prontos — você só conduz a conversa.
        </p>
        <div className="space-y-2 mb-8">
          {TIMES.map(t => {
            const feitaHoje = historico.some(h =>
              h.time_slug === t.slug &&
              h.data === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
            return (
              <button key={t.slug} onClick={() => setSlug(t.slug)}
                className="w-full text-left px-4 py-3 rounded-lg border border-border bg-surface hover:border-accent transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[15px] text-ink">{t.nome}</div>
                    <div className="text-[12px] text-ink-muted">{t.membros.join(' · ')}</div>
                  </div>
                  {feitaHoje && (
                    <span className="text-[11px] text-success font-medium whitespace-nowrap">
                      reunião de hoje ✓
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {perdasMes.length > 0 && (
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted mb-2">
              Por que perdemos · últimos 30 dias
            </h2>
            <RankingPerdas perdas={perdasMes} />
          </div>
        )}
      </div>
    )
  }

  const membros = time.membros as unknown as string[]
  const faltaVenda = Math.max(0, META_VENDA - (vendas?.vendido ?? 0))

  return (
    <div className="max-w-[1200px] mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button onClick={() => setSlug(null)}
            className="text-[12px] text-accent hover:underline mb-1">← trocar de time</button>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-ink">{time.nome}</h1>
          <p className="text-[13px] text-ink-muted">
            {membros.join(' · ')} ·{' '}
            <Link to={`/relatorio-lider?time=${time.slug}`}
              className="text-accent hover:underline inline-flex items-center gap-0.5">
              painel do time <ExternalLink className="w-3 h-3" />
            </Link>
          </p>
        </div>
        {jaFeita && (
          <span className="text-[12px] text-success font-medium">
            reunião de hoje já registrada — você pode corrigir
          </span>
        )}
      </header>

      {isLoading || !pauta ? (
        <div className="h-40 grid place-items-center text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          <Bloco n={1} icone={<Phone className="w-4 h-4 text-ink-muted" />} titulo="Ligações · últimos 7 dias">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Num label="Feitas" valor={String(pauta.ligacoes_feitas)}
                sub={`meta 150/semana`} alerta={pauta.ligacoes_feitas < 150} />
              <Num label="Recebidas" valor={String(pauta.ligacoes_recebidas)} />
              <Num label="Clientes atendidos" valor={String(pauta.clientes_atendidos)} />
              <Num label="Mensagens" valor={String(pauta.msgs)} />
            </div>
          </Bloco>

          <Bloco n={2} icone={<FileText className="w-4 h-4 text-ink-muted" />} titulo="Orçamentos · últimos 7 dias">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="Emitidos" valor={String(pauta.orcamentos)} />
              <Num label="Em proposta" valor={brl(pauta.orcamentos_valor)} />
              <Num label="Sem andamento marcado" valor={String(pauta.orcamentos_sem_andamento)}
                sub="ninguém marcou como está" alerta={pauta.orcamentos_sem_andamento > 0} />
            </div>
          </Bloco>

          <Bloco n={3} icone={<Flame className="w-4 h-4 text-ink-muted" />} titulo="Negociações em andamento">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="Leads quentes" valor={String(pauta.quentes)} />
              <Num label="Cliente esperando resposta" valor={String(pauta.quentes_sem_resposta)}
                sub="cliente falou por último" alerta={pauta.quentes_sem_resposta > 0} />
              <Num label="Vendido no mês" valor={brl(vendas?.vendido ?? 0)}
                sub={faltaVenda > 0 ? `faltam ${brl(faltaVenda)} p/ meta` : 'meta batida ✓'}
                alerta={false} />
            </div>
            {vendas?.porPessoa && vendas.porPessoa.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                {vendas.porPessoa.map(p => (
                  <span key={p.nome}>
                    <b className="text-ink">{p.nome}</b> {brl(p.vendido)} · {p.pedidos} pedido{p.pedidos === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            )}
          </Bloco>

          <Bloco n={4} icone={<TrendingDown className="w-4 h-4 text-ink-muted" />}
            titulo="O que perdemos — e por quê">
            <p className="text-[12px] text-ink-muted mb-2">
              É o dado que mais falta no sistema. Registre aqui o que morreu desde a última conversa.
            </p>
            <div className="space-y-2">
              {perdas.map((p, i) => (
                <div key={i} className="rounded-md border border-border bg-surface-2/30 p-3 space-y-2">
                  <div className="flex gap-2">
                    <input className={inputCls} placeholder="Nome do cliente" value={p.cliente}
                      onChange={e => setPerdas(perdas.map((x, j) => j === i ? { ...x, cliente: e.target.value } : x))} />
                    <button type="button" onClick={() => setPerdas(perdas.filter((_, j) => j !== i))}
                      className="shrink-0 w-10 grid place-items-center rounded-md border border-border text-ink-muted hover:text-danger hover:border-danger/50">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select className={inputCls} value={p.vendedor_nome}
                      onChange={e => setPerdas(perdas.map((x, j) => j === i ? { ...x, vendedor_nome: e.target.value } : x))}>
                      <option value="">Vendedor…</option>
                      {membros.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input className={inputCls} inputMode="numeric" placeholder="Valor (R$)"
                      value={p.valor ?? ''}
                      onChange={e => setPerdas(perdas.map((x, j) => j === i
                        ? { ...x, valor: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null } : x))} />
                  </div>
                  <select className={inputCls} value={p.motivo}
                    onChange={e => setPerdas(perdas.map((x, j) => j === i ? { ...x, motivo: e.target.value } : x))}>
                    <option value="">Por que perdeu…</option>
                    {MOTIVOS_PERDA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {p.motivo.includes('concorrente') && (
                    <input className={inputCls} placeholder="Qual concorrente?"
                      value={p.concorrente}
                      onChange={e => setPerdas(perdas.map((x, j) => j === i ? { ...x, concorrente: e.target.value } : x))} />
                  )}
                </div>
              ))}
              <button type="button"
                onClick={() => setPerdas([...perdas, { cliente: '', vendedor_nome: '', valor: null, motivo: '', concorrente: '' }])}
                className="w-full py-2.5 rounded-md border border-dashed border-border text-[13px] text-ink-muted hover:border-danger hover:text-danger transition-colors">
                <Plus className="w-4 h-4 inline mr-1" /> Registrar negócio perdido
              </button>
            </div>
          </Bloco>

          <Bloco n={5} icone={<MessageSquare className="w-4 h-4 text-ink-muted" />}
            titulo="O que saiu da conversa">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-ink mb-1">O que está funcionando</label>
                <textarea rows={4} className={cn(inputCls, 'resize-none')} value={funcionando}
                  onChange={e => setFuncionando(e.target.value)}
                  placeholder="o que o time acertou e deve manter" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink mb-1">O que precisa melhorar</label>
                <textarea rows={4} className={cn(inputCls, 'resize-none')} value={melhorar}
                  onChange={e => setMelhorar(e.target.value)}
                  placeholder="onde travou, o que atrapalhou" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink mb-1">Próximos passos</label>
                <textarea rows={4} className={cn(inputCls, 'resize-none')} value={proximos}
                  onChange={e => setProximos(e.target.value)}
                  placeholder="o que cada um vai fazer até a próxima" />
              </div>
            </div>
          </Bloco>
        </>
      )}

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-3 py-2.5 z-20">
        <div className="max-w-[1200px] mx-auto flex items-center gap-3">
          <div className="flex-1 text-[11px] text-ink-muted">
            {salvar.isSuccess ? '✅ Reunião registrada.'
              : perdas.some(p => p.cliente && !p.motivo) ? 'Falta o motivo de alguma perda.'
              : 'O motivo de perda é o dado que mais vale aqui.'}
          </div>
          <button
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({
              time_slug: time.slug, conduzida_por: 'DANIEL',
              funcionando, melhorar, proximos_passos: proximos, perdas,
            })}
            className={cn('px-5 py-2.5 rounded-md text-[14px] font-semibold inline-flex items-center gap-2 transition-colors',
              salvar.isPending ? 'bg-surface-2 text-ink-muted' : 'bg-accent text-accent-fg hover:opacity-90')}>
            {salvar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {jaFeita ? 'Corrigir' : 'Registrar reunião'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Ranking de motivo — o que o relatório diário existia pra produzir. */
function RankingPerdas({ perdas }: {
  perdas: { motivo: string | null; valor: number | null; concorrente: string | null }[]
}) {
  const m = new Map<string, { n: number; valor: number; conc: string[] }>()
  perdas.forEach(p => {
    const k = p.motivo ?? '(sem motivo)'
    const cur = m.get(k) ?? { n: 0, valor: 0, conc: [] }
    cur.n++; cur.valor += Number(p.valor ?? 0)
    if (p.concorrente) cur.conc.push(p.concorrente)
    m.set(k, cur)
  })
  const lista = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  if (!lista.length) return null

  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-1.5">
      {lista.map(([motivo, d]) => (
        <div key={motivo} className="flex items-center gap-2 text-[12px]">
          <span className="w-6 text-right font-bold text-ink">{d.n}</span>
          <div className="flex-1 min-w-0">
            <div className="h-5 rounded bg-danger/15 relative overflow-hidden">
              <div className="h-full bg-danger/50" style={{ width: `${(d.n / lista[0][1].n) * 100}%` }} />
              <span className="absolute inset-0 flex items-center px-2 text-[11px] text-ink truncate">
                {motivo}
                {d.conc.length > 0 && <b className="ml-1.5">→ {[...new Set(d.conc)].join(', ')}</b>}
              </span>
            </div>
          </div>
          {d.valor > 0 && (
            <span className="text-[11px] text-ink-muted w-20 text-right">{brl(d.valor)}</span>
          )}
        </div>
      ))}
    </div>
  )
}
