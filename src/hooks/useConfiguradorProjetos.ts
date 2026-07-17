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

const META_COLS = 'id,nome,contact_id,cliente_nome,created_by_nome,created_at,updated_at'

// ext_id = id interno do projeto no configurador (fica dentro do JSON `data`). É a chave
// que a GALERIA COMPARTILHADA do iframe usa pra upsert — o modal Salvar precisa respeitá-la
// pra não criar linha duplicada de um projeto que o autosave já gravou.
const extIdOf = (data: unknown): string | null => {
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === 'string' && id ? id : null
}

// Upsert: com id → UPDATE; sem id → tenta UPDATE por ext_id (autosave da galeria pode já
// ter criado a linha) e só então INSERT. Retorna o meta salvo.
export function useSalvarConfiguradorProjeto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalvarProjetoInput): Promise<ConfiguradorProjetoMeta> => {
      const extId = extIdOf(input.data)
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
          .select(META_COLS)
          .single()
        if (error) throw error
        return data as ConfiguradorProjetoMeta
      }
      if (extId) {
        const { data: upd, error: updErr } = await supabase
          .from('configurador_projetos')
          .update({
            nome: input.nome,
            contact_id: input.contact_id ?? null,
            cliente_nome: input.cliente_nome ?? null,
            data: input.data,
            thumbnail: input.thumbnail ?? null,
          })
          .eq('ext_id', extId)
          .select(META_COLS)
        if (!updErr && upd && upd.length) return upd[0] as ConfiguradorProjetoMeta
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
          ext_id: extId,
        })
        .select(META_COLS)
        .single()
      if (error) throw error
      return data as ConfiguradorProjetoMeta
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// ---- Ponte da GALERIA COMPARTILHADA (iframe → branorte:store:*) ----
// O configurador embutido não tem sessão no Supabase; estas funções rodam no CRM em nome
// dele. O `id` que o iframe manda é o ext_id; linhas legadas (ext_id NULL) aparecem na
// lista com o uuid da linha — por isso load/delete aceitam os dois.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BridgeListItem {
  id: string
  name: string
  updatedAt: string
  thumbnail: string | null
  createdByName: string | null
  createdById: string | null
}

export async function bridgeList(): Promise<BridgeListItem[]> {
  const { data, error } = await supabase
    .from('configurador_projetos')
    .select('id,ext_id,nome,thumbnail,created_by,created_by_nome,updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: (r.ext_id as string | null) ?? (r.id as string),
    name: r.nome as string,
    updatedAt: r.updated_at as string,
    thumbnail: (r.thumbnail as string | null) ?? null,
    createdByName: (r.created_by_nome as string | null) ?? null,
    createdById: (r.created_by as string | null) ?? null,
  }))
}

export async function bridgeLoad(id: string): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('configurador_projetos').select('data').eq('ext_id', id).maybeSingle()
  if (error) throw error
  if (data) return data.data
  if (!UUID_RE.test(id)) return null
  const { data: byRow, error: e2 } = await supabase
    .from('configurador_projetos').select('data').eq('id', id).maybeSingle()
  if (e2) throw e2
  return byRow?.data ?? null
}

export async function bridgeSave(
  project: unknown,
  thumbnail: string | null,
  me: { id: string | null; nome: string | null },
): Promise<void> {
  const extId = extIdOf(project)
  if (!extId) throw new Error('projeto sem id')
  const nome = ((project as { name?: unknown })?.name as string) || 'Projeto sem nome'
  const patch: Record<string, unknown> = { nome, data: project }
  if (thumbnail) patch.thumbnail = thumbnail
  const { data: upd, error: updErr } = await supabase
    .from('configurador_projetos').update(patch).eq('ext_id', extId).select('id')
  if (updErr) throw updErr
  if (upd && upd.length) return
  const { error: insErr } = await supabase.from('configurador_projetos').insert({
    ...patch,
    ext_id: extId,
    created_by: me.id,
    created_by_nome: me.nome,
  })
  if (insErr) {
    // corrida: outro save inseriu primeiro (unique ext_id) → vira update
    if (insErr.code === '23505') {
      const { error: retryErr } = await supabase
        .from('configurador_projetos').update(patch).eq('ext_id', extId)
      if (retryErr) throw retryErr
      return
    }
    throw insErr
  }
}

export async function bridgeDelete(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('configurador_projetos').delete().eq('ext_id', id).select('id')
  if (error) throw error
  if ((data?.length ?? 0) === 0 && UUID_RE.test(id)) {
    const { error: e2 } = await supabase.from('configurador_projetos').delete().eq('id', id)
    if (e2) throw e2
  }
}

export async function bridgeThumb(id: string, dataUrl: string): Promise<void> {
  await supabase.from('configurador_projetos').update({ thumbnail: dataUrl }).eq('ext_id', id)
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
