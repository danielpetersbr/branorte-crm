import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// FONTE DA VERDADE = o mesmo dado que o dashboard do Controle (controle.branorte.com)
// mostra, AO VIVO: tabela pedidos_venda no Supabase do Controle (kfucuvwrnwrkshxpsmyq).
// Replica exatamente a conta da "Corrida de Vendas":
//   - status != CANCELADO, vendedor não nulo
//   - vendido = Σ valor_total (data_venda no mês) + Σ ajuste_valor (ajuste_data no mês)
// Meta do time = system_settings.meta_mensal (R$ 2,5M). NÃO usa o espelho local (mirror_*),
// que fica defasado; o espelho só é fallback se a fonte viva falhar.
// A anon key abaixo é pública (já exposta no front do Controle) e só dá leitura via RLS.

const CONTROLE_URL = 'https://kfucuvwrnwrkshxpsmyq.supabase.co'
const CONTROLE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'
const FALLBACK_META = 2_500_000

export interface VendasReais {
  vendidoMes: number      // líquido de ajustes (igual à Corrida de Vendas do Controle)
  vendidoBruto: number    // só valor_total, sem ajustes
  pedidosMes: number
  meta: number
  ultimaVenda: string | null
  fonte: 'controle-live' | 'mirror-fallback'
}

function ctrlHeaders() {
  return { apikey: CONTROLE_ANON, Authorization: `Bearer ${CONTROLE_ANON}` }
}

async function fromControle(mstart: string, mnext: string): Promise<VendasReais> {
  const sel = 'select=vendedor,valor_total,ajuste_valor,ajuste_data,data_venda,status'
  const filt =
    `or=(and(data_venda.gte.${mstart},data_venda.lt.${mnext}),` +
    `and(ajuste_data.gte.${mstart},ajuste_data.lt.${mnext}))` +
    `&vendedor=not.is.null&status=neq.CANCELADO`
  const url = `${CONTROLE_URL}/rest/v1/pedidos_venda?${sel}&${filt}`
  const [rowsRes, metaRes] = await Promise.all([
    fetch(url, { headers: ctrlHeaders() }),
    fetch(`${CONTROLE_URL}/rest/v1/system_settings?select=value&key=eq.meta_mensal`, { headers: ctrlHeaders() }),
  ])
  if (!rowsRes.ok) throw new Error(`pedidos_venda HTTP ${rowsRes.status}`)
  const rows = (await rowsRes.json()) as {
    valor_total: number | null; ajuste_valor: number | null; ajuste_data: string | null; data_venda: string | null
  }[]
  const metaJson = metaRes.ok ? ((await metaRes.json()) as { value?: string }[]) : []

  let vendidoBruto = 0, ajustes = 0, pedidosMes = 0
  let ultimaVenda: string | null = null
  for (const r of rows) {
    const dv = (r.data_venda || '').slice(0, 10)
    const aj = (r.ajuste_data || '').slice(0, 10)
    if (dv >= mstart && dv < mnext) {
      vendidoBruto += Number(r.valor_total) || 0
      pedidosMes++
      if (!ultimaVenda || dv > ultimaVenda) ultimaVenda = dv
    }
    if (aj >= mstart && aj < mnext) ajustes += Number(r.ajuste_valor) || 0
  }
  const meta = Number(metaJson[0]?.value) || FALLBACK_META
  return { vendidoMes: vendidoBruto + ajustes, vendidoBruto, pedidosMes, meta, ultimaVenda, fonte: 'controle-live' }
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
  return { vendidoMes, vendidoBruto: vendidoMes, pedidosMes: rows.length, meta: FALLBACK_META, ultimaVenda, fonte: 'mirror-fallback' }
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
