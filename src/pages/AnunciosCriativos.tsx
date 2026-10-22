import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowUpDown, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Lightbulb, Megaphone, Minus, Power,
  RefreshCw, Rocket, Search, Wrench,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader } from './dashboard/ui/Card'
import { brl, n, pct } from './dashboard/ui/format'
import { AbasAnuncios, SeletorPeriodo, usePeriodoAnuncio } from './anuncios/compartilhado'

/**
 * /anuncios/criativos (22/10/2026). Daniel: "qual é o criativo que está trazendo mais cliente qualificado, gerando mais
 * orçamento, saindo venda, qual campanha… e no final a conclusão, pro gestor de tráfego saber qual criativo e conjunto
 * está gerando retorno e qual tem que melhorar ou desativar. E qual criativo traz quem nunca respondeu e outros assuntos."
 *
 * De onde vem cada número (todas as RPCs são do mesmo período):
 *  - gasto, cliques, resultado do Meta → anuncios_meta (por anúncio, carga do Gerenciador)
 *  - contatos NOVOS, qualificados, falou c/ vendedor, orçamentos → anuncios_crm (tipo 'anuncio', ad_id da conversa da Ana)
 *  - motivos de encerramento, gado 200+, vendas do período → anuncios_criativos (por anúncio; vendas também por código &NN)
 *  - Google: anuncios_google (gasto), anuncios_crm (tipo 'google_campanha'), anuncios_google_cliques (rastreio do site)
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
const txt = (v: unknown) => (v == null || v === '' ? null : String(v))
const linhas = (d: unknown) => (d ?? []) as Record<string, unknown>[]
const div = (a: number, b: number) => (b > 0 ? a / b : null)
const cent = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : v < 10 ? `R$ ${v.toFixed(2).replace('.', ',')}` : brl(v))
const naoEhVenda = (campanha: string) => /vaga|emprego/i.test(campanha)
const codigoDe = (nome: string | null) => (nome ? (nome.match(/&\d{1,3}/)?.[0] ?? null) : null)

const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
const td = 'whitespace-nowrap border-t border-border px-2 py-1.5 text-body tabular-nums text-ink-muted text-right'

/** Tudo o que se soma numa linha (anúncio, criativo, conjunto ou campanha). */
interface Soma {
  gasto: number; cliques: number; impressoes: number; conversas: number
  contatos: number; qualificados: number; conversou: number; orcamentos: number; rsOrcado: number; voltaram: number
  base: number; fechados: number; nunca: number; parou: number; semInteresse: number; preco: number; concorrente: number
  naoFab: number; outros: number; boi200: number; vendas: number; rsVendas: number
}
const ZERO: Soma = {
  gasto: 0, cliques: 0, impressoes: 0, conversas: 0, contatos: 0, qualificados: 0, conversou: 0, orcamentos: 0, rsOrcado: 0, voltaram: 0,
  base: 0, fechados: 0, nunca: 0, parou: 0, semInteresse: 0, preco: 0, concorrente: 0, naoFab: 0, outros: 0, boi200: 0, vendas: 0, rsVendas: 0,
}
const somar = (a: Soma, b: Partial<Soma>): Soma => {
  const r = { ...a }
  for (const k of Object.keys(b) as (keyof Soma)[]) r[k] = (r[k] ?? 0) + (b[k] ?? 0)
  return r
}

interface Anuncio { adId: string; nome: string; codigo: string | null; conjunto: string; campanha: string; status: string | null; s: Soma }

type Nivel = 'criativo' | 'conjunto' | 'campanha' | 'anuncio'
const NIVEIS: { v: Nivel; l: string; ajuda: string }[] = [
  { v: 'criativo', l: 'Criativo', ajuda: 'o mesmo criativo (código &NN) somado em todos os conjuntos onde roda' },
  { v: 'conjunto', l: 'Conjunto', ajuda: 'o público/conjunto de anúncios' },
  { v: 'campanha', l: 'Campanha', ajuda: 'a campanha inteira' },
  { v: 'anuncio', l: 'Anúncio', ajuda: 'cada anúncio do Gerenciador (criativo × conjunto)' },
]
type Ordem = 'qualificados' | 'cpq' | 'orcamentos' | 'vendas' | 'gasto' | 'nunca' | 'fora'
const ORDENS: { v: Ordem; l: string }[] = [
  { v: 'qualificados', l: 'Mais qualificados' }, { v: 'cpq', l: 'Menor custo por qualificado' }, { v: 'orcamentos', l: 'Mais orçamentos' },
  { v: 'vendas', l: 'Mais vendas' }, { v: 'gasto', l: 'Maior gasto' }, { v: 'nunca', l: 'Mais "nunca respondeu"' }, { v: 'fora', l: 'Mais fora do perfil' },
]

// ───────────────────────── decisão ─────────────────────────
type Decisao = 'escalar' | 'manter' | 'melhorar' | 'desativar' | 'esperar' | 'fora'
const DEC_UI: Record<Decisao, { l: string; cls: string; Icon: typeof Rocket }> = {
  escalar:   { l: 'Escalar',   cls: 'text-success border-success/40 bg-success-bg', Icon: Rocket },
  manter:    { l: 'Manter',    cls: 'text-ink-muted border-border bg-surface-2', Icon: Minus },
  melhorar:  { l: 'Melhorar',  cls: 'text-warning border-warning/40 bg-warning-bg', Icon: Wrench },
  desativar: { l: 'Desativar', cls: 'text-danger border-danger/40 bg-danger-bg', Icon: Power },
  esperar:   { l: 'Pouco volume', cls: 'text-ink-faint border-border bg-surface-2', Icon: CircleDashed },
  fora:      { l: 'Não é de venda', cls: 'text-ink-faint border-border bg-surface-2', Icon: Minus },
}
interface Media { cpq: number | null; taxaQ: number | null; nunca: number | null; fora: number | null; preco: number | null; orc100: number | null }
/** % de quem chegou pela conversa da Ana do anúncio */
const pctBase = (v: number, s: Soma) => div(100 * v, s.base)
const foraDe = (s: Soma) => s.naoFab + s.outros + s.semInteresse

/** Volume mínimo para julgar: R$ 300 gastos ou 30 contatos (abaixo disso 1 contato muda tudo). */
const VOL_GASTO = 300, VOL_CONTATOS = 30

function decidir(s: Soma, m: Media, nome: string): { d: Decisao; porque: string } {
  if (naoEhVenda(nome)) return { d: 'fora', porque: 'campanha de vaga de emprego — fora da análise de venda' }
  const cpq = div(s.gasto, s.qualificados)
  if (s.gasto < VOL_GASTO && s.contatos < VOL_CONTATOS) return { d: 'esperar', porque: `ainda pouco volume (${brl(s.gasto)} e ${n(s.contatos)} contatos) — julgar com R$ ${VOL_GASTO} ou ${VOL_CONTATOS} contatos` }
  if (s.gasto >= 500 && s.qualificados === 0) return { d: 'desativar', porque: `${brl(s.gasto)} gastos e nenhum contato qualificado` }
  if (cpq != null && m.cpq != null && cpq >= 2 * m.cpq && s.orcamentos === 0 && s.vendas === 0)
    return { d: 'desativar', porque: `custo por qualificado ${cent(cpq)} — o dobro da média (${cent(m.cpq)}) — e nenhum orçamento` }
  const nunca = pctBase(s.nunca, s), fora = pctBase(foraDe(s), s)
  if (cpq != null && m.cpq != null && (cpq <= 0.75 * m.cpq || ((s.orcamentos >= 2 || s.vendas >= 1) && cpq <= m.cpq)))
    return { d: 'escalar', porque: `custo por qualificado ${cent(cpq)} (média ${cent(m.cpq)})${s.orcamentos ? ` · ${n(s.orcamentos)} orçamento${s.orcamentos > 1 ? 's' : ''}` : ''}${s.vendas ? ` · ${n(s.vendas)} venda${s.vendas > 1 ? 's' : ''}` : ''}` }
  const problemas: string[] = []
  if (cpq != null && m.cpq != null && cpq >= 1.3 * m.cpq) problemas.push(`custo por qualificado ${cent(cpq)} (média ${cent(m.cpq)})`)
  if (s.base >= 20 && nunca != null && m.nunca != null && nunca >= m.nunca + 10) problemas.push(`${pct(nunca, 0)} nunca respondeu (média ${pct(m.nunca, 0)})`)
  if (s.base >= 20 && fora != null && m.fora != null && fora >= m.fora + 8) problemas.push(`${pct(fora, 0)} fora do perfil — não fabricamos/outros assuntos/sem interesse (média ${pct(m.fora, 0)})`)
  if (problemas.length) return { d: 'melhorar', porque: problemas.join(' · ') }
  return { d: 'manter', porque: `dentro da média${cpq != null ? ` (custo por qualificado ${cent(cpq)})` : ''}` }
}

// ───────────────────────── dados ─────────────────────────
function useMeta(from: Date, to: Date, ligado: boolean) {
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['anuncios-criativos-meta-v1', p_from, p_to],
    enabled: ligado,
    queryFn: async () => {
      const [meta, crm, cri] = await Promise.all([
        supabase.rpc('anuncios_meta', { p_from, p_to }),
        supabase.rpc('anuncios_crm', { p_from, p_to }),
        supabase.rpc('anuncios_criativos', { p_from, p_to }),
      ])
      const erro = [meta, crm, cri].find(r => r.error)?.error
      if (erro) throw erro
      const ads = new Map<string, Anuncio>()
      const pegar = (adId: string, nome: string | null, conjunto: string | null, campanha: string | null, status: string | null) => {
        let a = ads.get(adId)
        if (!a) {
          a = { adId, nome: nome ?? `Anúncio ${adId.slice(-6)} (sem nome no Gerenciador)`, codigo: codigoDe(nome), conjunto: conjunto ?? '(conjunto desconhecido)', campanha: campanha ?? '(campanha desconhecida)', status, s: { ...ZERO } }
          ads.set(adId, a)
        }
        return a
      }
      for (const r of linhas(meta.data)) {
        const a = pegar(String(r.ad_id), txt(r.anuncio), txt(r.conjunto), txt(r.campanha), txt(r.anuncio_status))
        a.s = somar(a.s, { gasto: num(r.gasto), cliques: num(r.cliques), impressoes: num(r.impressoes), conversas: String(r.resultado_tipo ?? 'conversas') === 'conversas' ? num(r.resultado) : 0 })
      }
      for (const r of linhas(crm.data).filter(x => x.tipo === 'anuncio')) {
        const a = ads.get(String(r.chave)) ?? null
        const s = { contatos: num(r.contatos), qualificados: num(r.qualificados), conversou: num(r.conversou), orcamentos: num(r.orcamentos), rsOrcado: num(r.rs_orcado), voltaram: num(r.voltaram) }
        if (a) a.s = somar(a.s, s)
        else pegar(String(r.chave), null, null, null, null).s = somar({ ...ZERO }, s)
      }
      const vendasCodigo: { codigo: string; vendas: number; rs: number }[] = []
      for (const r of linhas(cri.data)) {
        if (r.tipo === 'codigo') { vendasCodigo.push({ codigo: String(r.chave), vendas: num(r.vendas_periodo), rs: num(r.rs_vendas_periodo) }); continue }
        const a = ads.get(String(r.chave)) ?? pegar(String(r.chave), txt(r.anuncio), txt(r.conjunto), txt(r.campanha), txt(r.anuncio_status))
        if (!a.codigo) a.codigo = codigoDe(txt(r.anuncio))
        a.s = somar(a.s, {
          base: num(r.base), fechados: num(r.fechados), nunca: num(r.nunca), parou: num(r.parou), semInteresse: num(r.sem_interesse),
          preco: num(r.preco), concorrente: num(r.concorrente), naoFab: num(r.nao_fabricamos), outros: num(r.outros), boi200: num(r.boi200),
          vendas: num(r.vendas_periodo), rsVendas: num(r.rs_vendas_periodo),
        })
      }
      return { anuncios: [...ads.values()], vendasCodigo }
    },
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}

function useGoogle(from: Date, to: Date, ligado: boolean) {
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['anuncios-criativos-google-v1', p_from, p_to],
    enabled: ligado,
    queryFn: async () => {
      const [g, crm, cl, termos] = await Promise.all([
        supabase.rpc('anuncios_google', { p_from, p_to }),
        supabase.rpc('anuncios_crm', { p_from, p_to }),
        supabase.rpc('anuncios_google_cliques', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_termos_google', { p_limite: 15 }),
      ])
      const erro = [g, crm].find(r => r.error)?.error
      if (erro) throw erro
      const crmL = linhas(crm.data)
      return {
        campanhas: linhas(g.data).filter(r => r.nivel === 'campanha'),
        porCamp: new Map(crmL.filter(r => r.tipo === 'google_campanha').map(r => [String(r.chave), r])),
        site: crmL.find(r => r.tipo === 'canal' && r.chave === 'Site'),
        siteOrigem: crmL.filter(r => r.tipo === 'site_origem'),
        cliques: cl.error ? [] : linhas(cl.data),
        termos: termos.error ? [] : linhas(termos.data),
      }
    },
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}

// ───────────────────────── página ─────────────────────────
export function AnunciosCriativos() {
  const per = usePeriodoAnuncio()
  const [sp] = useSearchParams()
  const aba = sp.get('aba') === 'google' ? 'google' : 'meta'
  const meta = useMeta(per.from, per.to, aba === 'meta')
  const google = useGoogle(per.from, per.to, aba === 'google')
  const q = aba === 'meta' ? meta : google

  return (
    <div className="w-full space-y-5 p-4 md:p-6 2xl:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink"><Megaphone className="h-6 w-6 text-accent" aria-hidden="true" />Anúncios — {aba === 'meta' ? 'criativos do Meta' : 'Google'}</h1>
          <p className="mt-1 text-micro text-ink-faint">{per.rotulo}{q.isFetching && ' · atualizando…'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo p={per} />
          <button type="button" onClick={() => { void q.refetch() }} className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-3 py-1 text-micro text-ink-muted hover:text-ink md:min-h-0" aria-label="Recarregar agora">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      <AbasAnuncios />
      {aba === 'meta' ? <AbaMeta q={meta} /> : <AbaGoogle q={google} />}
    </div>
  )
}

// ───────────────────────── Meta ─────────────────────────
function AbaMeta({ q }: { q: ReturnType<typeof useMeta> }) {
  const [nivel, setNivel] = useState<Nivel>(() => { try { return (localStorage.getItem('criativos-nivel') as Nivel) || 'criativo' } catch { return 'criativo' } })
  const [ordem, setOrdem] = useState<Ordem>(() => { try { return (localStorage.getItem('criativos-ordem') as Ordem) || 'qualificados' } catch { return 'qualificados' } })
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sem storage */ } }

  const dados = useMemo(() => {
    const ads = (q.data?.anuncios ?? [])
    const venda = ads.filter(a => !naoEhVenda(a.campanha))
    const tot = venda.reduce((t, a) => somar(t, a.s), { ...ZERO })
    // vendas atribuídas só pelo código entram no total (e no criativo), não no conjunto/campanha
    const vc = q.data?.vendasCodigo ?? []
    const totV = somar(tot, { vendas: vc.reduce((x, v) => x + v.vendas, 0), rsVendas: vc.reduce((x, v) => x + v.rs, 0) })
    const m: Media = {
      cpq: div(tot.gasto, tot.qualificados), taxaQ: div(100 * tot.qualificados, tot.contatos), nunca: pctBase(tot.nunca, tot),
      fora: pctBase(foraDe(tot), tot), preco: pctBase(tot.preco, tot), orc100: div(100 * tot.orcamentos, tot.contatos),
    }
    const chave = (a: Anuncio, nv: Nivel) => nv === 'criativo' ? (a.codigo ?? a.nome) : nv === 'conjunto' ? `${a.campanha} › ${a.conjunto}` : nv === 'campanha' ? a.campanha : a.adId
    const agrupar = (nv: Nivel) => {
      const g = new Map<string, { chave: string; nome: string; sub: string; ads: Anuncio[]; s: Soma }>()
      for (const a of ads) {
        const k = chave(a, nv)
        let x = g.get(k)
        if (!x) {
          const nome = nv === 'criativo' ? (a.codigo ? `${a.codigo} · ${a.nome.replace(/^\s*AD\d*\s*-?\s*/i, '').replace(a.codigo, '').replace(/[-—·\s]+$/,'').replace(/^[-—·\s]+/, '') || a.codigo}` : a.nome)
            : nv === 'conjunto' ? a.conjunto : nv === 'campanha' ? a.campanha : a.nome
          x = { chave: k, nome, sub: '', ads: [], s: { ...ZERO } }
          g.set(k, x)
        }
        x.ads.push(a); x.s = somar(x.s, a.s)
      }
      if (nv === 'criativo') for (const v of vc) {
        const x = g.get(v.codigo)
        if (x) x.s = somar(x.s, { vendas: v.vendas, rsVendas: v.rs })
        else g.set(v.codigo, { chave: v.codigo, nome: `${v.codigo} (sem gasto/contato no período)`, sub: '', ads: [], s: somar({ ...ZERO }, { vendas: v.vendas, rsVendas: v.rs }) })
      }
      return [...g.values()].map(x => {
        const conj = [...new Set(x.ads.map(a => a.conjunto))], camps = [...new Set(x.ads.map(a => a.campanha))]
        x.sub = nv === 'criativo' ? `${x.ads.length} anúncio${x.ads.length === 1 ? '' : 's'} · ${conj.length} conjunto${conj.length === 1 ? '' : 's'}`
          : nv === 'conjunto' ? x.ads[0]?.campanha ?? '' : nv === 'campanha' ? `${conj.length} conjunto${conj.length === 1 ? '' : 's'}` : `${x.ads[0]?.conjunto ?? ''} · ${camps[0] ?? ''}`
        return { ...x, dec: decidir(x.s, m, nv === 'criativo' ? (x.ads[0]?.campanha ?? '') : nv === 'campanha' ? x.nome : x.ads[0]?.campanha ?? '') }
      })
    }
    const ord = (l: ReturnType<typeof agrupar>) => [...l].sort((a, b) => {
      const s = a.s, t = b.s
      const val = (x: Soma) => ordem === 'qualificados' ? x.qualificados : ordem === 'orcamentos' ? x.orcamentos : ordem === 'vendas' ? x.rsVendas
        : ordem === 'gasto' ? x.gasto : ordem === 'nunca' ? (x.base >= 10 ? x.nunca / x.base : -1) : ordem === 'fora' ? (x.base >= 10 ? foraDe(x) / x.base : -1) : 0
      if (ordem === 'cpq') {
        const ca = s.qualificados ? s.gasto / s.qualificados : Infinity, cb = t.qualificados ? t.gasto / t.qualificados : Infinity
        return ca - cb || t.gasto - s.gasto
      }
      return val(t) - val(s) || t.gasto - s.gasto
    })
    return { m, tot: totV, linhas: ord(agrupar(nivel)), criativos: agrupar('criativo'), conjuntos: agrupar('conjunto') }
  }, [q.data, nivel, ordem])

  if (q.error && !q.data) return <Card><p className="text-body text-ink-muted">Não deu para carregar agora. Tente recarregar.</p></Card>
  if (!q.data) return <Card><div className="h-40 animate-pulse rounded-lg bg-surface-2" /></Card>
  const { m, tot } = dados

  return (
    <div className={`space-y-5 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['Gasto', brl(tot.gasto), 'campanhas de venda'],
          ['Contatos', n(tot.contatos), `${cent(div(tot.gasto, tot.contatos))} cada`],
          ['Qualificados', `${n(tot.qualificados)} · ${pct(m.taxaQ, 0)}`, `${cent(m.cpq)} cada`],
          ['Orçamentos', n(tot.orcamentos), `${cent(div(tot.gasto, tot.orcamentos))} cada · ${brl(tot.rsOrcado)}`],
          ['Vendas no período', n(tot.vendas), tot.rsVendas ? brl(tot.rsVendas) : 'cliente veio por anúncio'],
          ['Nunca respondeu', pct(m.nunca, 0), `${n(tot.nunca)} de ${n(tot.base)} conversas da Ana`],
          ['Fora do perfil', pct(m.fora, 0), 'não fabricamos + outros assuntos + sem interesse'],
          ['Só preço', pct(m.preco, 0), 'achou caro / fora do orçamento'],
        ].map(([r, v, a]) => (
          <div key={r} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-micro font-semibold uppercase tracking-wide text-ink-faint">{r}</p>
            <p className="mt-1 text-title font-semibold tabular-nums text-ink">{v}</p>
            <p className="text-micro text-ink-muted">{a}</p>
          </div>
        ))}
      </div>

      <Conclusao criativos={dados.criativos} conjuntos={dados.conjuntos} m={m} />

      {/* Tabela */}
      <Card>
        <CardHeader
          title="Detalhe — funil e motivos"
          subtitle={NIVEIS.find(x => x.v === nivel)?.ajuda ?? ''}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1" role="group" aria-label="Ver por">
                {NIVEIS.map(x => (
                  <button key={x.v} type="button" aria-pressed={nivel === x.v} onClick={() => { setNivel(x.v); guardar('criativos-nivel', x.v) }}
                    className={`rounded-lg px-2.5 py-1 text-micro ${nivel === x.v ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>{x.l}</button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1.5 text-micro text-ink-muted">
                <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Ordenar por</span>
                <select value={ordem} onChange={e => { setOrdem(e.target.value as Ordem); guardar('criativos-ordem', e.target.value) }} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-micro text-ink">
                  {ORDENS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </label>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1700px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th colSpan={3} />
                <th colSpan={6} className="border-l border-border px-2 pb-1 text-left text-micro font-semibold uppercase tracking-wide text-ink-faint">Funil no CRM</th>
                <th colSpan={7} className="border-l border-border px-2 pb-1 text-left text-micro font-semibold uppercase tracking-wide text-ink-faint">Por que fecharam (% das conversas da Ana)</th>
              </tr>
              <tr>
                {['Nome', 'Decisão', 'Gasto', 'Contatos', 'Qualificados', 'Custo/qualif.', 'Falou c/ vendedor', 'Orçamentos', 'Vendas no período',
                  'Nunca respondeu', 'Parou', 'Só preço', 'Não fabricamos', 'Outros assuntos', 'Sem interesse', 'Gado 200+'].map((h, i) => (
                  <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'} ${i === 3 || i === 9 ? 'border-l border-border' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map(l => {
                const ab = abertos.has(l.chave)
                const podeAbrir = nivel !== 'anuncio' && l.ads.length > 1
                return (
                  <Fragment key={l.chave}>
                    <Linha s={l.s} m={m} nome={l.nome} sub={l.sub} dec={l.dec} forte
                      abrir={podeAbrir ? { aberto: ab, alternar: () => setAbertos(p => { const x = new Set(p); if (x.has(l.chave)) x.delete(l.chave); else x.add(l.chave); return x }) } : undefined} />
                    {ab && [...l.ads].sort((a, b) => b.s.gasto - a.s.gasto).map(a => (
                      <Linha key={a.adId} s={a.s} m={m} nome={a.nome} sub={nivel === 'conjunto' ? a.codigo ?? '' : `${a.conjunto}`} dec={decidir(a.s, m, a.campanha)} recuo />
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <details className="mt-3 text-micro text-ink-faint">
          <summary className="cursor-pointer select-none text-ink-muted hover:text-ink">Como ler e como a decisão é tomada</summary>
          <div className="mt-2 space-y-1 leading-relaxed">
            <p><b>Contatos</b> = cliente novo no CRM que chegou pela conversa da Ana daquele anúncio. <b>Qualificados</b> = a Ana passou ao vendedor, ou o vendedor marcou avanço, ou virou orçamento (e não é “não fabricamos/outro assunto”). <b>Falou c/ vendedor</b> = o cliente respondeu ou deu informação no WhatsApp do vendedor.</p>
            <p><b>Vendas no período</b> = pedidos fechados no período cujo cliente veio por este anúncio (conversa da Ana) ou por este criativo (código &NN no CRM), em qualquer data até 365 dias antes — o contato leva ~1 mês para virar pedido. Na visão por conjunto/campanha só entra a venda com anúncio exato.</p>
            <p><b>Por que fecharam</b> = etiqueta que o vendedor pôs ao encerrar, sobre todas as conversas da Ana vindas do anúncio no período (inclui cliente antigo que voltou). Em vermelho: 10 pontos acima da média com 20+ conversas.</p>
            <p><b>Decisão</b> (comparada à média do Meta no período, custo por qualificado {cent(m.cpq)}): <b>Escalar</b> = custo por qualificado 25% abaixo da média, ou na média com 2+ orçamentos ou venda. <b>Desativar</b> = R$ 500+ sem nenhum qualificado, ou o dobro da média sem orçamento nem venda. <b>Melhorar</b> = custo 30% acima da média, ou “nunca respondeu”/fora do perfil muito acima da média (o motivo aparece ao passar o mouse). <b>Pouco volume</b> = menos de R$ {VOL_GASTO} e {VOL_CONTATOS} contatos.</p>
          </div>
        </details>
      </Card>
    </div>
  )
}

function Linha({ s, m, nome, sub, dec, forte, recuo, abrir }: {
  s: Soma; m: Media; nome: string; sub: string; dec: { d: Decisao; porque: string }; forte?: boolean; recuo?: boolean
  abrir?: { aberto: boolean; alternar: () => void }
}) {
  const ui = DEC_UI[dec.d]
  const alto = (v: number | null, media: number | null) => s.base >= 20 && v != null && media != null && v >= media + 10
  const pc = (v: number, media: number | null) => {
    const x = pctBase(v, s)
    if (!s.base) return '—'
    return <span className={alto(x, media) ? 'font-semibold text-danger' : ''}>{pct(x, 0)}</span>
  }
  return (
    <tr className={abrir ? 'cursor-pointer hover:bg-surface-2' : ''} onClick={abrir?.alternar}>
      <th scope="row" className={`border-t border-border py-1.5 pr-2 text-left text-body ${recuo ? 'pl-8 font-normal text-ink-muted' : 'pl-2'} ${forte ? 'font-semibold text-ink' : ''}`}>
        <span className="inline-flex items-start gap-1">
          {abrir && (abrir.aberto ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />)}
          <span className="max-w-[22rem] whitespace-normal">{nome}{sub && <span className="block text-micro font-normal text-ink-faint">{sub}</span>}</span>
        </span>
      </th>
      <td className="border-t border-border px-2 py-1.5" title={dec.porque}>
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro ${ui.cls}`}><ui.Icon className="h-3 w-3" aria-hidden="true" />{ui.l}</span>
        <span className="sr-only">{dec.porque}</span>
      </td>
      <td className={td}>{s.gasto ? brl(s.gasto) : '—'}</td>
      <td className={`${td} border-l`}>{s.contatos ? n(s.contatos) : '—'}{s.voltaram ? <span className="block text-micro text-ink-faint">+{n(s.voltaram)} voltaram</span> : null}</td>
      <td className={td}>{s.contatos ? <>{n(s.qualificados)} <span className="text-micro text-ink-faint">{pct(div(100 * s.qualificados, s.contatos), 0)}</span></> : '—'}</td>
      <td className={`${td} font-medium text-ink`}>{s.qualificados && s.gasto ? cent(div(s.gasto, s.qualificados)) : '—'}</td>
      <td className={td}>{s.contatos ? pct(div(100 * s.conversou, s.contatos), 0) : '—'}</td>
      <td className={td}>{s.orcamentos ? <>{n(s.orcamentos)} <span className="text-micro text-ink-faint">{brl(s.rsOrcado)}</span></> : (s.contatos ? '0' : '—')}</td>
      <td className={td}>{s.vendas ? <span className="font-semibold text-success">{n(s.vendas)} · {brl(s.rsVendas)}</span> : '—'}</td>
      <td className={`${td} border-l`}>{pc(s.nunca, m.nunca)}</td>
      <td className={td}>{s.base ? pct(pctBase(s.parou, s), 0) : '—'}</td>
      <td className={td}>{pc(s.preco, m.preco)}</td>
      <td className={td}>{s.base ? pct(pctBase(s.naoFab, s), 0) : '—'}</td>
      <td className={td}>{s.base ? pct(pctBase(s.outros, s), 0) : '—'}</td>
      <td className={td}>{s.base ? pct(pctBase(s.semInteresse + s.concorrente, s), 0) : '—'}</td>
      <td className={td}>{s.boi200 ? n(s.boi200) : '—'}</td>
    </tr>
  )
}

// ───────────────────────── conclusão ─────────────────────────
type Grupo = { chave: string; nome: string; sub: string; ads: Anuncio[]; s: Soma; dec: { d: Decisao; porque: string } }

function Conclusao({ criativos, conjuntos, m }: { criativos: Grupo[]; conjuntos: Grupo[]; m: Media }) {
  const julg = (l: Grupo[]) => l.filter(x => x.dec.d !== 'esperar' && x.dec.d !== 'fora')
  const cpq = (s: Soma) => div(s.gasto, s.qualificados)
  const top = (l: Grupo[], d: Decisao) => julg(l).filter(x => x.dec.d === d).sort((a, b) => (cpq(a.s) ?? Infinity) - (cpq(b.s) ?? Infinity))
  const escalarC = top(criativos, 'escalar').slice(0, 4), escalarJ = top(conjuntos, 'escalar').slice(0, 4)
  const desligar = [...top(criativos, 'desativar'), ...top(conjuntos, 'desativar')].slice(0, 6)
  const melhorar = [...top(criativos, 'melhorar'), ...top(conjuntos, 'melhorar')].slice(0, 6)
  const comBase = criativos.filter(x => x.s.base >= 20)
  const curiosos = [...comBase].sort((a, b) => b.s.nunca / b.s.base - a.s.nunca / a.s.base).slice(0, 3)
  const foraPerfil = [...comBase].sort((a, b) => foraDe(b.s) / b.s.base - foraDe(a.s) / a.s.base).slice(0, 3)
  const vendeu = [...criativos].filter(x => x.s.vendas > 0).sort((a, b) => b.s.rsVendas - a.s.rsVendas).slice(0, 5)
  const orcou = [...criativos].filter(x => x.s.orcamentos > 0).sort((a, b) => b.s.orcamentos - a.s.orcamentos || (cpq(a.s) ?? 0) - (cpq(b.s) ?? 0)).slice(0, 5)

  const item = (g: Grupo, extra?: string) => <><b className="text-ink">{g.nome}</b>{g.sub && <span className="text-ink-faint"> ({g.sub})</span>} — {extra ?? g.dec.porque}</>
  const Bloco = ({ titulo, Icon, cor, itens, vazio }: { titulo: string; Icon: typeof Rocket; cor: string; itens: ReactNode[]; vazio: string }) => (
    <div className="rounded-lg border border-border/60 bg-surface-2 p-3">
      <p className={`mb-1.5 flex items-center gap-1.5 text-body font-semibold ${cor}`}><Icon className="h-4 w-4" aria-hidden="true" />{titulo}</p>
      {itens.length ? <ul className="space-y-1 text-micro leading-snug text-ink-muted">{itens.map((x, i) => <li key={i}>• {x}</li>)}</ul>
        : <p className="text-micro text-ink-faint">{vazio}</p>}
    </div>
  )
  return (
    <Card>
      <CardHeader title="Conclusão para o gestor de tráfego" subtitle={`Comparado com a média do Meta no período: ${cent(m.cpq)} por qualificado, ${pct(m.taxaQ, 0)} dos contatos qualificam, ${pct(m.nunca, 0)} nunca respondem, ${pct(m.fora, 0)} fora do perfil.`} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <Bloco titulo="Escalar (pôr mais verba)" Icon={Rocket} cor="text-success" vazio="Nenhum criativo ou conjunto com custo bem abaixo da média e volume suficiente."
          itens={[...escalarC.map(g => item(g)), ...escalarJ.map(g => <>conjunto {item(g)}</>)]} />
        <Bloco titulo="Desativar" Icon={Power} cor="text-danger" vazio="Nada para desligar: ninguém gastou muito sem trazer qualificado."
          itens={desligar.map(g => item(g))} />
        <Bloco titulo="Melhorar" Icon={Wrench} cor="text-warning" vazio="Nada fora da curva."
          itens={melhorar.map(g => item(g))} />
        <Bloco titulo="O que está gerando orçamento" Icon={CheckCircle2} cor="text-ink" vazio="Nenhum orçamento ligado a criativo no período."
          itens={orcou.map(g => item(g, `${n(g.s.orcamentos)} orçamento${g.s.orcamentos > 1 ? 's' : ''} (${brl(g.s.rsOrcado)})${g.s.gasto ? ` · ${cent(div(g.s.gasto, g.s.orcamentos))} cada` : ''}`))} />
        <Bloco titulo="O que está saindo venda" Icon={CheckCircle2} cor="text-success" vazio="Nenhuma venda do período ligada a criativo (venda leva ~1 mês: olhe “90 dias”)."
          itens={vendeu.map(g => item(g, `${n(g.s.vendas)} venda${g.s.vendas > 1 ? 's' : ''} · ${brl(g.s.rsVendas)}`))} />
        <Bloco titulo="Traz curioso / quem não responde" Icon={AlertTriangle} cor="text-warning" vazio="Pouco volume de conversa para comparar."
          itens={curiosos.map(g => item(g, `${pct(pctBase(g.s.nunca, g.s), 0)} nunca respondeu (média ${pct(m.nunca, 0)}) — texto/oferta pode estar atraindo clique sem intenção; teste chamada mais direta (preço a partir de, produção, porte)`))} />
        <Bloco titulo="Traz gente fora do perfil" Icon={Search} cor="text-warning" vazio="Pouco volume de conversa para comparar."
          itens={foraPerfil.map(g => item(g, `${pct(pctBase(foraDe(g.s), g.s), 0)} fora do perfil — ${n(g.s.naoFab)} pediram o que não fabricamos, ${n(g.s.outros)} outros assuntos, ${n(g.s.semInteresse)} sem interesse (média ${pct(m.fora, 0)}); deixe claro no criativo o que é o equipamento e para quem é`))} />
        <Bloco titulo="Como usar" Icon={Lightbulb} cor="text-ink" vazio=""
          itens={[
            'Decida com 7 dias ou mais (“Hoje/Ontem” têm pouco volume) e confirme com “90 dias” antes de desligar algo que já vendeu.',
            'Custo por qualificado é a métrica principal: orçamento e venda são poucos por anúncio e confirmam a tendência.',
            '“Nunca respondeu” alto com tempo de resposta bom do vendedor = problema do anúncio (público/texto), não do atendimento.',
          ]} />
      </div>
    </Card>
  )
}

// ───────────────────────── Google ─────────────────────────
function AbaGoogle({ q }: { q: ReturnType<typeof useGoogle> }) {
  if (q.error && !q.data) return <Card><p className="text-body text-ink-muted">Não deu para carregar agora. Tente recarregar.</p></Card>
  if (!q.data) return <Card><div className="h-40 animate-pulse rounded-lg bg-surface-2" /></Card>
  const d = q.data
  const camps = [...d.campanhas].sort((a, b) => num(b.gasto) - num(a.gasto))
  const gasto = camps.reduce((s, c) => s + num(c.gasto), 0)
  const cliquesSite = d.cliques.reduce((s, c) => s + num(c.cliques), 0)
  const cliquesConv = d.cliques.reduce((s, c) => s + num(c.viraram_conversa), 0)
  const cliquesAds = d.cliques.filter(c => c.origem === 'Google Ads').reduce((s, c) => s + num(c.cliques), 0)
  const comCamp = d.cliques.filter(c => !String(c.campanha).startsWith('(sem')).reduce((s, c) => s + num(c.cliques), 0)
  const site = d.site
  const conclusoes: string[] = []
  const semRet = camps.filter(c => num(c.gasto) >= 300 && !d.porCamp.get(String(c.campanha)) && !/youtube/i.test(String(c.campanha)))
  if (cliquesSite === 0) conclusoes.push('Ainda não há clique no WhatsApp do site registrado no período: o rastreio por campanha começou em 21/10 à noite.')
  else conclusoes.push(`${n(cliquesSite)} cliques no WhatsApp do site registrados (${n(cliquesAds)} vindos de anúncio do Google); ${n(cliquesConv)} viraram conversa e ${n(comCamp)} trouxeram a campanha. É essa ponte que liga gasto do Google a contato, orçamento e venda.`)
  for (const c of camps.filter(c => /youtube/i.test(String(c.campanha)) && num(c.gasto) > 0))
    conclusoes.push(`${String(c.campanha)}: ${brl(num(c.gasto))} gastos — campanha de inscrição/visualização no YouTube; as “conversões” dela (${n(num(c.conversoes))}) não são contato. Avalie se esse dinheiro não rende mais nas campanhas de pesquisa.`)
  if (semRet.length && cliquesSite > 0) conclusoes.push(`Sem contato ligado no período: ${semRet.map(c => `${String(c.campanha)} (${brl(num(c.gasto))})`).join(', ')}. Pode ser só falta de tempo de rastreio — confirme com 7+ dias.`)
  conclusoes.push('Próximo passo de rastreio: pôr no Google Ads o “sufixo de URL final” {keyword} e {campaignid} para saber a palavra-chave de cada contato, e devolver ao Google quem virou orçamento/venda (as conversões offline já estão prontas no banco, falta criar as 3 ações no Ads).')

  return (
    <div className={`space-y-5 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ['Gasto', brl(gasto), `${camps.length} campanhas`],
          ['Contatos do site', n(num(site?.contatos)), `${cent(div(gasto, num(site?.contatos)))} cada (inclui orgânico)`],
          ['Qualificados', n(num(site?.qualificados)), `${cent(div(gasto, num(site?.qualificados)))} cada`],
          ['Orçamentos', n(num(site?.orcamentos)), brl(num(site?.rs_orcado))],
          ['Cliques no WhatsApp do site', n(cliquesSite), `${n(cliquesAds)} de anúncio · ${n(cliquesConv)} viraram conversa`],
          ['Origem do site', d.siteOrigem.map(x => `${String(x.chave)} ${n(num(x.contatos))}`).join(' · ') || '—', 'separada desde 21/10'],
        ].map(([r, v, a]) => (
          <div key={r} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-micro font-semibold uppercase tracking-wide text-ink-faint">{r}</p>
            <p className="mt-1 text-title font-semibold tabular-nums text-ink">{v}</p>
            <p className="text-micro text-ink-muted">{a}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="Conclusão — Google" subtitle="O que dá para afirmar com o rastreio de hoje e o que falta." />
        <ul className="space-y-1.5 text-body text-ink-muted">{conclusoes.map((c, i) => <li key={i} className="flex gap-2"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />{c}</li>)}</ul>
      </Card>

      <Card>
        <CardHeader title="Campanhas do Google — do clique ao orçamento" subtitle="Contato no CRM ligado à campanha pelo código do clique que o site põe na mensagem do WhatsApp (desde 21/10)." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-separate border-spacing-0">
            <thead>
              <tr>{['Campanha', 'Situação', 'Gasto', 'Cliques', 'CPC', 'Conversões do Google', 'Cliques no WhatsApp do site', 'Contatos', 'Qualificados', 'Custo/qualif.', 'Orçamentos', 'Vendas'].map((h, i) => (
                <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'} ${i === 6 ? 'border-l border-border' : ''}`}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {camps.map(c => {
                const nome = String(c.campanha), f = d.porCamp.get(nome), g = num(c.gasto)
                const cl = d.cliques.filter(x => x.campanha === nome).reduce((s, x) => s + num(x.cliques), 0)
                return (
                  <tr key={nome}>
                    <th scope="row" className="border-t border-border px-2 py-1.5 text-left text-body font-semibold text-ink">{nome}</th>
                    <td className="border-t border-border px-2 py-1.5 text-micro text-ink-muted">{String(c.campanha_status ?? '—').toLowerCase()}</td>
                    <td className={td}>{brl(g)}</td>
                    <td className={td}>{n(num(c.cliques))}</td>
                    <td className={td}>{cent(div(g, num(c.cliques)))}</td>
                    <td className={td}>{n(num(c.conversoes))}</td>
                    <td className={`${td} border-l`}>{cl ? n(cl) : '—'}</td>
                    <td className={td}>{f ? n(num(f.contatos)) : '—'}</td>
                    <td className={td}>{f ? n(num(f.qualificados)) : '—'}</td>
                    <td className={`${td} font-medium text-ink`}>{f && num(f.qualificados) ? cent(div(g, num(f.qualificados))) : '—'}</td>
                    <td className={td}>{f && num(f.orcamentos) ? <>{n(num(f.orcamentos))} <span className="text-micro text-ink-faint">{brl(num(f.rs_orcado))}</span></> : '—'}</td>
                    <td className={td}>{f && num(f.vendas) ? n(num(f.vendas)) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {d.termos.length > 0 && (
        <Card>
          <CardHeader title="O que as pessoas pesquisaram (30 dias)" subtitle="Termos reais que acionaram os anúncios — base para negativar o que não vende." />
          <ul className="grid grid-cols-1 gap-x-6 md:grid-cols-2 xl:grid-cols-3">
            {d.termos.map(t => (
              <li key={`${t.termo}|${t.campanha}`} className="flex items-start justify-between gap-3 border-t border-border py-1.5 text-body">
                <span className="min-w-0"><span className="block truncate text-ink">“{String(t.termo)}”</span><span className="block truncate text-micro text-ink-faint">{String(t.campanha ?? '')}</span></span>
                <span className="whitespace-nowrap text-right tabular-nums text-ink-muted">{n(num(t.cliques))} cliques · {brl(num(t.gasto))}{num(t.conversoes) > 0 ? ` · ${n(num(t.conversoes))} conv.` : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
