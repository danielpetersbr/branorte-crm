import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeForPreset, type DashboardPreset } from './useDashboard'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'

// Qualidade dos leads por CANAL (RPC public.dashboard_canais, 19/10/2026).
// Coorte: leads que CHEGARAM na janela e o que aconteceu com eles — proposta montada a
// partir de 2 dias antes da chegada (sem as do dono) e pedido nascido dessa proposta.
// Régua de qualificado = a do card Qualificados da Visão geral (IA OU etiqueta de avanço).
export interface CanalQualidade {
  canal: string
  leads: number
  leads_rastreaveis: number
  respondeu_ia: number
  qualificados: number
  qualif_ou_proposta: number
  com_proposta: number
  prop_por_100: number | null
  prop_ic95_min: number | null
  prop_ic95_max: number | null
  compraram: number
  rs_proposto: number
  rs_proposto_por_lead: number | null
  mediana_proposta: number | null
  rs_vendido: number
  ticket_venda: number | null
  dias_ate_proposta: number | null
  nao_fabricamos: number
  lixo: number
  bovino: number
  suino: number
  aves: number
  peixe: number
  bovino_com_cabecas: number
  bovino_200_mais: number
  selo: string | null
}

export type JanelaCanais = '90d' | 'periodo'

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/** Janela da RPC. "Tudo" no topo não cabe numa coorte (4,6 s em 90 dias já): cai em 90 dias. */
export function janelaCanais(janela: JanelaCanais, preset: DashboardPreset, agora = new Date()): { p_from: string; p_to: string; usou90: boolean } {
  if (janela === 'periodo' && preset) {
    const p = paramsRpcPeriodo(rangeForPreset(preset, agora))
    if (p.p_from && p.p_to) return { p_from: p.p_from, p_to: p.p_to, usou90: false }
  }
  const fim = new Date(agora); fim.setHours(0, 0, 0, 0); fim.setDate(fim.getDate() + 1)
  const ini = new Date(fim); ini.setDate(ini.getDate() - 90)
  return { p_from: ini.toISOString(), p_to: fim.toISOString(), usou90: true }
}

export function useDashboardCanais(janela: JanelaCanais, preset: DashboardPreset) {
  const { p_from, p_to, usou90 } = janelaCanais(janela, preset)
  return useQuery({
    queryKey: ['dashboard-canais-v1', p_from, p_to],
    queryFn: async (): Promise<{ linhas: CanalQualidade[]; usou90: boolean }> => {
      const { data, error } = await supabase.rpc('dashboard_canais', { p_from, p_to })
      if (error) throw error
      const linhas = ((data ?? []) as Record<string, unknown>[]).map(r => ({
        canal: String(r.canal ?? ''),
        leads: Number(r.leads) || 0,
        leads_rastreaveis: Number(r.leads_rastreaveis) || 0,
        respondeu_ia: Number(r.respondeu_ia) || 0,
        qualificados: Number(r.qualificados) || 0,
        qualif_ou_proposta: Number(r.qualif_ou_proposta) || 0,
        com_proposta: Number(r.com_proposta) || 0,
        prop_por_100: num(r.prop_por_100),
        prop_ic95_min: num(r.prop_ic95_min),
        prop_ic95_max: num(r.prop_ic95_max),
        compraram: Number(r.compraram) || 0,
        rs_proposto: Number(r.rs_proposto) || 0,
        rs_proposto_por_lead: num(r.rs_proposto_por_lead),
        mediana_proposta: num(r.mediana_proposta),
        rs_vendido: Number(r.rs_vendido) || 0,
        ticket_venda: num(r.ticket_venda),
        dias_ate_proposta: num(r.dias_ate_proposta),
        nao_fabricamos: Number(r.nao_fabricamos) || 0,
        lixo: Number(r.lixo) || 0,
        bovino: Number(r.bovino) || 0,
        suino: Number(r.suino) || 0,
        aves: Number(r.aves) || 0,
        peixe: Number(r.peixe) || 0,
        bovino_com_cabecas: Number(r.bovino_com_cabecas) || 0,
        bovino_200_mais: Number(r.bovino_200_mais) || 0,
        selo: r.selo == null ? null : String(r.selo),
      }))
      return { linhas, usou90 }
    },
    // A coorte custa ~4,6 s em 90 dias no banco Micro: não recalcular a cada minuto.
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
