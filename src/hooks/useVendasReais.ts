import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// FONTE DA VERDADE = o mesmo dado que o dashboard do Controle (controle.branorte.com)
// mostra, AO VIVO: tabela pedidos_venda no Supabase do Controle (kfucuvwrnwrkshxpsmyq).
// Replica a conta do Controle (getValorPedidoParaPeriodo em src/pages/Dashboard.tsx
// do pedido-de-venda), conferida em 19/10/2026 — antes daqui só somava valor_total:
//   - status != CANCELADO, vendedor não nulo
//   - base do pedido = payment_plan_json.total quando > 0, senão valor_total, no mês da data_venda
//   - ajuste: no mês da ajuste_data; SEM ajuste_data vai junto com a base
//   - corrida: com vendedor_2 o valor divide 50/50 e o pedido conta para os dois
// Em fev/26 a diferença era R$ 193 mil (PV-2099 com plano de R$ 266k e valor de R$ 125k).
// Meta do time = system_settings.meta_mensal (R$ 2,5M).
// Meta por vendedor (corrida) = system_settings.corrida_vendas_meta (R$ 278k).
// NÃO usa o espelho local (mirror_*), que só é fallback se a fonte viva falhar.
// A anon key abaixo é pública (já exposta no front do Controle) e só dá leitura via RLS.

const CONTROLE_URL = 'https://kfucuvwrnwrkshxpsmyq.supabase.co'
const CONTROLE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'
const FALLBACK_META = 2_500_000
const FALLBACK_META_VENDEDOR = 278_000

export interface CorridaVendedor {
  vendedor: string
  valor: number      // líquido de ajustes, igual à Corrida de Vendas do Controle
  numVendas: number
  pct: number        // valor / metaVendedor * 100
}

export interface VendasReais {
  vendidoMes: number      // líquido de ajustes (igual à Corrida de Vendas do Controle)
  vendidoBruto: number    // só valor_total, sem ajustes
  pedidosMes: number
  meta: number            // meta do time (meta_mensal)
  metaVendedor: number    // meta por vendedor (corrida_vendas_meta)
  corrida: CorridaVendedor[]
  ultimaVenda: string | null
  fonte: 'controle-live' | 'mirror-fallback'
  /** 'padrao' = system_settings do Controle não respondeu e a meta é a constante do código. */
  metaFonte: 'controle' | 'padrao'
  /** Dia de Brasília (YYYY-MM-DD) em que o mês foi recortado — a tela conta os dias a partir dele. */
  hojeSP: string
}

function ctrlHeaders() {
  return { apikey: CONTROLE_ANON, Authorization: `Bearer ${CONTROLE_ANON}` }
}

export type PedidoRow = {
  vendedor: string | null; vendedor_2: string | null; valor_total: number | null
  plano_total: number | string | null; status: string | null
  ajuste_valor: number | null; ajuste_data: string | null; data_venda: string | null
}

/** Mesma regra para o Controle ao vivo e para o espelho — ver o cabeçalho do arquivo. */
export function calcular(
  rows: PedidoRow[], mstart: string, mnext: string,
  meta: number, metaVendedor: number, metaFonte: VendasReais['metaFonte'],
  fonte: VendasReais['fonte'], hojeSP: string,
): VendasReais {
  let vendidoBruto = 0, ajustes = 0, pedidosMes = 0
  let ultimaVenda: string | null = null
  const porVend = new Map<string, { nome: string; valor: number; numVendas: number }>()
  const bump = (nome: string, add: number, venda: boolean) => {
    const k = nome.toUpperCase()
    const cur = porVend.get(k) || { nome, valor: 0, numVendas: 0 }
    cur.valor += add
    if (venda) cur.numVendas++
    porVend.set(k, cur)
  }
  const noMes = (d: string) => d >= mstart && d < mnext
  for (const r of rows) {
    if ((r.status || '').toUpperCase() === 'CANCELADO') continue
    const v = (r.vendedor || '').trim()
    if (!v) continue
    const v2 = (r.vendedor_2 || '').trim()
    const dv = (r.data_venda || '').slice(0, 10)
    const aj = (r.ajuste_data || '').slice(0, 10)
    const plano = Number(r.plano_total) || 0
    const base = plano > 0 ? plano : Number(r.valor_total) || 0
    const av = Number(r.ajuste_valor) || 0
    let valorNoMes = 0
    let vendaNoMes = false
    if (noMes(dv)) {
      vendidoBruto += base; valorNoMes += base; pedidosMes++; vendaNoMes = true
      if (!aj && av !== 0) { ajustes += av; valorNoMes += av }
      if (!ultimaVenda || dv > ultimaVenda) ultimaVenda = dv
    }
    if (aj && av !== 0 && noMes(aj)) { ajustes += av; valorNoMes += av }
    if (valorNoMes === 0) continue
    if (v2) {
      bump(v, valorNoMes / 2, vendaNoMes)
      bump(v2, valorNoMes / 2, vendaNoMes)
    } else {
      bump(v, valorNoMes, vendaNoMes)
    }
  }
  const corrida: CorridaVendedor[] = [...porVend.values()]
    .map(x => ({
      vendedor: x.nome, valor: x.valor, numVendas: x.numVendas,
      pct: metaVendedor > 0 ? (x.valor / metaVendedor) * 100 : 0,
    }))
    // Saldo negativo (só ajuste de redução no mês) também aparece: sumir com ele
    // deixava o ranking sem fechar com o total.
    .filter(c => c.valor !== 0)
    .sort((a, b) => b.valor - a.valor)

  return {
    vendidoMes: vendidoBruto + ajustes, vendidoBruto, pedidosMes,
    meta, metaVendedor, corrida, ultimaVenda, fonte, metaFonte, hojeSP,
  }
}

async function fromControle(mstart: string, mnext: string, hojeSP: string): Promise<VendasReais> {
  const sel = 'select=vendedor,vendedor_2,valor_total,plano_total:payment_plan_json->>total,ajuste_valor,ajuste_data,data_venda,status'
  const filt =
    `or=(and(data_venda.gte.${mstart},data_venda.lt.${mnext}),` +
    `and(ajuste_data.gte.${mstart},ajuste_data.lt.${mnext}))` +
    `&vendedor=not.is.null&status=neq.CANCELADO`
  const url = `${CONTROLE_URL}/rest/v1/pedidos_venda?${sel}&${filt}`
  const [rowsRes, setRes] = await Promise.all([
    fetch(url, { headers: ctrlHeaders() }),
    fetch(
      `${CONTROLE_URL}/rest/v1/system_settings?select=key,value&key=in.(meta_mensal,corrida_vendas_meta)`,
      { headers: ctrlHeaders() },
    ),
  ])
  if (!rowsRes.ok) throw new Error(`pedidos_venda HTTP ${rowsRes.status}`)
  const rows = (await rowsRes.json()) as PedidoRow[]
  const settings = setRes.ok ? ((await setRes.json()) as { key: string; value: string }[]) : []
  const setMap = new Map(settings.map(s => [s.key, s.value]))
  const metaLida = Number(setMap.get('meta_mensal'))
  const meta = metaLida || FALLBACK_META
  const metaVendedor = Number(setMap.get('corrida_vendas_meta')) || FALLBACK_META_VENDEDOR
  return calcular(rows, mstart, mnext, meta, metaVendedor, metaLida ? 'controle' : 'padrao', 'controle-live', hojeSP)
}

async function fromMirror(mstart: string, mnext: string, hojeSP: string): Promise<VendasReais> {
  // Mesmo recorte do Controle (antes: sem CANCELADO, sem teto de data, sem ajuste nem
  // plano). E erro é ERRO: engolir o `error` mostrava R$ 0 como se fosse venda real.
  const { data, error } = await supabase
    .from('mirror_pedidos_venda')
    .select('vendedor, vendedor_2, valor_total, payment_plan_json, ajuste_valor, ajuste_data, data_venda, status')
    .or(`and(data_venda.gte.${mstart},data_venda.lt.${mnext}),and(ajuste_data.gte.${mstart},ajuste_data.lt.${mnext})`)
  if (error) throw error
  const rows = ((data ?? []) as (Omit<PedidoRow, 'plano_total'> & { payment_plan_json: { total?: number | string } | null })[])
    .map(r => ({ ...r, plano_total: r.payment_plan_json?.total ?? null }))
  return calcular(rows, mstart, mnext, FALLBACK_META, FALLBACK_META_VENDEDOR, 'padrao', 'mirror-fallback', hojeSP)
}

/** Mês corrente em Brasília: o `toISOString()` do mês local virava 30/09 num navegador com fuso positivo. */
function mesSP(now: Date): { mstart: string; mnext: string; hojeSP: string } {
  const hojeSP = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [y, m] = hojeSP.split('-').map(Number)
  const pad = (x: number) => String(x).padStart(2, '0')
  const mstart = `${y}-${pad(m)}-01`
  const mnext = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { mstart, mnext, hojeSP }
}

export function useVendasReais() {
  return useQuery<VendasReais>({
    queryKey: ['vendas-reais-mes'],
    staleTime: 3 * 60_000,
    // O selo diz "ao vivo": sem refetch, a tela parada ficava com o número da abertura
    // (refetchOnWindowFocus é false no App).
    refetchInterval: 3 * 60_000,
    queryFn: async () => {
      const { mstart, mnext, hojeSP } = mesSP(new Date())
      try {
        return await fromControle(mstart, mnext, hojeSP)
      } catch {
        return await fromMirror(mstart, mnext, hojeSP)
      }
    },
  })
}
