import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { intervaloMkt, lerFonte, lerVenda, montarRelatorio, type PeriodoMkt, type RelatorioMkt } from '@/lib/marketing-relatorio'

// Aba Marketing / PDF do gestor de tráfego (20/10/2026): duas RPCs, um relatório.
// A coorte de 90 dias custa alguns segundos no banco Micro — cache de 10 min.
export function useMarketingRelatorio(periodo: PeriodoMkt) {
  const { from, to, label } = intervaloMkt(periodo)
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['marketing-relatorio-v1', p_from, p_to],
    queryFn: async (): Promise<RelatorioMkt & { label: string }> => {
      const [fontes, vendas] = await Promise.all([
        supabase.rpc('dashboard_marketing_fontes', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_vendas', { p_from, p_to }),
      ])
      if (fontes.error) throw fontes.error
      if (vendas.error) throw vendas.error
      const rel = montarRelatorio(
        ((fontes.data ?? []) as Record<string, unknown>[]).map(lerFonte),
        ((vendas.data ?? []) as Record<string, unknown>[]).map(lerVenda),
      )
      return { ...rel, label }
    },
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
