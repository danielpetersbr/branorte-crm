import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { addHumanNote } from '@/lib/crm-fields'

// ============================================================================
// Pool de Prospecção — vendedor pega contatos órfãos, trabalha com status
// próprio e devolve/expira por prazo. Toda escrita passa por RPCs SECURITY
// DEFINER no banco (claim atômico, cota, quarentena).
// ============================================================================

export interface PoolContato {
  id: string
  name: string | null
  phone: string | null
  telefone_normalizado: string | null
  city: string | null
  state: string | null
  origin: string | null
  data_orcamento: string | null
  descricao_orcamento: string | null
}

export interface MeuClaim {
  claim_id: string
  contact_id: string
  status: string
  motivo: string | null
  claimed_at: string
  expires_at: string
  released_at: string | null
  first_action_at: string | null
  last_action_at: string | null
  acoes_count: number
  renovado: boolean
  name: string | null
  phone: string | null
  telefone_normalizado: string | null
  city: string | null
  state: string | null
  origin: string | null
  notes: string | null
  data_orcamento: string | null
}

export interface MinhaCota {
  ativos: number
  cota: number
  lote_max: number
  prazo_dias: number
}

export interface MetricaVendedor {
  vendor_id: string
  vendor_name: string
  pegos: number
  trabalhados: number
  negociando: number
  convertidos: number
  sem_interesse: number
  devolvidos: number
  ativos: number
}

export interface ProspeccaoConfig {
  cota_ativos: number
  prazo_dias: number
  lote_max: number
  quarentena_dias: number
}

// Status que o vendedor troca com 1 toque (não-terminais)
export const PROSPECCAO_STATUS_ATIVOS = [
  { value: 'em_contato', label: 'Em contato' },
  { value: 'respondeu', label: 'Respondeu' },
  { value: 'negociando', label: 'Negociando' },
]

// Terminais: tiram o contato da lista ativa e liberam cota
export const PROSPECCAO_STATUS_TERMINAIS = [
  { value: 'convertido', label: 'Convertido 🎉' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'incontactavel', label: 'Incontactável' },
  { value: 'ja_cliente', label: 'Já é cliente' },
]

export const PROSPECCAO_STATUS_LABELS: Record<string, string> = {
  em_contato: 'Em contato',
  respondeu: 'Respondeu',
  negociando: 'Negociando',
  convertido: 'Convertido',
  sem_interesse: 'Sem interesse',
  incontactavel: 'Incontactável',
  ja_cliente: 'Já é cliente',
  devolvido: 'Devolvido',
  expirado: 'Expirado',
}

export const POOL_PAGE_SIZE = 30

export interface PoolFiltros {
  search: string
  uf: string
  origem: string
  page: number
}

export function usePoolProspeccao(filtros: PoolFiltros) {
  return useQuery({
    queryKey: ['prospeccao', 'pool', filtros],
    queryFn: async (): Promise<PoolContato[]> => {
      const { data, error } = await supabase.rpc('prospeccao_pool', {
        p_search: filtros.search || null,
        p_uf: filtros.uf || null,
        p_origem: filtros.origem || null,
        p_limit: POOL_PAGE_SIZE,
        p_offset: filtros.page * POOL_PAGE_SIZE,
      })
      if (error) throw error
      return (data ?? []) as PoolContato[]
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function usePoolCount(filtros: Omit<PoolFiltros, 'page'>) {
  return useQuery({
    queryKey: ['prospeccao', 'pool-count', filtros.search, filtros.uf, filtros.origem],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('prospeccao_pool_count', {
        p_search: filtros.search || null,
        p_uf: filtros.uf || null,
        p_origem: filtros.origem || null,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    staleTime: 5 * 60_000, // count em 168k linhas: cacheia 5 min
  })
}

export function useMinhaCota() {
  return useQuery({
    queryKey: ['prospeccao', 'cota'],
    queryFn: async (): Promise<MinhaCota> => {
      const { data, error } = await supabase.rpc('prospeccao_minha_cota')
      if (error) throw error
      return data as MinhaCota
    },
    staleTime: 30_000,
  })
}

export function useMeusClaims(ativos: boolean) {
  return useQuery({
    queryKey: ['prospeccao', 'meus', ativos],
    queryFn: async (): Promise<MeuClaim[]> => {
      const { data, error } = await supabase.rpc('prospeccao_meus', { p_ativos: ativos })
      if (error) throw error
      return (data ?? []) as MeuClaim[]
    },
    staleTime: 15_000,
  })
}

// ============================================================================
// Carteira do vendedor — TODOS os contatos com vendor_id = eu (não só os que
// peguei no pool). Traz o claim de prospecção anexado quando o contato veio do
// pool (claim_id != null), pra manter os controles de prazo nesses casos.
// ============================================================================

export interface CarteiraContato {
  contact_id: string
  name: string | null
  phone: string | null
  telefone_normalizado: string | null
  city: string | null
  state: string | null
  origin: string | null
  notes: string | null
  data_orcamento: string | null
  descricao_orcamento: string | null
  empresa: string | null
  is_closed: boolean
  status_contato: string | null
  valor_negociacao: number | null
  proximo_followup: string | null
  updated_at: string | null
  // Claim de prospecção ativo (null quando o contato não veio do pool)
  claim_id: string | null
  claim_status: string | null
  claim_motivo: string | null
  claimed_at: string | null
  expires_at: string | null
  first_action_at: string | null
  last_action_at: string | null
  acoes_count: number | null
  renovado: boolean | null
}

export interface CarteiraFiltros {
  search: string
  uf: string
  ativos: boolean // true = em aberto, false = fechados/vendas
  page: number
}

export const CARTEIRA_PAGE_SIZE = 30

export function useMinhaCarteira(filtros: CarteiraFiltros) {
  return useQuery({
    queryKey: ['prospeccao', 'carteira', filtros],
    queryFn: async (): Promise<CarteiraContato[]> => {
      const { data, error } = await supabase.rpc('prospeccao_minha_carteira', {
        p_search: filtros.search || null,
        p_uf: filtros.uf || null,
        p_ativos: filtros.ativos,
        p_limit: CARTEIRA_PAGE_SIZE,
        p_offset: filtros.page * CARTEIRA_PAGE_SIZE,
      })
      if (error) throw error
      return (data ?? []) as CarteiraContato[]
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

export function useMinhaCarteiraCount(filtros: Omit<CarteiraFiltros, 'page'>) {
  return useQuery({
    queryKey: ['prospeccao', 'carteira-count', filtros.search, filtros.uf, filtros.ativos],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('prospeccao_minha_carteira_count', {
        p_search: filtros.search || null,
        p_uf: filtros.uf || null,
        p_ativos: filtros.ativos,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    staleTime: 60_000,
  })
}

// Nota rápida em contato SEM claim (grava no notes; não "toca" prazo de pool)
export function useSalvarNotaContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { contactId: string; notesAtual: string | null; texto: string }) => {
      const novoNotes = addHumanNote(args.notesAtual, args.texto)
      const { error } = await supabase
        .from('contacts')
        .update({ notes: novoNotes, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospeccao'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export interface PegarResultado {
  ok: boolean
  erro?: string
  pegos?: string[]
  perdidos?: string[]
  ativos?: number
  cota?: number
}

export function usePegarContatos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (contactIds: string[]): Promise<PegarResultado> => {
      const { data, error } = await supabase.rpc('prospeccao_pegar', { p_contact_ids: contactIds })
      if (error) throw error
      return data as PegarResultado
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospeccao'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useAtualizarStatusClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { claimId: string; status: string; motivo?: string }) => {
      const { data, error } = await supabase.rpc('prospeccao_atualizar_status', {
        p_claim_id: args.claimId,
        p_status: args.status,
        p_motivo: args.motivo ?? null,
      })
      if (error) throw error
      const res = data as { ok: boolean; erro?: string; terminal?: boolean }
      if (!res.ok) throw new Error(res.erro ?? 'erro')
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospeccao'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useRenovarClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (claimId: string) => {
      const { data, error } = await supabase.rpc('prospeccao_renovar', { p_claim_id: claimId })
      if (error) throw error
      const res = data as { ok: boolean; erro?: string }
      if (!res.ok) throw new Error(res.erro ?? 'erro')
      return res
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospeccao'] }),
  })
}

// Nota rápida: grava no notes do contato (formato [dd/mm/aaaa] que o CRM já usa)
// e "toca" o claim pra renovar o prazo de posse.
export function useSalvarNotaProspeccao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { contactId: string; claimId: string; notesAtual: string | null; texto: string }) => {
      const novoNotes = addHumanNote(args.notesAtual, args.texto)
      const { error } = await supabase
        .from('contacts')
        .update({ notes: novoNotes, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      if (error) throw error
      await supabase.rpc('prospeccao_tocar', { p_claim_id: args.claimId })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospeccao', 'meus'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useMetricasProspeccao(dias: number) {
  return useQuery({
    queryKey: ['prospeccao', 'metricas', dias],
    queryFn: async (): Promise<MetricaVendedor[]> => {
      const { data, error } = await supabase.rpc('prospeccao_metricas', { p_dias: dias })
      if (error) throw error
      return (data ?? []) as MetricaVendedor[]
    },
    staleTime: 60_000,
  })
}

export function useProspeccaoConfig() {
  return useQuery({
    queryKey: ['prospeccao', 'config'],
    queryFn: async (): Promise<ProspeccaoConfig> => {
      const { data, error } = await supabase
        .from('prospeccao_config')
        .select('cota_ativos, prazo_dias, lote_max, quarentena_dias')
        .eq('id', 1)
        .single()
      if (error) throw error
      return data as ProspeccaoConfig
    },
    staleTime: 60_000,
  })
}

export function useSalvarProspeccaoConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { cota: number; prazo: number; lote: number }) => {
      const { data, error } = await supabase.rpc('prospeccao_config_set', {
        p_cota: args.cota,
        p_prazo: args.prazo,
        p_lote: args.lote,
      })
      if (error) throw error
      const res = data as { ok: boolean; erro?: string }
      if (!res.ok) throw new Error(res.erro ?? 'erro')
      return res
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospeccao'] }),
  })
}
