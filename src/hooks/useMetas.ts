import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Placar das metas de COMPORTAMENTO (o que o vendedor controla na segunda-feira),
 * ao lado da meta de venda — que é resultado atrasado.
 *
 * Tudo vem pronto da RPC public.metas_semanais(p_from, p_to). As três contas são
 * medidas por HORÁRIO/EXISTÊNCIA de mensagem, não por conteúdo, de propósito: a
 * transcrição de áudio é intermitente e uma meta de conteúdo mediria cego.
 *
 * Denominador justo (a pegadinha que inverte o resultado): só entra no
 * denominador quem já teve a janela inteira pra ser atendido — proposta emitida
 * ontem não conta como abandonada, senão a semana corrente sempre parece pior.
 */

export interface MetaVendedor {
  vendedor: string
  time: string
  m1_calaram: number
  m1_resgatados: number
  m1_pct: number | null
  m2_propostas: number
  m2_d1: number
  m2_3d: number
  m2_pct: number | null
  m2_rs_abandonado: number
  m3_propostas: number
  m3_trabalhadas: number
  m3_rs: number
  lead_quente: number
  follow_up: number
  vendas_mes: number
  rs_mes: number
}

export interface MetaTime {
  time: string
  m1_calaram: number
  m1_resgatados: number
  m1_pct: number | null
  m2_propostas: number
  m2_3d: number
  m2_pct: number | null
  m3_propostas: number
  m3_trabalhadas: number
  lead_quente: number
  rs_mes: number
}

export interface MetasPlacar {
  periodo: { de: string; ate: string; mes_desde: string; gerado_em: string }
  metas: { m1_alvo_pct: number; m2_alvo_pct: number; m3_alvo_por_vendedor: number; quente_alvo_por_time: number }
  empresa: {
    m1_calaram: number; m1_resgatados: number; m1_pct: number | null
    m2_propostas: number; m2_d1: number; m2_3d: number; m2_pct: number | null; m2_rs_abandonado: number
    m3_propostas: number; m3_trabalhadas: number; m3_rs: number
    lead_quente: number; follow_up: number
    vendas_mes: number; rs_mes: number
  }
  times: MetaTime[]
  vendedores: MetaVendedor[]
}

/** ISO (YYYY-MM-DD) de hoje-N no fuso de São Paulo */
export function isoMenos(dias: number): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export function useMetas(de: string, ate: string) {
  return useQuery({
    queryKey: ['metas-semanais', de, ate],
    queryFn: async (): Promise<MetasPlacar> => {
      const { data, error } = await supabase.rpc('metas_semanais', { p_from: de, p_to: ate })
      if (error) throw error
      return data as MetasPlacar
    },
    staleTime: 5 * 60 * 1000,
  })
}
