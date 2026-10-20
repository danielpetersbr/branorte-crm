import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { janelaCanais, type JanelaCanais } from './useDashboardCanais'
import type { DashboardPreset } from './useDashboard'

// Porte do lead por ANÚNCIO, a partir do que a Ana coletou (RPC dashboard_porte_por_anuncio,
// 20/10/2026). A Ana guarda o lead por @lid e a origem pelo ID do anúncio do Meta — por isso
// esta visão é por anúncio, não pelo código &NN do resto da aba.
export interface PorteAnuncio {
  ad_id: string | null
  anuncio: string | null
  campanha: string | null
  codigo: string | null
  texto: string | null
  app: string | null
  conversas: number
  informou_animal: number
  informou_qtd: number
  bovino: number
  bovino_com_qtd: number
  bovino_mediana: number | null
  bovino_200: number
  bovino_500: number
  suino: number
  suino_mediana: number | null
  aves: number
  aves_mediana: number | null
  outros_animais: number
  revenda: number
  repassados: number
  equipamento_mais_pedido: string | null
}

const num = (v: unknown) => (v == null ? null : Number(v))

export function useDashboardPorteAnuncio(janela: JanelaCanais, preset: DashboardPreset) {
  const { p_from, p_to, usou90 } = janelaCanais(janela, preset)
  return useQuery({
    queryKey: ['dashboard-porte-anuncio-v1', p_from, p_to],
    queryFn: async (): Promise<{ linhas: PorteAnuncio[]; usou90: boolean }> => {
      const { data, error } = await supabase.rpc('dashboard_porte_por_anuncio', { p_from, p_to })
      if (error) throw error
      const linhas = ((data ?? []) as Record<string, unknown>[]).map(r => ({
        ad_id: (r.ad_id as string) ?? null,
        anuncio: (r.anuncio as string) ?? null,
        campanha: (r.campanha as string) ?? null,
        codigo: (r.codigo as string) ?? null,
        texto: (r.texto as string) ?? null,
        app: (r.app as string) ?? null,
        conversas: Number(r.conversas) || 0,
        informou_animal: Number(r.informou_animal) || 0,
        informou_qtd: Number(r.informou_qtd) || 0,
        bovino: Number(r.bovino) || 0,
        bovino_com_qtd: Number(r.bovino_com_qtd) || 0,
        bovino_mediana: num(r.bovino_mediana),
        bovino_200: Number(r.bovino_200) || 0,
        bovino_500: Number(r.bovino_500) || 0,
        suino: Number(r.suino) || 0,
        suino_mediana: num(r.suino_mediana),
        aves: Number(r.aves) || 0,
        aves_mediana: num(r.aves_mediana),
        outros_animais: Number(r.outros_animais) || 0,
        revenda: Number(r.revenda) || 0,
        repassados: Number(r.repassados) || 0,
        equipamento_mais_pedido: (r.equipamento_mais_pedido as string) ?? null,
      }))
      return { linhas, usou90 }
    },
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
