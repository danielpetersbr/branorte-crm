/**
 * Leads do quiz público /monte-sua-fabrica.
 *
 * A escrita NÃO passa por aqui: quem grava é a própria página pública, com o
 * client anônimo. Este hook é só o lado de dentro — listar e triar.
 *
 * A RLS manda: `papel_conhecido()` (admin, owner, vendor, marketing,
 * visualizador) lê e atualiza; papel externo (consultor, representante, mapa)
 * é barrado por policy RESTRICTIVE. Se a lista vier vazia pra alguém que
 * deveria ver, o problema é o papel dele, não a query.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Estacao } from '@/lib/quiz-fabrica/tipos'

const CHAVE = ['quiz-fabrica', 'respostas'] as const

export type StatusLead = 'novo' | 'contatado' | 'em_estudo' | 'virou_orcamento' | 'descartado'

export const STATUS_LEAD: Array<{ chave: StatusLead; nome: string }> = [
  { chave: 'novo', nome: 'Novo' },
  { chave: 'contatado', nome: 'Contatado' },
  { chave: 'em_estudo', nome: 'Virou estudo' },
  { chave: 'virou_orcamento', nome: 'Virou orçamento' },
  { chave: 'descartado', nome: 'Descartado' },
]

export interface QuizLeadRow {
  id: string
  criado_em: string
  nome: string
  telefone: string
  cidade: string | null
  uf: string | null
  especie: string | null
  categoria: string | null
  fora_de_escopo: 'peixe' | 'peletizada' | null
  modo: 'animais' | 'direto' | null
  numero_animais: number | null
  consumo_por_animal_mes: number | null
  toneladas_mes: number | null
  dias_por_semana: number | null
  horas_por_dia: number | null
  recebimento: string | null
  estoque_grao: string | null
  expedicao: string | null
  pesagem_automatica: boolean | null
  energia: string | null
  demanda_mensal_kg: number | null
  capacidade_kg_h: number | null
  compacta_linha: string | null
  compacta_codigo: string | null
  /**
   * Snapshot do que o produtor VIU na tela. Não recalcular a partir das
   * respostas: a escada de produtos muda, e a conversa do vendedor tem que
   * bater com o que apareceu pro cliente naquele dia.
   */
  resultado: { estacoes?: Estacao[]; alertas?: string[] } | null
  status: StatusLead
  notas_internas: string | null
  atendido_em: string | null
  origem: string | null
}

export function useQuizLeads(incluirDescartados = false) {
  return useQuery({
    queryKey: [...CHAVE, incluirDescartados],
    queryFn: async (): Promise<QuizLeadRow[]> => {
      let q = supabase
        .from('quiz_fabrica_respostas' as never)
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(300)
      if (!incluirDescartados) q = q.neq('status', 'descartado')
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as QuizLeadRow[]
    },
    staleTime: 60 * 1000,
  })
}

export function useAtualizarLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['quiz-fabrica', 'atualizar'],
    mutationFn: async (p: { id: string; status?: StatusLead; notas?: string }) => {
      const patch: Record<string, unknown> = {}
      if (p.status) {
        patch.status = p.status
        // Carimba quem/quando na primeira saída de "novo" — é o que separa lead
        // parado de lead trabalhado no relatório.
        if (p.status !== 'novo') {
          const { data: { user } } = await supabase.auth.getUser()
          patch.vendedor_id = user?.id ?? null
          patch.atendido_em = new Date().toISOString()
        }
      }
      if (p.notas !== undefined) patch.notas_internas = p.notas.trim() || null
      const { error } = await supabase
        .from('quiz_fabrica_respostas' as never)
        .update(patch)
        .eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE }) },
  })
}
