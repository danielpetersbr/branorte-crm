// Contratos gerados (tabela `contratos`). O `dados` jsonb guarda o ContratoDados
// inteiro — e' isso que permite reabrir um contrato meses depois e editar
// exatamente como ele foi feito, sem recalcular do orcamento (que pode ter sido
// editado, ou ter virado outra coisa, no meio do caminho).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ContratoDados } from '@/lib/contrato/contrato-dados'

export type StatusContrato = 'rascunho' | 'gerado' | 'assinado' | 'registrado' | 'cancelado'

export interface ContratoLinha {
  id: number
  orcamento_id: number | null
  orcamento_numero: string
  cliente_id: number | null
  cliente_nome: string
  vendedor_nome: string
  valor_total: number
  data_contrato: string | null
  status: StatusContrato
  comarca: string | null
  assinado_em: string | null
  registrado_em: string | null
  registro_obs: string | null
  created_at: string
  updated_at: string
}

export interface ContratoCompleto extends ContratoLinha {
  dados: ContratoDados
}

export const STATUS_CONTRATO: Record<StatusContrato, { label: string; classe: string }> = {
  rascunho:   { label: 'Rascunho',   classe: 'bg-gray-100 text-gray-700 border-gray-300' },
  gerado:     { label: 'Gerado',     classe: 'bg-blue-100 text-blue-700 border-blue-300' },
  assinado:   { label: 'Assinado',   classe: 'bg-amber-100 text-amber-700 border-amber-300' },
  registrado: { label: 'Registrado', classe: 'bg-green-100 text-green-700 border-green-300' },
  cancelado:  { label: 'Cancelado',  classe: 'bg-red-100 text-red-700 border-red-300' },
}

const COLUNAS_LISTA =
  'id, orcamento_id, orcamento_numero, cliente_id, cliente_nome, vendedor_nome, valor_total, ' +
  'data_contrato, status, comarca, assinado_em, registrado_em, registro_obs, created_at, updated_at'

export function useContratos() {
  return useQuery({
    queryKey: ['contratos'],
    queryFn: async (): Promise<ContratoLinha[]> => {
      const { data, error } = await supabase
        .from('contratos')
        .select(COLUNAS_LISTA)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      // cast: a tabela `contratos` e' nova e ainda nao esta nos tipos gerados do Supabase
      const linhas = (data ?? []) as unknown as ContratoLinha[]
      return linhas.map(c => ({ ...c, valor_total: Number(c.valor_total) }))
    },
    staleTime: 30_000,
  })
}

export function useContrato(id: number | null) {
  return useQuery({
    queryKey: ['contrato', id],
    enabled: !!id,
    queryFn: async (): Promise<ContratoCompleto | null> => {
      const { data, error } = await supabase
        .from('contratos')
        .select(`${COLUNAS_LISTA}, dados`)
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const c = data as unknown as ContratoCompleto
      return { ...c, valor_total: Number(c.valor_total) }
    },
  })
}

function linhaDe(d: ContratoDados, status: StatusContrato) {
  return {
    orcamento_id: d.orcamentoId,
    orcamento_numero: d.orcamentoNumero,
    cliente_nome: d.comprador.nome,
    vendedor_nome: d.vendedorNome,
    valor_total: d.valorTotal,
    data_contrato: d.dataContrato || null,
    comarca: d.comarca || null,
    status,
    dados: d as unknown as Record<string, unknown>,
  }
}

/**
 * Salva (insert) ou atualiza (update) o contrato. `id` null = novo.
 * Nunca rebaixa o status: contrato ja assinado que e' salvo de novo continua
 * assinado, senao gerar o PDF outra vez apagaria o andamento.
 */
export function useSalvarContrato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: number | null; dados: ContratoDados; status: StatusContrato }) => {
      const { id, dados, status } = args
      if (id) {
        const { data: atual } = await supabase.from('contratos').select('status').eq('id', id).maybeSingle()
        const ordem: StatusContrato[] = ['rascunho', 'gerado', 'assinado', 'registrado']
        const atualIdx = ordem.indexOf((atual?.status as StatusContrato) ?? 'rascunho')
        const novoIdx = ordem.indexOf(status)
        const statusFinal = atual?.status === 'cancelado'
          ? 'cancelado' as StatusContrato
          : (novoIdx > atualIdx ? status : ((atual?.status as StatusContrato) ?? status))
        const { error } = await supabase
          .from('contratos')
          .update({ ...linhaDe(dados, statusFinal), updated_at: new Date().toISOString() })
          .eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('contratos')
        .insert(linhaDe(dados, status))
        .select('id')
        .single()
      if (error) throw error
      return Number(data.id)
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['contratos'] })
      qc.invalidateQueries({ queryKey: ['contrato', id] })
    },
  })
}

/** Muda só o andamento (assinado / registrado / cancelado), sem mexer no conteúdo. */
export function useAtualizarStatusContrato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      id: number
      status: StatusContrato
      assinado_em?: string | null
      registrado_em?: string | null
      registro_obs?: string | null
    }) => {
      const { id, ...patch } = args
      const { error } = await supabase
        .from('contratos')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['contratos'] })
      qc.invalidateQueries({ queryKey: ['contrato', id] })
    },
  })
}
