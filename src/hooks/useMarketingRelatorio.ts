import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  intervaloMkt, lerFonte, lerGasto, lerPlataforma, lerTermo, lerVenda, lerVendedor, montarRelatorio,
  type PeriodoMkt, type RelatorioMkt,
} from '@/lib/marketing-relatorio'

// Aba Marketing / PDF do gestor de tráfego (20/10/2026): quatro RPCs, um relatório.
// Gasto e vendedores são opcionais: se a RPC falhar, o relatório sai sem custo/sem vendedor
// (e diz isso) em vez de não sair. A coorte de 90 dias custa ~3 s no banco Micro — cache de 10 min.
export function useMarketingRelatorio(periodo: PeriodoMkt) {
  const { from, to, label } = intervaloMkt(periodo)
  const p_from = from.toISOString(), p_to = to.toISOString()
  return useQuery({
    queryKey: ['marketing-relatorio-v3', p_from, p_to],
    queryFn: async (): Promise<RelatorioMkt & { label: string; faltou: string[] }> => {
      const [fontes, vendas, gasto, vend, plat, termos] = await Promise.all([
        supabase.rpc('dashboard_marketing_fontes', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_vendas', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_gasto', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_vendedores', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_plataformas', { p_from, p_to }),
        supabase.rpc('dashboard_marketing_termos_google', { p_limite: 15 }),
      ])
      if (fontes.error) throw fontes.error
      if (vendas.error) throw vendas.error
      const faltou: string[] = []
      if (gasto.error) faltou.push('gasto do Meta')
      if (vend.error) faltou.push('dados por vendedor')
      if (plat.error) faltou.push('verba por plataforma')
      const linhas = (d: unknown) => (d ?? []) as Record<string, unknown>[]
      const rel = montarRelatorio(
        linhas(fontes.data).map(lerFonte),
        linhas(vendas.data).map(lerVenda),
        gasto.error ? [] : linhas(gasto.data).map(lerGasto),
        vend.error ? [] : linhas(vend.data).map(lerVendedor),
        {
          emAndamento: periodo !== 'mes_passado',
          plataformas: plat.error ? [] : linhas(plat.data).map(lerPlataforma),
          termosGoogle: termos.error ? [] : linhas(termos.data).map(lerTermo),
        },
      )
      return { ...rel, label, faltou }
    },
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
