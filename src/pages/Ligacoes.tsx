import { useState, useMemo } from 'react'
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users, ChevronDown, Video } from 'lucide-react'
import { useLigacoesResumo, useLigacoesDe, type Periodo, type LigacaoResumo } from '@/hooks/useLigacoes'

// ============================================================================
// Central de Ligações — quanto cada vendedor pega no telefone.
//
// Existe porque até 17/08/2026 a única régua era uma coluna que contava
// `call_log` de conversa COM ETIQUETA DO FUNIL: numa segunda de manhã o time
// inteiro somava UMA ligação. A fonte de agora é o histórico do próprio
// WhatsApp — retroativa, com desfecho e duração.
// ============================================================================

const PERIODOS: Array<{ id: Periodo; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'tudo', label: 'Tudo' },
]

function fmtDur(seg: number): string {
  if (!seg) return '—'
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  if (m > 0) return `${m}min${s > 0 ? String(s).padStart(2, '0') : ''}`
  return `${s}s`
}
function fmtQuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtFone(f: string | null): string {
  const n = (f || '').replace(/\D/g, '')
  if (n.length < 12) return f || ''
  const ddd = n.slice(2, 4), resto = n.slice(4)
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`
}

// Quem é o outro lado. O `peer` cru é um JID @lid do WhatsApp Business, ilegível —
// o nome e o telefone vêm do join com wa_chat_labels. Quando o contato não está na
// carteira sincronizada (13% dos casos), assume o silêncio em vez de mostrar o @lid.
function quemE(l: { cliente_nome: string | null; cliente_fone: string | null; peer: string | null }): string {
  if (l.cliente_nome && l.cliente_nome.trim()) return l.cliente_nome.trim()
  if (l.cliente_fone) return fmtFone(l.cliente_fone)
  const n = (l.peer || '').split('@')[0]
  if (/^\d{12,13}$/.test(n)) return fmtFone(n)
  return 'contato não identificado'
}

// Vocabulário confirmado no histórico real. AcceptedElsewhere é ATENDIDA no
// celular — tratar como perdida puniria quem atende no telefone.
const DESFECHO: Record<string, { label: string; cls: string }> = {
  Completed:         { label: 'Atendida',            cls: 'text-success bg-success/10 border-success/30' },
  AcceptedElsewhere: { label: 'Atendida no celular', cls: 'text-success bg-success/10 border-success/30' },
  Missed:            { label: 'Perdida',             cls: 'text-danger bg-danger/10 border-danger/30' },
  miss:              { label: 'Perdida',             cls: 'text-danger bg-danger/10 border-danger/30' },
  Rejected:          { label: 'Recusada',            cls: 'text-danger bg-danger/10 border-danger/30' },
  Canceled:          { label: 'Desistiu',            cls: 'text-warning bg-warning/10 border-warning/30' },
}
function desfecho(estado: string | null) {
  return DESFECHO[estado ?? ''] ?? { label: estado || '—', cls: 'text-ink-faint border-border' }
}

export function Ligacoes() {
  const [periodo, setPeriodo] = useState<Periodo>('7d')
  const [aberto, setAberto] = useState<string | null>(null)
  const { data: linhas = [], isLoading, isError } = useLigacoesResumo(periodo)

  const tot = useMemo(() => linhas.reduce((a, r) => ({
    fez: a.fez + r.fez, recebeu: a.recebeu + r.recebeu,
    atendidas: a.atendidas + r.atendidas, perdidas: a.perdidas + r.perdidas,
    tempo_seg: a.tempo_seg + r.tempo_seg, clientes_fez: a.clientes_fez + r.clientes_fez,
  }), { fez: 0, recebeu: 0, atendidas: 0, perdidas: 0, tempo_seg: 0, clientes_fez: 0 }), [linhas])

  const maxFez = Math.max(1, ...linhas.map(r => r.fez))

  return (
    <div className="p-3 lg:p-6 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-ink tracking-tight flex items-center gap-2">
            <PhoneCall className="h-6 w-6 text-accent" /> Ligações
          </h1>
          <p className="text-[12px] text-ink-faint mt-0.5">
            Do histórico do WhatsApp de cada vendedor — qualquer conversa, com ou sem etiqueta.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
          {PERIODOS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                periodo === p.id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* Totais do time */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi icon={PhoneOutgoing} cor="text-accent" rotulo="Ligações feitas" valor={tot.fez} />
        {/* Alcance, não esforço. É a soma dos distintos POR VENDEDOR — dois vendedores que
            ligam pro mesmo produtor contam duas vezes aqui, de propósito: cada um gastou
            uma abordagem. Deduplicar no time esconderia trabalho de quem ligou. */}
        <Kpi icon={Users} cor="text-accent" rotulo="Clientes chamados" valor={tot.clientes_fez} />
        <Kpi icon={PhoneMissed} cor="text-danger" rotulo="Perdidas" valor={tot.perdidas} />
        <Kpi icon={Clock} cor="text-success" rotulo="Tempo ao telefone" valor={fmtDur(tot.tempo_seg)} />
      </div>

      {isLoading ? (
        <p className="text-[13px] text-ink-muted py-10 text-center">Carregando…</p>
      ) : isError ? (
        <p className="text-[13px] text-danger py-10 text-center">Não consegui carregar as ligações.</p>
      ) : linhas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <PhoneCall className="h-8 w-8 text-ink-faint mx-auto mb-2" />
          <p className="text-[13px] text-ink-muted">Nenhuma ligação no período.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {/* O número pequeno ao lado de Fez/Recebeu é de CLIENTES DISTINTOS — quem liga
              5x pro mesmo produtor não alcançou 5 produtores. */}
          <div className="hidden lg:grid grid-cols-[1fr_repeat(5,minmax(0,110px))] gap-2 px-4 py-2.5 border-b border-border text-[11px] font-medium text-ink-faint uppercase tracking-wide">
            <span>Vendedor</span>
            <span className="text-right">Fez <span className="normal-case">· clientes</span></span>
            <span className="text-right">Recebeu <span className="normal-case">· clientes</span></span>
            <span className="text-right">Atendidas</span>
            <span className="text-right">Perdidas</span>
            <span className="text-right">No telefone</span>
          </div>
          {linhas.map(r => (
            <LinhaVendedor
              key={r.vendedor} r={r} maxFez={maxFez} periodo={periodo}
              aberto={aberto === r.vendedor}
              onToggle={() => setAberto(aberto === r.vendedor ? null : r.vendedor)}
            />
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        O número miúdo ao lado de <b className="text-ink-muted">Fez</b> e{' '}
        <b className="text-ink-muted">Recebeu</b> é de <b className="text-ink-muted">clientes
        diferentes</b> — quem liga cinco vezes pro mesmo produtor fez cinco ligações, mas
        alcançou um. <b className="text-ink-muted">Atendidas</b> inclui as que o vendedor atendeu no celular
        (o WhatsApp marca como <i>AcceptedElsewhere</i>) — contar só as atendidas no computador
        puniria justamente quem trabalha com o telefone na mão. <b className="text-ink-muted">Tempo ao
        telefone</b> é <b>piso</b>: o WhatsApp só registra a duração das chamadas atendidas no
        próprio WhatsApp Web.
      </p>
    </div>
  )
}

function Kpi({ icon: Icon, cor, rotulo, valor }: { icon: typeof PhoneCall; cor: string; rotulo: string; valor: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mb-1">
        <Icon className={`h-3.5 w-3.5 ${cor}`} /> {rotulo}
      </div>
      <p className="text-[22px] font-semibold text-ink tabular-nums leading-none">{valor}</p>
    </div>
  )
}

function LinhaVendedor({ r, maxFez, periodo, aberto, onToggle }: {
  r: LigacaoResumo; maxFez: number; periodo: Periodo; aberto: boolean; onToggle: () => void
}) {
  const { data: lista = [], isLoading } = useLigacoesDe(aberto ? r.vendedor : null, periodo)
  // Só faz sentido pra quem ligou: quem só recebe teria 0% e pareceria ruim sem ter feito nada errado.
  const pct = r.fez > 0 ? Math.round((r.atendidas / (r.fez + r.recebeu)) * 100) : null

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-surface-2/40 transition-colors grid grid-cols-2 lg:grid-cols-[1fr_repeat(5,minmax(0,110px))] gap-2 items-center"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <ChevronDown className={`h-3.5 w-3.5 text-ink-faint shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`} />
          <span className="text-[13px] font-semibold text-ink truncate">{r.vendedor}</span>
        </span>
        <Num v={r.fez} destaque barra={r.fez / maxFez} rotulo="fez"
             extra={r.clientes_fez > 0 ? `${r.clientes_fez} cli.` : undefined} />
        <Num v={r.recebeu} rotulo="recebeu"
             extra={r.clientes_recebeu > 0 ? `${r.clientes_recebeu} cli.` : undefined} />
        <Num v={r.atendidas} cls="text-success" rotulo="atendidas" extra={pct !== null ? `${pct}%` : undefined} />
        <Num v={r.perdidas} cls={r.perdidas > 0 ? 'text-danger' : ''} rotulo="perdidas" />
        <Num txt={fmtDur(r.tempo_seg)} rotulo="no telefone" />
      </button>

      {aberto && (
        <div className="px-4 pb-3">
          {isLoading ? (
            <p className="text-[11px] text-ink-faint py-2">Carregando as ligações…</p>
          ) : lista.length === 0 ? (
            <p className="text-[11px] text-ink-faint py-2">Nenhuma ligação no período.</p>
          ) : (
            <div className="rounded-lg border border-border/60 bg-surface-2/20 divide-y divide-border/40 max-h-[420px] overflow-y-auto">
              {lista.map(l => {
                const d = desfecho(l.estado)
                return (
                  <div key={l.call_id} className="flex items-center gap-2 px-3 py-2 text-[12px] flex-wrap">
                    {l.outgoing
                      ? <PhoneOutgoing className="h-3.5 w-3.5 text-accent shrink-0" />
                      : <PhoneIncoming className="h-3.5 w-3.5 text-info shrink-0" />}
                    {l.is_video && <Video className="h-3.5 w-3.5 text-ink-faint shrink-0" />}
                    <span className="text-ink font-medium">{quemE(l)}</span>
                    {l.cliente_nome && l.cliente_fone && (
                      <span className="text-ink-faint tabular-nums">{fmtFone(l.cliente_fone)}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${d.cls}`}>{d.label}</span>
                    {l.duracao_seg ? <span className="text-ink-muted tabular-nums">{fmtDur(l.duracao_seg)}</span> : null}
                    <span className="flex-1" />
                    <span className="text-ink-faint tabular-nums shrink-0">{fmtQuando(l.offer_time)}</span>
                  </div>
                )
              })}
              {lista.length >= 300 && (
                <p className="px-3 py-2 text-[11px] text-ink-faint">
                  Mostrando as 300 mais recentes do período.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// No celular a grade vira 2 colunas e o cabeçalho some — por isso cada número
// carrega o próprio rótulo ali.
function Num({ v, txt, cls = '', destaque, barra, rotulo, extra }: {
  v?: number; txt?: string; cls?: string; destaque?: boolean; barra?: number; rotulo?: string; extra?: string
}) {
  return (
    <span className="text-right">
      <span className="lg:hidden text-[10px] text-ink-faint block">{rotulo}</span>
      <span className={`tabular-nums text-[13px] ${destaque ? 'font-semibold text-ink' : 'text-ink-muted'} ${cls}`}>
        {txt ?? (v === 0 ? '—' : v)}
      </span>
      {extra && <span className="text-[10px] text-ink-faint ml-1">{extra}</span>}
      {barra !== undefined && (
        <span className="hidden lg:block h-1 rounded-full bg-surface-2 overflow-hidden mt-1">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, barra * 100)}%` }} />
        </span>
      )}
    </span>
  )
}

export default Ligacoes
