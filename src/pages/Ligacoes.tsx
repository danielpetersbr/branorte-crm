import { useState, useMemo } from 'react'
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users, ChevronDown, Video, Timer } from 'lucide-react'
import { useLigacoesResumo, useLigacoesDe, useLigacoesPorHora, type Periodo, type LigacaoResumo } from '@/hooks/useLigacoes'

// ============================================================================
// Central de Ligações — quanto cada vendedor pega no telefone.
//
// Existe porque até 17/08/2026 a única régua era uma coluna que contava
// `call_log` de conversa COM ETIQUETA DO FUNIL: numa segunda de manhã o time
// inteiro somava UMA ligação. A fonte de agora é o histórico do próprio
// WhatsApp — retroativa, com desfecho e duração.
//
// LAYOUT: tabela no desktop, CARD por vendedor no celular. A grade de 2 colunas
// com rótulo miúdo embaixo de cada número não sobrevive a 7 métricas.
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

// Taxa HONESTA: das que ELE ligou, quantas atenderam. Só faz sentido com volume —
// 1 de 1 = 100% e viraria líder do ranking sem ter feito nada.
function taxaAtendimento(r: LigacaoResumo): number | null {
  if (r.fez < 5) return null
  return Math.round((r.atendidas_fez / r.fez) * 100)
}

export function Ligacoes() {
  const [periodo, setPeriodo] = useState<Periodo>('7d')
  const [aberto, setAberto] = useState<string | null>(null)
  const { data: linhas = [], isLoading, isError } = useLigacoesResumo(periodo)
  const { data: horas = [] } = useLigacoesPorHora(periodo)

  const tot = useMemo(() => linhas.reduce((a, r) => ({
    fez: a.fez + r.fez, recebeu: a.recebeu + r.recebeu,
    atendidas_fez: a.atendidas_fez + r.atendidas_fez, perdidas: a.perdidas + r.perdidas,
    tempo_seg: a.tempo_seg + r.tempo_seg, clientes_fez: a.clientes_fez + r.clientes_fez,
    video_fez: a.video_fez + r.video_fez,
  }), { fez: 0, recebeu: 0, atendidas_fez: 0, perdidas: 0, tempo_seg: 0, clientes_fez: 0, video_fez: 0 }), [linhas])

  const taxaTime = tot.fez > 0 ? Math.round((tot.atendidas_fez / tot.fez) * 100) : null
  const maxFez = Math.max(1, ...linhas.map(r => r.fez))

  return (
    <div className="p-3 lg:p-6 max-w-[1150px] mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-3xl font-semibold text-ink tracking-tight flex items-center gap-2">
            <PhoneCall className="h-5 w-5 lg:h-6 lg:w-6 text-accent" /> Ligações
          </h1>
          <p className="text-[11.5px] lg:text-[12px] text-ink-faint mt-0.5">
            Do histórico do WhatsApp de cada vendedor — qualquer conversa, com ou sem etiqueta.
          </p>
        </div>
        {/* No celular a barra de período ocupa a largura toda; empilhar 4 botões
            miúdos no canto é o jeito mais rápido de ninguém acertar o toque. */}
        <div className="grid grid-cols-4 w-full sm:w-auto sm:inline-flex rounded-lg border border-border overflow-hidden shrink-0">
          {PERIODOS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-2 sm:py-1.5 text-[12px] font-medium transition-colors ${
                periodo === p.id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 lg:gap-3 mb-4">
        <Kpi icon={PhoneOutgoing} cor="text-accent" rotulo="Ligações feitas" valor={tot.fez}
             nota={taxaTime !== null ? `${taxaTime}% atenderam` : undefined} />
        {/* Alcance, não esforço. É a soma dos distintos POR VENDEDOR — dois vendedores que
            ligam pro mesmo produtor contam duas vezes aqui, de propósito: cada um gastou
            uma abordagem. Deduplicar no time esconderia trabalho de quem ligou. */}
        <Kpi icon={Users} cor="text-accent" rotulo="Clientes chamados" valor={tot.clientes_fez}
             nota={tot.clientes_fez > 0 ? `${(tot.fez / tot.clientes_fez).toFixed(1)}× por cliente` : undefined} />
        <Kpi icon={PhoneMissed} cor="text-danger" rotulo="Perdidas" valor={tot.perdidas} />
        <Kpi icon={Video} cor="text-info" rotulo="Chamadas de vídeo" valor={tot.video_fez} />
        <Kpi icon={Clock} cor="text-success" rotulo="Tempo ao telefone" valor={fmtDur(tot.tempo_seg)} />
      </div>

      <FaixaHorarios horas={horas} />

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
          <div className="hidden lg:grid grid-cols-[1fr_repeat(6,minmax(0,105px))] gap-2 px-4 py-2.5 border-b border-border text-[11px] font-medium text-ink-faint uppercase tracking-wide">
            <span>Vendedor</span>
            <span className="text-right">Fez <span className="normal-case">· clientes</span></span>
            <span className="text-right">Atenderam</span>
            <span className="text-right">Recebeu <span className="normal-case">· clientes</span></span>
            <span className="text-right">Perdidas</span>
            <span className="text-right">Vídeo</span>
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
        alcançou um. <b className="text-ink-muted">Atenderam</b> é sobre as que ele CHAMOU
        (só aparece com 5+ ligações; abaixo disso um acerto isolado viraria 100%).{' '}
        <b className="text-ink-muted">Vídeo</b> conta só as que ele chamou — é onde mostra o
        equipamento. Quem atendeu no celular entra como atendida (o WhatsApp marca{' '}
        <i>AcceptedElsewhere</i>): contar só as atendidas no computador puniria justamente
        quem trabalha com o telefone na mão. <b className="text-ink-muted">Tempo ao telefone</b>{' '}
        é piso — o WhatsApp só registra a duração das chamadas atendidas no próprio WhatsApp Web.
      </p>
    </div>
  )
}

// Em que hora do dia o cliente ATENDE. A diferença é grande o bastante pra mudar
// rotina: medido em 17/08, 15h atende 63% e 16h atende 40%.
function FaixaHorarios({ horas }: { horas: Array<{ hora: number; feitas: number; atenderam: number }> }) {
  const uteis = horas.filter(h => h.feitas >= 5)
  if (uteis.length < 4) return null
  const melhor = [...uteis].sort((a, b) => (b.atenderam / b.feitas) - (a.atenderam / a.feitas))[0]
  const pior = [...uteis].sort((a, b) => (a.atenderam / a.feitas) - (b.atenderam / b.feitas))[0]

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5 lg:p-4 mb-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5">
          <Timer className="h-4 w-4 text-accent" /> Que horas o cliente atende
        </h2>
        <p className="text-[11px] text-ink-faint">
          melhor <b className="text-success">{melhor.hora}h</b> ({Math.round(melhor.atenderam / melhor.feitas * 100)}%)
          {' · '}pior <b className="text-danger">{pior.hora}h</b> ({Math.round(pior.atenderam / pior.feitas * 100)}%)
        </p>
      </div>
      {/* Rola no celular em vez de espremer 12 barras em 360px. */}
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
        {uteis.map(h => {
          const taxa = h.atenderam / h.feitas
          return (
            <div key={h.hora} className="flex flex-col items-center gap-1 shrink-0 w-[38px]" title={`${h.hora}h — ${h.feitas} ligações, ${h.atenderam} atenderam`}>
              <span className="text-[10px] text-ink-faint tabular-nums">{Math.round(taxa * 100)}%</span>
              <div className="w-full h-14 rounded-md bg-surface-2 flex items-end overflow-hidden">
                <div
                  className={`w-full rounded-md ${taxa >= 0.55 ? 'bg-success' : taxa >= 0.45 ? 'bg-accent' : 'bg-danger/70'}`}
                  style={{ height: `${Math.max(6, taxa * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-ink-muted tabular-nums">{h.hora}h</span>
            </div>
          )
        })}
      </div>
      <p className="text-[10.5px] text-ink-faint mt-2">
        % de ligações FEITAS que o cliente atendeu, por hora do dia. Só horas com 5+ ligações.
      </p>
    </div>
  )
}

function Kpi({ icon: Icon, cor, rotulo, valor, nota }: {
  icon: typeof PhoneCall; cor: string; rotulo: string; valor: number | string; nota?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 lg:p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mb-1">
        <Icon className={`h-3.5 w-3.5 ${cor} shrink-0`} /> <span className="truncate">{rotulo}</span>
      </div>
      <p className="text-[20px] lg:text-[22px] font-semibold text-ink tabular-nums leading-none">{valor}</p>
      {nota && <p className="text-[10.5px] text-ink-faint mt-1">{nota}</p>}
    </div>
  )
}

function LinhaVendedor({ r, maxFez, periodo, aberto, onToggle }: {
  r: LigacaoResumo; maxFez: number; periodo: Periodo; aberto: boolean; onToggle: () => void
}) {
  const { data: lista = [], isLoading } = useLigacoesDe(aberto ? r.vendedor : null, periodo)
  const taxa = taxaAtendimento(r)

  return (
    <div className="border-b border-border/60 last:border-0">
      <button onClick={onToggle} className="w-full text-left px-3 lg:px-4 py-3 hover:bg-surface-2/40 transition-colors">
        {/* ── CELULAR: card ─────────────────────────────────────────────── */}
        <div className="lg:hidden">
          <div className="flex items-center gap-1.5 mb-2">
            <ChevronDown className={`h-3.5 w-3.5 text-ink-faint shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`} />
            <span className="text-[14px] font-semibold text-ink truncate flex-1">{r.vendedor}</span>
            {taxa !== null && (
              <span className={`text-[11px] font-semibold tabular-nums ${taxa >= 55 ? 'text-success' : taxa >= 40 ? 'text-ink-muted' : 'text-danger'}`}>
                {taxa}% atenderam
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 pl-5">
            <Mini rotulo="fez" valor={r.fez} sub={`${r.clientes_fez} clientes`} forte />
            <Mini rotulo="recebeu" valor={r.recebeu} sub={`${r.clientes_recebeu} clientes`} />
            <Mini rotulo="perdidas" valor={r.perdidas} cls={r.perdidas > 0 ? 'text-danger' : ''} />
            <Mini rotulo="no telefone" txt={fmtDur(r.tempo_seg)} />
            <Mini rotulo="média/ligação" txt={fmtDur(r.dur_media)} />
            <Mini rotulo="vídeo" valor={r.video_fez} cls={r.video_fez > 0 ? 'text-info' : ''} />
          </div>
        </div>

        {/* ── DESKTOP: linha da tabela ──────────────────────────────────── */}
        <div className="hidden lg:grid grid-cols-[1fr_repeat(6,minmax(0,105px))] gap-2 items-center">
          <span className="flex items-center gap-1.5 min-w-0">
            <ChevronDown className={`h-3.5 w-3.5 text-ink-faint shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`} />
            <span className="text-[13px] font-semibold text-ink truncate">{r.vendedor}</span>
          </span>
          <Num v={r.fez} destaque barra={r.fez / maxFez} extra={r.clientes_fez > 0 ? `${r.clientes_fez} cli.` : undefined} />
          <Num v={r.atendidas_fez} cls="text-success" extra={taxa !== null ? `${taxa}%` : undefined} />
          <Num v={r.recebeu} extra={r.clientes_recebeu > 0 ? `${r.clientes_recebeu} cli.` : undefined} />
          <Num v={r.perdidas} cls={r.perdidas > 0 ? 'text-danger' : ''} />
          <Num v={r.video_fez} cls={r.video_fez > 0 ? 'text-info' : ''} extra={r.clientes_video > 0 ? `${r.clientes_video} cli.` : undefined} />
          <Num txt={fmtDur(r.tempo_seg)} extra={r.dur_media > 0 ? `~${fmtDur(r.dur_media)}` : undefined} />
        </div>
      </button>

      {aberto && (
        <div className="px-3 lg:px-4 pb-3">
          {isLoading ? (
            <p className="text-[11px] text-ink-faint py-2">Carregando as ligações…</p>
          ) : lista.length === 0 ? (
            <p className="text-[11px] text-ink-faint py-2">Nenhuma ligação no período.</p>
          ) : (
            <div className="rounded-lg border border-border/60 bg-surface-2/20 divide-y divide-border/40 max-h-[420px] overflow-y-auto">
              {lista.map(l => {
                const d = desfecho(l.estado)
                return (
                  <div key={l.call_id} className="flex items-center gap-x-2 gap-y-1 px-3 py-2 text-[12px] flex-wrap">
                    {l.outgoing
                      ? <PhoneOutgoing className="h-3.5 w-3.5 text-accent shrink-0" />
                      : <PhoneIncoming className="h-3.5 w-3.5 text-info shrink-0" />}
                    {l.is_video && <Video className="h-3.5 w-3.5 text-info shrink-0" />}
                    <span className="text-ink font-medium">{quemE(l)}</span>
                    {l.cliente_nome && l.cliente_fone && (
                      <span className="hidden sm:inline text-ink-faint tabular-nums">{fmtFone(l.cliente_fone)}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${d.cls}`}>{d.label}</span>
                    {l.duracao_seg ? <span className="text-ink-muted tabular-nums">{fmtDur(l.duracao_seg)}</span> : null}
                    <span className="flex-1" />
                    <span className="text-ink-faint tabular-nums shrink-0">{fmtQuando(l.offer_time)}</span>
                  </div>
                )
              })}
              {lista.length >= 300 && (
                <p className="px-3 py-2 text-[11px] text-ink-faint">Mostrando as 300 mais recentes do período.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Célula do card no celular: rótulo em cima, número grande, detalhe embaixo.
function Mini({ rotulo, valor, txt, sub, cls = '', forte }: {
  rotulo: string; valor?: number; txt?: string; sub?: string; cls?: string; forte?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] text-ink-faint leading-none mb-1">{rotulo}</p>
      <p className={`tabular-nums leading-none ${forte ? 'text-[16px] font-semibold text-ink' : 'text-[15px] text-ink-muted'} ${cls}`}>
        {txt ?? (valor === 0 ? '—' : valor)}
      </p>
      {sub && <p className="text-[10px] text-ink-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function Num({ v, txt, cls = '', destaque, barra, extra }: {
  v?: number; txt?: string; cls?: string; destaque?: boolean; barra?: number; extra?: string
}) {
  return (
    <span className="text-right">
      <span className={`tabular-nums text-[13px] ${destaque ? 'font-semibold text-ink' : 'text-ink-muted'} ${cls}`}>
        {txt ?? (v === 0 ? '—' : v)}
      </span>
      {extra && <span className="text-[10px] text-ink-faint ml-1">{extra}</span>}
      {barra !== undefined && (
        <span className="block h-1 rounded-full bg-surface-2 overflow-hidden mt-1">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, barra * 100)}%` }} />
        </span>
      )}
    </span>
  )
}

export default Ligacoes
