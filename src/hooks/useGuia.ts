/**
 * Acesso ao banco do Guia do Vendedor.
 *
 * Tudo passa pelo client Supabase do CRM (mesma sessão do vendedor). A RLS
 * decide o que aparece: vendedor vê 'aprovado' e 'desatualizado'; quem tem
 * `guia.editar` vê rascunho e em_revisão também.
 *
 * O guia antigo era um HTML público na internet, sem login. Este não é.
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type {
  FrenteRevisao, GuiaAnimal, GuiaFonte, GuiaImagem, GuiaMateria, GuiaVersao,
  ItemFila, TipoItem,
} from '@/lib/guia/tipos'

const K_ANIMAIS = ['guia', 'animais'] as const
const K_MATERIAS = ['guia', 'materias'] as const
const K_IMAGENS = ['guia', 'imagens'] as const
const K_FONTES = ['guia', 'fontes'] as const
const K_FAVORITOS = ['guia', 'favoritos'] as const

// Conteúdo técnico muda pouco: 10 min de cache evita refetch no meio do atendimento.
const STALE = 10 * 60 * 1000

export function useGuiaAnimais() {
  return useQuery({
    queryKey: K_ANIMAIS,
    queryFn: async (): Promise<GuiaAnimal[]> => {
      const { data, error } = await supabase
        .from('guia_animais')
        .select('*')
        .neq('status', 'arquivado')
        .order('ordem', { ascending: true })
      if (error) throw error
      return (data ?? []) as GuiaAnimal[]
    },
    staleTime: STALE,
  })
}

export function useGuiaMaterias() {
  return useQuery({
    queryKey: K_MATERIAS,
    queryFn: async (): Promise<GuiaMateria[]> => {
      const { data, error } = await supabase
        .from('guia_materias')
        .select('*')
        .neq('status', 'arquivado')
        .order('ordem', { ascending: true })
      if (error) throw error
      return (data ?? []) as GuiaMateria[]
    },
    staleTime: STALE,
  })
}

export function useGuiaImagens() {
  return useQuery({
    queryKey: K_IMAGENS,
    queryFn: async (): Promise<GuiaImagem[]> => {
      const { data, error } = await supabase.from('guia_imagens').select('*').order('slug')
      if (error) throw error
      return (data ?? []) as GuiaImagem[]
    },
    staleTime: STALE,
  })
}

export function useGuiaFontes() {
  return useQuery({
    queryKey: K_FONTES,
    queryFn: async (): Promise<GuiaFonte[]> => {
      const { data, error } = await supabase.from('guia_fontes').select('*').order('chave')
      if (error) throw error
      return (data ?? []) as GuiaFonte[]
    },
    staleTime: STALE,
  })
}

/** Mapa slug → imagem, para o card não varrer o array a cada render. */
export function useMapaImagens() {
  const { data } = useGuiaImagens()
  return useMemo(() => {
    const m = new Map<string, GuiaImagem>()
    for (const i of data ?? []) m.set(i.slug, i)
    return m
  }, [data])
}

export function useMapaFontes() {
  const { data } = useGuiaFontes()
  return useMemo(() => {
    const m = new Map<string, GuiaFonte>()
    for (const f of data ?? []) m.set(f.chave, f)
    return m
  }, [data])
}

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
export function useFavoritos() {
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: K_FAVORITOS,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('guia_favoritos').select('tipo, slug')
      if (error) throw error
      return new Set((data ?? []).map(r => `${r.tipo}:${r.slug}`))
    },
    staleTime: STALE,
  })

  const alternar = useMutation({
    mutationFn: async ({ tipo, slug }: { tipo: TipoItem; slug: string }) => {
      const chave = `${tipo}:${slug}`
      const jaTem = q.data?.has(chave)
      if (jaTem) {
        const { error } = await supabase.from('guia_favoritos').delete()
          .eq('tipo', tipo).eq('slug', slug)
        if (error) throw error
        return { chave, marcado: false }
      }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sem sessão')
      const { error } = await supabase.from('guia_favoritos')
        .insert({ user_id: user.id, tipo, slug })
      if (error) throw error
      return { chave, marcado: true }
    },
    // Otimista: favoritar no meio do atendimento não pode esperar o round-trip.
    onMutate: async ({ tipo, slug }) => {
      await qc.cancelQueries({ queryKey: K_FAVORITOS })
      const antes = qc.getQueryData<Set<string>>(K_FAVORITOS)
      const novo = new Set(antes ?? [])
      const chave = `${tipo}:${slug}`
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
      qc.setQueryData(K_FAVORITOS, novo)
      return { antes }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(K_FAVORITOS, ctx.antes)
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: K_FAVORITOS }) },
  })

  return { favoritos: q.data ?? new Set<string>(), alternar, carregando: q.isLoading }
}

// ---------------------------------------------------------------------------
// Histórico recente — local. Não vale uma tabela: é preferência de sessão do
// vendedor naquele computador, não dado da empresa.
// ---------------------------------------------------------------------------
const CHAVE_RECENTES = 'guia:recentes'
const MAX_RECENTES = 12

export function lerRecentes(): Array<{ tipo: TipoItem; slug: string }> {
  try {
    const raw = localStorage.getItem(CHAVE_RECENTES)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function registrarRecente(tipo: TipoItem, slug: string) {
  try {
    const atual = lerRecentes().filter(r => !(r.tipo === tipo && r.slug === slug))
    atual.unshift({ tipo, slug })
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(atual.slice(0, MAX_RECENTES)))
  } catch { /* localStorage bloqueado: histórico é conveniência, não requisito */ }
}

// ---------------------------------------------------------------------------
// Edição (painel admin) — exige `guia.editar` na RLS
// ---------------------------------------------------------------------------
export function useSalvarAnimal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: Partial<GuiaAnimal> & { id: number }) => {
      const { id, ...campos } = a
      const { error } = await supabase.from('guia_animais').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: K_ANIMAIS }) },
  })
}

export function useSalvarMateria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: Partial<GuiaMateria> & { id: number }) => {
      const { id, ...campos } = m
      const { error } = await supabase.from('guia_materias').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: K_MATERIAS }) },
  })
}

export function useSalvarImagem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (i: Partial<GuiaImagem> & { id: number }) => {
      const { id, ...campos } = i
      const { error } = await supabase.from('guia_imagens').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: K_IMAGENS }) },
  })
}

export function useSalvarFonte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: Partial<GuiaFonte> & { id: number }) => {
      const { id, ...campos } = f
      const { error } = await supabase.from('guia_fontes').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: K_FONTES }) },
  })
}

/** Histórico de versões de um registro (snapshot antes de cada update). */
export function useVersoes(tabela: string, registroId: number | null) {
  return useQuery({
    queryKey: ['guia', 'versoes', tabela, registroId],
    enabled: !!registroId,
    queryFn: async (): Promise<GuiaVersao[]> => {
      const { data, error } = await supabase
        .from('guia_versoes')
        .select('*')
        .eq('tabela', tabela)
        .eq('registro_id', registroId!)
        .order('versao', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as GuiaVersao[]
    },
  })
}

// ---------------------------------------------------------------------------
// Fila de revisão e assinatura EM LOTE
//
// Existe porque o painel item-a-item não escala para o volume que a migração
// gerou: pedir a um nutricionista que abra 81 cards, um por um, garante que
// ninguém assina nunca. A view `guia_fila_revisao` já devolve quais frentes
// cada card exige e quais faltam; a assinatura vai por RPC, que valida a
// permissão e exige responsável nomeado do lado do banco.
// ---------------------------------------------------------------------------
const K_FILA = ['guia', 'fila-revisao'] as const

export function useFilaRevisao() {
  return useQuery({
    queryKey: K_FILA,
    queryFn: async (): Promise<ItemFila[]> => {
      const { data, error } = await supabase
        .from('guia_fila_revisao')
        .select('*')
        .order('nome')
      if (error) throw error
      return (data ?? []) as ItemFila[]
    },
    staleTime: 60 * 1000,
  })
}

/** Invalida tudo que a assinatura muda: a fila e os dois catálogos. */
function invalidarRevisao(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: K_FILA })
  qc.invalidateQueries({ queryKey: K_ANIMAIS })
  qc.invalidateQueries({ queryKey: K_MATERIAS })
  qc.invalidateQueries({ queryKey: K_IMAGENS })
}

export function useAssinarRevisao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      tabela: 'guia_animais' | 'guia_materias'
      slugs: string[]
      frente: FrenteRevisao
      por: string
    }): Promise<number> => {
      const { data, error } = await supabase.rpc('guia_assinar_revisao', {
        p_tabela: p.tabela, p_slugs: p.slugs, p_frente: p.frente, p_por: p.por,
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    onSuccess: () => invalidarRevisao(qc),
  })
}

export function useVerificarImagens() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { slugs: string[]; por: string }): Promise<number> => {
      const { data, error } = await supabase.rpc('guia_verificar_imagens', {
        p_slugs: p.slugs, p_por: p.por,
      })
      if (error) throw error
      return (data as number) ?? 0
    },
    onSuccess: () => invalidarRevisao(qc),
  })
}
