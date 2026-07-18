import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// FONTE DA VERDADE = o mesmo dado que o dashboard do Controle (controle.branorte.com)
// mostra, AO VIVO: tabela pedidos_venda no Supabase do Controle (kfucuvwrnwrkshxpsmyq).
// Replica exatamente a conta da "Corrida de Vendas":
//   - status != CANCELADO, vendedor não nulo
//   - vendido = Σ valor_total (data_venda no mês) + Σ ajuste_valor (ajuste_data no mês)
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
}

function ctrlHeaders() {
  return { apikey: CONTROLE_ANON, Authorization: `Bearer ${CONTROLE_ANON}` }
}

type PedidoRow = {
  vendedor: string | null; valor_total: number | null
  ajuste_valor: number | null; ajuste_data: string | null; data_venda: string | null
}

async function fromControle(mstart: string, mnext: string): Promise<VendasReais> {
  const sel = 'select=vendedor,valor_total,ajuste_valor,ajuste_data,data_venda,status'
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
  const meta = Number(setMap.get('meta_mensal')) || FALLBACK_META
  const metaVendedor = Number(setMap.get('corrida_vendas_meta')) || FALLBACK_META_VENDEDOR

  let vendidoBruto = 0, ajustes = 0, pedidosMes = 0
  let ultimaVenda: string | null = null
  const porVend = new Map<string, { valor: number; numVendas: number }>()
  const bump = (v: string, add: number, venda: boolean) => {
    const cur = porVend.get(v) || { valor: 0, numVendas: 0 }
    cur.valor += add
    if (venda) cur.numVendas++
    porVend.set(v, cur)
  }
  for (const r of rows) {
    const v = (r.vendedor || '').trim() || '—'
    const dv = (r.data_venda || '').slice(0, 10)
    const aj = (r.ajuste_data || '').slice(0, 10)
    if (dv >= mstart && dv < mnext) {
      const vt = Number(r.valor_total) || 0
      vendidoBruto += vt; pedidosMes++
      bump(v, vt, true)
      if (!ultimaVenda || dv > ultimaVenda) ultimaVenda = dv
    }
    if (aj >= mstart && aj < mnext) {
      const av = Number(r.ajuste_valor) || 0
      ajustes += av
      bump(v, av, false)
    }
  }
  const corrida: CorridaVendedor[] = [...porVend.entries()]
    .map(([vendedor, x]) => ({
      vendedor, valor: x.valor, numVendas: x.numVendas,
      pct: metaVendedor > 0 ? (x.valor / metaVendedor) * 100 : 0,
    }))
    .filter(c => c.valor > 0)
    .sort((a, b) => b.valor - a.valor)

  return {
    vendidoMes: vendidoBruto + ajustes, vendidoBruto, pedidosMes,
    meta, metaVendedor, corrida, ultimaVenda, fonte: 'controle-live',
  }
}

async function fromMirror(mstart: string): Promise<VendasReais> {
  const { data } = await supabase
    .from('mirror_pedidos_venda')
    .select('valor_total, data_venda')
    .gte('data_venda', mstart)
  const rows = (data ?? []) as { valor_total: number | null; data_venda: string | null }[]
  const vendidoMes = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0)
  let ultimaVenda: string | null = null
  for (const r of rows) if (r.data_venda && (!ultimaVenda || r.data_venda > ultimaVenda)) ultimaVenda = r.data_venda
  return {
    vendidoMes, vendidoBruto: vendidoMes, pedidosMes: rows.length,
    meta: FALLBACK_META, metaVendedor: FALLBACK_META_VENDEDOR, corrida: [],
    ultimaVenda, fonte: 'mirror-fallback',
  }
}

export function useVendasReais() {
  return useQuery<VendasReais>({
    queryKey: ['vendas-reais-mes'],
    staleTime: 3 * 60_000,
    queryFn: async () => {
      const now = new Date()
      const mstart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const mnext = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10)
      try {
        return await fromControle(mstart, mnext)
      } catch {
        return await fromMirror(mstart)
      }
    },
  })
}
