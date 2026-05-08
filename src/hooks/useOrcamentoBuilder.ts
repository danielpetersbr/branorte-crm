import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface OrcamentoItem {
  letra: string         // A, B, C...
  qtd: number
  nome: string
  specs: string[]
  valor: number
}

export interface OrcamentoAcessorios {
  items: string[]
  valor: number
}

export interface OrcamentoMotor {
  cv: number
  polos: number
  valor: number
}

export interface OrcamentoModelo {
  id: number
  slug: string
  basename: string
  pacote: string         // COMPACTA 01/02/03, MINI FABRICA
  voltagem: 'monofasico' | 'trifasico'
  is_master: boolean
  is_jr: boolean
  com_balanca: boolean
  com_ensacadeira: boolean
  com_chupim: boolean
  producao_kgh: number | null
  armazenamento_kg: number | null
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  arquivo_origem: string | null
  template_path: string | null
  ativo: boolean
}

export interface ClienteDados {
  ac?: string
  fone?: string
  cidade?: string
  bairro?: string
  endereco?: string
  cep?: string
  cnpj?: string
  ie?: string
  email?: string
}

export interface OrcamentoCliente extends ClienteDados {
  id: number
  nome: string
}

export interface OrcamentoGerado {
  id: number
  numero: string                    // 2026 - 0691
  ano: number
  sequencial: number
  data_emissao: string
  vendedor_nome: string
  cliente_id: number | null
  cliente_nome: string
  cliente_dados: ClienteDados
  modelo_id: number | null
  modelo_basename: string | null
  voltagem: 'monofasico' | 'trifasico'
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  observacoes: string | null
  status: 'rascunho' | 'enviado' | 'aprovado' | 'perdido'
  pdf_url: string | null
  enviado_em: string | null
  created_at: string
  updated_at: string
}

// Lista todos os modelos (catalogo Branorte)
export function useOrcamentoModelos() {
  return useQuery({
    queryKey: ['orcamento-modelos'],
    queryFn: async (): Promise<OrcamentoModelo[]> => {
      const { data, error } = await supabase
        .from('orcamento_modelos')
        .select('*')
        .eq('ativo', true)
        .order('pacote')
        .order('producao_kgh', { ascending: true })
        .order('armazenamento_kg', { ascending: true })
      if (error) throw error
      return (data ?? []) as OrcamentoModelo[]
    },
    staleTime: 60 * 60 * 1000,  // 1h — catalogo muda raramente
  })
}

// Lista clientes recentes para autocomplete
export function useClientesOrcamento(search: string) {
  return useQuery({
    queryKey: ['orcamento-clientes', search],
    queryFn: async (): Promise<OrcamentoCliente[]> => {
      let q = supabase.from('orcamento_clientes').select('*').limit(20)
      if (search.trim()) q = q.ilike('nome', `%${search.trim()}%`)
      const { data, error } = await q.order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OrcamentoCliente[]
    },
    enabled: true,
    staleTime: 30_000,
  })
}

// Lista orçamentos gerados (recentes)
export function useOrcamentosGerados(filters?: { vendedor_nome?: string; status?: string }) {
  return useQuery({
    queryKey: ['orcamentos-gerados', filters],
    queryFn: async (): Promise<OrcamentoGerado[]> => {
      let q = supabase
        .from('orcamentos_gerados')
        .select('*')
        .order('data_emissao', { ascending: false })
        .order('sequencial', { ascending: false })
        .limit(100)
      if (filters?.vendedor_nome) q = q.eq('vendedor_nome', filters.vendedor_nome)
      if (filters?.status) q = q.eq('status', filters.status)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OrcamentoGerado[]
    },
    staleTime: 30_000,
  })
}

// Busca proximo numero (lê do banco e calcula 2026 - XXXX)
export async function obterProximoNumero(): Promise<{ ano: number; sequencial: number; numero: string }> {
  const ano = new Date().getFullYear()
  const { data, error } = await supabase.rpc('proximo_orcamento_sequencial', { p_ano: ano })
  if (error) throw error
  const seq = Number(data) || 1
  return {
    ano,
    sequencial: seq,
    numero: `${ano} - ${String(seq).padStart(4, '0')}`,
  }
}

export interface CriarOrcamentoInput {
  vendedor_nome: string
  vendedor_id?: string | null
  cliente_id?: number | null
  cliente_nome: string
  cliente_dados: ClienteDados
  modelo_id: number | null
  modelo_basename: string | null
  voltagem: 'monofasico' | 'trifasico'
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  observacoes?: string | null
  forma_pagamento?: string | null
  prazo_entrega?: string | null
  status?: 'rascunho' | 'enviado' | 'aprovado' | 'perdido'
}

export function useCriarOrcamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CriarOrcamentoInput): Promise<OrcamentoGerado> => {
      const { ano, sequencial, numero } = await obterProximoNumero()

      // Cria/atualiza cliente se tiver nome
      let cliente_id = input.cliente_id ?? null
      if (!cliente_id && input.cliente_nome.trim()) {
        const { data: cli } = await supabase
          .from('orcamento_clientes')
          .insert({
            nome: input.cliente_nome.trim(),
            ac: input.cliente_dados.ac ?? null,
            fone: input.cliente_dados.fone ?? null,
            cidade: input.cliente_dados.cidade ?? null,
            bairro: input.cliente_dados.bairro ?? null,
            endereco: input.cliente_dados.endereco ?? null,
            cep: input.cliente_dados.cep ?? null,
            cnpj: input.cliente_dados.cnpj ?? null,
            ie: input.cliente_dados.ie ?? null,
            email: input.cliente_dados.email ?? null,
          })
          .select('id')
          .single()
        cliente_id = cli?.id ?? null
      }

      const payload = {
        numero,
        ano,
        sequencial,
        data_emissao: new Date().toISOString().split('T')[0],
        vendedor_nome: input.vendedor_nome,
        vendedor_id: input.vendedor_id ?? null,
        cliente_id,
        cliente_nome: input.cliente_nome.trim(),
        cliente_dados: input.cliente_dados,
        modelo_id: input.modelo_id,
        modelo_basename: input.modelo_basename,
        voltagem: input.voltagem,
        itens: input.itens,
        acessorios: input.acessorios,
        motores: input.motores,
        total_equipamentos: input.total_equipamentos,
        total_motores: input.total_motores,
        total_proposta: input.total_proposta,
        observacoes: input.observacoes ?? null,
        forma_pagamento: input.forma_pagamento ?? null,
        prazo_entrega: input.prazo_entrega ?? null,
        status: input.status ?? 'rascunho',
      }
      const { data, error } = await supabase
        .from('orcamentos_gerados')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      return data as OrcamentoGerado
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-gerados'] })
      qc.invalidateQueries({ queryKey: ['orcamento-clientes'] })
    },
  })
}
