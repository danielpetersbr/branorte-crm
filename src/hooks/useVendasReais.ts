import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Vendas REAIS do mês — espelho do Controle (mirror_pedidos_venda), não o status_real
// dos atendimentos (que só tem status de conversa: Abandonado/Aguardando/etc, NUNCA "vendido").
// A meta real vem de mirror_metas_vendas (ano/mes/valor); fallback R$ 2M se não houver.
export interface VendasReais {
  vendidoMes: number
  pedidosMes: number
  meta: number
  ultimaVenda: string | null
  sincronizadoEm: string | null
}

const FALLBACK_META = 2_000_000

export function useVendasReais() {
  return useQuery<VendasReais>({
    queryKey: ['vendas-reais-mes'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const now = new Date()
      const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const [pedidos, meta] = await Promise.all([
        supabase.from('mirror_pedidos_venda')
          .select('valor_total, data_venda, synced_at')
          .gte('data_venda', inicioMes),
        supabase.from('mirror_metas_vendas')
          .select('valor')
          .eq('ano', now.getFullYear())
          .eq('mes', now.getMonth() + 1)
          .maybeSingle(),
      ])
      const rows = (pedidos.data ?? []) as { valor_total: number | null; data_venda: string | null; synced_at: string | null }[]
      const vendidoMes = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0)
      const pedidosMes = rows.length
      const metaVal = Number((meta.data as { valor?: number } | null)?.valor) || FALLBACK_META
      let ultimaVenda: string | null = null
      let sincronizadoEm: string | null = null
      for (const r of rows) {
        if (r.data_venda && (!ultimaVenda || r.data_venda > ultimaVenda)) ultimaVenda = r.data_venda
        if (r.synced_at && (!sincronizadoEm || r.synced_at > sincronizadoEm)) sincronizadoEm = r.synced_at
      }
      return { vendidoMes, pedidosMes, meta: metaVal, ultimaVenda, sincronizadoEm }
    },
  })
}
