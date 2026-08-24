/**
 * Acesso ao banco do módulo Produção Própria (/producao-propria).
 *
 * As tabelas mantêm o nome `venda_racao_*` de quando o módulo era de
 * precificação: renomeá-las quebraria RLS, grants e os estudos já salvos. O que
 * mudou foi o significado das colunas, não o endereço.
 *
 * Tudo passa pelo client Supabase do CRM (mesma sessão do vendedor) — sem auth
 * paralela. A RLS é quem decide o que cada um enxerga: vendedor vê os próprios
 * estudos, admin (ou quem tem `venda_racao.ver_todas`) vê todos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fasesDoProduto, mesclarConfig } from '@/lib/venda-racao/catalogo'
import type {
  ConfigEstudo, Especie, EstudoInput, EstudoRow, FormulaSalvaRow,
  IngredienteCatalogoRow, StatusEstudo,
} from '@/lib/venda-racao/tipos'

const CHAVE_CONFIG = ['venda-racao', 'config'] as const
const CHAVE_ESTUDOS = ['venda-racao', 'estudos'] as const
const CHAVE_INGREDIENTES = ['venda-racao', 'ingredientes'] as const
const CHAVE_FORMULAS = ['venda-racao', 'formulas'] as const

// ---------------------------------------------------------------------------
// Config da empresa
// ---------------------------------------------------------------------------

export function useConfigEstudo() {
  return useQuery({
    queryKey: CHAVE_CONFIG,
    queryFn: async (): Promise<ConfigEstudo> => {
      const { data, error } = await supabase
        .from('venda_racao_config')
        .select('config')
        .eq('id', 1)
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
    mutationFn: async (config: ConfigEstudo) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('venda_racao_config')
        .update({ config, updated_by: user?.id ?? null })
        .eq('id', 1)
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
// Estudos
// ---------------------------------------------------------------------------

export interface FiltrosEstudo {
  busca?: string
  status?: StatusEstudo | ''
  especie?: Especie | ''
  vendedor?: string
  de?: string
  ate?: string
  /** 'nao' (padrão) esconde arquivados; 'sim' mostra só eles; 'todos' não filtra. */
  arquivados?: 'nao' | 'sim' | 'todos'
}

/** Lista sem o JSONB `dados` — é pesado e a listagem não usa. */
const COLUNAS_LISTA =
  'id, codigo, created_by, vendedor_nome, cliente_nome, cliente_empresa, cliente_cidade, '
  + 'cliente_uf, especie, categoria, quantidade_kg, quantidade_mensal_kg, peso_saco, '
  + 'custo_atual_kg, custo_proprio_kg, economia_kg, economia_mensal, economia_anual, '
  + 'reducao_pct, capacidade_kg_hora, investimento_total, payback_meses, '
  + 'status, arquivado, validade, created_at, updated_at'

export function useEstudos(filtros: FiltrosEstudo = {}) {
  return useQuery({
    queryKey: [...CHAVE_ESTUDOS, filtros],
    queryFn: async () => {
      let q = supabase
        .from('venda_racao_simulacoes')
        .select(COLUNAS_LISTA)
        // A tabela é compartilhada com o /venda-racao (precificação da venda),
        // que grava tipo='venda' e tem outro formato no `dados`. Sem o filtro,
        // este Histórico listaria as linhas de lá. O insert daqui não seta o
        // campo — o default da coluna é 'estudo'.
        .eq('tipo', 'estudo')
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
      if (filtros.arquivados === 'sim') q = q.eq('arquivado', true)
      else if (filtros.arquivados !== 'todos') q = q.eq('arquivado', false)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as EstudoRow[]
    },
    staleTime: 30_000,
  })
}

/** Um estudo completo (com `dados`) pra reabrir no formulário. */
export function useEstudo(id: string | null) {
  return useQuery({
    queryKey: [...CHAVE_ESTUDOS, 'item', id],
    enabled: !!id,
    queryFn: async (): Promise<EstudoRow | null> => {
      if (!id) return null
      const { data, error } = await supabase
        .from('venda_racao_simulacoes')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as EstudoRow | null
    },
  })
}

export interface PayloadEstudo {
  /** Presente = update; ausente = insert. */
  id?: string
  input: EstudoInput
  /** Números já calculados (o motor é a fonte da verdade, não o banco). */
  resumo: {
    consumoMensalKg: number
    custoAtualPorKg: number
    custoProprioPorKg: number
    economiaPorKg: number
    economiaMensal: number
    economiaAnual: number
    reducaoPct: number
    capacidadeKgHora: number
    investimentoTotal: number
    /** null quando não há economia — payback não existe, e o banco guarda null. */
    paybackMeses: number | null
  }
}

function paraLinha(p: PayloadEstudo) {
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
    // Multi-fase salva todas as chaves juntas: a listagem tem que mostrar o
    // estudo inteiro, não só a fase que a fórmula atende. O `dados` jsonb abaixo
    // continua sendo a fonte completa.
    categoria: fasesDoProduto(input.produto)
      .map(c => (c === 'outro' ? (input.produto.categoriaLivre || 'Outro') : c))
      .join('+'),

    // quantidade_kg fica igual ao mensal: no estudo não existe "pedido"
    quantidade_kg: resumo.consumoMensalKg,
    quantidade_mensal_kg: resumo.consumoMensalKg,
    peso_saco: input.necessidade.pesoSaco || 40,

    custo_atual_kg: resumo.custoAtualPorKg,
    custo_proprio_kg: resumo.custoProprioPorKg,
    economia_kg: resumo.economiaPorKg,
    economia_mensal: resumo.economiaMensal,
    economia_anual: resumo.economiaAnual,
    reducao_pct: resumo.reducaoPct,
    capacidade_kg_hora: resumo.capacidadeKgHora,
    investimento_total: resumo.investimentoTotal,
    payback_meses: resumo.paybackMeses,

    status: input.status,
    validade: id.validade || null,
    observacoes: id.observacoesInternas || null,
    dados: input,
  }
}

export function useSalvarEstudo() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'estudo', 'salvar'],
    mutationFn: async (p: PayloadEstudo): Promise<EstudoRow> => {
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
        return data as EstudoRow
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada — entre de novo pra salvar.')
      const { data, error } = await supabase
        .from('venda_racao_simulacoes')
        .insert({ ...linha, created_by: user.id })
        .select('*')
        .single()
      if (error) throw error
      return data as EstudoRow
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_ESTUDOS }) },
  })
}

export function useAtualizarStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'estudo', 'status'],
    mutationFn: async ({ id, status }: { id: string; status: StatusEstudo }) => {
      const { error } = await supabase
        .from('venda_racao_simulacoes')
        .update({ status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_ESTUDOS }) },
  })
}

export function useArquivarEstudo() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'estudo', 'arquivar'],
    mutationFn: async ({ id, arquivado }: { id: string; arquivado: boolean }) => {
      const { error } = await supabase
        .from('venda_racao_simulacoes')
        .update({ arquivado })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_ESTUDOS }) },
  })
}

export function useRemoverEstudo() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['venda-racao', 'estudo', 'remover'],
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('venda_racao_simulacoes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: CHAVE_ESTUDOS }) },
  })
}
