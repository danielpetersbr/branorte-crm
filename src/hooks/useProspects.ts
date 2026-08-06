import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Possíveis representantes (prospecção OUTBOUND) — public.representante_prospects.
// Não confundir com useCandidaturas (INBOUND, o formulário /seja-representante).
// A RLS só devolve linha pra quem passa em pode_gerir_representantes()
// (admin ou permissão 'representantes.gerir'): hoje Daniel e Patrick.

export type RiscoProspect = 'Baixo' | 'Médio' | 'Alto'
export type PrioridadeProspect = 'Alta' | 'Média' | 'Exploratória'

/** As duas pesquisas que alimentam o mapa. Elas NÃO usam a mesma régua de nota
 *  nem o mesmo vocabulário de prioridade — ver pontuacao_max/prioridade_origem. */
export type FonteBase = 'planilha-54' | 'base-148'

export interface Prospect {
  id: number
  origem_id: number | null
  fonte_base: FonteBase
  uf: string
  estado: string | null
  regiao: string | null
  cidade_texto: string | null
  cidade: string | null
  uf_cidade: string | null
  lat: number | null
  lng: number | null
  geo_precisao: string | null
  nota_geo: string | null
  empresa: string
  contato: string | null
  cargo: string | null
  telefone: string | null
  whatsapp: string | null
  email: string | null
  site: string | null
  social: string | null
  segmento: string | null
  rede: string | null
  especies: string | null
  tipo: string | null
  cobertura: string | null
  regiao_atendida: string | null
  indicio_carteira: string | null
  fonte: string | null
  verificado_em: string | null
  nivel_verificacao: string | null
  fit: number | null
  carteira: number | null
  contato_pts: number | null
  presenca: number | null
  estrutura: number | null
  pontuacao_bruta: number | null
  pontuacao: number | null
  pontuacao_max: number | null
  risco: RiscoProspect | null
  prioridade: PrioridadeProspect | null
  /** Rótulo cru da fonte: 'Alta'/'Média'/'Exploratória' na planilha-54, 'A'/'B'/'D' na base-148. */
  prioridade_origem: string | null
  status: string
  responsavel: string | null
  proxima_acao: string | null
  observacoes: string | null
  anotacoes: string | null
  updated_at: string | null
  updated_by: string | null
}

export const STATUS_PROSPECT = [
  'Não abordado', 'Em contato', 'Negociando', 'Fechado', 'Descartado',
] as const

export const BASES: { id: FonteBase; rotulo: string; descricao: string }[] = [
  { id: 'base-148', rotulo: 'Pesquisa nacional', descricao: 'Base de 148 candidatos (régua até 13, prioridade A/B/C/D)' },
  { id: 'planilha-54', rotulo: 'Mapeamento 2/UF', descricao: 'Planilha de 54 candidatos, 2 por estado (régua até 10)' },
]

export function useProspects() {
  return useQuery<Prospect[]>({
    queryKey: ['representante-prospects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('representante_prospects')
        .select('*')
        .order('uf', { ascending: true })
        .order('pontuacao', { ascending: false })
      if (error) throw error
      return (data ?? []) as Prospect[]
    },
    staleTime: 60_000,
  })
}

/** Só os 3 campos de trabalho: status, responsável e anotações. O resto é pesquisa. */
export function useSalvarProspect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      id: number
      status?: string
      responsavel?: string | null
      anotacoes?: string | null
      autor?: string | null
    }) => {
      const patch: Record<string, unknown> = { updated_by: p.autor ?? null }
      if (p.status !== undefined) patch.status = p.status
      if (p.responsavel !== undefined) patch.responsavel = p.responsavel
      if (p.anotacoes !== undefined) patch.anotacoes = p.anotacoes
      // .update() sem .select(): a policy de UPDATE não implica SELECT do RETURNING,
      // e um RETURNING negado volta como "violates row-level security" — erro que
      // manda depurar a policy certa. Mesmo motivo do formulário /seja-representante.
      const { error } = await supabase
        .from('representante_prospects')
        .update(patch)
        .eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['representante-prospects'] }),
  })
}
