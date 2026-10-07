import type { RastreioVenda } from '@/hooks/useControleRastreio'
import {
  ORIGEM_NAO_INFORMADA, chaveOrigemRastreada, origemFinalVenda, rotuloOrigemVenda,
  type BaseOrigem, type ConferenciaOrigem,
} from '@/lib/vendas-origem'

// ───────────────────────────────────────────────────────────────────────────
// Relatório "Origem das vendas" pra GESTÃO DE TRÁFEGO (pedido do Daniel, 07/10/2026).
//
// Parte PURA: recebe as linhas do rastreio (RPC controle_vendas_rastreio) e devolve
// os números do relatório. Quem desenha é lib/rastreio-origem-pdf.ts.
//
// ⚠️ O documento sai da empresa (vai pro gestor de tráfego): aqui NÃO entra nome
// nem telefone de cliente. A linha da venda leva pedido, data, UF, valor e origem.
//
// A origem de cada venda é a MESMA do Painel de Vendas e da tela de rastreio
// (origemFinalVenda). O relatório nunca recalcula por conta própria.
// ───────────────────────────────────────────────────────────────────────────

/** Como a origem daquela venda foi conhecida — é o que diz ao gestor quanto confiar no número. */
export const ROTULO_BASE: Record<BaseOrigem, string> = {
  rastreio: 'Rastreio',
  vendedor: 'Vendedor',
  historico: 'Pedido anterior',
  porta: 'Porta de entrada',
  nenhuma: 'Sem origem',
}

export interface LinhaVendaRelatorio {
  pedido: string
  data: string            // 'YYYY-MM-DD'
  uf: string              // 'SC' | '—'
  valor: number
  origem: string          // rótulo da origem que vale
  chaveOrigem: string
  base: BaseOrigem
  conferencia: ConferenciaOrigem
  /** O que o vendedor marcou (rótulo) ou '—'. */
  vendedorMarcou: string
  /** O que o rastreio achou (rótulo) ou '—'. */
  rastreioAchou: string
  codigoAnuncio: string   // '&50' | ''
  anuncio: string         // nome do anúncio | ''
  chegouEm: string        // 'YYYY-MM-DD' (fuso de Brasília) | ''
  /** Dias corridos entre a chegada rastreada e a venda; null sem chegada. */
  diasAteVenda: number | null
}

export interface OrigemRelatorio {
  chave: string
  origem: string
  vendas: number
  valor: number
  pctValor: number        // 0..100 sobre o faturamento do período
  ticketMedio: number
  porRastreio: number
  porVendedor: number
  /** Média de dias entre chegada e venda, só das vendas rastreadas desta origem; null sem nenhuma. */
  diasMedios: number | null
}

export interface AnuncioRelatorio {
  codigo: string
  anuncio: string
  origem: string
  vendas: number
  valor: number
  ticketMedio: number
  diasMedios: number | null
}

export interface RelatorioOrigem {
  total: { vendas: number; valor: number; ticketMedio: number }
  /** Origem conhecida por qualquer caminho (tudo menos "Sem origem"). */
  comOrigem: { vendas: number; valor: number }
  /** Só o que o rastreio pelo telefone comprovou. */
  rastreadas: { vendas: number; valor: number; pctVendas: number; pctValor: number }
  conferem: number
  divergem: number
  origens: OrigemRelatorio[]
  anuncios: AnuncioRelatorio[]
  /** Vendas em que o rastreio achou um canal e o vendedor marcou outro. */
  divergentes: LinhaVendaRelatorio[]
  vendas: LinhaVendaRelatorio[]
}

/** Data (Brasília) de um timestamptz, sem depender do fuso de quem gera o PDF. */
export function diaBrasilia(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Dias corridos entre dois dias 'YYYY-MM-DD' (b - a). Negativo vira 0: chegada no dia da venda. */
export function diasEntre(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(a), pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(b)
  if (!pa || !pb) return null
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]), tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3])
  return Math.max(0, Math.round((tb - ta) / 86_400_000))
}

function media(ns: number[]): number | null {
  return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null
}

/**
 * Monta os números do relatório. `ufPorPedido` vem do espelho de pedidos (a RPC do
 * rastreio não devolve UF); pedido sem UF aparece com '—'.
 */
export function montarRelatorioOrigem(
  linhas: readonly RastreioVenda[],
  ufPorPedido: ReadonlyMap<string, string | null | undefined> = new Map(),
): RelatorioOrigem {
  const vendas: LinhaVendaRelatorio[] = linhas.map(v => {
    const o = origemFinalVenda(v)
    const rastreada = chaveOrigemRastreada(v.chegada_origem)
    const chegouEm = o.base === 'rastreio' || o.base === 'porta' ? diaBrasilia(v.chegada_em) : ''
    return {
      pedido: v.pedido_numero ?? '—',
      data: (v.data_venda ?? '').slice(0, 10),
      uf: (ufPorPedido.get(v.pedido_id) ?? '').trim().toUpperCase() || '—',
      valor: Number(v.valor) || 0,
      origem: o.rotulo,
      chaveOrigem: o.chave,
      base: o.base,
      conferencia: o.conferencia,
      vendedorMarcou: o.declarada === ORIGEM_NAO_INFORMADA ? '—' : rotuloOrigemVenda(o.declarada),
      rastreioAchou: rastreada ? rotuloOrigemVenda(rastreada) : '—',
      // anúncio só vale como dado do relatório quando a origem que vale É a do rastreio
      codigoAnuncio: o.base === 'rastreio' ? (v.chegada_criativo ?? '').trim() : '',
      anuncio: o.base === 'rastreio' ? (v.chegada_anuncio ?? '').trim() : '',
      chegouEm,
      diasAteVenda: chegouEm ? diasEntre(chegouEm, (v.data_venda ?? '').slice(0, 10)) : null,
    }
  })
  // mais recente primeiro; empate pelo número do pedido (ordem estável entre exportações)
  vendas.sort((a, b) => b.data.localeCompare(a.data) || b.pedido.localeCompare(a.pedido))

  const valorTotal = vendas.reduce((s, v) => s + v.valor, 0)
  const total = { vendas: vendas.length, valor: valorTotal, ticketMedio: vendas.length ? valorTotal / vendas.length : 0 }
  const comOrigemL = vendas.filter(v => v.base !== 'nenhuma')
  const rastreadasL = vendas.filter(v => v.base === 'rastreio')
  const valorRastreado = rastreadasL.reduce((s, v) => s + v.valor, 0)

  const mapaO = new Map<string, LinhaVendaRelatorio[]>()
  for (const v of vendas) { const l = mapaO.get(v.chaveOrigem); if (l) l.push(v); else mapaO.set(v.chaveOrigem, [v]) }
  const origens: OrigemRelatorio[] = Array.from(mapaO.entries()).map(([chave, l]) => {
    const valor = l.reduce((s, v) => s + v.valor, 0)
    const dias = l.filter(v => v.base === 'rastreio' && v.diasAteVenda !== null).map(v => v.diasAteVenda as number)
    return {
      chave, origem: l[0].origem, vendas: l.length, valor,
      pctValor: valorTotal > 0 ? (valor / valorTotal) * 100 : 0,
      ticketMedio: valor / l.length,
      porRastreio: l.filter(v => v.base === 'rastreio').length,
      porVendedor: l.filter(v => v.base === 'vendedor').length,
      diasMedios: media(dias),
    }
  }).sort((a, b) => {
    const aSem = a.chave === ORIGEM_NAO_INFORMADA, bSem = b.chave === ORIGEM_NAO_INFORMADA
    if (aSem !== bSem) return aSem ? 1 : -1
    return b.valor - a.valor || b.vendas - a.vendas || a.origem.localeCompare(b.origem, 'pt-BR')
  })

  // Anúncio = venda rastreada que trouxe código OU nome. Agrupa pelo código quando há; senão pelo nome.
  const mapaA = new Map<string, LinhaVendaRelatorio[]>()
  for (const v of rastreadasL) {
    if (!v.codigoAnuncio && !v.anuncio) continue
    const k = v.codigoAnuncio || `nome:${v.anuncio.toLowerCase()}`
    const l = mapaA.get(k); if (l) l.push(v); else mapaA.set(k, [v])
  }
  const anuncios: AnuncioRelatorio[] = Array.from(mapaA.values()).map(l => {
    const valor = l.reduce((s, v) => s + v.valor, 0)
    const dias = l.filter(v => v.diasAteVenda !== null).map(v => v.diasAteVenda as number)
    return {
      codigo: l[0].codigoAnuncio || '—',
      anuncio: l.find(v => v.anuncio)?.anuncio || '(sem nome no catálogo)',
      origem: l[0].origem,
      vendas: l.length, valor, ticketMedio: valor / l.length, diasMedios: media(dias),
    }
  }).sort((a, b) => b.valor - a.valor || b.vendas - a.vendas || a.codigo.localeCompare(b.codigo))

  return {
    total,
    comOrigem: { vendas: comOrigemL.length, valor: comOrigemL.reduce((s, v) => s + v.valor, 0) },
    rastreadas: {
      vendas: rastreadasL.length, valor: valorRastreado,
      pctVendas: vendas.length ? (rastreadasL.length / vendas.length) * 100 : 0,
      pctValor: valorTotal > 0 ? (valorRastreado / valorTotal) * 100 : 0,
    },
    conferem: vendas.filter(v => v.conferencia === 'confere').length,
    divergem: vendas.filter(v => v.conferencia === 'diverge').length,
    origens, anuncios,
    divergentes: vendas.filter(v => v.conferencia === 'diverge'),
    vendas,
  }
}
