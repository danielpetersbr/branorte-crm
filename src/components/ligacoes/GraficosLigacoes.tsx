import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, ReferenceLine, LabelList,
} from 'recharts'
import { PhoneMissed, Video, PhoneCall, Timer, TrendingUp, Users } from 'lucide-react'
import type { SerieDia, HoraLigacao, LigacaoResumo } from '@/hooks/useLigacoes'

// ============================================================================
// Blocos visuais do dashboard de ligações. Ficam fora da página pra que ela
// continue legível e pra que cada gráfico re-renderize só quando SEU dado muda.
//
// Cores: tokens do tema (verde da Branorte no principal). Nada de paleta nova.
// ============================================================================

export const COR = {
  feitas: 'hsl(var(--accent))',
  atendidas: 'hsl(var(--success))',
  perdidas: 'hsl(var(--danger))',
  video: 'hsl(var(--info))',
  grade: 'hsl(var(--border))',
  eixo: 'hsl(var(--ink-faint))',
}

export function fmtDur(seg: number): string {
  if (!seg) return '—'
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`
  if (m > 0) return `${m}min${s > 0 ? String(s).padStart(2, '0') : ''}`
  return `${s}s`
}
const diaCurto = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// Caixa de tooltip com a cara do app (o padrão do recharts é branco puro e
// ignora o tema escuro).
function Caixa({ titulo, linhas }: { titulo: string; linhas: Array<{ rotulo: string; valor: string; cor?: string }> }) {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-lg px-3 py-2">
      <p className="text-[12px] font-semibold text-ink mb-1">{titulo}</p>
      {linhas.map(l => (
        <p key={l.rotulo} className="text-[11.5px] text-ink-muted flex items-center gap-1.5">
          {l.cor && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: l.cor }} />}
          {l.rotulo}: <b className="text-ink tabular-nums">{l.valor}</b>
        </p>
      ))}
    </div>
  )
}

function Painel({ titulo, icone: Icone, direita, children, nota }: {
  titulo: string; icone: typeof PhoneCall; direita?: React.ReactNode; children: React.ReactNode; nota?: string
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
          <Icone className="h-4 w-4 text-accent shrink-0" /> {titulo}
        </h2>
        {direita}
      </div>
      {/* flex-1 + centro: quando o card vizinho da grade e mais alto, o conteudo ocupa a
          sobra em vez de deixar um buraco branco embaixo (era o vazio do donut). */}
      <div className="flex-1 flex flex-col justify-center min-h-0">{children}</div>
      {nota && <p className="text-[10.5px] text-ink-faint mt-3 leading-relaxed">{nota}</p>}
    </section>
  )
}

function Vazio({ msg }: { msg: string }) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2">
      <PhoneCall className="h-7 w-7 text-ink-faint/60" />
      <p className="text-[12.5px] text-ink-muted max-w-[280px]">{msg}</p>
    </div>
  )
}

// ── EVOLUÇÃO DAS LIGAÇÕES ───────────────────────────────────────────────────
const SERIES = [
  { id: 'feitas' as const, label: 'Total', cor: COR.feitas },
  { id: 'atendidas' as const, label: 'Atendidas', cor: COR.atendidas },
  { id: 'perdidas' as const, label: 'Não atendidas', cor: COR.perdidas },
  { id: 'video' as const, label: 'Vídeo', cor: COR.video },
]

export function EvolucaoLigacoes({ serie, truncado }: { serie: SerieDia[]; truncado: boolean }) {
  const [ativas, setAtivas] = useState<Record<string, boolean>>({
    feitas: true, atendidas: true, perdidas: true, video: false,
  })
  const dados = useMemo(() => serie.map(d => ({ ...d, rotulo: diaCurto(d.dia) })), [serie])

  return (
    <Painel
      titulo="Evolução das ligações" icone={TrendingUp}
      direita={
        <div className="flex gap-1.5 flex-wrap">
          {SERIES.map(s => (
            <button
              key={s.id}
              onClick={() => setAtivas(a => ({ ...a, [s.id]: !a[s.id] }))}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5 ${
                ativas[s.id] ? 'border-transparent text-ink bg-surface-2' : 'border-border text-ink-faint'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: ativas[s.id] ? s.cor : 'hsl(var(--ink-faint))' }} />
              {s.label}
            </button>
          ))}
        </div>
      }
      nota={truncado
        ? 'Os dias mais antigos aparecem menores do que foram: a primeira leitura de cada vendedor traz as últimas 500 ligações dele, então o começo da série está cortado. Os últimos dias estão completos.'
        : undefined}
    >
      {dados.length === 0 ? <Vazio msg="Nenhuma ligação no período selecionado." /> : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={dados} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COR.grade} vertical={false} />
            <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--surface-2))', opacity: 0.5 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as SerieDia & { rotulo: string }
                const taxa = d.feitas > 0 ? Math.round((d.atendidas / d.feitas) * 100) : null
                return (
                  <Caixa titulo={String(label)} linhas={[
                    { rotulo: 'Ligações', valor: String(d.feitas), cor: COR.feitas },
                    { rotulo: 'Atendidas', valor: String(d.atendidas), cor: COR.atendidas },
                    { rotulo: 'Não atendidas', valor: String(d.perdidas), cor: COR.perdidas },
                    ...(d.video > 0 ? [{ rotulo: 'Vídeo', valor: String(d.video), cor: COR.video }] : []),
                    ...(taxa !== null ? [{ rotulo: 'Taxa de atendimento', valor: `${taxa}%` }] : []),
                  ]} />
                )
              }}
            />
            {ativas.feitas && <Bar dataKey="feitas" fill={COR.feitas} radius={[4, 4, 0, 0]} maxBarSize={38} />}
            {ativas.atendidas && <Line type="monotone" dataKey="atendidas" stroke={COR.atendidas} strokeWidth={2} dot={false} />}
            {ativas.perdidas && <Line type="monotone" dataKey="perdidas" stroke={COR.perdidas} strokeWidth={2} dot={false} />}
            {ativas.video && <Line type="monotone" dataKey="video" stroke={COR.video} strokeWidth={2} dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Painel>
  )
}

// ── LIGAÇÕES NO MÊS ─────────────────────────────────────────────────────────
export function LigacoesNoMes({ serie }: { serie: SerieDia[] }) {
  const dados = useMemo(() => serie.map(d => ({ ...d, rotulo: d.dia.slice(8) })), [serie])
  const media = dados.length > 0 ? Math.round(dados.reduce((a, d) => a + d.feitas, 0) / dados.length) : 0

  return (
    <Painel
      titulo="Ligações no mês" icone={PhoneCall}
      direita={media > 0 ? (
        <span className="text-[11.5px] text-ink-muted">
          Média: <b className="text-ink tabular-nums">{media}</b> ligações/dia
        </span>
      ) : undefined}
      nota="Cada barra é um dia. A linha tracejada é a média diária do período — quem fica abaixo dela puxou o time pra baixo naquele dia."
    >
      {dados.length === 0 ? <Vazio msg="Nenhuma ligação no período selecionado." /> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dados} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COR.grade} vertical={false} />
            <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
            <YAxis tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--surface-2))', opacity: 0.5 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as SerieDia
                return <Caixa titulo={diaCurto(d.dia)} linhas={[
                  { rotulo: 'Ligações', valor: String(d.feitas), cor: COR.feitas },
                  { rotulo: 'Atendidas', valor: String(d.atendidas), cor: COR.atendidas },
                ]} />
              }}
            />
            {media > 0 && <ReferenceLine y={media} stroke={COR.eixo} strokeDasharray="4 4" />}
            <Bar dataKey="feitas" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {dados.map(d => (
                <Cell key={d.dia} fill={d.feitas >= media ? COR.feitas : 'hsl(var(--accent) / 0.35)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  )
}

// ── RESULTADO DAS LIGAÇÕES (donut) ──────────────────────────────────────────
export function ResultadoLigacoes({ atendidas, perdidas, outras, video }: {
  atendidas: number; perdidas: number; outras: number; video: number
}) {
  const total = atendidas + perdidas + outras
  const pct = total > 0 ? Math.round((atendidas / total) * 100) : 0
  const dados = [
    { nome: 'Atendidas', valor: atendidas, cor: COR.atendidas },
    { nome: 'Não atendidas', valor: perdidas, cor: COR.perdidas },
    // Canceladas/desistiu não são "perdidas do cliente" — o vendedor desligou antes.
    ...(outras > 0 ? [{ nome: 'Desistiu antes', valor: outras, cor: 'hsl(var(--warning))' }] : []),
  ]

  return (
    <Painel titulo="Resultado das ligações" icone={PhoneMissed}
      nota="Atendidas inclui quem atendeu no celular. Desistiu antes = o vendedor desligou antes de o cliente atender.">
      {total === 0 ? <Vazio msg="Nenhuma ligação no período selecionado." /> : (
        <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
          <div className="relative w-[168px] h-[168px] shrink-0 mx-auto sm:mx-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={54} outerRadius={78} paddingAngle={2} stroke="none">
                  {dados.map(d => <Cell key={d.nome} fill={d.cor} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as { nome: string; valor: number; cor: string }
                  return <Caixa titulo={d.nome} linhas={[
                    { rotulo: 'Ligações', valor: String(d.valor), cor: d.cor },
                    { rotulo: 'Do total', valor: `${Math.round((d.valor / total) * 100)}%` },
                  ]} />
                }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[26px] font-semibold text-ink leading-none tabular-nums">{pct}%</span>
              <span className="text-[11px] text-ink-faint mt-0.5">atendidas</span>
            </div>
          </div>
          <ul className="flex-1 min-w-[150px] space-y-2">
            {dados.map(d => (
              <li key={d.nome} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.cor }} />
                <span className="text-ink-muted flex-1">{d.nome}</span>
                <b className="text-ink tabular-nums">{d.valor}</b>
              </li>
            ))}
            {video > 0 && (
              <li className="flex items-center gap-2 text-[12.5px] pt-2 border-t border-border/60">
                <Video className="h-3.5 w-3.5 text-info shrink-0" />
                <span className="text-ink-muted flex-1">Chamadas de vídeo</span>
                <b className="text-ink tabular-nums">{video}</b>
              </li>
            )}
          </ul>
        </div>
      )}
    </Painel>
  )
}

// ── LIGAÇÕES POR VENDEDOR (barras horizontais, métrica alternável) ──────────
const METRICAS = [
  { id: 'fez', label: 'Ligações', fmt: (v: number) => String(v) },
  { id: 'atendidas_fez', label: 'Atendidas', fmt: (v: number) => String(v) },
  { id: 'taxa', label: 'Taxa', fmt: (v: number) => `${v}%` },
  { id: 'tempo_seg', label: 'Tempo', fmt: fmtDur },
  { id: 'clientes_fez', label: 'Clientes', fmt: (v: number) => String(v) },
] as const
type MetricaId = typeof METRICAS[number]['id']

// Taxa com menos de 5 ligações é ruído: 1 de 1 = 100% e lideraria o ranking sem
// ninguém ter trabalhado. Some da comparação em vez de mentir.
const MIN_LIGACOES_TAXA = 5

export function PorVendedor({ linhas }: { linhas: LigacaoResumo[] }) {
  const [metrica, setMetrica] = useState<MetricaId>('fez')
  const meta = METRICAS.find(m => m.id === metrica)!

  const dados = useMemo(() => {
    const base = linhas.map(r => ({
      vendedor: r.vendedor,
      valor: metrica === 'taxa'
        ? (r.fez >= MIN_LIGACOES_TAXA ? Math.round((r.atendidas_fez / r.fez) * 100) : -1)
        : (r[metrica] as number),
    }))
    return base.filter(d => d.valor >= 0 && d.valor > 0).sort((a, b) => b.valor - a.valor)
  }, [linhas, metrica])

  return (
    <Painel
      titulo="Ligações por vendedor" icone={Users}
      direita={
        <div className="flex gap-1 flex-wrap">
          {METRICAS.map(m => (
            <button key={m.id} onClick={() => setMetrica(m.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                metrica === m.id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
              {m.label}
            </button>
          ))}
        </div>
      }
      nota={metrica === 'taxa' ? `Só entra quem fez ${MIN_LIGACOES_TAXA}+ ligações — abaixo disso um acerto isolado vira 100%.` : undefined}
    >
      {dados.length === 0 ? <Vazio msg="Nenhum vendedor com dado nesta métrica no período." /> : (
        <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 38)}>
          <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="vendedor" width={92} tick={{ fontSize: 11.5, fill: 'hsl(var(--ink-muted))' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'hsl(var(--surface-2))', opacity: 0.5 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as { vendedor: string; valor: number }
                return <Caixa titulo={d.vendedor} linhas={[{ rotulo: meta.label, valor: meta.fmt(d.valor), cor: COR.feitas }]} />
              }} />
            <Bar dataKey="valor" fill={COR.feitas} radius={[0, 6, 6, 0]} maxBarSize={22}>
              {/* o LabelFormatter do recharts 3 recebe `unknown` — converte aqui em vez
                  de mentir o tipo com `as`, que esconderia um valor inesperado */}
              <LabelList dataKey="valor" position="right"
                formatter={(v: unknown) => meta.fmt(Number(v) || 0)}
                style={{ fontSize: 11, fill: 'hsl(var(--ink))', fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  )
}

// ── TAXA DE ATENDIMENTO POR VENDEDOR ────────────────────────────────────────
export function TaxaPorVendedor({ linhas }: { linhas: LigacaoResumo[] }) {
  const dados = useMemo(() => linhas
    .filter(r => r.fez >= MIN_LIGACOES_TAXA)
    .map(r => ({ vendedor: r.vendedor, taxa: Math.round((r.atendidas_fez / r.fez) * 100), fez: r.fez, atendidas: r.atendidas_fez }))
    .sort((a, b) => b.taxa - a.taxa), [linhas])

  return (
    <Painel titulo="Taxa de atendimento" icone={PhoneCall}
      nota={`Quantas das ligações que ELE fez foram atendidas. Volume não entra na conta — é aqui que aparece quem consegue falar com o cliente, não quem só disca. Mínimo de ${MIN_LIGACOES_TAXA} ligações.`}>
      {dados.length === 0 ? <Vazio msg={`Ninguém fez ${MIN_LIGACOES_TAXA}+ ligações no período.`} /> : (
        <ul className="space-y-2.5">
          {dados.map(d => (
            <li key={d.vendedor}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12.5px] font-medium text-ink truncate">{d.vendedor}</span>
                <span className="text-[12px] text-ink-faint shrink-0">
                  <b className={`tabular-nums ${d.taxa >= 55 ? 'text-success' : d.taxa >= 40 ? 'text-ink' : 'text-danger'}`}>{d.taxa}%</b>
                  <span className="ml-1.5">{d.atendidas}/{d.fez}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${d.taxa}%`, background: d.taxa >= 55 ? COR.atendidas : d.taxa >= 40 ? COR.feitas : COR.perdidas }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  )
}

// ── LIGAÇÕES POR HORÁRIO ────────────────────────────────────────────────────
export function PorHorario({ horas }: { horas: HoraLigacao[] }) {
  const [modo, setModo] = useState<'qtd' | 'taxa'>('taxa')
  const MIN = 5
  const dados = useMemo(() => horas
    .filter(h => h.feitas >= MIN)
    .map(h => ({ ...h, rotulo: `${h.hora}h`, taxa: Math.round((h.atenderam / h.feitas) * 100) })), [horas])

  const melhor = dados.length ? [...dados].sort((a, b) => b.taxa - a.taxa)[0] : null

  return (
    <Painel
      titulo="Ligações por horário" icone={Timer}
      direita={
        <div className="flex gap-1">
          {([['qtd', 'Quantidade'], ['taxa', 'Taxa']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setModo(id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                modo === id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      }
      nota={`Só horas com ${MIN}+ ligações — com menos que isso a taxa oscila demais pra significar alguma coisa.`}
    >
      {dados.length === 0 ? <Vazio msg={`Nenhuma hora com ${MIN}+ ligações no período.`} /> : (
        <>
          {melhor && modo === 'taxa' && (
            <p className="text-[11.5px] text-ink-muted -mt-2 mb-3">
              O cliente atende mais às <b className="text-success">{melhor.hora}h</b> ({melhor.taxa}%).
            </p>
          )}
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={dados} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COR.grade} vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} allowDecimals={false}
                domain={modo === 'taxa' ? [0, 100] : undefined} />
              <Tooltip cursor={{ fill: 'hsl(var(--surface-2))', opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as HoraLigacao & { taxa: number }
                  return <Caixa titulo={`${d.hora}h`} linhas={[
                    { rotulo: 'Ligações feitas', valor: String(d.feitas), cor: COR.feitas },
                    { rotulo: 'Atenderam', valor: String(d.atenderam), cor: COR.atendidas },
                    { rotulo: 'Taxa', valor: `${d.taxa}%` },
                  ]} />
                }} />
              <Bar dataKey={modo === 'taxa' ? 'taxa' : 'feitas'} radius={[4, 4, 0, 0]} maxBarSize={34}>
                {dados.map(d => (
                  <Cell key={d.hora} fill={modo === 'taxa'
                    ? (d.taxa >= 55 ? COR.atendidas : d.taxa >= 40 ? COR.feitas : COR.perdidas)
                    : COR.feitas} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Painel>
  )
}
