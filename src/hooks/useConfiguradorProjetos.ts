import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Projetos 3D do configurador (branorte-configurador-3d), salvos no Supabase pra
// sincronizar entre dispositivos e (opcionalmente) ficarem ligados a um cliente.
// O campo `data` guarda o Project inteiro (JSON do configurador). A lista NÃO traz
// `data` (pode ser grande) — o blob só é buscado ao abrir um projeto.

export interface ConfiguradorProjetoMeta {
  id: string
  nome: string
  contact_id: string | null
  cliente_nome: string | null
  created_by_nome: string | null
  created_at: string
  updated_at: string
}

export interface ConfiguradorProjeto extends ConfiguradorProjetoMeta {
  data: unknown
  thumbnail: string | null
}

const KEY = ['configurador-projetos']

// Lista leve (sem o blob `data`) ordenada por atualização.
export function useConfiguradorProjetos() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ConfiguradorProjetoMeta[]> => {
      const { data, error } = await supabase
        .from('configurador_projetos')
        .select('id,nome,contact_id,cliente_nome,created_by_nome,created_at,updated_at')
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ConfiguradorProjetoMeta[]
    },
  })
}

// Busca o projeto completo (com o `data`) — usado ao abrir pra mandar pro iframe.
export async function fetchConfiguradorProjeto(id: string): Promise<ConfiguradorProjeto> {
  const { data, error } = await supabase
    .from('configurador_projetos')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as ConfiguradorProjeto
}

export interface SalvarProjetoInput {
  id?: string | null // presente = atualiza; ausente = cria
  nome: string
  contact_id?: string | null
  cliente_nome?: string | null
  data: unknown
  thumbnail?: string | null
  created_by?: string | null
  created_by_nome?: string | null
}

// Upsert: com id → UPDATE; sem id → INSERT. Retorna o meta salvo.
export function useSalvarConfiguradorProjeto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalvarProjetoInput): Promise<ConfiguradorProjetoMeta> => {
      if (input.id) {
        const { data, error } = await supabase
          .from('configurador_projetos')
          .update({
            nome: input.nome,
            contact_id: input.contact_id ?? null,
            cliente_nome: input.cliente_nome ?? null,
            data: input.data,
            thumbnail: input.thumbnail ?? null,
          })
          .eq('id', input.id)
          .select('id,nome,contact_id,cliente_nome,created_by_nome,created_at,updated_at')
          .single()
        if (error) throw error
        return data as ConfiguradorProjetoMeta
      }
      const { data, error } = await supabase
        .from('configurador_projetos')
        .insert({
          nome: input.nome,
          contact_id: input.contact_id ?? null,
          cliente_nome: input.cliente_nome ?? null,
          data: input.data,
          thumbnail: input.thumbnail ?? null,
          created_by: input.created_by ?? null,
          created_by_nome: input.created_by_nome ?? null,
        })
        .select('id,nome,contact_id,cliente_nome,created_by_nome,created_at,updated_at')
        .single()
      if (error) throw error
      return data as ConfiguradorProjetoMeta
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletarConfiguradorProjeto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('configurador_projetos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export interface ContatoBusca {
  id: string
  name: string | null
  phone: string | null
}

// Busca leve de contatos por nome/telefone pra vincular o projeto ao cliente (ilike, limit 8).
export function useBuscarContatos(term: string) {
  const q = term.trim()
  return useQuery({
    queryKey: ['contatos-busca-projeto', q],
    enabled: q.length >= 2,
    queryFn: async (): Promise<ContatoBusca[]> => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id,name,phone')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8)
      if (error) throw error
      return (data ?? []) as ContatoBusca[]
    },
  })
}
