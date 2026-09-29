import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeForPreset, type DashboardPreset } from './useDashboard'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'

// Propostas montadas no builder cruzadas com o ESTÁGIO ATUAL da etiqueta WhatsApp do
// cliente (estado de agora). Responde "quais orçamentos foram enviados e estão com
// atendimento aberto, ainda não vendido" (= dinheiro na mesa) e "quem montou mais
// proposta em cada estágio do funil". Janela = propostas MONTADAS no período; a
// categoria é o estágio atual, independente do período.
// O DONO fica fora — filtro DENTRO da RPC (`ilike '%daniel%'`), não aqui.
// Ver `lib/vendedores-fora-do-ranking.ts`: o lado SQL ainda não foi unificado.

export type PropCategoria =
  | 'orcamento' | 'quente' | 'lead_quente' | 'novo' | 'sem_etiqueta'
  | 'vendido' | 'perdido' | 'outros'

export interface PropostasStatus {
  porCategoria: { categoria: PropCategoria; n: number; brl: number }[]
  porCatVendedor: { categoria: PropCategoria; vendedor: string; n: number; brl: number }[]
  aberto: { n: number; brl: number }   // não vendido/perdido = orcamento+lead_quente+quente+novo+sem_etiqueta
  abertoQuente: { n: number; brl: number } // orcamento+quente+lead_quente = pipeline QUENTE real (sem 'novo'/sem-etiqueta)
  vendido: { n: number; brl: number }
}

// Categorias que contam como "proposta em aberto" (negócio vivo, não fechado/perdido).
export const CATS_ABERTO: PropCategoria[] = ['orcamento', 'lead_quente', 'quente', 'novo', 'sem_etiqueta']

interface RawRow { categoria: PropCategoria; n: number; brl: number }
interface RawVendRow extends RawRow { vendedor: string }

export function usePropostasStatus(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['propostas-status-v2', preset],
    queryFn: async (): Promise<PropostasStatus> => {
      // Período com INÍCIO e FIM (29/09/2026). Havia aqui um `desdeFromPreset` próprio
      // que só devolvia o começo, e a RPC ia com `p_to: null`: em "Ontem" e no
      // personalizado, "R$ em negociação quente" (TabVisaoGeral) e as propostas por
      // estágio (TabFunil) somavam até AGORA, enquanto o useOrcamentosResumo do mesmo
      // card já recortava as duas pontas. Agora é o mesmo `rangeForPreset` do resto do
      // Dashboard; paramsRpcPeriodo ajusta o fim ao `<` da RPC (ver lib/periodo-preset).
      const { data, error } = await supabase.rpc(
        'dashboard_propostas_status',
        paramsRpcPeriodo(rangeForPreset(preset, new Date())),
      )
      if (error) throw error
      const obj = (data ?? {}) as { por_categoria?: RawRow[]; por_cat_vendedor?: RawVendRow[] }
      const porCategoria = (obj.por_categoria ?? []).map(r => ({ categoria: r.categoria, n: Number(r.n) || 0, brl: Number(r.brl) || 0 }))
      const porCatVendedor = (obj.por_cat_vendedor ?? []).map(r => ({ categoria: r.categoria, vendedor: r.vendedor, n: Number(r.n) || 0, brl: Number(r.brl) || 0 }))
      const soma = (cats: PropCategoria[]) => porCategoria.filter(c => cats.includes(c.categoria))
        .reduce((a, c) => ({ n: a.n + c.n, brl: a.brl + c.brl }), { n: 0, brl: 0 })
      return { porCategoria, porCatVendedor, aberto: soma(CATS_ABERTO), abertoQuente: soma(['orcamento', 'lead_quente', 'quente']), vendido: soma(['vendido']) }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
