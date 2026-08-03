/**
 * Acesso ao banco do módulo Venda de Ração.
 *
 * Tudo passa pelo client Supabase do CRM (mesma sessão do vendedor) — sem auth
 * paralela. A RLS é quem decide o que cada um enxerga: vendedor vê as próprias
 * simulações, admin (ou quem tem `venda_racao.ver_todas`) vê todas.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { mesclarConfig } from '@/lib/precificacao-racao/catalogo'
import type {
  ConfigVendaRacao, Especie, FormulaSalvaRow, IngredienteCatalogoRow,
  SimulacaoInput, SimulacaoRow, StatusProposta,
} from '@/lib/precificacao-racao/tipos'

const CHAVE_CONFIG = ['venda-racao', 'config'] as const
const CHAVE_SIMULACOES = ['venda-racao', 'simulacoes'] as const
const CHAVE_INGREDIENTES = ['venda-racao', 'ingredientes'] as const
const CHAVE_FORMULAS = ['venda-racao', 'formulas'] as const

// ---------------------------------------------------------------------------
// Config da empresa
// ---------------------------------------------------------------------------

export function useConfigVendaRacao() {
  return useQuery({
    queryKey: CHAVE_CONFIG,
    queryFn: async (): Promise<ConfigVendaRacao> => {
      const { data, error } = await supabase
        .from('venda_racao_config')
        // id=2 e a linha DESTE modulo. A id=1 pertence ao /producao-propria:
        // o shape do jsonb e outro, e quem salvasse por ultimo apagaria os
        // defaults do vizinho. Ver migration 20260803_discriminar_estudo_venda.
        .select('config')
        .eq('id', 2)
        .maybeSingle()
      if (error) throw error
      return mesclarConfig(data?.config)
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useSalvarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'config', 'salvar'],
    mutationFn: async (config: ConfigVendaRacao) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('venda_racao_config')
        .update({ config, updated_by: user?.id ?? null })
        .eq('id', 2)
      if (error) throw error
      return config
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_CONFIG }) },
  })
}

// ---------------------------------------------------------------------------
// Catálogo de ingredientes
// ---------------------------------------------------------------------------

export function useIngredientesCatalogo() {
  return useQuery({
    queryKey: CHAVE_INGREDIENTES,
    queryFn: async (): Promise<IngredienteCatalogoRow[]> => {
      const { data, error } = await supabase
        .from('venda_racao_ingredientes')
        .select('*')
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as IngredienteCatalogoRow[]
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useSalvarIngrediente() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'ingrediente', 'salvar'],
    mutationFn: async (ing: Partial<IngredienteCatalogoRow> & { nome: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const linha = {
        nome: ing.nome.trim(),
        preco: ing.preco ?? 0,
        unidade_preco: ing.unidade_preco ?? 'kg',
        peso_saco: ing.peso_saco ?? null,
        observacao: ing.observacao ?? null,
        ativo: ing.ativo ?? true,
      }
      if (ing.id) {
        const { error } = await supabase.from('venda_racao_ingredientes').update(linha).eq('id', ing.id)
        if (error) throw error
        return ing.id
      }
      const { data, error } = await supabase
        .from('venda_racao_ingredientes')
        .insert({ ...linha, created_by: user?.id ?? null })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_INGREDIENTES }) },
  })
}

export function useRemoverIngrediente() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'ingrediente', 'remover'],
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('venda_racao_ingredientes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_INGREDIENTES }) },
  })
}

// ---------------------------------------------------------------------------
// Fórmulas salvas
// ---------------------------------------------------------------------------

export function useFormulasSalvas(especie?: Especie) {
  return useQuery({
    queryKey: [...CHAVE_FORMULAS, especie ?? 'todas'],
    queryFn: async (): Promise<FormulaSalvaRow[]> => {
      let q = supabase.from('venda_racao_formulas').select('*').eq('ativo', true).order('nome')
      if (especie) q = q.eq('especie', especie)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as FormulaSalvaRow[]
    },
    staleTime: 60_000,
  })
}

export function useSalvarFormula() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'formula', 'salvar'],
    mutationFn: async (f: Partial<FormulaSalvaRow> & { nome: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const linha = {
        nome: f.nome.trim(),
        especie: f.especie ?? null,
        categoria: f.categoria ?? null,
        itens: f.itens ?? [],
        observacoes: f.observacoes ?? null,
        ativo: f.ativo ?? true,
      }
      if (f.id) {
        const { error } = await supabase.from('venda_racao_formulas').update(linha).eq('id', f.id)
        if (error) throw error
        return f.id
      }
      const { data, error } = await supabase
        .from('venda_racao_formulas')
        .insert({ ...linha, created_by: user?.id ?? null })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_FORMULAS }) },
  })
}

export function useRemoverFormula() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'formula', 'remover'],
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('venda_racao_formulas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_FORMULAS }) },
  })
}

// ---------------------------------------------------------------------------
// Simulações
// ---------------------------------------------------------------------------

export interface FiltrosSimulacao {
  busca?: string
  status?: StatusProposta | ''
  especie?: Especie | ''
  vendedor?: string
  de?: string
  ate?: string
}

/** Lista sem o JSONB `dados` — é pesado e a listagem não usa. */
const COLUNAS_LISTA =
  'id, codigo, created_by, vendedor_nome, cliente_nome, cliente_empresa, cliente_cidade, '
  + 'cliente_uf, especie, categoria, quantidade_kg, quantidade_mensal_kg, peso_saco, '
  + 'preco_negociado_kg, preco_sugerido_kg, preco_minimo_kg, margem_real_pct, valor_total, '
  + 'lucro_total, lucro_mensal, status, validade, created_at, updated_at'

export function useSimulacoes(filtros: FiltrosSimulacao = {}) {
  return useQuery({
    queryKey: [...CHAVE_SIMULACOES, filtros],
    queryFn: async () => {
      let q = supabase
        .from('venda_racao_simulacoes')
        .select(COLUNAS_LISTA)
        // A tabela e compartilhada com o /producao-propria; sem este filtro o
        // Historico de uma tela listaria as linhas da outra, e abrir a linha do
        // tipo errado quebraria o normalizarInput (o `dados` tem outro formato).
        .eq('tipo', 'venda')
        .order('created_at', { ascending: false })
        .limit(300)

      if (filtros.busca?.trim()) {
        const t = filtros.busca.trim()
        q = q.or(`cliente_nome.ilike.%${t}%,cliente_empresa.ilike.%${t}%,codigo.ilike.%${t}%`)
      }
      if (filtros.status) q = q.eq('status', filtros.status)
      if (filtros.especie) q = q.eq('especie', filtros.especie)
      if (filtros.vendedor?.trim()) q = q.ilike('vendedor_nome', `%${filtros.vendedor.trim()}%`)
      if (filtros.de) q = q.gte('created_at', `${filtros.de}T00:00:00`)
      if (filtros.ate) q = q.lte('created_at', `${filtros.ate}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as SimulacaoRow[]
    },
    staleTime: 30_000,
  })
}

/** Uma simulação completa (com `dados`) pra reabrir no formulário. */
export function useSimulacao(id: string | null) {
  return useQuery({
    queryKey: [...CHAVE_SIMULACOES, 'item', id],
    enabled: !!id,
    queryFn: async (): Promise<SimulacaoRow | null> => {
      if (!id) return null
      const { data, error } = await supabase
        .from('venda_racao_simulacoes')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as SimulacaoRow | null
    },
  })
}

export interface PayloadSimulacao {
  /** Presente = update; ausente = insert. */
  id?: string
  input: SimulacaoInput
  /** Números já calculados (o motor é a fonte da verdade, não o banco). */
  resumo: {
    quantidadeKg: number
    quantidadeMensalKg: number
    custoBasePorKg: number
    precoSugeridoPorKg: number
    precoMinimoPorKg: number
    precoNegociadoPorKg: number
    margemRealPct: number
    valorTotal: number
    lucroTotal: number
    lucroMensal: number
  }
}

function paraLinha(p: PayloadSimulacao) {
  const { input, resumo } = p
  const id = input.identificacao
  return {
    vendedor_nome: id.vendedorNome || null,
    cliente_nome: id.clienteNome.trim(),
    cliente_empresa: id.clienteEmpresa || null,
    cliente_cidade: id.clienteCidade || null,
    cliente_uf: id.clienteUf || null,
    cliente_telefone: id.clienteTelefone || null,
    especie: input.produto.especie,
    categoria: input.produto.categoria === 'outro'
      ? (input.produto.categoriaLivre || 'Outro')
      : input.produto.categoria,
    quantidade_kg: resumo.quantidadeKg,
    quantidade_mensal_kg: resumo.quantidadeMensalKg,
    peso_saco: input.quantidade.pesoSaco || 40,
    custo_base_kg: resumo.custoBasePorKg,
    margem_desejada_pct: input.venda.margemDesejadaPct,
    margem_minima_pct: input.venda.margemMinimaPct,
    preco_sugerido_kg: resumo.precoSugeridoPorKg,
    preco_minimo_kg: resumo.precoMinimoPorKg,
    preco_negociado_kg: resumo.precoNegociadoPorKg,
    margem_real_pct: resumo.margemRealPct,
    valor_total: resumo.valorTotal,
    lucro_total: resumo.lucroTotal,
    lucro_mensal: resumo.lucroMensal,
    status: input.status,
    validade: id.validade || null,
    observacoes: id.observacoesInternas || null,
    dados: input,
  }
}

export function useSalvarSimulacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'simulacao', 'salvar'],
    mutationFn: async (p: PayloadSimulacao): Promise<SimulacaoRow> => {
      if (!p.input.identificacao.clienteNome.trim()) {
        throw new Error('Informe o nome do cliente antes de salvar.')
      }
      const linha = paraLinha(p)

      if (p.id) {
        const { data, error } = await supabase
          .from('venda_racao_simulacoes')
          .update(linha)
          .eq('id', p.id)
          .select('*')
          .single()
        if (error) throw error
        return data as SimulacaoRow
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada — entre de novo pra salvar.')
      const { data, error } = await supabase
        .from('venda_racao_simulacoes')
        .insert({ ...linha, tipo: 'venda', created_by: user.id })
        .select('*')
        .single()
      if (error) throw error
      return data as SimulacaoRow
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_SIMULACOES }) },
  })
}

export function useAtualizarStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'simulacao', 'status'],
    mutationFn: async ({ id, status }: { id: string; status: StatusProposta }) => {
      const { error } = await supabase
        .from('venda_racao_simulacoes')
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_SIMULACOES }) },
  })
}

export function useRemoverSimulacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'simulacao', 'remover'],
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('venda_racao_simulacoes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_SIMULACOES }) },
  })
}
