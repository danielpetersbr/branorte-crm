import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { montarAreaClientes } from '@/lib/area-vendedor'
import { useWaKanban } from './useWaKanban'
import type { SupervisaoAchado } from './useSupervisaoVendedor'
import { useAuth } from './useAuth'
import { analisePrecalculadaSchema } from '@/lib/area-vendedor-analises'

/** Somente leitura. Achados da supervisão são restritos ao gestor nesta fase.
 * Polling atualiza registros existentes; NÃO dispara análise de IA.
 */
export function useAreaVendedor(vendedorNome: string | null, vendedorId: string | null, permitirSupervisao = false) {
  const { session, profile } = useAuth()
  const podeLerSupervisao = permitirSupervisao && profile?.role === 'admin' && !!session
  const carteira = useWaKanban(vendedorNome)
  const podeLerPrecalculada = !!session && !!profile?.approved_at &&
    profile.role !== 'pending' && profile.role !== 'rejected' &&
    (profile.role === 'admin' || profile.vendor_id === vendedorId)
  const precalculadas = useQuery({
    queryKey: ['area-vendedor', 'precalculadas', session?.user.id, vendedorId],
    enabled: !!vendedorId && podeLerPrecalculada,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('area_vendedor_analises')
        .select('vendedor_id,chat_id,gerado_em,snapshot_em,ultima_mensagem_em,snapshot_sha256,mensagens_analisadas,audios_sem_transcricao,historico_parcial,versao_contrato,origem,resumo,pendencias,proxima_acao,mensagem_sugerida,evidencias')
        .eq('vendedor_id', vendedorId!).order('gerado_em', { ascending: false }).limit(1000)
      if (error) throw error // tabela não aplicada é indisponível, NUNCA lista vazia
      return (data ?? []).map(row => analisePrecalculadaSchema.parse(row))
    },
  })
  const analises = useQuery({
    queryKey: ['area-vendedor', 'analises', session?.user.id, vendedorId, podeLerSupervisao],
    enabled: !!vendedorNome && !!vendedorId && podeLerSupervisao,
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async (): Promise<SupervisaoAchado[]> => {
      const { data, error } = await supabase.from('supervisao_achados')
        .select('id,vendedor_id,chat_id,categoria,tags,severidade,camada,regra_key,regra_versao,modelo,confianca,titulo,o_que_aconteceu,por_que_vendo,proxima_acao,score,score_motivo,estado,qtd_evidencias,detectado_em,atualizado_em,evidencias:supervisao_achado_evidencias(id,fonte,ref_tabela,ref_id,trecho,peso,ordem,ocorrido_em)')
        .eq('vendedor_id', vendedorId!).eq('estado', 'aberta')
        .order('score', { ascending: false }).limit(1000)
      if (error) throw error
      return (data ?? []) as unknown as SupervisaoAchado[]
    },
  })
  return {
    carteira,
    analises,
    precalculadas,
    // Conservador: 1000 também pode ser o total exato. Não afirmar carteira completa.
    precalculadasLimiteAtingido: (precalculadas.data?.length ?? 0) >= 1000,
    clientes: montarAreaClientes(carteira.data, podeLerSupervisao ? analises.data : []),
    atualizadoEm: carteira.dataUpdatedAt,
    atualizar: () => Promise.all([carteira.refetch(), ...(podeLerSupervisao && vendedorId ? [analises.refetch()] : []), ...(podeLerPrecalculada && vendedorId ? [precalculadas.refetch()] : [])]),
  }
}
