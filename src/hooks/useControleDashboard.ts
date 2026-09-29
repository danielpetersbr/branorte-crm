import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subMonths, format,
} from 'date-fns'
import {
  ORIGEM_TODAS, ehPedidoGarantia, filtrarPorOrigem, resumirOrigens,
  type OrigemResumo, type ResumoOrigens,
} from '@/lib/vendas-origem'

// ───────────────────────────────────────────────────────────────────────────
// Espelho do dashboard do controle.branorte.com — lê SOMENTE das mirror_* no
// nosso Supabase (preenchidas pelo job sync_controle_mirror.py). A lógica de
// valor replica EXATO a do controle (buscar-pedidos): exclui CANCELADO,
// precedência payment_plan_json.total > valor_total, ajuste por data de
// competência, e split 50/50 quando há vendedor_2.
// Validado jun/2026: PEDRO 322.619 (113,2%) / RAMON 2.856 (1,0%).
// ───────────────────────────────────────────────────────────────────────────

export type Periodo = 'hoje' | 'semana' | 'mes'

interface MirrorPedido {
  vendedor: string | null
  vendedor_2: string | null
  valor_total: number | null
  ajuste_valor: number | null
  ajuste_data: string | null
  data_venda: string | null
  status: string | null
  payment_plan_json: { total?: number | string } | null
  /** "Como o cliente encontrou a empresa?" do pedido — vem de raw->>'fonte_origem' (ver lib/vendas-origem). */
  fonte_origem: string | null
}

const EXCLUIR_VENDEDOR = new Set(['DESCONHECIDO'])
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function baseValue(p: MirrorPedido): number {
  const raw = p.payment_plan_json?.total
  const paymentTotal = raw != null ? Number(raw) : 0
  return paymentTotal > 0 ? paymentTotal : Number(p.valor_total) || 0
}

/** Valor do pedido atribuído ao período [from,to] (datas 'YYYY-MM-DD'). */
function valorNoPeriodo(p: MirrorPedido, from: string, to: string): number {
  if ((p.status || '') === 'CANCELADO') return 0
  const dv = (p.data_venda || '').slice(0, 10)
  const ad = (p.ajuste_data || '').slice(0, 10)
  const ajuste = Number(p.ajuste_valor) || 0
  const base = baseValue(p)
  let v = 0
  if (dv && dv >= from && dv <= to) {
    v += base
    if (!ad && ajuste !== 0) v += ajuste
  }
  if (ad && ajuste !== 0 && ad >= from && ad <= to) v += ajuste
  return v
}

function dateRange(periodo: Periodo): { from: string; to: string } {
  const now = new Date()
  let f: Date, t: Date
  if (periodo === 'hoje') { f = startOfDay(now); t = endOfDay(now) }
  else if (periodo === 'semana') { f = startOfWeek(now, { weekStartsOn: 1 }); t = endOfWeek(now, { weekStartsOn: 1 }) }
  else { f = startOfMonth(now); t = endOfMonth(now) }
  return { from: format(f, 'yyyy-MM-dd'), to: format(t, 'yyyy-MM-dd') }
}

export interface VendedorRanking {
  vendedor: string
  realizado: number
  vendas: number
  pctCorrida: number
}
export interface FaturamentoMes { mes: string; valor: number; vendas: number }
export interface MetaProgresso { realizado: number; meta: number; pct: number; falta: number }

export interface ControleVendas {
  ranking: VendedorRanking[]
  faturamentoMensal: FaturamentoMes[]
  valorTotal: number
  ticketMedio: number
  metaMes: MetaProgresso
  metaSemanal: MetaProgresso
  metaCorrida: number
  totalVendasMes: number
  /** Chips do filtro: vendas/valor do MÊS por origem, sempre sobre TODAS as origens. */
  origens: OrigemResumo[]
  /** Quanto das vendas do mês tem origem informada — o piso da atribuição, nunca escondido. */
  coberturaOrigem: Pick<ResumoOrigens, 'total' | 'informada'>
}

async function fetchSettings(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('mirror_system_settings')
    .select('key, value')
    .in('key', ['corrida_vendas_meta', 'meta_mensal', 'meta_semanal', 'meta_audaciosa'])
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { key: string; value: string | null }[]) {
    const n = Number(r.value)
    if (!Number.isNaN(n)) out[r.key] = n
  }
  return out
}

async function fetchPedidos(): Promise<MirrorPedido[]> {
  const { data, error } = await supabase
    .from('mirror_pedidos_venda')
    // fonte_origem não é coluna do espelho: o PostgREST extrai do jsonb `raw`
    // (29/09/2026, roadmap #80). Sem trazer o raw inteiro, que é pesado.
    .select('vendedor, vendedor_2, valor_total, ajuste_valor, ajuste_data, data_venda, status, payment_plan_json, fonte_origem:raw->>fonte_origem')
    .limit(20000)
  if (error) throw error
  return (data ?? []) as unknown as MirrorPedido[]
}

/** Vendas (qtd) e valor do pedido na janela — a MESMA conta dos KPIs do mês. */
function medirNoPeriodo(p: MirrorPedido, from: string, to: string): { vendas: number; valor: number } {
  const dv = (p.data_venda || '').slice(0, 10)
  const conta = (p.status || '') !== 'CANCELADO' && dv >= from && dv <= to
  return { vendas: conta ? 1 : 0, valor: valorNoPeriodo(p, from, to) }
}

function computeRanking(pedidos: MirrorPedido[], from: string, to: string, metaCorrida: number): VendedorRanking[] {
  const map = new Map<string, { realizado: number; vendas: number; nome: string }>()
  for (const p of pedidos) {
    if (!p.vendedor) continue
    const v = valorNoPeriodo(p, from, to)
    if (v === 0) continue
    const key = p.vendedor.trim().toUpperCase()
    if (EXCLUIR_VENDEDOR.has(key)) continue
    const v2 = (p.vendedor_2 || '').trim().toUpperCase()
    const temV2 = v2.length > 0
    const valorPorVendedor = temV2 ? v / 2 : v

    const cur = map.get(key)
    if (cur) { cur.realizado += valorPorVendedor; cur.vendas += 1 }
    else map.set(key, { realizado: valorPorVendedor, vendas: 1, nome: p.vendedor.trim() })

    if (temV2 && !EXCLUIR_VENDEDOR.has(v2)) {
      const cur2 = map.get(v2)
      if (cur2) { cur2.realizado += valorPorVendedor; cur2.vendas += 1 }
      else map.set(v2, { realizado: valorPorVendedor, vendas: 1, nome: (p.vendedor_2 || '').trim() })
    }
  }
  return Array.from(map.values())
    .map(d => ({ vendedor: d.nome, realizado: d.realizado, vendas: d.vendas, pctCorrida: metaCorrida > 0 ? (d.realizado / metaCorrida) * 100 : 0 }))
    .sort((a, b) => b.realizado - a.realizado || a.vendedor.localeCompare(b.vendedor))
}

function computeFaturamento(pedidos: MirrorPedido[]): FaturamentoMes[] {
  const out: FaturamentoMes[] = []
  for (let i = 5; i >= 0; i--) {
    const ref = subMonths(new Date(), i)
    const from = format(startOfMonth(ref), 'yyyy-MM-dd')
    const to = format(endOfMonth(ref), 'yyyy-MM-dd')
    let valor = 0, vendas = 0
    for (const p of pedidos) {
      const v = valorNoPeriodo(p, from, to)
      if (v !== 0) valor += v
      const dv = (p.data_venda || '').slice(0, 10)
      if ((p.status || '') !== 'CANCELADO' && dv >= from && dv <= to) vendas += 1
    }
    out.push({ mes: `${MESES[ref.getMonth()]}/${String(ref.getFullYear()).slice(-2)}`, valor, vendas })
  }
  return out
}

/** Exportada só pro teste (lib/vendas-origem.test.ts): é aqui que o recorte vira número. */
export function computeControleVendas(
  espelho: MirrorPedido[], settings: Record<string, number>, periodo: Periodo, origem: string,
): ControleVendas {
  // GARANTIA não é venda (valor 0, criada pelo PedidoGarantia): o controle tira
  // esses pedidos de TODAS as somas e o painel diz ser espelho dele. Aqui eles
  // contavam em "Vendas no Mês" e puxavam o ticket médio pra baixo (3 em set/2026).
  const todos = espelho.filter(p => !ehPedidoGarantia(p.fonte_origem))
  const { from, to } = dateRange(periodo)
  const metaCorrida = settings.corrida_vendas_meta || 285000
  const metaMensal = settings.meta_mensal || 0
  const metaSemanalValor = settings.meta_semanal || (metaMensal ? metaMensal / 4 : 0)

  // Totais do MÊS atual (independente do toggle de período do ranking)
  const mFrom = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  const mTo = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  // Chips e cobertura olham TODAS as origens, mesmo com uma escolhida: é o que
  // deixa ver que a soma das origens não fecha o total (a origem é piso).
  const resumo = resumirOrigens(todos, p => medirNoPeriodo(p, mFrom, mTo))

  // Daqui pra baixo TODO número do painel sai só da origem escolhida.
  const pedidos = filtrarPorOrigem(todos, origem)

  const ranking = computeRanking(pedidos, from, to, metaCorrida)
  const faturamentoMensal = computeFaturamento(pedidos)

  let valorTotal = 0, totalVendasMes = 0
  for (const p of pedidos) {
    const m = medirNoPeriodo(p, mFrom, mTo)
    valorTotal += m.valor
    totalVendasMes += m.vendas
  }
  const ticketMedio = totalVendasMes > 0 ? valorTotal / totalVendasMes : 0

  // Meta semanal (semana corrente, seg-dom)
  const wFrom = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const wTo = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  let realizadoSemana = 0
  for (const p of pedidos) realizadoSemana += valorNoPeriodo(p, wFrom, wTo)

  const metaMes: MetaProgresso = {
    realizado: valorTotal, meta: metaMensal,
    pct: metaMensal > 0 ? (valorTotal / metaMensal) * 100 : 0,
    falta: Math.max(0, metaMensal - valorTotal),
  }
  const metaSemanal: MetaProgresso = {
    realizado: realizadoSemana, meta: metaSemanalValor,
    pct: metaSemanalValor > 0 ? (realizadoSemana / metaSemanalValor) * 100 : 0,
    falta: Math.max(0, metaSemanalValor - realizadoSemana),
  }

  return {
    ranking, faturamentoMensal, valorTotal, ticketMedio, metaMes, metaSemanal, metaCorrida, totalVendasMes,
    origens: resumo.origens,
    coberturaOrigem: { total: resumo.total, informada: resumo.informada },
  }
}

/**
 * Hook único: puxa pedidos + settings uma vez e computa todos os widgets.
 *
 * Período e origem NÃO entram na chave da consulta (29/09/2026): trocar o chip de
 * origem é só recortar o que já veio, não baixar o espelho de novo. A chave segue
 * começando por 'controle-vendas' porque ControlePedidos invalida por esse prefixo
 * depois de editar/excluir pedido.
 */
export function useControleVendas(periodo: Periodo, origem: string = ORIGEM_TODAS) {
  const q = useQuery({
    queryKey: ['controle-vendas', 'base'],
    queryFn: async () => {
      const [pedidos, settings] = await Promise.all([fetchPedidos(), fetchSettings()])
      return { pedidos, settings }
    },
    staleTime: 60_000,
  })
  const base = q.data
  // dataUpdatedAt nas deps: um refetch com o mesmo conteúdo devolve o MESMO objeto
  // (structural sharing), e as janelas "hoje/semana/mês" dependem do relógio.
  const data = useMemo(
    () => (base ? computeControleVendas(base.pedidos, base.settings, periodo, origem) : undefined),
    [base, q.dataUpdatedAt, periodo, origem],
  )
  return { data, isLoading: q.isLoading }
}
