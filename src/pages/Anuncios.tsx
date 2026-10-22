import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpDown, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Info, Megaphone, RefreshCw, Search } from 'lucide-react'
import { Bar, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader } from './dashboard/ui/Card'
import { brl, n, pct } from './dashboard/ui/format'
import { CHART, TOOLTIP_STYLE } from './dashboard/ui/chart-tokens'
import { situacaoCampanha } from '@/lib/marketing-relatorio'
import { useMarketingRelatorioIntervalo } from '@/hooks/useMarketingRelatorio'
import { AbasAnuncios } from './anuncios/compartilhado'
import { AnunciosVerbaCard, MotivosCard, VendedoresCard } from './dashboard/blocks/RelatorioMarketing'

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

type Periodo = 'hoje' | 'ontem' | '7d' | 'mes' | 'mes_passado' | '90d' | 'custom'
const PERIODOS: { v: Exclude<Periodo, 'custom'>; l: string }[] = [
  { v: 'hoje', l: 'Hoje' }, { v: 'ontem', l: 'Ontem' }, { v: '7d', l: '7 dias' }, { v: 'mes', l: 'Este mês' },
  { v: 'mes_passado', l: 'Mês passado' }, { v: '90d', l: '90 dias' },
]
/** Período personalizado: datas 'AAAA-MM-DD' (as duas inclusas). */
interface Personalizado { de: string; ate: string }
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaLocal = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d) }
function personalizadoPadrao(): Personalizado {
  const h = new Date()
  return { de: isoDia(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6)), ate: isoDia(h) }
}

function intervalo(p: Periodo, custom?: Personalizado, agora = new Date()): { from: Date; to: Date } {
  const y = agora.getFullYear(), m = agora.getMonth(), d = agora.getDate()
  const amanha = new Date(y, m, d + 1)
  if (p === 'custom' && custom) {
    const de = diaLocal(custom.de), ate = diaLocal(custom.ate)
    const [a, b] = de <= ate ? [de, ate] : [ate, de]
    return { from: a, to: new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1) }
  }
  if (p === 'hoje') return { from: new Date(y, m, d), to: amanha }
  if (p === 'ontem') return { from: new Date(y, m, d - 1), to: new Date(y, m, d) }
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
/** 0,4 → "24 min"; 7,6 → "7,6 h"; 50 → "2,1 dias" */
const horas = (h: number) => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h` : `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`

/** "21/10 às 09:44" */
const horaBr = (iso: string | null) => {
  if (!iso) return '—'
  const t = new Date(iso)
  return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')} às ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')
const cent = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : v < 10 ? `R$ ${v.toFixed(2).replace('.', ',')}` : brl(v))
const div = (a: number, b: number) => (b > 0 ? a / b : null)
/** Custo por unidade: plataforma sem gasto no período (ex.: o Meta antes da carga do dia) mostra "—", não R$ 0,00. */
const custo = (gasto: number, q: number) => (gasto > 0 ? cent(div(gasto, q)) : '—')

interface LinhaMeta {
  campanha: string; campanhaStatus: string | null; campanhaOrc: number | null; objetivo: string | null
  conjunto: string; conjuntoStatus: string | null; conjuntoOrc: number | null
  adId: string; anuncio: string; codigo: string | null; anuncioStatus: string | null
  gasto: number; impressoes: number; cliques: number; resultado: number; resultadoTipo: string
}
interface Dia { dia: string; gastoMeta: number; gastoGoogle: number; contatosMeta: number; contatosSite: number; contatos: number }
/** Funil do CRM: contatos que chegaram → qualificados → orçamentos → vendas (RPC anuncios_crm). */
interface Funil {
  contatos: number; qualificados: number; orcamentos: number; rsOrcado: number; vendas: number; rsVendido: number
  /** contatos que conversaram com a Ana por anúncio e nunca viraram atendimento no CRM (já somados em contatos) */
  soAna: number
  /** clientes que JÁ estavam no CRM e voltaram por este anúncio (não somam em contatos novos) */
  voltaram: number
  /** LP e site (vão direto ao vendedor): quantos, quantos escreveram e ninguém respondeu, horas até a 1ª resposta (mediana) */
  diretos: number
  semResposta: number
  respMedH: number | null
  /** o cliente respondeu ao vendedor ou deu informação de compra no WhatsApp dele (todo canal) */
  conversou: number
}
const FUNIL0: Funil = { contatos: 0, qualificados: 0, orcamentos: 0, rsOrcado: 0, vendas: 0, rsVendido: 0, soAna: 0, voltaram: 0, diretos: 0, semResposta: 0, respMedH: null, conversou: 0 }
const lerFunil = (r: Record<string, unknown> | undefined): Funil => ({
  contatos: num(r?.contatos), qualificados: num(r?.qualificados), orcamentos: num(r?.orcamentos),
  rsOrcado: num(r?.rs_orcado), vendas: num(r?.vendas), rsVendido: num(r?.rs_vendido), soAna: num(r?.so_ana), voltaram: num(r?.voltaram),
  diretos: num(r?.diretos), semResposta: num(r?.sem_resposta), respMedH: numN(r?.resp_mediana_h), conversou: num(r?.conversou),
})
const somarFunil = (fs: Funil[]): Funil => fs.reduce((s, f) => ({
  contatos: s.contatos + f.contatos, qualificados: s.qualificados + f.qualificados, orcamentos: s.orcamentos + f.orcamentos,
  rsOrcado: s.rsOrcado + f.rsOrcado, vendas: s.vendas + f.vendas, rsVendido: s.rsVendido + f.rsVendido,
  soAna: s.soAna + f.soAna, voltaram: s.voltaram + f.voltaram,
  diretos: s.diretos + f.diretos, semResposta: s.semResposta + f.semResposta,
  // mediana não soma: fica a primeira que existir (na árvore só a LP tem)
  respMedH: s.respMedH ?? f.respMedH, conversou: s.conversou + f.conversou,
}), { ...FUNIL0 })

/** Campanha que não é de venda (vaga de emprego): fica na árvore, mas fora dos números de venda do topo. */
const naoEhVenda = (campanha: string) => /vaga|emprego/i.test(campanha)

/**
 * Contato de landing page não passa pela Ana, então não tem o anúncio exato: liga pela origem do CRM
 * ("LP Mini Fábrica", "LP Plástico") à campanha de cadastro correspondente.
 */
const LP_PARA_CAMPANHA: { origem: RegExp; campanha: RegExp }[] = [
  { origem: /pl[aá]stico/i, campanha: /\[LEADS\].*PL[AÁ]STICO/i },
  { origem: /./, campanha: /\[LEADS\]\s*-\s*\[LP\]/i },
]

/** Previsão do mês: o que já foi gasto até ontem + orçamento/dia das campanhas ativas × dias que faltam (com hoje). */
function usePrevisaoMes() {
  const agora = new Date()
  const ini = new Date(agora.getFullYear(), agora.getMonth(), 1)
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 1)
  const p_from = ini.toISOString(), p_to = fim.toISOString()
  return useQuery({
    queryKey: ['anuncios-previsao-mes-v1', p_from],
    queryFn: async () => {
      const [plat, diario] = await Promise.all([
        supabase.rpc('dashboard_marketing_plataformas', { p_from, p_to }),
        supabase.rpc('anuncios_diario', { p_from, p_to: new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1).toISOString() }),
      ])
      if (plat.error) throw plat.error
      if (diario.error) throw diario.error
      const pl = linhas(plat.data)
      const hojeIso = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
      const dias = linhas(diario.data)
      const ateOntem = (campo: string) => dias.filter(x => String(x.dia) < hojeIso).reduce((s, x) => s + num(x[campo]), 0)
      const restantes = Math.round((fim.getTime() - new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime()) / 86400000)
      const orcMeta = num(pl.find(r => r.tipo === 'plataforma' && r.plataforma === 'Meta')?.orcamento_dia)
      const orcGoogle = pl.filter(r => r.tipo === 'campanha' && r.plataforma === 'Google' && (r.status === 'ENABLED' || r.status === 'ACTIVE'))
        .reduce((s, r) => s + num(r.orcamento_dia), 0)
      const mk = (gasto: number, orcDia: number) => ({ gasto, orcDia, previsto: gasto + orcDia * restantes })
      return {
        mes: ini.toLocaleDateString('pt-BR', { month: 'long' }), restantes,
        meta: mk(ateOntem('gasto_meta'), orcMeta), google: mk(ateOntem('gasto_google'), orcGoogle),
      }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  })
}

function useDados(from: Date, to: Date) {
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['pagina-anuncios-v7', p_from, p_to],
    queryFn: async () => {
      const [meta, diario, plat, crm, google, palavras, termos, atual, pedSemOrc, vendOrig, volt] = await Promise.all([
        supabase.rpc('anuncios_meta', { p_from, p_to }),
        supabase.rpc('anuncios_diario', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_plataformas', { p_from, p_to }),
        supabase.rpc('anuncios_crm', { p_from, p_to }),
        supabase.rpc('anuncios_google', { p_from, p_to }),
        supabase.rpc('anuncios_google_palavras', { p_limite: 30 }),
        supabase.rpc('dashboard_marketing_termos_google', { p_limite: 20 }),
        supabase.rpc('anuncios_atualizacao'),
        supabase.rpc('anuncios_pedidos_sem_orcamento', { p_from, p_to }),
        supabase.rpc('anuncios_vendas_origem', { p_from, p_to }),
        // clientes que já estavam no CRM e voltaram a falar no período (régua do "voltaram" de /atendimentos), por canal
        supabase.rpc('anuncios_voltaram', { p_from, p_to }),
      ])
      const erro = [meta, diario, plat, crm].find(r => r.error)?.error
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
      const crmL = linhas(crm.data)
      const canal = (c: string): Funil => lerFunil(crmL.find(f => f.tipo === 'canal' && f.chave === c))
      // funil do CRM por anúncio exato (ad_id que a Ana guarda da conversa)
      const porAd = new Map<string, Funil>(crmL.filter(f => f.tipo === 'anuncio').map(f => [String(f.chave), lerFunil(f)]))
      const semAnuncio = (c: string): Funil => lerFunil(crmL.find(f => f.tipo === 'sem_anuncio' && f.chave === c))
      const porLp = crmL.filter(f => f.tipo === 'origem_lp').map(f => ({ origem: String(f.chave), funil: lerFunil(f) }))
      // o Site separado pela origem que o script do site grava (desde 21/10): Google Ads (pago), Google busca, as outras
      // origens do script (Instagram, YouTube, ChatGPT…) e direto; origem fora da lista vai pro fim
      const ORDEM_SITE = ['Google Ads', 'Google busca', 'Instagram', 'Facebook', 'YouTube', 'TikTok', 'LinkedIn', 'ChatGPT/IA', 'E-mail',
        'Link no WhatsApp', 'Outros buscadores', 'Outros sites', 'Site direto', 'Sem origem (antes de 21/10)']
      const posSite = (o: string) => { const i = ORDEM_SITE.indexOf(o); return i < 0 ? ORDEM_SITE.length : i }
      const siteOrigem = crmL.filter(f => f.tipo === 'site_origem').map(f => ({ origem: String(f.chave), funil: lerFunil(f) }))
        .sort((a, b) => posSite(a.origem) - posSite(b.origem))
      // vaga de emprego: fora dos números de venda do topo
      const vaga = metaLinhas.filter(l => naoEhVenda(l.campanha))
      const vagaSoma = { gasto: vaga.reduce((a, l) => a + l.gasto, 0), cliques: vaga.reduce((a, l) => a + l.cliques, 0),
        impressoes: vaga.reduce((a, l) => a + l.impressoes, 0),
        conversas: vaga.filter(l => l.resultadoTipo === 'conversas').reduce((a, l) => a + l.resultado, 0) }
      const atualL = atual.error ? [] : linhas(atual.data)
      const horaCarga = (pl: string) => txt(atualL.find(r => r.plataforma === pl)?.atualizado_em)
      return {
        metaLinhas, dias, porAd, semAnuncioMeta: semAnuncio('Meta'), porLp, vagaSoma, siteOrigem, outros: canal('Outros'),
        // funil por campanha do Google: código do clique que o site põe na mensagem (desde 21/10)
        porGoogleCamp: new Map<string, Funil>(crmL.filter(f => f.tipo === 'google_campanha').map(f => [String(f.chave), lerFunil(f)])),
        horaMeta: horaCarga('Meta'), horaGoogle: horaCarga('Google'),
        voltaram: Object.fromEntries(['Meta', 'Site', 'Outros'].map(c => [c, num((volt.error ? [] : linhas(volt.data)).find(r => r.canal === c)?.voltaram)])) as Record<'Meta' | 'Site' | 'Outros', number>,
        pedidosSemOrc: pedSemOrc.error ? [] : linhas(pedSemOrc.data),
        // vendas DO período e de onde veio cada cliente (chegou em qualquer data) — RPC anuncios_vendas_origem
        vendas: (vendOrig.error ? [] : linhas(vendOrig.data)).map(r => ({
          pedido: String(r.pedido), data: txt(r.data_venda), vendedor: txt(r.vendedor), cliente: txt(r.cliente), valor: num(r.valor),
          canal: String(r.canal), evidencia: String(r.evidencia), detalhe: String(r.detalhe ?? ''), chegou: txt(r.chegou_em), dias: numN(r.dias_ate_venda),
        })) as VendaOrigem[],
        meta: {
          // sem a campanha de vaga de emprego (não é de venda)
          gasto: num(totMeta?.gasto) - vagaSoma.gasto, orcDia: numN(totMeta?.orcamento_dia), conversas: num(totMeta?.resultado) - vagaSoma.conversas,
          cliques: num(totMeta?.cliques) - vagaSoma.cliques, impressoes: num(totMeta?.impressoes) - vagaSoma.impressoes,
          // custo por conversa só com o gasto das campanhas de mensagem (LP, cadastro e tráfego não geram conversa)
          gastoConversas: metaLinhas.filter(l => l.resultadoTipo === 'conversas' && !naoEhVenda(l.campanha)).reduce((a, l) => a + l.gasto, 0),
          ate: txt(totMeta?.carregado_ate), crm: canal('Meta'),
        },
        google: {
          gasto: num(totGoogle?.gasto), cliques: num(totGoogle?.cliques), impressoes: num(totGoogle?.impressoes),
          conversoes: num(totGoogle?.resultado),
          // a campanha do YouTube conta inscrição/engajamento como conversão; as de pesquisa contam o clique no WhatsApp do site ([BOTÃO] - WHATS, principal) e formulário
          conversoesYoutube: (google.error ? [] : linhas(google.data)).filter(l => l.nivel === 'campanha' && /youtube/i.test(String(l.campanha))).reduce((a, l) => a + num(l.conversoes), 0),
          ate: txt(totGoogle?.carregado_ate), crm: canal('Site'),
          linhas: google.error ? [] : linhas(google.data),
          palavras: palavras.error ? [] : linhas(palavras.data),
          termos: termos.error ? [] : linhas(termos.data),
        },
      }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}

interface VendaOrigem {
  pedido: string; data: string | null; vendedor: string | null; cliente: string | null; valor: number
  canal: string; evidencia: string; detalhe: string; chegou: string | null; dias: number | null
}
const CANAIS_VENDA: { canal: string; cor: string }[] = [
  { canal: 'Meta', cor: COR_META }, { canal: 'Google / Site', cor: COR_GOOGLE },
  { canal: 'Carteira e indicação', cor: CHART.s5 }, { canal: 'Sem origem', cor: 'hsl(var(--ink-faint))' },
]
/** "11,2×" */
const vezes = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })}×`)

/** Vendas do período por origem do cliente + retorno do anúncio (vendido ÷ gasto do mesmo período). */
function VendasOrigem({ vendas, gastoMeta, gastoGoogle }: { vendas: VendaOrigem[]; gastoMeta: number; gastoGoogle: number }) {
  const total = vendas.reduce((a, v) => a + v.valor, 0)
  const blocos = CANAIS_VENDA.map(c => {
    const vs = vendas.filter(v => v.canal === c.canal)
    const rast = vs.filter(v => v.evidencia === 'rastreado')
    const valor = vs.reduce((a, v) => a + v.valor, 0), valorRast = rast.reduce((a, v) => a + v.valor, 0)
    const gasto = c.canal === 'Meta' ? gastoMeta : c.canal === 'Google / Site' ? gastoGoogle : null
    const dias = rast.filter(v => v.dias != null).map(v => v.dias as number)
    return { ...c, n: vs.length, nRast: rast.length, valor, valorRast, gasto, dias: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null }
  })
  return (
    <Card>
      <CardHeader title="Vendas do período por origem do cliente"
        subtitle="Pedidos fechados no período e de onde veio cada cliente — mesmo que ele tenha chegado antes (o contato leva em média 1 mês para virar pedido). Retorno = vendido ÷ gasto do mesmo período." />
      {vendas.length === 0 ? <p className="text-body text-ink-faint">Nenhum pedido no período.</p> : (
        <>
          <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            {blocos.filter(b => b.valor > 0).map(b => <div key={b.canal} style={{ width: `${(100 * b.valor) / Math.max(1, total)}%`, background: b.cor }} title={`${b.canal}: ${brl(b.valor)}`} />)}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {blocos.map(b => (
              <div key={b.canal} className="rounded-lg border border-border/60 bg-surface-2 p-3">
                <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-ink-faint"><span className="h-2 w-2 rounded-full" style={{ background: b.cor }} aria-hidden="true" />{b.canal}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{brl(b.valor)}</p>
                <p className="text-micro text-ink-muted">{n(b.n)} pedido{b.n === 1 ? '' : 's'} · {pct(div(100 * b.valor, total), 0)} do vendido</p>
                {b.gasto != null && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-micro">
                    <div><p className="text-ink-faint">Retorno (tudo)</p><p className="text-title font-semibold tabular-nums text-success">{vezes(div(b.valor, b.gasto))}</p></div>
                    <div><p className="text-ink-faint">Retorno só rastreado</p><p className="text-title font-semibold tabular-nums text-ink">{vezes(div(b.valorRast, b.gasto))}</p></div>
                    <p className="col-span-2 text-ink-muted">{brl(b.gasto)} gastos · {n(b.nRast)} rastreado{b.nRast === 1 ? '' : 's'} ({brl(b.valorRast)}){b.dias != null ? ` · ${b.dias} dias do contato à venda` : ''}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-micro text-ink-muted hover:text-ink">Ver os {n(vendas.length)} pedidos e como cada origem foi achada</summary>
            <div className="mt-2 max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[1100px] border-separate border-spacing-0">
                <thead className="sticky top-0 bg-surface">
                  <tr>{['Pedido', 'Data', 'Cliente', 'Vendedor', 'Valor', 'Origem', 'Como sabemos', 'Chegou em', 'Dias'].map((h, i) => (
                    <th key={h} scope="col" className={`${th} ${[4, 7, 8].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {vendas.map(v => (
                    <tr key={v.pedido}>
                      <td className={tdL}>{v.pedido}</td>
                      <td className={tdL}>{dataBr(v.data)}</td>
                      <td className={`${tdL} max-w-[16rem] truncate`} title={v.cliente ?? ''}>{v.cliente ?? '—'}</td>
                      <td className={tdL}>{v.vendedor ?? '—'}</td>
                      <td className={td}>{brl(v.valor)}</td>
                      <td className={tdL}><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CANAIS_VENDA.find(c => c.canal === v.canal)?.cor }} aria-hidden="true" />{v.canal}</span></td>
                      <td className={`${tdL} max-w-[22rem] truncate`} title={v.detalhe}>
                        <span className={`mr-1 rounded px-1 text-micro ${v.evidencia === 'rastreado' ? 'bg-success-bg text-success' : v.evidencia === 'declarado' ? 'bg-surface-2 text-ink-muted' : 'bg-warning-bg text-warning'}`}>{v.evidencia === 'rastreado' ? 'rastreado' : v.evidencia === 'declarado' ? 'vendedor marcou' : 'sem origem'}</span>{v.detalhe}
                      </td>
                      <td className={td}>{dataBr(v.chegou)}</td>
                      <td className={td}>{v.dias ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-micro text-ink-faint">
              Rastreado = o cliente chegou por anúncio no CRM, conversou com a Ana a partir de um anúncio, ou mandou o código do criativo (&NN) / a frase do site na 1ª mensagem ao vendedor (até 365 dias antes da venda).
              Vendedor marcou = a origem escolhida no pedido (Facebook/Instagram contam como Meta e podem incluir orgânico; Google/Site como Google).
            </p>
          </details>
        </>
      )}
    </Card>
  )
}

interface Problema { gravidade: 'alta' | 'atencao'; plataforma: string; titulo: string; detalhe: string }
/** O que precisa de atenção agora (anúncio reprovado, campanha que não gastou, carga atrasada) — RPC anuncios_problemas. */
function useProblemas() {
  return useQuery({
    queryKey: ['anuncios-problemas-v1'],
    queryFn: async () => {
      const r = await supabase.rpc('anuncios_problemas')
      if (r.error) throw r.error
      return linhas(r.data).map(x => ({ gravidade: x.gravidade === 'alta' ? 'alta' : 'atencao', plataforma: String(x.plataforma), titulo: String(x.titulo), detalhe: String(x.detalhe ?? '') }) as Problema)
        .sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === 'alta' ? -1 : 1))
    },
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  })
}

type Ordem = 'gasto' | 'qualificados' | 'cpq' | 'contatos'
const ORDENS: { v: Ordem; l: string }[] = [
  { v: 'gasto', l: 'Maior gasto' }, { v: 'qualificados', l: 'Mais qualificados' }, { v: 'cpq', l: 'Menor custo por qualificado' }, { v: 'contatos', l: 'Mais contatos' },
]
/** Compara duas linhas da árvore pela ordem escolhida (custo por qualificado: quem não tem qualificado vai pro fim). */
function comparar(o: Ordem, a: { gasto: number; f: Funil }, b: { gasto: number; f: Funil }) {
  if (o === 'qualificados') return b.f.qualificados - a.f.qualificados || b.gasto - a.gasto
  if (o === 'contatos') return b.f.contatos - a.f.contatos || b.gasto - a.gasto
  if (o === 'cpq') {
    const ca = a.f.qualificados ? a.gasto / a.f.qualificados : Infinity, cb = b.f.qualificados ? b.gasto / b.f.qualificados : Infinity
    return ca - cb || b.gasto - a.gasto
  }
  return b.gasto - a.gasto
}

function Situacao({ s }: { s: string | null }) {
  const t = situacaoCampanha(s)
  if (!t) return <span className="text-ink-faint">—</span>
  const cls = t === 'ativa' ? 'text-success border-success/40 bg-success-bg' : 'text-ink-faint border-border bg-surface-2'
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-micro ${cls}`}>{t}</span>
}

function Kpi({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-surface-2 px-3 py-2.5">
      <p className="text-micro text-ink-faint">{rotulo}</p>
      <p className="text-title font-semibold tabular-nums text-ink">{valor}</p>
      {apoio && <p className="mt-0.5 text-micro leading-snug text-ink-muted">{apoio}</p>}
    </div>
  )
}

/** Bloco grande do resumo do topo: total + Meta e Google lado a lado. */
function Tile({ rotulo, valor, meta, google, rodape, destaque }: { rotulo: string; valor: string; meta: string; google: string; rodape?: string; destaque?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border p-4 ${destaque ? 'border-accent/40 bg-accent-bg' : 'border-border bg-surface'}`}>
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-faint">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{valor}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-micro tabular-nums">
        <span className="inline-flex items-center gap-1 text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: COR_META }} aria-hidden="true" />Meta {meta}</span>
        <span className="inline-flex items-center gap-1 text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: COR_GOOGLE }} aria-hidden="true" />Google {google}</span>
      </div>
      {rodape && <p className="mt-1 text-micro text-ink-faint">{rodape}</p>}
    </div>
  )
}

/** Funil de um canal em barras horizontais: contatos → qualificados → falou c/ vendedor → orçamentos → vendas. */
function FunilCanal({ nome, cor, f, gasto, nota }: { nome: string; cor: string; f: Funil; gasto: number | null; nota?: string }) {
  const etapas: { l: string; v: number; extra?: string }[] = [
    { l: 'Contatos', v: f.contatos, extra: gasto ? `${cent(div(gasto, f.contatos))} cada` : undefined },
    { l: 'Qualificados', v: f.qualificados, extra: gasto ? `${cent(div(gasto, f.qualificados))} cada` : undefined },
    { l: 'Falou c/ vendedor', v: f.conversou },
    { l: 'Orçamentos', v: f.orcamentos, extra: f.orcamentos ? brl(f.rsOrcado) : undefined },
    { l: 'Vendas', v: f.vendas, extra: f.vendas ? brl(f.rsVendido) : undefined },
  ]
  const max = Math.max(1, f.contatos)
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-body font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: cor }} aria-hidden="true" />{nome}</p>
        {gasto != null && <p className="text-micro tabular-nums text-ink-faint">{brl(gasto)} gastos</p>}
      </div>
      <div className="space-y-1">
        {etapas.map((e, i) => (
          <div key={e.l} className="grid grid-cols-[7.5rem_1fr_11rem] items-center gap-2 text-micro">
            <span className="truncate text-ink-muted">{e.l}</span>
            <div className="h-5 overflow-hidden rounded bg-surface-2">
              {e.v > 0 ? (
                <div className="flex h-full items-center rounded px-1.5 text-[11px] font-semibold text-white tabular-nums"
                  style={{ width: `${Math.max(6, (100 * e.v) / max)}%`, background: cor, opacity: 1 - i * 0.13 }}>
                  {n(e.v)}
                </div>
              ) : <span className="flex h-full items-center px-1.5 text-[11px] text-ink-faint">0</span>}
            </div>
            <span className="truncate whitespace-nowrap text-right tabular-nums text-ink-faint">{[i > 0 && f.contatos ? pct(div(100 * e.v, f.contatos), 0) : '', e.extra ?? ''].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
      {nota && <p className="mt-1 text-micro text-ink-faint">{nota}</p>}
    </div>
  )
}

const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
const td = 'whitespace-nowrap border-t border-border px-2 py-1.5 text-body tabular-nums text-ink-muted text-right'
const tdL = 'whitespace-nowrap border-t border-border px-2 py-1.5 text-body tabular-nums text-ink-muted text-left'

interface Soma { gasto: number; impressoes: number; cliques: number; resultado: number }
const somar = (ls: LinhaMeta[]): Soma => ls.reduce((s, l) => ({ gasto: s.gasto + l.gasto, impressoes: s.impressoes + l.impressoes, cliques: s.cliques + l.cliques, resultado: s.resultado + l.resultado }), { gasto: 0, impressoes: 0, cliques: 0, resultado: 0 })

function Metricas({ s, tipo }: { s: Soma; tipo: string }) {
  return (
    <>
      <td className={td}>{brl(s.gasto)}</td>
      <td className={td}>{n(s.cliques)}</td>
      <td className={td}>{pct(div(100 * s.cliques, s.impressoes), 1)}</td>
      <td className={td}>{cent(div(s.gasto, s.cliques))}</td>
      <td className={td}>{n(s.resultado)} <span className="text-micro text-ink-faint">{tipo}</span></td>
      <td className={td}>{cent(div(s.gasto, s.resultado))}</td>
    </>
  )
}

/** Colunas do CRM numa linha da árvore: contatos → qualificados → orçamentos → vendas, e o custo por orçamento. */
function ColunasCrm({ f, gasto }: { f: Funil; gasto: number }) {
  const pq = div(100 * f.qualificados, f.contatos)
  return (
    <>
      <td className={`${td} border-l`}>{f.contatos ? n(f.contatos) : '—'}</td>
      <td className={td}>{f.contatos ? <>{n(f.qualificados)} <span className="text-micro text-ink-faint">{pct(pq, 0)}</span></> : '—'}</td>
      <td className={`${td} font-medium text-ink`} title="Gasto ÷ qualificados">{f.qualificados && gasto > 0 ? cent(div(gasto, f.qualificados)) : '—'}</td>
      <td className={td} title="O cliente respondeu ao vendedor ou deu informação de compra no WhatsApp dele">{f.contatos ? <>{n(f.conversou)} <span className="text-micro text-ink-faint">{pct(div(100 * f.conversou, f.contatos), 0)}</span></> : '—'}</td>
      <td className={td}>{f.orcamentos ? <>{n(f.orcamentos)} <span className="text-micro text-ink-faint">{brl(f.rsOrcado)}</span></> : (f.contatos ? '0' : '—')}</td>
      <td className={td}>{f.orcamentos && gasto > 0 ? cent(div(gasto, f.orcamentos)) : '—'}</td>
      <td className={td}>{f.vendas ? <span className="font-semibold text-success">{n(f.vendas)} · {brl(f.rsVendido)}</span> : (f.contatos ? '0' : '—')}</td>
      <td className={td} title="Clientes que já estavam no CRM e voltaram a chamar por este anúncio (não somam em contatos novos)">{f.voltaram ? n(f.voltaram) : '—'}</td>
    </>
  )
}

export function Anuncios() {
  const [periodo, setPeriodo] = useState<Periodo>(() => {
    try { const v = localStorage.getItem('anuncios-periodo'); return (PERIODOS.some(p => p.v === v) || v === 'custom' ? v : 'mes') as Periodo } catch { return 'mes' }
  })
  const escolher = (p: Periodo) => { setPeriodo(p); try { localStorage.setItem('anuncios-periodo', p) } catch { /* sem storage */ } }
  const [custom, setCustom] = useState<Personalizado>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('anuncios-personalizado') ?? 'null')
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.de) && /^\d{4}-\d{2}-\d{2}$/.test(v.ate)) return v as Personalizado
    } catch { /* sem storage */ }
    return personalizadoPadrao()
  })
  const mudarCustom = (c: Personalizado) => { setCustom(c); try { localStorage.setItem('anuncios-personalizado', JSON.stringify(c)) } catch { /* sem storage */ } }
  const iv = intervalo(periodo, custom)
  const rotuloPeriodo = periodo === 'custom'
    ? `${dataBr(custom.de)} a ${dataBr(custom.ate)}`
    : PERIODOS.find(x => x.v === periodo)?.l ?? ''
  const q = useDados(iv.from, iv.to)
  const prev = usePrevisaoMes()
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [soNoAr, setSoNoAr] = useState(false)
  const [ordem, setOrdem] = useState<Ordem>(() => {
    try { const v = localStorage.getItem('anuncios-ordem'); return (ORDENS.some(o => o.v === v) ? v : 'gasto') as Ordem } catch { return 'gasto' }
  })
  const escolherOrdem = (o: Ordem) => { setOrdem(o); try { localStorage.setItem('anuncios-ordem', o) } catch { /* sem storage */ } }
  const probs = useProblemas()
  // "onde pôr a verba": a mesma régua da aba Marketing, no período desta página
  // só depois dos dados principais: abrir a página disparava ~18 consultas juntas e o banco Micro engasgava (21/10)
  const rel = useMarketingRelatorioIntervalo(iv.from, iv.to, rotuloPeriodo, iv.to > new Date(), !!q.data && !q.isFetching)
  const alternar = (k: string) => setAbertos(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s })

  const arvore = useMemo(() => {
    const ls = (q.data?.metaLinhas ?? []).filter(l => !soNoAr || situacaoCampanha(l.campanhaStatus) === 'ativa')
    const camps = new Map<string, LinhaMeta[]>()
    for (const l of ls) camps.set(l.campanha, [...(camps.get(l.campanha) ?? []), l])
    return [...camps.entries()].map(([nome, cl]) => {
      const conj = new Map<string, LinhaMeta[]>()
      for (const l of cl) conj.set(l.conjunto, [...(conj.get(l.conjunto) ?? []), l])
      const funilDe = (ls: LinhaMeta[]) => somarFunil(ls.map(l => q.data?.porAd.get(l.adId) ?? FUNIL0))
      // landing page: contatos com origem "LP …" entram na campanha de cadastro correspondente
      const lp = (q.data?.porLp ?? []).filter(x => {
        const regra = LP_PARA_CAMPANHA.find(r => r.origem.test(x.origem))
        return regra ? regra.campanha.test(nome) : false
      }).map(x => x.funil)
      return {
        nome, linhas: cl, soma: somar(cl), funil: somarFunil([funilDe(cl), ...lp]), viaLp: lp.length > 0,
        conjuntos: [...conj.entries()].map(([cn, al]) => ({ nome: cn, linhas: al, soma: somar(al), funil: funilDe(al) }))
          .sort((a, b) => comparar(ordem, { gasto: a.soma.gasto, f: a.funil }, { gasto: b.soma.gasto, f: b.funil })),
      }
    }).sort((a, b) => comparar(ordem, { gasto: a.soma.gasto, f: a.funil }, { gasto: b.soma.gasto, f: b.funil }))
  }, [q.data?.metaLinhas, q.data?.porAd, q.data?.porLp, soNoAr, ordem])

  const d = q.data
  const googleLigado = !!d?.google.ate

  return (
    <div className="w-full space-y-5 p-4 md:p-6 2xl:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink"><Megaphone className="h-6 w-6 text-accent" aria-hidden="true" />Anúncios — Meta e Google</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-faint">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COR_META }} aria-hidden="true" />Meta atualizado {horaBr(d?.horaMeta ?? null)}</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COR_GOOGLE }} aria-hidden="true" />Google {googleLigado ? `atualizado ${horaBr(d!.horaGoogle)}` : 'ainda não ligado'}</span>
            <span>a página relê a cada 15 min{q.isFetching && ' · atualizando…'}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
            {PERIODOS.map(p => (
              <button key={p.v} type="button" onClick={() => escolher(p.v)} aria-pressed={periodo === p.v}
                className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1 text-micro md:min-h-0 ${periodo === p.v ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>
                {p.l}
              </button>
            ))}
            <button type="button" onClick={() => escolher('custom')} aria-pressed={periodo === 'custom'}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 py-1 text-micro md:min-h-0 ${periodo === 'custom' ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}>
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{periodo === 'custom' ? rotuloPeriodo : 'Personalizado'}
            </button>
          </div>
          {periodo === 'custom' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-micro text-ink-muted">
              <label className="inline-flex items-center gap-1">de
                <input type="date" value={custom.de} max={custom.ate} onChange={e => e.target.value && mudarCustom({ ...custom, de: e.target.value })}
                  className="rounded border border-border bg-surface px-1.5 py-0.5 text-micro text-ink" />
              </label>
              <label className="inline-flex items-center gap-1">até
                <input type="date" value={custom.ate} min={custom.de} max={isoDia(new Date())} onChange={e => e.target.value && mudarCustom({ ...custom, ate: e.target.value })}
                  className="rounded border border-border bg-surface px-1.5 py-0.5 text-micro text-ink" />
              </label>
            </div>
          )}
          <button type="button" onClick={() => { void q.refetch() }} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-border px-3 py-1 text-micro text-ink-muted hover:text-ink md:min-h-0" aria-label="Recarregar agora">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AbasAnuncios />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {prev.data && (
          <section className="rounded-xl border border-border bg-surface p-4 xl:col-span-5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-body font-semibold text-ink">Previsão de gasto em {prev.data.mes}</p>
              <p className="text-title font-semibold tabular-nums text-ink">{brl(prev.data.meta.previsto + prev.data.google.previsto)}</p>
            </div>
            <div className="mt-3 space-y-2.5">
              {([['Meta', prev.data.meta, COR_META], ['Google', prev.data.google, COR_GOOGLE]] as const).map(([nome, x, cor]) => (
                <div key={nome} title={`${brl(x.gasto)} gastos até ontem + ${brl(x.orcDia)}/dia (campanhas ativas) × ${prev.data!.restantes} dias que faltam, com hoje`}>
                  <div className="flex items-baseline justify-between text-micro">
                    <span className="font-semibold text-ink">{nome}</span>
                    <span className="tabular-nums text-ink-muted">{brl(x.gasto)} até ontem · <strong className="text-ink">{brl(x.previsto)}</strong> no mês</span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (100 * x.gasto) / Math.max(1, x.previsto))}%`, background: cor }} />
                  </div>
                  <p className="mt-0.5 text-micro text-ink-faint">+ {brl(x.orcDia)}/dia nas campanhas ativas × {prev.data!.restantes} dias que faltam</p>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className={`rounded-xl border p-4 ${prev.data ? 'xl:col-span-7' : 'xl:col-span-12'} ${(probs.data ?? []).some(x => x.gravidade === 'alta') ? 'border-danger/40 bg-danger-bg' : (probs.data ?? []).length ? 'border-warning/40 bg-warning-bg' : 'border-border bg-surface'}`}>
          <p className="flex items-center gap-2 text-body font-semibold text-ink">
            {(probs.data ?? []).length ? <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
            {probs.isLoading ? 'Conferindo as contas…' : (probs.data ?? []).length ? `Precisa de atenção (${(probs.data ?? []).length})` : 'Nada fora do normal nas contas'}
          </p>
          {(probs.data ?? []).length > 0 && (
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 lg:grid-cols-2">
              {(probs.data ?? []).map((x, i) => (
                <li key={i} className="flex min-w-0 items-start gap-2 text-micro">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-semibold ${x.gravidade === 'alta' ? 'bg-danger text-white' : 'bg-warning text-white'}`}>{x.plataforma}</span>
                  <span className="min-w-0"><span className="font-semibold text-ink">{x.titulo}</span><span className="block text-ink-muted">{x.detalhe}</span></span>
                </li>
              ))}
            </ul>
          )}
          {!probs.isLoading && !(probs.data ?? []).length && <p className="mt-1 text-micro text-ink-muted">Sem anúncio reprovado em conjunto ativo, sem campanha parada ontem e as cargas estão em dia.</p>}
        </section>
      </div>

      {q.error && !d ? (
        <Card><p className="text-body text-ink-muted">Não deu para carregar os anúncios agora. Tente o botão de recarregar.</p></Card>
      ) : !d ? (
        <Card><div className="h-40 animate-pulse rounded-lg bg-surface-2" /></Card>
      ) : (
        <div className={`space-y-5 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {/* Resumo geral: Meta + Google */}
          {(() => {
            const fm = d.meta.crm, fg = d.google.crm, gm = d.meta.gasto, gg = d.google.gasto
            const tot = { gasto: gm + gg, contatos: fm.contatos + fg.contatos, qualif: fm.qualificados + fg.qualificados, conv: fm.conversou + fg.conversou, orc: fm.orcamentos + fg.orcamentos, rsOrc: fm.rsOrcado + fg.rsOrcado, vendas: fm.vendas + fg.vendas, rsVend: fm.rsVendido + fg.rsVendido }
            // custo do total: só entra quem teve gasto no período (antes da carga do dia o Meta está em R$ 0 e os contatos dele
            // baratearam o Google: 22/10 cedo dava "R$ 4,36 por contato" = gasto do Google ÷ contatos do Meta)
            const comGasto = (m: number, g: number) => (gm > 0 ? m : 0) + (gg > 0 ? g : 0)
            // a carga do Meta roda 8h30, 12h30 e 15h30: o fim do período pode ainda não ter gasto
            const ultimoDia = isoDia(new Date(iv.to.getTime() - 1))
            const metaAtrasado = !!d.meta.ate && d.meta.ate < ultimoDia
            const voltaram = d.voltaram.Meta + d.voltaram.Site
            return (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Tile rotulo="Investido" valor={brl(tot.gasto)} meta={brl(gm)} google={brl(gg)}
                  rodape={metaAtrasado ? `Meta carregado até ${dataBr(d.meta.ate!)} (o servidor relê de hora em hora) · sem a vaga de emprego` : 'sem a vaga de emprego'} />
                <Tile rotulo="Contatos" valor={n(tot.contatos)} meta={`${n(fm.contatos)} · ${custo(gm, fm.contatos)}`} google={`${n(fg.contatos)} · ${custo(gg, fg.contatos)}`} rodape={`${cent(div(tot.gasto, comGasto(fm.contatos, fg.contatos)))} por contato${voltaram ? ` · +${n(voltaram)} clientes antigos voltaram` : ''}`} />
                <Tile destaque rotulo="Qualificados" valor={`${n(tot.qualif)} · ${pct(div(100 * tot.qualif, tot.contatos), 0)}`} meta={`${n(fm.qualificados)} · ${custo(gm, fm.qualificados)}`} google={`${n(fg.qualificados)} · ${custo(gg, fg.qualificados)}`} rodape={`${cent(div(tot.gasto, comGasto(fm.qualificados, fg.qualificados)))} por qualificado`} />
                <Tile rotulo="Falaram c/ vendedor" valor={`${n(tot.conv)} · ${pct(div(100 * tot.conv, tot.contatos), 0)}`} meta={n(fm.conversou)} google={n(fg.conversou)} rodape="responderam no WhatsApp do vendedor" />
                <Tile rotulo="Orçamentos" valor={n(tot.orc)} meta={`${n(fm.orcamentos)} · ${custo(gm, fm.orcamentos)}`} google={`${n(fg.orcamentos)} · ${custo(gg, fg.orcamentos)}`} rodape={`${brl(tot.rsOrc)} orçados`} />
                {(() => {
                  const vm = d.vendas.filter(v => v.canal === 'Meta').reduce((a, v) => a + v.valor, 0)
                  const vg = d.vendas.filter(v => v.canal === 'Google / Site').reduce((a, v) => a + v.valor, 0)
                  return <Tile rotulo="Vendido por anúncio" valor={brl(vm + vg)} meta={`${brl(vm)} · ${vezes(div(vm, gm))}`} google={`${brl(vg)} · ${vezes(div(vg, gg))}`}
                    rodape={`retorno ${vezes(div(comGasto(vm, vg), tot.gasto))} no período · pedidos do período`} />
                })()}
              </div>
            )
          })()}

          {/* Funil por canal + dia a dia */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card className="xl:col-span-5">
              <CardHeader title="Funil por canal" subtitle="Dos contatos que chegaram no período: quantos qualificaram, falaram com o vendedor, viraram orçamento e venda." />
              <div className="space-y-5">
                <FunilCanal nome="Meta Ads" cor={COR_META} f={d.meta.crm} gasto={d.meta.gasto}
                  nota={d.voltaram.Meta ? `+${n(d.voltaram.Meta)} clientes antigos do Meta voltaram a falar no período (não somam nos contatos).` : undefined} />
                <FunilCanal nome="Google Ads / Site" cor={COR_GOOGLE} f={d.google.crm} gasto={d.google.gasto}
                  nota={d.siteOrigem.length ? `Origem: ${d.siteOrigem.map(x => `${x.origem} ${n(x.funil.contatos)}`).join(' · ')}. Desde 21/10 o site diz de onde veio a visita (Google Ads, busca, Instagram, YouTube, ChatGPT, e-mail…).${d.voltaram.Site ? ` +${n(d.voltaram.Site)} clientes antigos do site voltaram a falar.` : ''}` : undefined} />
                {d.outros.contatos > 0 && <FunilCanal nome="Outros (orgânico, LP, indicação…)" cor={CHART.s5} f={d.outros} gasto={null} />}
              </div>
            </Card>
            <Card className="flex flex-col xl:col-span-7">
              <CardHeader title="Dia a dia" subtitle="Gasto de cada plataforma (barras) e contatos que chegaram no CRM (linhas)." />
              <div className="min-h-80 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={d.dias.map(x => ({ ...x, rotulo: x.dia.slice(8, 10) + '/' + x.dia.slice(5, 7) }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fill: CHART.ink, fontSize: 11 }} />
                    <YAxis yAxisId="r" tick={{ fill: CHART.ink, fontSize: 11 }} tickFormatter={v => `R$ ${Math.round(Number(v))}`} width={64} />
                    <YAxis yAxisId="c" orientation="right" tick={{ fill: CHART.ink, fontSize: 11 }} width={32} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, nome) => (String(nome).startsWith('Gasto') ? brl(Number(v)) : n(Number(v)))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="r" dataKey="gastoMeta" name="Gasto Meta Ads" fill={COR_META} maxBarSize={18} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Bar yAxisId="r" dataKey="gastoGoogle" name="Gasto Google Ads" fill={COR_GOOGLE} maxBarSize={18} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Line yAxisId="c" dataKey="contatosMeta" name="Contatos do Meta" stroke={CHART.s1} strokeWidth={2} dot={d.dias.length < 3} isAnimationActive={false} />
                    <Line yAxisId="c" dataKey="contatosSite" name="Contatos do Site" stroke={CHART.s4} strokeWidth={2} dot={d.dias.length < 3} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <VendasOrigem vendas={d.vendas} gastoMeta={d.meta.gasto} gastoGoogle={d.google.gasto} />

          {/* Detalhe por plataforma */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <p className="mb-3 flex items-center gap-2 text-body font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_META }} aria-hidden="true" />Meta Ads</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4">
                <Kpi rotulo="Gasto (vendas)" valor={brl(d.meta.gasto)} apoio={`${d.meta.orcDia ? `${brl(d.meta.orcDia)}/dia nas campanhas ativas` : ''}${d.vagaSoma.gasto > 0 ? ` · sem a vaga de emprego (${brl(d.vagaSoma.gasto)})` : ''}`} />
                <Kpi rotulo="Conversas iniciadas" valor={n(d.meta.conversas)} apoio={`${cent(div(d.meta.gastoConversas, d.meta.conversas))} cada (gasto só das campanhas de mensagem)`} />
                <Kpi rotulo="Cliques" valor={n(d.meta.cliques)} apoio={`CTR ${pct(div(100 * d.meta.cliques, d.meta.impressoes), 1)} · CPC ${custo(d.meta.gasto, d.meta.cliques)}`} />
                <Kpi rotulo="Contatos" valor={n(d.meta.crm.contatos)} apoio={`${custo(d.meta.gasto, d.meta.crm.contatos)} por contato · ${n(d.meta.crm.soAna)} ficaram só com a Ana`} />
                <Kpi rotulo="Qualificados" valor={`${n(d.meta.crm.qualificados)} · ${pct(div(100 * d.meta.crm.qualificados, d.meta.crm.contatos), 0)}`} apoio={`${custo(d.meta.gasto, d.meta.crm.qualificados)} por qualificado`} />
                <Kpi rotulo="Falaram com o vendedor" valor={`${n(d.meta.crm.conversou)} · ${pct(div(100 * d.meta.crm.conversou, d.meta.crm.contatos), 0)}`} apoio="responderam ou deram informação no WhatsApp do vendedor" />
                <Kpi rotulo="Viraram orçamento" valor={n(d.meta.crm.orcamentos)} apoio={`${custo(d.meta.gasto, d.meta.crm.orcamentos)} por orçamento · ${brl(d.meta.crm.rsOrcado)} orçados`} />
                <Kpi rotulo="Vendas" valor={n(d.meta.crm.vendas)} apoio={d.meta.crm.vendas ? `${brl(d.meta.crm.rsVendido)} vendidos` : 'destes contatos, até agora'} />
              </div>
            </Card>
            <Card>
              <p className="mb-3 flex items-center gap-2 text-body font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COR_GOOGLE }} aria-hidden="true" />Google Ads</p>
              {googleLigado ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4">
                  <Kpi rotulo="Gasto" valor={brl(d.google.gasto)} />
                  <Kpi rotulo="Cliques" valor={n(d.google.cliques)} apoio={`CTR ${pct(div(100 * d.google.cliques, d.google.impressoes), 1)} · CPC ${custo(d.google.gasto, d.google.cliques)}`} />
                  <Kpi rotulo="Conversões do Google" valor={n(d.google.conversoes)} apoio={`${n(d.google.conversoes - d.google.conversoesYoutube)} da pesquisa (clique no WhatsApp do site, formulário e outras)${d.google.conversoesYoutube ? ` · ${n(d.google.conversoesYoutube)} do YouTube (inscrição/engajamento)` : ''}`} />
                  <Kpi rotulo="Contatos do Site no CRM" valor={n(d.google.crm.contatos)} apoio={`${custo(d.google.gasto, d.google.crm.contatos)} por contato (site inclui orgânico)`} />
                  <Kpi rotulo="Qualificados" valor={`${n(d.google.crm.qualificados)} · ${pct(div(100 * d.google.crm.qualificados, d.google.crm.contatos), 0)}`} apoio={`${custo(d.google.gasto, d.google.crm.qualificados)} por qualificado · lido na conversa`} />
                  <Kpi rotulo="Resposta do vendedor" valor={d.google.crm.respMedH != null ? horas(d.google.crm.respMedH) : '—'} apoio={`até a 1ª mensagem (mediana)${d.google.crm.semResposta ? ` · ${n(d.google.crm.semResposta)} sem resposta` : ' · todos respondidos'}`} />
                  <Kpi rotulo="Viraram orçamento" valor={n(d.google.crm.orcamentos)} apoio={`${custo(d.google.gasto, d.google.crm.orcamentos)} por orçamento · ${brl(d.google.crm.rsOrcado)} orçados`} />
                  <Kpi rotulo="Vendas" valor={n(d.google.crm.vendas)} apoio={d.google.crm.vendas ? `${brl(d.google.crm.rsVendido)} vendidos` : 'destes contatos, até agora'} />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-body text-ink-muted">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    O Google ainda não manda dados. Falta colar o script do CRM na conta Google Ads (Ferramentas → Ações em massa → Scripts → “+”), autorizar e pôr para rodar todo dia.
                    Enquanto isso: o Site trouxe <strong className="text-ink">{n(d.google.crm.contatos)} contatos</strong> e <strong className="text-ink">{n(d.google.crm.orcamentos)} orçamentos</strong> no período.
                  </span>
                </div>
              )}
            </Card>
          </div>

          {rel.data ? (
            <div className={`space-y-5 ${rel.isPlaceholderData ? 'opacity-60' : ''}`}>
              <AnunciosVerbaCard rel={rel.data} titulo="Anúncios do Meta: onde pôr a verba" />
              <MotivosCard rel={rel.data} titulo="Por que os atendimentos fecham — por canal e por criativo" porCriativo />
              <VendedoresCard rel={rel.data} titulo="O contato chega bem atendido? — por vendedor" />
            </div>
          ) : rel.isLoading ? <Card><div className="h-32 animate-pulse rounded-lg bg-surface-2" /></Card> : null}

          {/* Meta em árvore */}
          <Card>
            <CardHeader
              title="Meta: campanha → conjunto → anúncio"
              subtitle="Clique na campanha para abrir os conjuntos, e no conjunto para ver os anúncios. O resultado segue o objetivo de cada campanha."
              right={
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-micro text-ink-muted">
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Ordenar por</span>
                    <select value={ordem} onChange={e => escolherOrdem(e.target.value as Ordem)} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-micro text-ink">
                      {ORDENS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2 text-micro text-ink-muted">
                    <input type="checkbox" checked={soNoAr} onChange={e => setSoNoAr(e.target.checked)} /> só campanhas ativas
                  </label>
                </div>
              }
            />
            {arvore.length === 0 ? <p className="text-body text-ink-faint">Nenhum gasto no Meta no período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1540px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th colSpan={9} />
                      <th colSpan={8} className="border-l border-border px-2 pb-1 text-left text-micro font-semibold uppercase tracking-wide text-ink-faint">No CRM (contatos que chegaram no período)</th>
                    </tr>
                    <tr>
                      {['Nome', 'Situação', 'Orçamento/dia', 'Gasto', 'Cliques', 'CTR', 'CPC', 'Resultado', 'Custo/resultado', 'Contatos', 'Qualificados', 'Custo/qualif.', 'Falou c/ vendedor', 'Orçamentos', 'Custo/orçamento', 'Vendas', 'Voltaram'].map((h, i) => (
                        <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'} ${i === 9 ? 'border-l border-border' : ''}`}>{h}</th>
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
                              {naoEhVenda(c.nome) && <span className="ml-2 rounded bg-surface-2 px-1 text-micro font-normal text-ink-faint">não é de venda</span>}
                              {c.viaLp && <span className="ml-2 rounded bg-surface-2 px-1 text-micro font-normal text-ink-faint" title="Contatos da landing page ligados pela origem do CRM">contatos via LP{c.funil.respMedH != null ? ` · 1ª resposta do vendedor em ${horas(c.funil.respMedH)}` : ''}</span>}
                              {c.funil.semResposta > 0 && <span className="ml-2 rounded bg-danger/10 px-1 text-micro font-semibold text-danger" title="O cliente escreveu e nenhum vendedor respondeu até agora">{n(c.funil.semResposta)} sem resposta do vendedor</span>}
                            </th>
                            <td className="border-t border-border px-2 py-1.5"><Situacao s={l0.campanhaStatus} /></td>
                            <td className={td}>{l0.campanhaOrc != null ? brl(l0.campanhaOrc) : '—'}</td>
                            <Metricas s={c.soma} tipo={l0.resultadoTipo} />
                            <ColunasCrm f={c.funil} gasto={c.soma.gasto} />
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
                                  <ColunasCrm f={cj.funil} gasto={cj.soma.gasto} />
                                </tr>
                                {abj && [...cj.linhas].sort((a, b) => comparar(ordem, { gasto: a.gasto, f: d.porAd.get(a.adId) ?? FUNIL0 }, { gasto: b.gasto, f: d.porAd.get(b.adId) ?? FUNIL0 })).map(a => {
                                  const fa = d.porAd.get(a.adId) ?? FUNIL0
                                  return (
                                    <tr key={a.adId}>
                                      <th scope="row" className="border-t border-border py-1.5 pl-14 pr-2 text-left text-body font-normal text-ink-muted">
                                        {a.anuncio}{a.codigo && <span className="ml-2 rounded bg-surface-2 px-1 text-micro text-ink">{a.codigo}</span>}
                                      </th>
                                      <td className="border-t border-border px-2 py-1.5"><Situacao s={a.anuncioStatus} /></td>
                                      <td className={td}>—</td>
                                      <Metricas s={a} tipo={a.resultadoTipo} />
                                      <ColunasCrm f={fa} gasto={a.gasto} />
                                    </tr>
                                  )
                                })}
                              </Fragment>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                    {d.semAnuncioMeta.contatos > 0 && (
                      <tr>
                        <th scope="row" className="border-t-2 border-border px-2 py-1.5 text-left text-body font-medium text-ink-muted" title="Contatos com origem Meta que não passaram pela Ana (ou a conversa não guardou o anúncio): o CRM sabe que vieram do Meta, mas não de qual anúncio">
                          Contatos do Meta sem anúncio identificado
                        </th>
                        <td className="border-t-2 border-border" colSpan={8} />
                        <ColunasCrm f={d.semAnuncioMeta} gasto={0} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <details className="mt-3 text-micro text-ink-faint">
              <summary className="cursor-pointer select-none text-ink-muted hover:text-ink">Como os números são calculados</summary>
              <p className="mt-2 leading-relaxed">
              No CRM: o contato é ligado ao anúncio exato pela conversa da Ana (ela guarda de qual anúncio o cliente veio).
              Qualificado = a Ana passou ao vendedor, ou o vendedor marcou avanço (lead quente, follow-up, agendamento, orçamento), ou virou orçamento — e não foi marcado “não fabricamos”/“outro assunto”.
              Vendas = pedidos nascidos dos orçamentos desses contatos (venda costuma demorar: períodos curtos quase sempre mostram 0).
              Contatos incluem quem conversou com a Ana por anúncio e nunca foi passado ao vendedor ({n(d.meta.crm.soAna)} no período) — sem eles o “% qualificados” ficava inflado.
              Landing page e site vão direto ao vendedor (sem a Ana): para eles, qualificado é lido na conversa do WhatsApp do vendedor — o cliente deu informação de compra (espécie, rebanho, kg, energia, preço, pagamento, frete, cidade…) ou respondeu 2+ vezes ao vendedor; a mensagem pronta da página não conta. No Meta também vale quem conversou assim com o vendedor, mesmo sem etiqueta.
              “Falou c/ vendedor” = o cliente respondeu ao vendedor ou deu informação de compra no WhatsApp dele (a conversa com a Ana não conta).
              “Voltaram” = clientes que já estavam no CRM e chamaram de novo pelo anúncio. Contatos de landing page entram na campanha de cadastro pela origem do CRM.
              Situação e orçamento/dia vêm do Gerenciador na última carga. Custo/qualif. = gasto ÷ qualificados.
              </p>
            </details>
          </Card>

          {d.pedidosSemOrc.length > 0 && (
            <Card>
              <CardHeader title="Para corrigir: pedidos com orçamento que não existe" subtitle="O número de orçamento no pedido não bate com nenhum orçamento do sistema — essa venda não se liga ao contato nem ao anúncio. Corrigir o número no pedido." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-separate border-spacing-0">
                  <thead><tr>{['Pedido', 'Nº de orçamento no pedido', 'Vendedor', 'Data', 'Valor'].map((h, i) => <th key={h} className={`${th} ${i < 3 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.pedidosSemOrc.map(x => (
                      <tr key={String(x.pedido)}>
                        <td className={tdL}>{String(x.pedido)}</td>
                        <td className={tdL}>{String(x.numero_orcamento)}</td>
                        <td className={tdL}>{String(x.vendedor ?? '—')}</td>
                        <td className={td}>{dataBr(txt(x.data_venda))}</td>
                        <td className={td}>{brl(num(x.valor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Google */}
          <Card>
            <CardHeader title="Google: campanha → grupo de anúncios" subtitle="Gasto, cliques e conversões da conta BRANORTE-ADS no período. No CRM: contatos ligados à campanha pelo código do clique que o site põe na mensagem do WhatsApp (começa em 21/10)." />
            {!googleLigado ? (
              <p className="text-body text-ink-faint">Aparece assim que o script do CRM rodar na conta do Google Ads.</p>
            ) : (
              <TabelaGoogle linhas={d.google.linhas} abertos={abertos} alternar={alternar} porCamp={d.porGoogleCamp} />
            )}
          </Card>

          {googleLigado && (d.google.palavras.length > 0 || d.google.termos.length > 0) && (
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
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

function TabelaGoogle({ linhas: ls, abertos, alternar, porCamp }: { linhas: Record<string, unknown>[]; abertos: Set<string>; alternar: (k: string) => void; porCamp: Map<string, Funil> }) {
  const crm = (f: Funil | undefined, gasto: number) => (
    <>
      <td className={`${td} border-l`}>{f?.contatos ? n(f.contatos) : '—'}</td>
      <td className={td}>{f?.contatos ? <>{n(f.qualificados)} <span className="text-micro text-ink-faint">{pct(div(100 * f.qualificados, f.contatos), 0)}</span></> : '—'}</td>
      <td className={`${td} font-medium text-ink`}>{f?.qualificados && gasto > 0 ? cent(div(gasto, f.qualificados)) : '—'}</td>
      <td className={td}>{f?.orcamentos ? <>{n(f.orcamentos)} <span className="text-micro text-ink-faint">{brl(f.rsOrcado)}</span></> : (f?.contatos ? '0' : '—')}</td>
      <td className={td}>{f?.vendas ? <span className="font-semibold text-success">{n(f.vendas)} · {brl(f.rsVendido)}</span> : (f?.contatos ? '0' : '—')}</td>
    </>
  )
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
      <table className="w-full min-w-[1380px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th colSpan={10} />
            <th colSpan={5} className="border-l border-border px-2 pb-1 text-left text-micro font-semibold uppercase tracking-wide text-ink-faint">No CRM (contatos que chegaram no período)</th>
          </tr>
          <tr>
            {['Nome', 'Situação', 'Orçamento/dia', 'Gasto', 'Impressões', 'Cliques', 'CTR', 'CPC', 'Conversões', 'Custo/conversão', 'Contatos', 'Qualificados', 'Custo/qualif.', 'Orçamentos', 'Vendas'].map((h, i) => (
              <th key={h} scope="col" className={`${th} ${i < 2 ? 'text-left' : 'text-right'} ${i === 10 ? 'border-l border-border' : ''}`}>{h}</th>
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
                  {crm(porCamp.get(String(c.campanha)), num(c.gasto))}
                </tr>
                {ab && gs.map(g => (
                  <tr key={k + String(g.grupo)}>
                    <th scope="row" className="border-t border-border py-1.5 pl-8 pr-2 text-left text-body font-normal text-ink-muted">{String(g.grupo)}</th>
                    <td className="border-t border-border px-2 py-1.5"><Situacao s={txt(g.grupo_status)} /></td>
                    <td className={td}>—</td>
                    {met(g)}
                    <td className={`${td} border-l`} colSpan={5} />
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
    <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
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
