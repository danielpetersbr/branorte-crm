import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface PrecoBranorte {
  id: number
  categoria: string
  subcategoria: string | null
  codigo: string | null
  modelo: string | null
  descricao: string
  capacidade: string | null
  potencia: string | null
  motor_cv: number | null
  motor_polos: number | null
  // 2o motor (alguns equipamentos como pré-limpeza tem peneira + vibrador). Nullable.
  motor_cv_2: number | null
  motor_polos_2: number | null
  valor_equipamento: number | null
  valor_com_motor_trif: number | null
  valor_com_motor_mono: number | null
  valor_com_motor_trif_balanca: number | null
  valor_com_motor_mono_balanca: number | null
  valor_com_motorredutor: number | null
  producao_kgh: number | null
  armazenamento_kg: number | null
  dimensoes: string | null
  capacidade_litros: number | null
  capacidade_kg_milho: number | null
  capacidade_kg_pratica: number | null
  capacidade_ton: number | null
  volume_m3: number | null
  diametro_m: number | null
  altura_m: number | null
  aneis_qtd: number | null
  funil_tipo: string | null
  observacoes: string | null
  origem_aba: string | null
  ordem: number
  ativo: boolean
  created_at: string
  updated_at: string
}

export function usePrecosBranorte() {
  return useQuery({
    queryKey: ['precos-branorte'],
    queryFn: async (): Promise<PrecoBranorte[]> => {
      const { data, error } = await supabase
        .from('precos_branorte')
        .select('*')
        .eq('ativo', true)
        .order('categoria')
        .order('subcategoria', { nullsFirst: true })
        .order('ordem')
      if (error) throw error
      return (data ?? []) as PrecoBranorte[]
    },
    staleTime: 60 * 1000,
  })
}

export function useUpdatePrecoBranorte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<PrecoBranorte> }) => {
      const { error } = await supabase
        .from('precos_branorte')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['precos-branorte'] }),
  })
}

// Força sync de todos os 319 orcamento_modelos com os preços vigentes
export function useSyncTodosModelos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ modelos_atualizados: number; soma_proposta: number }> => {
      const { data, error } = await supabase.rpc('sync_todos_modelos')
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return row as { modelos_atualizados: number; soma_proposta: number }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamento-modelos'] })
    },
  })
}

// Estatísticas de integridade do catálogo (pra painel de auditoria)
export interface PrecosAuditStats {
  total_ativos: number
  sem_foto: number
  sem_link_oficial: number
  desatualizados_30d: number
}
export function usePrecosAudit() {
  return useQuery({
    queryKey: ['precos-audit'],
    queryFn: async (): Promise<PrecosAuditStats> => {
      const [{ count: total }, { count: semLink }, { count: desatualizados }] = await Promise.all([
        supabase.from('catalogo_items').select('id', { count: 'exact', head: true }).eq('ativo', true).eq('is_oficial', true),
        supabase.from('catalogo_items').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('is_oficial', true).is('preco_branorte_id', null)
          .in('categoria', ['TRANSPORTADOR', 'MISTURADOR', 'MOINHO', 'CAIXA', 'SILO', 'ELEVADOR', 'CAÇAMBA DE PESAGEM', 'PRE-LIMPEZA', 'PRE_LIMPEZA', 'ENSACADEIRA']),
        supabase.from('precos_branorte').select('id', { count: 'exact', head: true })
          .eq('ativo', true).lt('updated_at', new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
      ])
      const { count: semFoto } = await supabase
        .from('catalogo_items').select('id', { count: 'exact', head: true })
        .eq('ativo', true).eq('is_oficial', true).is('foto_url', null)
      return {
        total_ativos: total ?? 0,
        sem_foto: semFoto ?? 0,
        sem_link_oficial: semLink ?? 0,
        desatualizados_30d: desatualizados ?? 0,
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}
