import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface CatalogoItem {
  id: number
  categoria: string
  subcategoria: string | null
  nome_curto: string
  nome_completo: string
  specs: string[]
  capacidade_kg: number | null
  capacidade_litros: number | null
  potencia_cv: number | null
  motor_padrao_cv: number | null
  motor_padrao_polos: number | null
  motor_padrao_qtd: number
  valor: number
  imagem_url: string | null
  ativo: boolean
  ordem: number
  ocorrencias: number
  is_oficial: boolean
  foto_url: string | null
  descricao: string | null
  acessorios_relacionados_ids: number[]
  /** Quando true, motor associado usa inversor → preço igual em mono e trif. */
  usa_inversor: boolean
  /** Lista de funções que o vendedor pode escolher ao adicionar (ex: alimentação/descarga). Vazio = sem escolha. */
  funcao_opcoes: string[]
  /** Chave de agrupamento (ex: HELICOIDAL_160x3.5). Usada para deduplicar variantes do mesmo equipamento. */
  tamanho_codigo: string | null
  /** Quando true, a função escolhida não aparece no PDF final (uso interno apenas). */
  ocultar_funcao_no_pdf: boolean
  /** FK ao catalogo_motores. Quando preenchido, o preço do motor é sempre o atual da tabela central. */
  motor_id: number | null
}

export interface CatalogoMotor {
  id: number
  cv: number
  polos: number
  voltagem: string
  valor: number
  ativo: boolean
  ocorrencias: number
}

export interface CatalogoAcessorio {
  id: number
  nome: string
  categoria: string | null
  valor: number
  ativo: boolean
  ocorrencias: number
}

// Lista de items do catálogo (ordenado por uso real — mais usados primeiro)
export function useCatalogoItems() {
  return useQuery({
    queryKey: ['catalogo-items'],
    queryFn: async (): Promise<CatalogoItem[]> => {
      const { data, error } = await supabase
        .from('catalogo_items')
        .select('*')
        .eq('ativo', true)
        .order('ocorrencias', { ascending: false })
        .order('categoria')
        .order('nome_curto')
      if (error) throw error
      return (data ?? []) as CatalogoItem[]
    },
    staleTime: 60 * 60 * 1000, // 1h
  })
}

export function useCatalogoMotores() {
  return useQuery({
    queryKey: ['catalogo-motores'],
    queryFn: async (): Promise<CatalogoMotor[]> => {
      const { data, error } = await supabase
        .from('catalogo_motores')
        .select('*')
        .eq('ativo', true)
        .order('cv')
        .order('polos')
      if (error) throw error
      return (data ?? []) as CatalogoMotor[]
    },
    staleTime: 60 * 60 * 1000,
  })
}

export function useCatalogoAcessorios() {
  return useQuery({
    queryKey: ['catalogo-acessorios'],
    queryFn: async (): Promise<CatalogoAcessorio[]> => {
      const { data, error } = await supabase
        .from('catalogo_acessorios')
        .select('*')
        .eq('ativo', true)
        .order('ocorrencias', { ascending: false })
      if (error) throw error
      return (data ?? []) as CatalogoAcessorio[]
    },
    staleTime: 60 * 60 * 1000,
  })
}

// Helper: lista única de categorias presentes (com contagem)
export function agruparPorCategoria(items: CatalogoItem[]): Array<{ categoria: string; qtd: number }> {
  const m = new Map<string, number>()
  for (const it of items) m.set(it.categoria, (m.get(it.categoria) || 0) + 1)
  return [...m.entries()]
    .map(([categoria, qtd]) => ({ categoria, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

// Helper: acha o motor compatível mais próximo do CV/polos de um item
export function acharMotorCompativel(
  motores: CatalogoMotor[],
  cv: number,
  polos: number,
  voltagem: 'monofasico' | 'trifasico',
): CatalogoMotor | null {
  // 1) match exato
  const exato = motores.find(m =>
    Number(m.cv) === cv && m.polos === polos && m.voltagem === voltagem,
  )
  if (exato) return exato
  // 2) match cv+polos (qualquer voltagem)
  const cvPolos = motores.find(m => Number(m.cv) === cv && m.polos === polos)
  if (cvPolos) return cvPolos
  // 3) só cv (qualquer polos+voltagem)
  const soCv = motores.find(m => Number(m.cv) === cv)
  if (soCv) return soCv
  return null
}
