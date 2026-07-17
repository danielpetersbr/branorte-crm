import { supabase } from '@/lib/supabase'

// Modelos 3D importados (GLB/STL) do configurador — compartilhados pela equipe (mesmo modelo dos
// blocos/projetos). O binário mora no bucket `configurador-modelos` (público); a `def` (FurnitureDef
// JSON com assetUrl+thumb+medidas em cm) fica na tabela `configurador_modelos`. O configurador (iframe)
// não tem sessão Supabase — quem sobe/persiste é o CRM, via RPC postMessage (branorte:model:*).

const BUCKET = 'configurador-modelos'

type Def = Record<string, unknown> & { id?: string; assetUrl?: string; thumb?: string; format?: string }

/** Lista as defs salvas (com assetUrl já apontando pro Storage). O configurador registra os loaders. */
export async function fetchConfiguradorModelos(): Promise<Def[]> {
  const { data, error } = await supabase
    .from('configurador_modelos')
    .select('def')
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => (r as { def: Def }).def)
}

/** Sobe o binário no Storage e faz upsert da def. Retorna a URL pública do arquivo. */
export async function saveConfiguradorModelo(args: {
  def: Def
  buffer: ArrayBuffer
  format: 'glb' | 'stl'
  thumb?: string | null
  createdBy?: string | null
  createdByNome?: string | null
}): Promise<string> {
  const id = String(args.def.id ?? '')
  if (!id) throw new Error('modelo sem id')
  const path = `models/${id}.${args.format}`
  const contentType = args.format === 'glb' ? 'model/gltf-binary' : 'model/stl'

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.buffer, { contentType, upsert: true, cacheControl: '31536000' })
  if (upErr) throw upErr

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const assetUrl = pub.publicUrl

  // A def guardada carrega assetUrl+format+thumb → outros usuários carregam o modelo por URL.
  const def: Def = { ...args.def, assetUrl, format: args.format }
  if (args.thumb) def.thumb = args.thumb

  const { error } = await supabase
    .from('configurador_modelos')
    .upsert(
      {
        id,
        def,
        format: args.format,
        storage_path: path,
        thumb: args.thumb ?? null,
        created_by: args.createdBy ?? null,
        created_by_nome: args.createdByNome ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  if (error) throw error
  return assetUrl
}

export async function deleteConfiguradorModelo(id: string): Promise<void> {
  if (!id) return
  // Remove o binário (tenta os dois formatos — não sabemos qual sem consultar) e a row.
  const { data } = await supabase.from('configurador_modelos').select('storage_path').eq('id', id).maybeSingle()
  const path = (data as { storage_path?: string } | null)?.storage_path
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
  const { error } = await supabase.from('configurador_modelos').delete().eq('id', id)
  if (error) throw error
}
