import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Info, Megaphone, RefreshCw, Search } from 'lucide-react'
import { Bar, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader } from './dashboard/ui/Card'
import { brl, n, pct } from './dashboard/ui/format'
import { CHART, TOOLTIP_STYLE } from './dashboard/ui/chart-tokens'
import { situacaoCampanha } from '@/lib/marketing-relatorio'

/**
 * /anuncios — acompanhar Meta e Google no detalhe (20/10/2026, pedido do Daniel: "uma página que fica
 * conectada pra eu acompanhar como estão os anúncios do Meta e Google, tudo detalhado").
 *
 * De onde vem cada número:
 *  - Meta: gasto por anúncio e dia (meta_gasto_anuncio_dia), situação e orçamento (meta_campanha, meta_anuncio),
 *    carregados pelo Chrome do Gerenciador (D:\MEGA BRAIN\Branorte\backend\meta_gasto\ATUALIZAR-GASTO-META.bat).
 *  - Google: script diário dentro da conta BRANORTE-ADS → google_ads_* .
 *  - CRM: contatos e orçamentos pela mesma régua do relatório de marketing (dashboard_marketing_fontes).
 * A página relê o banco a cada 5 minutos; o dado em si é tão novo quanto a última carga (mostrado no topo).
 */

type Periodo = 'hoje' | '7d' | 'mes' | 'mes_passado' | '90d'
const PERIODOS: { v: Periodo; l: string }[] = [
  { v: 'hoje', l: 'Hoje' }, { v: '7d', l: '7 dias' }, { v: 'mes', l: 'Este mês' }, { v: 'mes_passado', l: 'Mês passado' }, { v: '90d', l: '90 dias' },
]

function intervalo(p: Periodo, agora = new Date()): { from: Date; to: Date } {
  const y = agora.getFullYear(), m = agora.getMonth(), d = agora.getDate()
  const amanha = new Date(y, m, d + 1)
  if (p === 'hoje') return { from: new Date(y, m, d), to: amanha }
  if (p === '7d') return { from: new Date(y, m, d - 6), to: amanha }
  if (p === 'mes_passado') return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) }
  if (p === '90d') return { from: new Date(y, m, d - 89), to: amanha }
  return { from: new Date(y, m, 1), to: amanha }
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
const numN = (v: unknown) => (v == null || v === '' ? null : Number(v))
const txt = (v: unknown) => (v == null ? null : String(v))
const linhas = (d: unknown) => (d ?? []) as Record<string, unknown>[]
/** Cores do gráfico "Dia a dia": Meta azul, Google laranja (as linhas de contatos seguem verde e vermelho). */
const COR_META = CHART.s2
const COR_GOOGLE = '#f97316'
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')
const cent = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : v < 10 ? `R$ ${v.toFixed(2).replace('.', ',')}` : brl(v))
const div = (a: number, b: number) => (b > 0 ? a / b : null)

interface LinhaMeta {
  campanha: string; campanhaStatus: string | null; campanhaOrc: number | null; objetivo: string | null
  conjunto: string; conjuntoStatus: string | null; conjuntoOrc: number | null
  adId: string; anuncio: string; codigo: string | null; anuncioStatus: string | null
  gasto: number; impressoes: number; cliques: number; resultado: number; resultadoTipo: string
}
interface Dia { dia: string; gastoMeta: number; gastoGoogle: number; contatosMeta: number; contatosSite: number; contatos: number }
interface Crm { leads: number; orcamentos: number }

function useDados(p: Periodo) {
  const { from, to } = intervalo(p)
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['pagina-anuncios-v1', p_from, p_to],
    queryFn: async () => {
      const [meta, diario, plat, fontes, google, palavras, termos] = await Promise.all([
        supabase.rpc('anuncios_meta', { p_from, p_to }),
        supabase.rpc('anuncios_diario', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_plataformas', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_fontes', { p_from, p_to }),
        supabase.rpc('anuncios_google', { p_from, p_to }),
        supabase.rpc('anuncios_google_palavras', { p_limite: 30 }),
        supabase.rpc('dashboard_marketing_termos_google', { p_limite: 20 }),
      ])
      const erro = [meta, diario, plat, fontes].find(r => r.error)?.error
      if (erro) throw erro
      const metaLinhas: LinhaMeta[] = linhas(meta.data).map(r => ({
        campanha: String(r.campanha ?? '—'), campanhaStatus: txt(r.campanha_status), campanhaOrc: numN(r.campanha_orcamento_dia),
        objetivo: txt(r.objetivo), conjunto: String(r.conjunto ?? '—'), conjuntoStatus: txt(r.conjunto_status),
        conjuntoOrc: numN(r.conjunto_orcamento_dia), adId: String(r.ad_id), anuncio: String(r.anuncio ?? r.ad_id),
        codigo: txt(r.codigo), anuncioStatus: txt(r.anuncio_status), gasto: num(r.gasto), impressoes: num(r.impressoes),
        cliques: num(r.cliques), resultado: num(r.resultado), resultadoTipo: String(r.resultado_tipo ?? 'conversas'),
      }))
      const dias: Dia[] = linhas(diario.data).map(r => ({
        dia: String(r.dia), gastoMeta: num(r.gasto_meta), gastoGoogle: num(r.gasto_google),
        contatosMeta: num(r.contatos_meta), contatosSite: num(r.contatos_site), contatos: num(r.contatos),
      }))
      const platL = linhas(plat.data)
      const totMeta = platL.find(r => r.tipo === 'plataforma' && r.plataforma === 'Meta')
      const totGoogle = platL.find(r => r.tipo === 'plataforma' && r.plataforma === 'Google')
      const fontesL = linhas(fontes.data)
      const canal = (pref: string): Crm => {
        const r = fontesL.find(f => f.tipo === 'canal' && String(f.chave).startsWith(pref))
        return { leads: num(r?.leads), orcamentos: num(r?.com_proposta) }
      }
      const porCodigo = new Map<string, Crm>(fontesL.filter(f => f.tipo === 'criativo').map(f => [String(f.chave), { leads: num(f.leads), orcamentos: num(f.com_proposta) }]))
      return {
        metaLinhas, dias, porCodigo,
        meta: {
          gasto: num(totMeta?.gasto), orcDia: numN(totMeta?.orcamento_dia), conversas: num(totMeta?.resultado),
          cliques: num(totMeta?.cliques), impressoes: num(totMeta?.impressoes), ate: txt(totMeta?.carregado_ate), crm: canal('Meta ADS'),
        },
        google: {
          gasto: num(totGoogle?.gasto), cliques: num(totGoogle?.cliques), impressoes: num(totGoogle?.impressoes),
          conversoes: num(totGoogle?.resultado), ate: txt(totGoogle?.carregado_ate), crm: canal('Site'),
          linhas: google.error ? [] : linhas(google.data),
          palavras: palavras.error ? [] : linhas(palavras.data),
          termos: termos.error ? [] : linhas(termos.data),
        },
      }
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}

function Situacao({ s }: { s: string | null }) {
  const t = situacaoCampanha(s)
  if (!t) return <span className="text-ink-faint">—</span>
  const cls = t === 'ativa' ? 'text-success border-success/40 bg-success-bg' : 'text-ink-faint border-border bg-surface-2'
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-micro ${cls}`}>{t}</span>
}

function Kpi({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-micro text-ink-faint">{rotulo}</p>
      <p className="text-title font-semibold tabular-nums text-ink">{valor}</p>
      {apoio && <p className="text-micro text-ink-muted">{apoio}</p>}
    </div>
  )
}

const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
const td = 'whitespace-nowrap border-t border-border px-2 py-1.5 text-body tabular-nums text-ink-muted text-right'

interface Soma { gasto: number; impressoes: number; cliques: number; resultado: number }
const somar = (ls: LinhaMeta[]): Soma => ls.reduce((s, l) => ({ gasto: s.gasto + l.gasto, impressoes: s.impressoes + l.impressoes, cliques: s.cliques + l.cliques, resultado: s.resultado + l.resultado }), { gasto: 0, impressoes: 0, cliques: 0, resultado: 0 })

function Metricas({ s, tipo }: { s: Soma; tipo: string }) {
  return (
    <>
      <td className={td}>{brl(s.gasto)}</td>
      <td className={td}>{n(s.impressoes)}</td>
      <td className={td}>{n(s.cliques)}</td>
      <td className={td}>{pct(div(100 * s.cliques, s.impressoes), 1)}</td>
      <td className={td}>{cent(div(s.gasto, s.cliques))}</td>
      <td className={td}>{n(s.resultado)} <span className="text-micro text-ink-faint">{tipo}</span></td>
      <td className={td}>{cent(div(s.gasto, s.resultado))}</td>
    </>
  )
}

export function Anuncios() {
  const [periodo, setPeriodo] = useState<Periodo>(() => {
    try { const v = localStorage.getItem('anuncios-periodo'); return (PERIODOS.some(p => p.v === v) ? v : 'mes') as Periodo } catch { return 'mes' }
  })
  const escolher = (p: Periodo) => { setPeriodo(p); try { localStorage.setItem('anuncios-periodo', p) } catch { /* sem storage */ } }
  const q = useDados(periodo)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [soNoAr, setSoNoAr] = useState(false)
  const alternar = (k: string) => setAbertos(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s })

  const arvore = useMemo(() => {
    const ls = (q.data?.metaLinhas ?? []).filter(l => !soNoAr || situacaoCampanha(l.campanhaStatus) === 'ativa')
    const camps = new Map<string, LinhaMeta[]>()
    for (const l of ls) camps.set(l.campanha, [...(camps.get(l.campanha) ?? []), l])
    return [...camps.entries()].map(([nome, cl]) => {
      const conj = new Map<string, LinhaMeta[]>()
      for (const l of cl) conj.set(l.conjunto, [...(conj.get(l.conjunto) ?? []), l])
      return {
        nome, linhas: cl, soma: somar(cl),
        conjuntos: [...conj.entries()].map(([cn, al]) => ({ nome: cn, linhas: al, soma: somar(al) })).sort((a, b) => b.soma.gasto - a.soma.gasto),
      }
    }).sort((a, b) => b.soma.gasto - a.soma.gasto)
  }, [q.data?.metaLinhas, soNoAr])

  const d = q.data
  const googleLigado = !!d?.google.ate

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><Megaphone className="h-5 w-5" aria-hidden="true" />Anúncios — Meta e Google</h1>
          <p className="text-micro text-ink-faint">
            Meta: dados até {dataBr(d?.meta.ate ?? null)} · Google: {googleLigado ? `dados até ${dataBr(d!.google.ate)}` : 'ainda não ligado'} · a página relê a cada 5 min
            {q.isFetching && ' · atualizando…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Período">
            {PERIODOS.map(p => (
              <button key={p.v} type="button" onClick={() => escolher(p.v)} aria-pressed={periodo === p.v}
                className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1 text-micro md:min-h-0 ${periodo === p.v ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>
                {p.l}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { void q.refetch() }} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-border px-3 py-1 text-micro text-ink-muted hover:text-ink md:min-h-0" aria-label="Recarregar agora">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {q.error && !d ? (
        <Card><p className="text-body text-ink-muted">Não deu para carregar os anúncios agora. Tente o botão de recarregar.</p></Card>
      ) : !d ? (
        <Card><div className="h-40 animate-pulse rounded-lg bg-surface-2" /></Card>
      ) : (
        <div className={`space-y-5 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {/* Resumo por plataforma */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <p className="mb-2 text-body font-semibold text-ink">Meta Ads</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Kpi rotulo="Gasto" valor={brl(d.meta.gasto)} apoio={d.meta.orcDia ? `${brl(d.meta.orcDia)}/dia nas campanhas ativas` : undefined} />
                <Kpi rotulo="Conversas iniciadas" valor={n(d.meta.conversas)} apoio={`${cent(div(d.meta.gasto, d.meta.conversas))} cada (campanhas de mensagem)`} />
                <Kpi rotulo="Cliques" valor={n(d.meta.cliques)} apoio={`CTR ${pct(div(100 * d.meta.cliques, d.meta.impressoes), 1)} · CPC ${cent(div(d.meta.gasto, d.meta.cliques))}`} />
                <Kpi rotulo="Contatos no CRM" valor={n(d.meta.crm.leads)} apoio={`${cent(div(d.meta.gasto, d.meta.crm.leads))} por contato`} />
                <Kpi rotulo="Viraram orçamento" valor={n(d.meta.crm.orcamentos)} apoio={`${cent(div(d.meta.gasto, d.meta.crm.orcamentos))} por orçamento`} />
              </div>
            </Card>
            <Card>
              <p className="mb-2 text-body font-semibold text-ink">Google Ads</p>
              {googleLigado ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <Kpi rotulo="Gasto" valor={brl(d.google.gasto)} />
                  <Kpi rotulo="Cliques" valor={n(d.google.cliques)} apoio={`CTR ${pct(div(100 * d.google.cliques, d.google.impressoes), 1)} · CPC ${cent(div(d.google.gasto, d.google.cliques))}`} />
                  <Kpi rotulo="Conversões do Google" valor={n(d.google.conversoes)} apoio="o que a conta mede hoje (visualização de página)" />
                  <Kpi rotulo="Contatos do Site no CRM" valor={n(d.google.crm.leads)} apoio={`${cent(div(d.google.gasto, d.google.crm.leads))} por contato (site inclui orgânico)`} />
                  <Kpi rotulo="Viraram orçamento" valor={n(d.google.crm.orcamentos)} apoio={`${cent(div(d.google.gasto, d.google.crm.orcamentos))} por orçamento`} />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-body text-ink-muted">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    O Google ainda não manda dados. Falta colar o script do CRM na conta Google Ads (Ferramentas → Ações em massa → Scripts → “+”), autorizar e pôr para rodar todo dia.
                    Enquanto isso: o Site trouxe <strong className="text-ink">{n(d.google.crm.leads)} contatos</strong> e <strong className="text-ink">{n(d.google.crm.orcamentos)} orçamentos</strong> no período.
                  </span>
                </div>
              )}
            </Card>
          </div>

          {/* Por dia */}
          <Card>
            <CardHeader title="Dia a dia" subtitle="Gasto de cada plataforma (barras) e contatos que chegaram no CRM (linhas)." />
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {/* Barras AGRUPADAS (lado a lado), não empilhadas: cada uma é o gasto só daquela plataforma no dia.
                    barGap = espaço entre as duas barras do dia; barCategoryGap = espaço entre os dias; maxBarSize
                    deixa a barra fina em períodos curtos e o Recharts afina sozinho em 90 dias. */}
                <ComposedChart data={d.dias.map(x => ({ ...x, rotulo: x.dia.slice(8, 10) + '/' + x.dia.slice(5, 7) }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fill: CHART.ink, fontSize: 11 }} />
                  <YAxis yAxisId="r" tick={{ fill: CHART.ink, fontSize: 11 }} tickFormatter={v => `R$ ${Math.round(Number(v))}`} width={64} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fill: CHART.ink, fontSize: 11 }} width={32} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, nome) => (String(nome).startsWith('Gasto') ? brl(Number(v)) : n(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="r" dataKey="gastoMeta" name="Gasto Meta Ads" fill={COR_META} maxBarSize={18} radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="r" dataKey="gastoGoogle" name="Gasto Google Ads" fill={COR_GOOGLE} maxBarSize={18} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="c" dataKey="contatosMeta" name="Contatos do Meta" stroke={CHART.s1} strokeWidth={2} dot={false} />
                  <Line yAxisId="c" dataKey="contatosSite" name="Contatos do Site" stroke={CHART.s4} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Meta em árvore */}
          <Card>
            <CardHeader
              title="Meta: campanha → conjunto → anúncio"
              subtitle="Clique na campanha para abrir os conjuntos, e no conjunto para ver os anúncios. O resultado segue o objetivo de cada campanha."
              right={
                <label className="inline-flex items-center gap-2 text-micro text-ink-muted">
                  <input type="checkbox" checked={soNoAr} onChange={e => setSoNoAr(e.target.checked)} /> só campanhas ativas
                </label>
              }
            />
            {arvore.length === 0 ? <p className="text-body text-ink-faint">Nenhum gasto no Meta no período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {['Nome', 'Situação', 'Orçamento/dia', 'Gasto', 'Impressões', 'Cliques', 'CTR', 'CPC', 'Resultado', 'Custo/resultado', 'Contatos (código)', 'Orçamentos (código)'].map((h, i) => (
                        <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {arvore.map(c => {
                      const kc = 'c:' + c.nome, ab = abertos.has(kc), l0 = c.linhas[0]
                      return (
                        <Fragment key={kc}>
                          <tr className="cursor-pointer hover:bg-surface-2" onClick={() => alternar(kc)}>
                            <th scope="row" className="border-t border-border px-2 py-1.5 text-left text-body font-semibold text-ink">
                              <span className="inline-flex items-center gap-1">{ab ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}{c.nome}</span>
                            </th>
                            <td className="border-t border-border px-2 py-1.5"><Situacao s={l0.campanhaStatus} /></td>
                            <td className={td}>{l0.campanhaOrc != null ? brl(l0.campanhaOrc) : '—'}</td>
                            <Metricas s={c.soma} tipo={l0.resultadoTipo} />
                            <td className={td} /><td className={td} />
                          </tr>
                          {ab && c.conjuntos.map(cj => {
                            const kj = kc + '|' + cj.nome, abj = abertos.has(kj), j0 = cj.linhas[0]
                            return (
                              <Fragment key={kj}>
                                <tr className="cursor-pointer hover:bg-surface-2" onClick={() => alternar(kj)}>
                                  <th scope="row" className="border-t border-border py-1.5 pl-8 pr-2 text-left text-body font-medium text-ink">
                                    <span className="inline-flex items-center gap-1">{abj ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}{cj.nome}</span>
                                  </th>
                                  <td className="border-t border-border px-2 py-1.5"><Situacao s={j0.conjuntoStatus} /></td>
                                  <td className={td}>{j0.conjuntoOrc != null ? brl(j0.conjuntoOrc) : '—'}</td>
                                  <Metricas s={cj.soma} tipo={j0.resultadoTipo} />
                                  <td className={td} /><td className={td} />
                                </tr>
                                {abj && [...cj.linhas].sort((a, b) => b.gasto - a.gasto).map(a => {
                                  const crm = a.codigo ? d.porCodigo.get(a.codigo) : undefined
                                  return (
                                    <tr key={a.adId}>
                                      <th scope="row" className="border-t border-border py-1.5 pl-14 pr-2 text-left text-body font-normal text-ink-muted">
                                        {a.anuncio}{a.codigo && <span className="ml-2 rounded bg-surface-2 px-1 text-micro text-ink">{a.codigo}</span>}
                                      </th>
                                      <td className="border-t border-border px-2 py-1.5"><Situacao s={a.anuncioStatus} /></td>
                                      <td className={td}>—</td>
                                      <Metricas s={a} tipo={a.resultadoTipo} />
                                      <td className={td} title="Todos os contatos com esse código no período (vários anúncios podem usar o mesmo código)">{crm ? n(crm.leads) : '—'}</td>
                                      <td className={td}>{crm ? n(crm.orcamentos) : '—'}</td>
                                    </tr>
                                  )
                                })}
                              </Fragment>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-micro text-ink-faint">
              Contatos e orçamentos ligam pelo código &amp;NN do nome do anúncio — o mesmo código pode estar em mais de um anúncio, então o número é do código, não do anúncio.
              Situação e orçamento vêm do Gerenciador na hora da última carga.
            </p>
          </Card>

          {/* Google */}
          <Card>
            <CardHeader title="Google: campanha → grupo de anúncios" subtitle="Gasto, cliques e conversões da conta BRANORTE-ADS no período." />
            {!googleLigado ? (
              <p className="text-body text-ink-faint">Aparece assim que o script do CRM rodar na conta do Google Ads.</p>
            ) : (
              <TabelaGoogle linhas={d.google.linhas} abertos={abertos} alternar={alternar} />
            )}
          </Card>

          {googleLigado && (d.google.palavras.length > 0 || d.google.termos.length > 0) && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader title="Palavras-chave (30 dias)" subtitle="As que mais gastaram." />
                <ListaGoogle itens={d.google.palavras.map(p => ({ k: `${p.palavra}|${p.grupo}|${p.correspondencia}`, nome: String(p.palavra), extra: `${String(p.correspondencia ?? '').toLowerCase()} · ${String(p.grupo ?? '')}`, cliques: num(p.cliques), gasto: num(p.gasto), conv: num(p.conversoes) }))} />
              </Card>
              <Card>
                <CardHeader title="O que as pessoas pesquisaram (30 dias)" subtitle="Termos reais de busca que acionaram os anúncios." />
                <ListaGoogle itens={d.google.termos.map(t => ({ k: `${t.termo}|${t.campanha}`, nome: `“${String(t.termo)}”`, extra: String(t.campanha ?? ''), cliques: num(t.cliques), gasto: num(t.gasto), conv: num(t.conversoes) }))} icone />
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabelaGoogle({ linhas: ls, abertos, alternar }: { linhas: Record<string, unknown>[]; abertos: Set<string>; alternar: (k: string) => void }) {
  const camps = ls.filter(l => l.nivel === 'campanha').sort((a, b) => num(b.gasto) - num(a.gasto))
  const grupos = ls.filter(l => l.nivel === 'grupo')
  const met = (l: Record<string, unknown>) => {
    const g = num(l.gasto), c = num(l.cliques), i = num(l.impressoes), cv = num(l.conversoes)
    return (
      <>
        <td className={td}>{brl(g)}</td><td className={td}>{n(i)}</td><td className={td}>{n(c)}</td>
        <td className={td}>{pct(div(100 * c, i), 1)}</td><td className={td}>{cent(div(g, c))}</td>
        <td className={td}>{n(cv)}</td><td className={td}>{cent(div(g, cv))}</td>
      </>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-separate border-spacing-0">
        <thead>
          <tr>
            {['Nome', 'Situação', 'Orçamento/dia', 'Gasto', 'Impressões', 'Cliques', 'CTR', 'CPC', 'Conversões', 'Custo/conversão'].map((h, i) => (
              <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {camps.map(c => {
            const k = 'g:' + String(c.campanha), ab = abertos.has(k)
            const gs = grupos.filter(g => g.campanha === c.campanha).sort((a, b) => num(b.gasto) - num(a.gasto))
            return (
              <Fragment key={k}>
                <tr className={gs.length ? 'cursor-pointer hover:bg-surface-2' : ''} onClick={() => gs.length && alternar(k)}>
                  <th scope="row" className="border-t border-border px-2 py-1.5 text-left text-body font-semibold text-ink">
                    <span className="inline-flex items-center gap-1">{gs.length > 0 && (ab ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />)}{String(c.campanha)}</span>
                  </th>
                  <td className="border-t border-border px-2 py-1.5"><Situacao s={txt(c.campanha_status)} /></td>
                  <td className={td}>{c.orcamento_dia != null ? brl(num(c.orcamento_dia)) : '—'}</td>
                  {met(c)}
                </tr>
                {ab && gs.map(g => (
                  <tr key={k + String(g.grupo)}>
                    <th scope="row" className="border-t border-border py-1.5 pl-8 pr-2 text-left text-body font-normal text-ink-muted">{String(g.grupo)}</th>
                    <td className="border-t border-border px-2 py-1.5"><Situacao s={txt(g.grupo_status)} /></td>
                    <td className={td}>—</td>
                    {met(g)}
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ListaGoogle({ itens, icone }: { itens: { k: string; nome: string; extra: string; cliques: number; gasto: number; conv: number }[]; icone?: boolean }) {
  if (itens.length === 0) return <p className="text-body text-ink-faint">Nada no período.</p>
  return (
    <ul className="space-y-1">
      {itens.map(i => (
        <li key={i.k} className="flex items-start justify-between gap-3 border-t border-border py-1.5 text-body">
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-ink">{icone && <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />}<span className="truncate">{i.nome}</span></span>
            <span className="block truncate text-micro text-ink-faint">{i.extra}</span>
          </span>
          <span className="whitespace-nowrap text-right tabular-nums text-ink-muted">{n(i.cliques)} cliques · {brl(i.gasto)}{i.conv > 0 ? ` · ${n(i.conv)} conv.` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
