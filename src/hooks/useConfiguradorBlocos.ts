import { supabase } from '@/lib/supabase'

// Blocos personalizados (primitivas com medidas) do configurador 3D — compartilhados pela equipe
// (mesmo modelo dos projetos). O CRM é dono da persistência (Supabase), o configurador emite
// upsert/delete via postMessage. `def` = FurnitureDef JSON (shape/material/medidas em cm).

export interface BlocoRow {
  id: string
  def: Record<string, unknown>
  created_by: string | null
  created_by_nome: string | null
  updated_at: string
}

// Lista os defs (o configurador só precisa do FurnitureDef).
export async function fetchConfiguradorBlocos(): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('configurador_blocos')
    .select('def')
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => (r as { def: Record<string, unknown> }).def)
}

export async function upsertConfiguradorBloco(
  def: Record<string, unknown> & { id?: string },
  createdBy?: string | null,
  createdByNome?: string | null,
): Promise<void> {
  const id = String(def.id ?? '')
  if (!id) return
  const { error } = await supabase
    .from('configurador_blocos')
    .upsert(
      { id, def, created_by: createdBy ?? null, created_by_nome: createdByNome ?? null },
      { onConflict: 'id' },
    )
  if (error) throw error
}

export async function deleteConfiguradorBloco(id: string): Promise<void> {
  if (!id) return
  const { error } = await supabase.from('configurador_blocos').delete().eq('id', id)
  if (error) throw error
}
