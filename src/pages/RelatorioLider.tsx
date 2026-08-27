import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Phone, FileText, MessageSquare, Users, Flame, AlertTriangle, WifiOff,
  Check, Plus, X, TrendingUp, Trophy, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TIMES, OBSTACULOS, MOTIVOS_PERDA, MOTIVOS_ABAIXO, DESVIOS_LEAD, PREVISOES,
  usePainelTime, useSerieTime, useRelatorioDoDia, useSalvarRelatorio, useVendasTime,
  META_LIGACOES_PESSOA_DIA, META_VENDA_TIME_MES, diasUteis,
  type TimeSlug, type VendedorPainel, type NegocioForm, type Periodo,
} from '@/hooks/useRelatorioLider'

// ============================================================================
// /relatorio-lider — a tela que o líder da semana abre no fim do dia.
//
// DUAS METADES, nesta ordem, de propósito:
//   1. OS NÚMEROS DO TIME   → o líder vê o que os 3 fizeram hoje (e cobra)
//   2. AS 5 PERGUNTAS       → ele conta o que o número não mostra (o motivo)
//
// O link vai com o time embutido: /relatorio-lider?time=caca-lead. Cada líder
// recebe o link do time dele; quem é o líder da semana é o Daniel que define,
// e o líder só confirma o próprio nome no topo.
//
// ⚠️ Nenhuma pergunta aqui pede número. Ligação, orçamento e mensagem já são
// contados pelo sistema e aparecem na metade de cima. Perguntar de novo seria
// gastar o tempo do líder pra ganhar um dado pior que o do banco.
// ============================================================================

const brl = (n: number) =>
  n >= 1000
    ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: n >= 10000 ? 0 : 1 })} mil`
    : `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`

const fmtDia = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }

// ⚠️ As duas séries saíam da MESMA cor: no tema Branorte --accent e --success
// são os dois verdes, e no gráfico barra e linha viravam a mesma coisa.
// Orçamento passou pro azul de --info (211°) contra o verde do accent (152°).
const COR_LIGACAO = 'hsl(var(--accent))'   // verde Branorte
const COR_ORCAMENTO = 'hsl(var(--info))'   // azul

// ─── Metade 1: os números ───────────────────────────────────────────────────

/** Um cartão por vendedor. O "abaixo" é calculado aqui e alimenta a pergunta 3. */
function CardVendedor({ v, abaixo, quando }: { v: VendedorPainel; abaixo: boolean; quando: string }) {
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
          <Flame className="w-3 h-3 text-danger" /> {v.funil_quente} quente{v.funil_quente === 1 ? '' : 's'}
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

// ─── Formulário: componentes de resposta ────────────────────────────────────

function Pergunta({ n, titulo, ajuda, children }: {
  n: number; titulo: string; ajuda?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-[12px] font-bold grid place-items-center">
          {n}
        </span>
        <div>
          <h3 className="font-semibold text-[14px] text-ink leading-snug">{titulo}</h3>
          {ajuda && <p className="text-[12px] text-ink-muted mt-0.5">{ajuda}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Chips<T extends string>({ opcoes, valor, onChange, cols }: {
  opcoes: readonly T[]; valor: T | null; onChange: (v: T | null) => void; cols?: string
}) {
  return (
    <div className={cn('grid gap-1.5', cols ?? 'grid-cols-1 sm:grid-cols-2')}>
      {opcoes.map(o => (
        <button key={o} type="button" onClick={() => onChange(valor === o ? null : o)}
          className={cn(
            'text-left px-3 py-2 rounded-md border text-[13px] transition-colors min-h-[40px]',
            valor === o
              ? 'border-accent bg-accent/10 text-ink font-medium'
              : 'border-border bg-surface-2/40 text-ink-muted hover:bg-surface-2',
          )}>
          {o}
        </button>
      ))}
    </div>
  )
}

const inputCls =
  'w-full min-h-[40px] rounded-md border border-border bg-surface px-3 text-[14px] sm:text-[13px] ' +
  'text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/40'

/** Uma linha de negócio (P1 quente / P2 perdido). */
function LinhaNegocio({ n, membros, onChange, onRemove }: {
  n: NegocioForm; membros: string[]
  onChange: (n: NegocioForm) => void; onRemove: () => void
}) {
  const quente = n.tipo === 'quente'
  return (
    <div className="rounded-md border border-border bg-surface-2/30 p-3 space-y-2.5">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Nome do cliente" value={n.cliente}
          onChange={e => onChange({ ...n, cliente: e.target.value })} />
        <button type="button" onClick={onRemove} title="Remover"
          className="shrink-0 w-10 grid place-items-center rounded-md border border-border text-ink-muted hover:text-danger hover:border-danger/50">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={n.vendedor_nome}
          onChange={e => onChange({ ...n, vendedor_nome: e.target.value })}>
          <option value="">Vendedor…</option>
          {membros.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className={inputCls} inputMode="numeric" placeholder="Valor (R$)"
          value={n.valor ?? ''}
          onChange={e => onChange({ ...n, valor: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} />
      </div>

      {quente && (
        <div className="flex flex-wrap gap-1.5">
          {PREVISOES.map(p => (
            <button key={p.v} type="button" onClick={() => onChange({ ...n, previsao: p.v })}
              className={cn('px-2.5 py-1.5 rounded-md border text-[12px]',
                n.previsao === p.v ? 'border-accent bg-accent/10 text-ink font-medium'
                  : 'border-border text-ink-muted hover:bg-surface-2')}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <select className={inputCls}
        value={(quente ? n.obstaculo : n.motivo) ?? ''}
        onChange={e => onChange(quente
          ? { ...n, obstaculo: e.target.value }
          : { ...n, motivo: e.target.value, concorrente: e.target.value.includes('concorrente') ? n.concorrente : '' })}>
        <option value="">{quente ? 'O que falta pra fechar…' : 'Por que morreu…'}</option>
        {(quente ? OBSTACULOS : MOTIVOS_PERDA).map(o => <option key={o} value={o}>{o}</option>)}
      </select>

      {!quente && n.motivo?.includes('concorrente') && (
        <input className={inputCls} placeholder="Qual concorrente? (obrigatório)"
          value={n.concorrente ?? ''} onChange={e => onChange({ ...n, concorrente: e.target.value })} />
      )}
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────

export function RelatorioLider() {
  const [params, setParams] = useSearchParams()
  const timeSlug = (params.get('time') as TimeSlug | null) ?? null
  const time = TIMES.find(t => t.slug === timeSlug) ?? null

  // Período dos NÚMEROS. O formulário continua sempre do DIA — o relatório é
  // diário; só o painel de cima muda de recorte.
  const [periodo, setPeriodo] = useState<Periodo>('dia')

  const { data: painel = [], isLoading } = usePainelTime(timeSlug, periodo)
  const { data: serie = [] } = useSerieTime(timeSlug, periodo === 'mes' ? 30 : 14)
  const { data: vendas } = useVendasTime(timeSlug)
  const { data: jaSalvo } = useRelatorioDoDia(timeSlug)
  const salvar = useSalvarRelatorio()

  const [lider, setLider] = useState('')
  const [negocios, setNegocios] = useState<NegocioForm[]>([])
  const [abaixoMotivo, setAbaixoMotivo] = useState<string | null>(null)
  const [qualidade, setQualidade] = useState<'bons' | 'mistos' | 'ruins' | null>(null)
  const [desvio, setDesvio] = useState<string | null>(null)
  const [termometro, setTermometro] = useState<'verde' | 'amarelo' | 'vermelho' | null>(null)
  const [obs, setObs] = useState('')

  // Reabriu no mesmo dia? Carrega o que já respondeu, pra CORRIGIR e não refazer.
  useEffect(() => {
    if (!jaSalvo) return
    const r = jaSalvo as Record<string, any>
    setLider(r.lider_nome ?? '')
    setAbaixoMotivo(r.abaixo_motivo ?? null)
    setQualidade(r.qualidade_lead ?? null)
    setDesvio(r.qualidade_lead_motivo ?? null)
    setTermometro(r.termometro ?? null)
    setObs(r.termometro_obs ?? '')
    setNegocios((r.negocios ?? []).map((n: Record<string, any>) => ({
      tipo: n.tipo, cliente: n.cliente, vendedor_nome: n.vendedor_nome ?? '',
      valor: n.valor ? Number(n.valor) : null, previsao: n.previsao ?? undefined,
      obstaculo: n.obstaculo ?? undefined, motivo: n.motivo ?? undefined,
      concorrente: n.concorrente ?? undefined,
    })))
  }, [jaSalvo])

  // Quem ficou abaixo hoje: o sistema aponta, o líder só justifica.
  // Régua: zerou orçamento E ficou abaixo de metade da média do time em
  // conversa. Quem está sem sync fica FORA — zero sem sinal não é zero de
  // trabalho, e acusar por falha de sync destrói a confiança na tela.
  const abaixo = useMemo(() => {
    const validos = painel.filter(v => v.sync_minutos !== null && v.sync_minutos <= 60)
    if (validos.length < 2) return null
    const media = validos.reduce((s, v) => s + v.clientes_respondidos, 0) / validos.length
    const cand = validos
      .filter(v => v.orcamentos === 0 && v.clientes_respondidos < media * 0.5)
      .sort((a, b) => a.clientes_respondidos - b.clientes_respondidos)
    return cand[0]?.vendedor_nome ?? null
  }, [painel])

  const totais = useMemo(() => painel.reduce((s, v) => ({
    ligacoes: s.ligacoes + v.ligacoes,
    feitas: s.feitas + v.ligacoes_feitas,
    orcamentos: s.orcamentos + v.orcamentos,
    valor: s.valor + v.orcamentos_valor,
    msgs: s.msgs + v.msgs_enviadas,
    quentes: s.quentes + v.funil_quente,
  }), { ligacoes: 0, feitas: 0, orcamentos: 0, valor: 0, msgs: 0, quentes: 0 }), [painel])

  // Meta de ligação = 10 por pessoa por DIA ÚTIL. No dia são 30 (3 pessoas);
  // na semana e no mês multiplica pelos dias úteis JÁ DECORRIDOS, não pelo mês
  // inteiro — meta de mês fechado no dia 3 mostraria um buraco que não existe.
  const metaLigacoes = useMemo(() => {
    const hoje = new Date()
    const de = painel[0]?.periodo_de ? new Date(painel[0].periodo_de + 'T12:00:00') : hoje
    return META_LIGACOES_PESSOA_DIA * (painel.length || 3) * diasUteis(de, hoje)
  }, [painel])

  const rotuloPeriodo = periodo === 'dia' ? 'hoje' : periodo === 'semana' ? 'na semana' : 'no mês'

  const podeSalvar = !!lider && !!termometro
    && (termometro === 'verde' || obs.trim().length >= 5)
    && (!abaixo || !!abaixoMotivo)

  // ── Sem time no link: escolhe ─────────────────────────────────────────────
  if (!time) {
    return (
      <div className="max-w-lg mx-auto px-4 py-10">
        <h1 className="text-[20px] font-bold text-ink mb-1">Relatório do Líder</h1>
        <p className="text-[13px] text-ink-muted mb-5">Qual time você lidera esta semana?</p>
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
    // Em tela grande vira DUAS COLUNAS: números à esquerda, perguntas à direita.
    // Não é só estética — o líder responde "quem ficou abaixo" e "o que travou"
    // olhando o número que motivou a pergunta, sem rolar pra cima e perder o
    // contexto. Abaixo de xl empilha na ordem antiga (números primeiro).
    <div className="max-w-[1700px] mx-auto px-3 sm:px-5 py-4 sm:py-6 pb-24">
      {/* Cabeçalho + quem preenche, lado a lado quando cabe */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-5 h-5 text-accent" />
            <h1 className="text-[19px] sm:text-[24px] font-bold text-ink">{time.nome}</h1>
          </div>
          <p className="text-[13px] text-ink-muted">
            Relatório de{' '}
            {new Date().toLocaleDateString('pt-BR', {
              weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo',
            })}
            {jaSalvo && <span className="text-success font-medium"> · já enviado (você pode corrigir)</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-muted whitespace-nowrap">
            Líder da semana
          </span>
          <div className="flex flex-wrap gap-1.5">
            {membros.map(m => (
              <button key={m} onClick={() => setLider(m)}
                className={cn('px-3 py-2 rounded-md border text-[13px] font-medium transition-colors',
                  lider === m ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-2')}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px] gap-5 items-start">

      {/* ═══ COLUNA 1: OS NÚMEROS ═══ */}
      <div className="space-y-5 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted">
            {periodo === 'dia' ? 'Como o time foi hoje'
              : periodo === 'semana' ? 'O time nesta semana'
              : 'O time neste mês'}
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

        {/* METAS — ligação escala com o período; venda é sempre do MÊS, porque a
            meta de R$ 833 mil é mensal. Misturar as duas escalas confundiria. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <BarraMeta
            titulo={`Ligações feitas · meta ${META_LIGACOES_PESSOA_DIA}/pessoa por dia`}
            feito={totais.feitas} meta={metaLigacoes}
            detalhe={periodo === 'dia'
              ? `${painel.length || 3} pessoas × ${META_LIGACOES_PESSOA_DIA} hoje`
              : `${META_LIGACOES_PESSOA_DIA}/pessoa × dias úteis já corridos no período`} />
          <BarraMeta
            titulo="Vendas do mês · meta do time"
            feito={vendas?.vendido ?? 0} meta={META_VENDA_TIME_MES}
            fmt={brl}
            detalhe={vendas ? `${vendas.pedidos} pedido${vendas.pedidos === 1 ? '' : 's'} fechado${vendas.pedidos === 1 ? '' : 's'} no mês` : 'carregando…'} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Tile label={periodo === 'dia' ? 'Ligações' : 'Ligações no período'} valor={String(totais.ligacoes)} />
          <Tile label="Orçamentos" valor={String(totais.orcamentos)} />
          <Tile label="Em proposta" valor={totais.valor > 0 ? brl(totais.valor) : '—'} />
          <Tile label="Mensagens" valor={String(totais.msgs)} />
          {/* "agora" de propósito: funil é ESTOQUE, não tem recorte de período —
              somar quentes da semana contaria o mesmo lead 5 vezes. */}
          <Tile label="Quentes agora" valor={String(totais.quentes)} destaque />
        </div>

        {isLoading ? (
          <div className="h-28 grid place-items-center text-ink-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {painel.map(v => (
              <CardVendedor key={v.vendedor_nome} v={v} abaixo={v.vendedor_nome === abaixo} quando={rotuloPeriodo} />
            ))}
          </div>
        )}

      {/* Gráfico dos 14 dias */}
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
          Barra = ligações do time · Linha = orçamentos emitidos
        </p>
      </div>
      </div>

      {/* ═══ COLUNA 2: AS 5 PERGUNTAS ═══ */}
      {/* sticky no xl: as perguntas acompanham a rolagem e continuam ao lado dos
          números. Sem isso a coluna direita some quando o líder desce a página. */}
      <div className="xl:sticky xl:top-4">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-muted mb-1">
          O que os números não mostram
        </h2>
        <p className="text-[12px] text-ink-muted mb-3">
          5 perguntas, 2 a 3 minutos. Só o que o sistema não sabe sozinho.
        </p>

        <div className="space-y-3">
          <Pergunta n={1} titulo="Qual negócio está mais perto de fechar?"
            ajuda="Até 2. Se nenhum, deixe vazio.">
            <div className="space-y-2">
              {negocios.filter(n => n.tipo === 'quente').map((n) => (
                <LinhaNegocio key={negocios.indexOf(n)} n={n} membros={membros}
                  onChange={u => setNegocios(negocios.map(x => x === n ? u : x))}
                  onRemove={() => setNegocios(negocios.filter(x => x !== n))} />
              ))}
              {negocios.filter(n => n.tipo === 'quente').length < 2 && (
                <button type="button"
                  onClick={() => setNegocios([...negocios, {
                    tipo: 'quente', cliente: '', vendedor_nome: '', valor: null, previsao: 'semana',
                  }])}
                  className="w-full py-2.5 rounded-md border border-dashed border-border text-[13px] text-ink-muted hover:border-accent hover:text-accent transition-colors">
                  <Plus className="w-4 h-4 inline mr-1" /> Adicionar negócio quente
                </button>
              )}
            </div>
          </Pergunta>

          <Pergunta n={2} titulo="Algum negócio esfriou ou foi perdido hoje?"
            ajuda="É a pergunta mais valiosa. Sem ela, ninguém sabe por que o time vendeu menos.">
            <div className="space-y-2">
              {negocios.filter(n => n.tipo === 'perdido').map((n) => (
                <LinhaNegocio key={negocios.indexOf(n)} n={n} membros={membros}
                  onChange={u => setNegocios(negocios.map(x => x === n ? u : x))}
                  onRemove={() => setNegocios(negocios.filter(x => x !== n))} />
              ))}
              <button type="button"
                onClick={() => setNegocios([...negocios, {
                  tipo: 'perdido', cliente: '', vendedor_nome: '', valor: null,
                }])}
                className="w-full py-2.5 rounded-md border border-dashed border-border text-[13px] text-ink-muted hover:border-danger hover:text-danger transition-colors">
                <Plus className="w-4 h-4 inline mr-1" /> Registrar negócio perdido
              </button>
            </div>
          </Pergunta>

          {abaixo && (
            <Pergunta n={3} titulo={`${abaixo} ficou abaixo hoje. O que aconteceu?`}
              ajuda="O sistema apontou o nome — você só dá o motivo.">
              <Chips opcoes={MOTIVOS_ABAIXO} valor={abaixoMotivo} onChange={setAbaixoMotivo} cols="grid-cols-1" />
            </Pergunta>
          )}

          <Pergunta n={abaixo ? 4 : 3} titulo="Os leads que chegaram hoje eram bons?">
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['bons', 'Bons', 'no perfil'],
                ['mistos', 'Mistos', 'metade prestava'],
                ['ruins', 'Ruins', 'fora do perfil'],
              ] as const).map(([v, l, s]) => (
                <button key={v} type="button"
                  onClick={() => { setQualidade(v); if (v !== 'ruins') setDesvio(null) }}
                  className={cn('px-2 py-2.5 rounded-md border text-center transition-colors',
                    qualidade === v ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-2')}>
                  <div className="text-[13px] font-medium text-ink">{l}</div>
                  <div className="text-[10px] text-ink-muted">{s}</div>
                </button>
              ))}
            </div>
            {qualidade === 'ruins' && (
              <div className="mt-2">
                <Chips opcoes={DESVIOS_LEAD} valor={desvio} onChange={setDesvio} cols="grid-cols-1" />
              </div>
            )}
          </Pergunta>

          <Pergunta n={abaixo ? 5 : 4} titulo="Como estava o time hoje?">
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['verde', '🟢 Normal'],
                ['amarelo', '🟡 Algo fora do lugar'],
                ['vermelho', '🔴 Problema real'],
              ] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setTermometro(v)}
                  className={cn('px-2 py-2.5 rounded-md border text-[12px] font-medium transition-colors',
                    termometro === v ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-2')}>
                  {l}
                </button>
              ))}
            </div>
            {termometro && termometro !== 'verde' && (
              <textarea value={obs} onChange={e => setObs(e.target.value.slice(0, 200))}
                placeholder="Em 1 linha: o que aconteceu? (obrigatório)"
                rows={2}
                className={cn(inputCls, 'mt-2 py-2 resize-none',
                  obs.trim().length < 5 && 'border-warning')} />
            )}
          </Pergunta>
        </div>
      </div>

      </div>{/* fim do grid de 2 colunas */}

      {/* Barra de envio */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-3 py-2.5 z-20">
        <div className="max-w-[1700px] mx-auto flex items-center gap-3">
          <div className="flex-1 text-[11px] text-ink-muted leading-tight">
            {!lider ? 'Escolha seu nome no topo.'
              : !termometro ? 'Falta o termômetro do time.'
              : termometro !== 'verde' && obs.trim().length < 5 ? 'Escreva 1 linha sobre o que aconteceu.'
              : abaixo && !abaixoMotivo ? `Falta o motivo do ${abaixo}.`
              : salvar.isSuccess ? '✅ Enviado. Obrigado.'
              : 'Tudo pronto.'}
          </div>
          <button
            disabled={!podeSalvar || salvar.isPending}
            onClick={() => salvar.mutate({
              time_slug: time.slug, lider_nome: lider,
              abaixo_vendedor: abaixo, abaixo_motivo: abaixoMotivo,
              qualidade_lead: qualidade, qualidade_lead_motivo: desvio,
              termometro: termometro!, termometro_obs: obs.trim() || null,
              negocios: negocios.filter(n => n.cliente.trim()),
            })}
            className={cn(
              'px-5 py-2.5 rounded-md text-[14px] font-semibold transition-colors inline-flex items-center gap-2',
              podeSalvar && !salvar.isPending
                ? 'bg-accent text-accent-fg hover:opacity-90'
                : 'bg-surface-2 text-ink-muted cursor-not-allowed',
            )}>
            {salvar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {jaSalvo ? 'Corrigir' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2.5',
      destaque ? 'border-danger/40 bg-danger-bg/20' : 'border-border bg-surface')}>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-[18px] font-bold text-ink leading-tight">{valor}</div>
    </div>
  )
}
