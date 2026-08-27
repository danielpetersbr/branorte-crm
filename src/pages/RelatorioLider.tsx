import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Phone, FileText, MessageSquare, Users, Flame, AlertTriangle, WifiOff,
  Check, Plus, X, TrendingUp, Trophy, Loader2, ChevronRight, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TIMES,
  usePainelTime, useSerieTime, useVendasTime, useAtencaoTime,
  useOrcamentosTime, useQuentesTime, useMarcarAndamento,
  META_LIGACOES_PESSOA_DIA, META_VENDA_TIME_MES, diasUteis, ANDAMENTOS,
  type TimeSlug, type VendedorPainel, type Periodo, type Andamento, type AtencaoLinha,
} from '@/hooks/useRelatorioLider'

// ============================================================================
// Painel do Time — a tela que o time abre pra se acompanhar.
//
// ⚠️ 27/08/2026 o MODELO MUDOU: acabou o líder fixo de time. Antes esta tela
// tinha um formulário de 5 perguntas que UMA pessoa (o líder da semana)
// respondia sobre os colegas. Sem líder, isso não se sustenta:
//
//   • o formulário diário SAIU — relatório sem dono não é preenchido;
//   • a pergunta "quem ficou abaixo hoje?" virou o bloco PRECISA DE ATENÇÃO,
//     apurado pelo banco. Pedir a um vendedor pra justificar o colega seria
//     delação, e mataria a tela na primeira semana;
//   • os 3 botões de andamento, que eram acessório, viraram o CENTRO: é
//     literalmente "o time se acompanha e se ajuda".
//
// O motivo de perda não morreu junto: mudou de gatilho e passou a ser
// capturado na tela da reunião, quando o Daniel senta com o time.
// ============================================================================

// ⚠️ acima de 1 milhão precisa de "mi": no filtro de Mês o time passa de R$ 9 mi
// e sem isto saía "R$ 9.315 mil", que ninguém lê como nove milhões.
const brl = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 1000
      ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: n >= 10000 ? 0 : 1 })} mil`
      : `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`

const fmtDia = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }

/**
 * "hoje 14:21" / "há 3 dias" — a anotação de andamento precisa mostrar QUANDO
 * foi feita. Sem isso o líder marca "Negociando" uma vez e a marcação envelhece
 * invisível: seis dias depois a tela continua dizendo Negociando como se fosse
 * notícia fresca.
 */
function quandoAnotado(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (dias === 0) {
    return 'hoje ' + d.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    })
  }
  return `há ${dias} dia${dias === 1 ? '' : 's'}`
}

// ⚠️ As duas séries saíam da MESMA cor: no tema Branorte --accent e --success
// são os dois verdes, e no gráfico barra e linha viravam a mesma coisa.
// Orçamento passou pro azul de --info (211°) contra o verde do accent (152°).
const COR_LIGACAO = 'hsl(var(--accent))'   // verde Branorte
const COR_ORCAMENTO = 'hsl(var(--info))'   // azul

// ─── Metade 1: os números ───────────────────────────────────────────────────

/** Um cartão por vendedor. O "abaixo" é calculado aqui e alimenta a pergunta 3. */
function CardVendedor({ v, abaixo, quando, quentes }: { v: VendedorPainel; abaixo: boolean; quando: string; quentes: number }) {
  const semSync = v.sync_minutos === null || v.sync_minutos > 60
  return (
    <div className={cn(
      'rounded-lg border bg-surface p-3 sm:p-4',
      abaixo ? 'border-danger/50 bg-danger-bg/20' : 'border-border',
    )}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-[14px] text-ink">{v.vendedor_nome}</span>
        {semSync ? (
          <span title="A extensão deste vendedor não reportou. Os zeros abaixo podem ser falta de sync, não falta de trabalho."
            className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning-bg px-1.5 py-0.5 rounded">
            <WifiOff className="w-3 h-3" /> sem sinal
          </span>
        ) : abaixo ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-danger bg-danger-bg px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" /> abaixo
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Metrica icone={<Phone className="w-3.5 h-3.5" />} label="Ligações" valor={v.ligacoes}
          sub={`${v.ligacoes_feitas} feitas · ${v.ligacoes_recebidas} recebidas`} />
        <Metrica icone={<FileText className="w-3.5 h-3.5" />} label="Orçamentos" valor={v.orcamentos}
          sub={v.orcamentos_valor > 0 ? brl(v.orcamentos_valor) : '—'} />
        <Metrica icone={<Users className="w-3.5 h-3.5" />} label="Atendidos" valor={v.clientes_respondidos}
          sub={semSync ? 'sem sync' : `clientes ${quando}`} />
        <Metrica icone={<MessageSquare className="w-3.5 h-3.5" />} label="Mensagens" valor={v.msgs_enviadas}
          sub={`enviadas ${quando}`} />
      </div>

      <div className="mt-3 pt-2.5 border-t border-border flex items-center gap-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <Flame className="w-3 h-3 text-danger" /> {quentes} quente{quentes === 1 ? '' : 's'}
        </span>
        <span>{v.funil_followup} follow-up</span>
        <span>{v.funil_aberto} em aberto</span>
      </div>
    </div>
  )
}

function Metrica({ icone, label, valor, sub }: {
  icone: React.ReactNode; label: string; valor: number; sub: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-ink-muted">
        {icone}<span className="truncate">{label}</span>
      </div>
      <div className={cn('text-[20px] font-bold leading-tight', valor === 0 ? 'text-ink-muted' : 'text-ink')}>
        {valor}
      </div>
      <div className="text-[10px] text-ink-muted truncate">{sub}</div>
    </div>
  )
}

// ─── Metas ──────────────────────────────────────────────────────────────────

/**
 * Barra de meta. `falta` é o que interessa pro líder cobrar — vem em destaque,
 * não o percentual.
 */
function BarraMeta({ titulo, feito, meta, sufixo, fmt, detalhe }: {
  titulo: React.ReactNode; feito: number; meta: number; sufixo?: string
  fmt?: (n: number) => string; detalhe?: string
}) {
  const f = fmt ?? ((n: number) => n.toLocaleString('pt-BR'))
  const pct = meta > 0 ? Math.min(100, (feito / meta) * 100) : 0
  const falta = Math.max(0, meta - feito)
  const bateu = falta === 0 && meta > 0
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">{titulo}</span>
        {bateu ? (
          <span className="text-[11px] font-bold text-success">meta batida ✓</span>
        ) : (
          <span className="text-[11px] text-ink-muted">
            faltam <b className="text-danger">{f(falta)}{sufixo}</b>
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[20px] font-bold text-ink leading-none">{f(feito)}{sufixo}</span>
        <span className="text-[12px] text-ink-muted">de {f(meta)}{sufixo}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', bateu ? 'bg-success' : 'bg-accent')}
          style={{ width: `${pct}%` }} />
      </div>
      {detalhe && <p className="text-[10px] text-ink-muted mt-1">{detalhe}</p>}
    </div>
  )
}

// ─── Lista clicável de clientes (orçamentos / quentes) ──────────────────────

/**
 * Os 3 botões de andamento. Clicar no que já está marcado DESMARCA — sem isso
 * o líder que erra o clique fica com a anotação errada pra sempre.
 */
function BotoesAndamento({ atual, onMarcar, salvando }: {
  atual: Andamento | null; onMarcar: (s: Andamento | null) => void; salvando: boolean
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {ANDAMENTOS.map(a => {
        const ativo = atual === a.v
        return (
          <button key={a.v} type="button" disabled={salvando}
            onClick={() => onMarcar(ativo ? null : a.v)}
            className={cn(
              'px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
              ativo && a.cor === 'info' && 'border-info bg-info-bg text-info',
              ativo && a.cor === 'warning' && 'border-warning bg-warning-bg text-warning',
              ativo && a.cor === 'success' && 'border-success bg-success-bg text-success',
              !ativo && 'border-border text-ink-muted hover:bg-surface-2',
              salvando && 'opacity-50',
            )}>
            {a.label}
          </button>
        )
      })}
    </div>
  )
}

/** Painel que abre ao clicar num número. Fecha no Esc e no clique fora. */
function PainelLista({ titulo, subtitulo, onFechar, children }: {
  titulo: string; subtitulo?: string; onFechar: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onFechar])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm"
      onClick={onFechar}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-lg border border-border bg-surface shadow-xl mt-4">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div>
            <h3 className="font-bold text-[16px] text-ink">{titulo}</h3>
            {subtitulo && <p className="text-[12px] text-ink-muted mt-0.5">{subtitulo}</p>}
          </div>
          <button onClick={onFechar}
            className="shrink-0 w-8 h-8 grid place-items-center rounded-md border border-border text-ink-muted hover:bg-surface-2">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">{children}</div>
      </div>
    </div>
  )
}

// ─── Precisa de atenção ─────────────────────────────────────────────────────

const ICONE_ATENCAO: Record<string, React.ReactNode> = {
  sem_resposta: <MessageSquare className="w-3.5 h-3.5" />,
  orcamento_parado: <FileText className="w-3.5 h-3.5" />,
  abaixo_meta: <Phone className="w-3.5 h-3.5" />,
}

/**
 * O bloco que substituiu a pergunta "quem ficou abaixo hoje?".
 *
 * Com líder, um vendedor justificava o colega. Sem líder isso vira delação e
 * mata a tela. Aqui NINGUÉM acusa ninguém: são três fatos apurados pelo banco
 * — cliente sem resposta, orçamento sem andamento, ligação abaixo da meta.
 * O time olha junto e resolve.
 */
function BlocoAtencao({ itens, carregando }: { itens: AtencaoLinha[]; carregando: boolean }) {
  const [tudo, setTudo] = useState(false)
  const altas = itens.filter(i => i.severidade === 'alta')
  const mostrar = tudo ? itens : itens.slice(0, 7)

  return (
    <div className={cn('rounded-lg border',
      altas.length > 0 ? 'border-danger/40 bg-danger-bg/10' : 'border-border bg-surface')}>
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className={cn('w-4 h-4 shrink-0',
            altas.length > 0 ? 'text-danger' : 'text-ink-muted')} />
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">
            Precisa de atenção
          </h2>
          {itens.length > 0 && (
            <span className="text-[11px] text-ink-muted truncate">
              {itens.length}
              {altas.length > 0 && <b className="text-danger"> · {altas.length} urgente{altas.length === 1 ? '' : 's'}</b>}
            </span>
          )}
        </div>
        {itens.length > 7 && (
          <button onClick={() => setTudo(v => !v)}
            className="shrink-0 text-[11px] text-accent hover:underline">
            {tudo ? 'ver menos' : `ver todos (${itens.length})`}
          </button>
        )}
      </div>

      {carregando ? (
        <div className="h-20 grid place-items-center text-ink-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : itens.length === 0 ? (
        <p className="text-[13px] text-ink-muted p-4 text-center">
          Nada parado. Cliente respondido, orçamento acompanhado, meta em dia.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {mostrar.map((a, i) => (
            <div key={i} className="flex items-start gap-2.5 p-2.5">
              <span className={cn('shrink-0 mt-0.5',
                a.severidade === 'alta' ? 'text-danger' : 'text-warning')}>
                {ICONE_ATENCAO[a.tipo]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink truncate">
                  {a.cliente ?? a.vendedor_nome}
                  {a.cliente && <span className="text-ink-muted"> · {a.vendedor_nome}</span>}
                </div>
                <div className={cn('text-[11px]',
                  a.severidade === 'alta' ? 'text-danger' : 'text-ink-muted')}>
                  {a.detalhe}
                </div>
              </div>
              {!!a.valor && (
                <span className="shrink-0 text-[12px] font-semibold text-ink">{brl(a.valor)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────

export function RelatorioLider() {
  const [params, setParams] = useSearchParams()
  const timeSlug = (params.get('time') as TimeSlug | null) ?? null
  const time = TIMES.find(t => t.slug === timeSlug) ?? null

  const [periodo, setPeriodo] = useState<Periodo>('dia')
  const { data: painel = [], isLoading } = usePainelTime(timeSlug, periodo)
  const { data: serie = [] } = useSerieTime(timeSlug, periodo === 'mes' ? 30 : 14)
  const { data: vendas } = useVendasTime(timeSlug)
  const { data: atencao = [], isLoading: carregandoAtencao } = useAtencaoTime(timeSlug)

  // Quem está mexendo — só pra assinar as marcações. NÃO é líder: o modelo de
  // líder fixo acabou. Fica no localStorage pra não perguntar toda vez.
  const [euSou, setEuSou] = useState(() => localStorage.getItem('painel-time-eu') ?? '')
  const escolherEu = (n: string) => { setEuSou(n); localStorage.setItem('painel-time-eu', n) }

  const [lista, setLista] = useState<'orcamentos' | 'quentes' | null>(null)
  const { data: orcs = [], isLoading: carregandoOrcs } =
    useOrcamentosTime(timeSlug, periodo, lista === 'orcamentos')
  const { data: quentes = [] } = useQuentesTime(timeSlug)
  const marcar = useMarcarAndamento()

  const marcarLinha = (
    tipo: 'orcamento' | 'quente', chave: string, cliente: string,
    vendedor: string, status: Andamento | null,
  ) => marcar.mutate({
    time_slug: time?.slug ?? '', tipo, chave, cliente,
    vendedor_nome: vendedor, status, anotado_por: euSou || '(sem nome)',
  })

  const rotuloPeriodo = periodo === 'dia' ? 'hoje' : periodo === 'semana' ? 'na semana' : 'no mês'

  const totais = useMemo(() => painel.reduce((s, v) => ({
    ligacoes: s.ligacoes + v.ligacoes,
    feitas: s.feitas + v.ligacoes_feitas,
    orcamentos: s.orcamentos + v.orcamentos,
    valor: s.valor + v.orcamentos_valor,
    msgs: s.msgs + v.msgs_enviadas,
  }), { ligacoes: 0, feitas: 0, orcamentos: 0, valor: 0, msgs: 0 }), [painel])

  // Meta de ligação = 10 por pessoa × dia útil do PERÍODO FECHADO (dia 1,
  // semana 5, mês inteiro). Fechado pra bater com a régua da meta de VENDA,
  // que já é o mês inteiro.
  const metaLigacoes = useMemo(() => {
    const pessoas = painel.length || 3
    const hoje = new Date()
    const dias = periodo === 'dia' ? 1
      : periodo === 'semana' ? 5
      : diasUteis(
          new Date(hoje.getFullYear(), hoje.getMonth(), 1),
          new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0),
        )
    return META_LIGACOES_PESSOA_DIA * pessoas * dias
  }, [painel.length, periodo])

  if (!time) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10">
        <h1 className="text-[20px] font-bold text-ink mb-1">Painel do Time</h1>
        <p className="text-[13px] text-ink-muted mb-5">Qual time?</p>
        <div className="space-y-2">
          {TIMES.map(t => (
            <button key={t.slug} onClick={() => setParams({ time: t.slug })}
              className="w-full text-left px-4 py-3 rounded-lg border border-border bg-surface hover:border-accent transition-colors">
              <div className="font-semibold text-[15px] text-ink">{t.nome}</div>
              <div className="text-[12px] text-ink-muted">{t.membros.join(' · ')}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const membros = time.membros as unknown as string[]

  return (
    <div className="max-w-[1700px] mx-auto px-3 sm:px-5 py-4 sm:py-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-5 h-5 text-accent" />
            <h1 className="text-[19px] sm:text-[24px] font-bold text-ink">{time.nome}</h1>
          </div>
          <p className="text-[13px] text-ink-muted">
            {membros.join(' · ')} — o time se acompanha aqui
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-muted whitespace-nowrap">
            Sou eu
          </span>
          <div className="flex flex-wrap gap-1.5">
            {membros.map(m => (
              <button key={m} onClick={() => escolherEu(m)}
                title="Só pra assinar o que você marcar"
                className={cn('px-3 py-2 rounded-md border text-[13px] font-medium transition-colors',
                  euSou === m ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-2')}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px] gap-5 items-start">

      {/* ═══ COLUNA 1: OS NÚMEROS ═══ */}
      <div className="space-y-5 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">
            {periodo === 'dia' ? 'Como o time foi hoje'
              : periodo === 'semana' ? 'O time nesta semana' : 'O time neste mês'}
          </h2>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setPeriodo(v)}
                className={cn('px-3 py-1.5 text-[12px] font-medium transition-colors',
                  periodo === v ? 'bg-accent text-accent-fg' : 'text-ink-muted hover:bg-surface-2')}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <BarraMeta
            titulo={`Ligações feitas · meta ${META_LIGACOES_PESSOA_DIA}/pessoa por dia`}
            feito={totais.feitas} meta={metaLigacoes}
            detalhe={periodo === 'dia'
              ? `${painel.length || 3} pessoas × ${META_LIGACOES_PESSOA_DIA} no dia`
              : periodo === 'semana'
                ? `${painel.length || 3} pessoas × ${META_LIGACOES_PESSOA_DIA} × 5 dias (seg a sex)`
                : `${painel.length || 3} pessoas × ${META_LIGACOES_PESSOA_DIA} × dias úteis do mês`} />
          <BarraMeta
            titulo="Vendas do mês · meta do time"
            feito={vendas?.vendido ?? 0} meta={META_VENDA_TIME_MES} fmt={brl}
            detalhe={vendas ? `${vendas.pedidos} pedido${vendas.pedidos === 1 ? '' : 's'} fechado${vendas.pedidos === 1 ? '' : 's'} no mês` : 'carregando…'} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Tile label={periodo === 'dia' ? 'Ligações' : 'Ligações no período'} valor={String(totais.ligacoes)} />
          <Tile label="Orçamentos" valor={String(totais.orcamentos)} onClick={() => setLista('orcamentos')} />
          <Tile label="Em proposta" valor={totais.valor > 0 ? brl(totais.valor) : '—'} onClick={() => setLista('orcamentos')} />
          <Tile label="Mensagens" valor={String(totais.msgs)} />
          {/* "agora" de propósito: funil é ESTOQUE. A contagem vem da LISTA
              (wa_chat_labels), pra bater com o que abre ao clicar. */}
          <Tile label="Quentes agora" valor={String(quentes.length)} destaque onClick={() => setLista('quentes')} />
        </div>

        {isLoading ? (
          <div className="h-28 grid place-items-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {painel.map(v => (
              <CardVendedor key={v.vendedor_nome} v={v} abaixo={false} quando={rotuloPeriodo}
                quentes={quentes.filter(q => q.vendedor_nome?.toUpperCase() === v.vendedor_nome.toUpperCase()).length} />
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-ink-muted" />
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">
              {periodo === 'mes' ? 'Últimos 30 dias do time' : 'Últimos 14 dias do time'}
            </h2>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="dia" tickFormatter={fmtDia} tick={{ fontSize: 10 }} stroke="hsl(var(--ink-muted))" />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} stroke="hsl(var(--ink-muted))" />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--ink-muted))" />
                <Tooltip
                  labelFormatter={(label) => fmtDia(String(label))}
                  contentStyle={{
                    background: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))',
                    borderRadius: 8, fontSize: 12,
                  }}
                  formatter={(v, n) => [String(v), n === 'ligacoes' ? 'Ligações' : 'Orçamentos']} />
                <Bar yAxisId="l" dataKey="ligacoes" fill={COR_LIGACAO} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="r" dataKey="orcamentos" stroke={COR_ORCAMENTO} strokeWidth={2} dot={{ r: 2.5, fill: COR_ORCAMENTO }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-ink-muted mt-1.5">
            <span className="inline-flex items-center gap-1.5 mr-3">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COR_LIGACAO }} />
              Barra = ligações do time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: COR_ORCAMENTO }} />
              Linha = orçamentos emitidos
            </span>
          </p>
        </div>
      </div>

      {/* ═══ COLUNA 2: O QUE PRECISA DE ATENÇÃO ═══ */}
      <div className="xl:sticky xl:top-4 space-y-2">
        <BlocoAtencao itens={atencao} carregando={carregandoAtencao} />
        <p className="text-[11px] text-ink-muted px-1">
          Clique em <b className="text-ink">Orçamentos</b> ou <b className="text-ink">Quentes agora</b>{' '}
          pra abrir a lista de clientes e marcar como está cada um.
        </p>
      </div>

      </div>{/* fim do grid */}

      {/* ═══ LISTA: ORÇAMENTOS ═══ */}
      {lista === 'orcamentos' && (
        <PainelLista onFechar={() => setLista(null)}
          titulo={`Orçamentos ${rotuloPeriodo} · ${orcs.length}`}
          subtitulo="Marque como está cada um — é assim que o time se acompanha.">
          {carregandoOrcs ? (
            <div className="h-24 grid place-items-center text-ink-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : orcs.length === 0 ? (
            <p className="text-[13px] text-ink-muted p-4 text-center">Nenhum orçamento {rotuloPeriodo}.</p>
          ) : orcs.map(o => (
            <div key={o.id} className="rounded-md border border-border bg-surface-2/30 p-3">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <div className="font-medium text-[14px] text-ink truncate">{o.cliente}</div>
                  <div className="text-[11px] text-ink-muted">
                    {o.vendedor_nome} · {o.numero}
                    {o.dias > 0 && <> · há {o.dias} dia{o.dias === 1 ? '' : 's'}</>}
                  </div>
                </div>
                <span className="shrink-0 text-[14px] font-bold text-ink">{brl(o.valor)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
                <BotoesAndamento atual={o.status} salvando={marcar.isPending}
                  onMarcar={s => marcarLinha('orcamento', String(o.id), o.cliente, o.vendedor_nome, s)} />
                {o.anotado_por && (
                  <span className="text-[10px] text-ink-muted">
                    por {o.anotado_por} · {quandoAnotado(o.anotado_em)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </PainelLista>
      )}

      {/* ═══ LISTA: LEADS QUENTES ═══ */}
      {lista === 'quentes' && (
        <PainelLista onFechar={() => setLista(null)}
          titulo={`Leads quentes · ${quentes.length}`}
          subtitulo="“Cliente falou por último” = está esperando resposta.">
          {quentes.length === 0 ? (
            <p className="text-[13px] text-ink-muted p-4 text-center">
              Nenhum lead com etiqueta LEAD QUENTE neste time.
            </p>
          ) : quentes.map(q => {
            const esperando = q.ultima_foi_minha === false
            const parado = (q.dias_parado ?? 0) >= 2
            return (
              <div key={q.chat_id} className={cn('rounded-md border p-3',
                esperando && parado ? 'border-danger/50 bg-danger-bg/15' : 'border-border bg-surface-2/30')}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="min-w-0">
                    <div className="font-medium text-[14px] text-ink truncate">{q.cliente}</div>
                    <div className="text-[11px] text-ink-muted">{q.vendedor_nome}</div>
                  </div>
                  <span className={cn('shrink-0 inline-flex items-center gap-1 text-[11px] font-medium',
                    esperando && parado ? 'text-danger' : 'text-ink-muted')}>
                    <Clock className="w-3 h-3" />
                    {q.dias_parado === null ? 'sem mensagem'
                      : q.dias_parado === 0 ? 'hoje'
                      : `${q.dias_parado} dia${q.dias_parado === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="text-[11px] mb-2">
                  {esperando
                    ? <span className="text-danger font-medium">cliente falou por último — esperando resposta</span>
                    : q.ultima_foi_minha
                      ? <span className="text-ink-muted">vendedor respondeu por último</span>
                      : <span className="text-ink-muted">sem histórico de mensagem</span>}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <BotoesAndamento atual={q.status} salvando={marcar.isPending}
                    onMarcar={s => marcarLinha('quente', q.chat_id, q.cliente, q.vendedor_nome, s)} />
                  {q.anotado_por && (
                    <span className="text-[10px] text-ink-muted">
                      por {q.anotado_por} · {quandoAnotado(q.anotado_em)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </PainelLista>
      )}
    </div>
  )
}

function Tile({ label, valor, destaque, onClick }: {
  label: string; valor: string; destaque?: boolean; onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick}
      className={cn('rounded-lg border p-2.5 text-left w-full',
        destaque ? 'border-danger/40 bg-danger-bg/20' : 'border-border bg-surface',
        onClick && 'hover:border-accent cursor-pointer transition-colors')}>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted flex items-center gap-1">
        {label}
        {onClick && <ChevronRight className="w-3 h-3 opacity-60" />}
      </div>
      <div className="text-[18px] font-bold text-ink leading-tight">{valor}</div>
      {onClick && <div className="text-[9px] text-accent mt-0.5">ver clientes</div>}
    </Comp>
  )
}
