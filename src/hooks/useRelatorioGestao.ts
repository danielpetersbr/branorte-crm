import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Visão do GESTOR do Relatório do Líder.
//
// A tela /relatorio-lider é de ENTRADA (o líder preenche). Esta é a de LEITURA:
// o Daniel abre e vê os 3 times de uma vez.
//
// Regra que desenhou isto: a AUSÊNCIA é a informação mais importante. Um líder
// que não preencheu não pode sumir da tela — por isso a RPC parte dos TIMES e
// faz left join no relatório, em vez de listar o que existe.
// ============================================================================

export interface GestaoLinha {
  time_slug: string; time_nome: string; dia: string
  lider_nome: string | null
  termometro: 'verde' | 'amarelo' | 'vermelho' | null
  termometro_obs: string | null
  qualidade_lead: string | null
  qualidade_lead_motivo: string | null
  abaixo_vendedor: string | null
  abaixo_motivo: string | null
  preenchido_em: string | null
  quentes_n: number; quentes_valor: number
  perdidos_n: number; perdidos_valor: number
}

export interface NegocioPeriodo {
  dia: string; time_slug: string; time_nome: string
  tipo: 'quente' | 'perdido'
  cliente: string; vendedor_nome: string | null; valor: number | null
  previsao: string | null; obstaculo: string | null
  motivo: string | null; concorrente: string | null
  lider_nome: string | null
}

export interface AndamentoLinha {
  time_slug: string; tipo: 'orcamento' | 'quente'
  cliente: string; vendedor_nome: string | null
  status: string; anotado_por: string | null; anotado_em: string
  /** há quantos dias está parado NESTE estado — o dado que faltava */
  dias_no_status: number
  /** quantas vezes já mudou de estado (do histórico) */
  mudancas: number
}

const n = (v: unknown) => Number(v ?? 0)

export function useGestao(dias = 7) {
  return useQuery({
    queryKey: ['rel-gestao', dias],
    staleTime: 60_000,
    queryFn: async (): Promise<GestaoLinha[]> => {
      const ate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const d = new Date(); d.setDate(d.getDate() - (dias - 1))
      const de = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const { data, error } = await supabase.rpc('relatorio_lider_gestao', { p_de: de, p_ate: ate })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        quentes_valor: n(r.quentes_valor), perdidos_valor: n(r.perdidos_valor),
        quentes_n: n(r.quentes_n), perdidos_n: n(r.perdidos_n),
      })) as GestaoLinha[]
    },
  })
}

export function useNegociosPeriodo(dias = 7) {
  return useQuery({
    queryKey: ['rel-gestao-negocios', dias],
    staleTime: 60_000,
    queryFn: async (): Promise<NegocioPeriodo[]> => {
      const ate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const d = new Date(); d.setDate(d.getDate() - (dias - 1))
      const de = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const { data, error } = await supabase.rpc('relatorio_lider_negocios_periodo', { p_de: de, p_ate: ate })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({ ...r, valor: n(r.valor) })) as NegocioPeriodo[]
    },
  })
}

export function useAndamentos() {
  return useQuery({
    queryKey: ['rel-gestao-andamentos'],
    staleTime: 60_000,
    queryFn: async (): Promise<AndamentoLinha[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_andamentos', { p_time: null })
      if (error) throw error
      return (data ?? []) as AndamentoLinha[]
    },
  })
}
