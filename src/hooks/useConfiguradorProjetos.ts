import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { idExternoProjeto, nomeClienteProjeto } from '@/lib/projeto-3d-identidade'

// Projetos 3D do configurador (branorte-configurador-3d), salvos no Supabase pra
// sincronizar entre dispositivos. Novos layouts exigem nome do cliente;
// o vínculo com um contato cadastrado continua opcional.
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
  ext_id?: string | null
  data: unknown
  thumbnail: string | null
}

// A galeria identifica a linha antiga por UUID quando não há ext_id.
// O JSON aberto deve usar a mesma identidade para os saves voltarem àquela linha.
function dataParaAbrir(row: { id: string; ext_id?: string | null; data: unknown }): unknown {
  return row.ext_id === null && row.data && typeof row.data === 'object'
    ? { ...row.data, id: row.id }
    : row.data
}

const KEY = ['configurador-projetos']

// Lista leve (sem o blob `data`) ordenada por atualização.
export function useConfiguradorProjetos(enabled = true) {
  return useQuery({
    queryKey: KEY,
    enabled,
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
  const row = data as ConfiguradorProjeto
  return { ...row, data: dataParaAbrir(row) }
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

export async function fetchConfiguradorProjetoMetaAtual(project: unknown): Promise<ConfiguradorProjetoMeta | null> {
  const extId = idExternoProjeto(project)
  if (!extId) throw new Error('O projeto aberto não informou sua identidade. Reabra o editor e tente novamente.')
  const { data, error } = await supabase.from('configurador_projetos').select(META_COLS).eq('ext_id', extId).maybeSingle()
  if (error) throw error
  if (data || !UUID_RE.test(extId)) return data as ConfiguradorProjetoMeta | null
  const { data: legacy, error: legacyError } = await supabase.from('configurador_projetos')
    .select(META_COLS).eq('id', extId).is('ext_id', null).maybeSingle()
  if (legacyError) throw legacyError
  return legacy as ConfiguradorProjetoMeta | null
}

// ext_id = id interno do projeto no configurador (fica dentro do JSON `data`). É a chave
// que a GALERIA COMPARTILHADA do iframe usa pra upsert — o modal Salvar precisa respeitá-la
// pra não criar linha duplicada de um projeto que o autosave já gravou.
const extIdOf = idExternoProjeto

// Upsert: com id → UPDATE; sem id → tenta UPDATE por ext_id (autosave da galeria pode já
// ter criado a linha) e só então INSERT. Retorna o meta salvo.
export function useSalvarConfiguradorProjeto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SalvarProjetoInput): Promise<ConfiguradorProjetoMeta> => {
      const extId = extIdOf(input.data)
      const clienteNome = input.cliente_nome?.trim() || nomeClienteProjeto(input.data)
      const projectData = input.data && typeof input.data === 'object'
        ? { ...input.data, name: input.nome, ...(clienteNome ? { clientName: clienteNome } : {}) }
        : input.data
      const patch = {
        nome: input.nome,
        ...(input.contact_id !== undefined ? { contact_id: input.contact_id } : {}),
        ...(clienteNome ? { cliente_nome: clienteNome } : {}),
        data: projectData,
        thumbnail: input.thumbnail ?? null,
      }
      if (input.id) {
        const { data, error } = await supabase
          .from('configurador_projetos')
          .update(patch)
          .eq('id', input.id)
          .select(META_COLS)
          .single()
        if (error) throw error
        return data as ConfiguradorProjetoMeta
      }
      if (extId) {
        const { data: upd, error: updErr } = await supabase
          .from('configurador_projetos')
          .update(patch)
          .eq('ext_id', extId)
          .select(META_COLS)
        if (updErr) throw updErr
        if (upd && upd.length) return upd[0] as ConfiguradorProjetoMeta
        if (UUID_RE.test(extId)) {
          const { data: legacy, error: legacyError } = await supabase.from('configurador_projetos')
            .update(patch).eq('id', extId).is('ext_id', null).select(META_COLS)
          if (legacyError) throw legacyError
          if (legacy && legacy.length) return legacy[0] as ConfiguradorProjetoMeta
        }
      }
      if (!clienteNome) throw new Error('Informe o nome do cliente antes de criar o layout.')
      const { data, error } = await supabase
        .from('configurador_projetos')
        .insert({
          ...patch,
          contact_id: input.contact_id ?? null,
          cliente_nome: clienteNome,
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
    .from('configurador_projetos').select('id,ext_id,data').eq('id', id).maybeSingle()
  if (e2) throw e2
  return byRow ? dataParaAbrir(byRow) : null
}

export async function bridgeSave(
  project: unknown,
  thumbnail: string | null,
  me: { id: string | null; nome: string | null },
): Promise<void> {
  const extId = extIdOf(project)
  if (!extId) throw new Error('projeto sem id')
  const nome = ((project as { name?: unknown })?.name as string) || 'Projeto sem nome'
  const clienteNome = nomeClienteProjeto(project)
  const patch: Record<string, unknown> = {
    nome,
    data: clienteNome ? { ...project as object, clientName: clienteNome } : project,
    ...(clienteNome ? { cliente_nome: clienteNome } : {}),
  }
  if (thumbnail) patch.thumbnail = thumbnail
  const { data: upd, error: updErr } = await supabase
    .from('configurador_projetos').update(patch).eq('ext_id', extId).select('id')
  if (updErr) throw updErr
  if (upd && upd.length) return
  if (UUID_RE.test(extId)) {
    const { data: legacy, error: legacyError } = await supabase.from('configurador_projetos')
      .update(patch).eq('id', extId).is('ext_id', null).select('id')
    if (legacyError) throw legacyError
    if (legacy && legacy.length) return
  }
  if (!clienteNome) throw new Error('Informe o nome do cliente antes de criar o layout.')
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
