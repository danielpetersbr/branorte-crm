import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CatalogoItem } from './useCatalogo'

// Item do catálogo com todos os campos de curadoria
export interface CatalogoItemAdmin extends CatalogoItem {
  is_oficial: boolean
  descricao: string | null
  foto_url: string | null
  acessorios_relacionados_ids: number[]
  items_relacionados_ids: number[]
  notas_curadoria: string | null
  atualizado_por: string | null
  atualizado_em: string | null
}

const BUCKET_FOTOS = 'catalogo-fotos'

// Helper: extrai path interno do bucket a partir de URL pública do Supabase Storage
export function extrairPathDaUrl(url: string): string | null {
  if (!url) return null
  const match = url.match(
    new RegExp(`/storage/v1/object/public/${BUCKET_FOTOS}/(.+)$`)
  )
  return match ? match[1] : null
}

// Lista TODOS os items (inclusive ativo=false), ordenados para painel de curadoria
export function useCatalogoItemsAdmin() {
  return useQuery({
    queryKey: ['catalogo-items-admin'],
    queryFn: async (): Promise<CatalogoItemAdmin[]> => {
      const { data, error } = await supabase
        .from('catalogo_items')
        .select('*')
        .order('is_oficial', { ascending: false })
        .order('ocorrencias', { ascending: false })
        .order('categoria', { ascending: true })
        .order('nome_curto', { ascending: true })
      if (error) throw error
      return (data ?? []) as CatalogoItemAdmin[]
    },
    staleTime: 30_000,
  })
}

// Atualiza qualquer subset de campos do item
export function useAtualizarItemCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number
      updates: Partial<CatalogoItemAdmin>
    }) => {
      const payload = {
        ...updates,
        atualizado_em: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('catalogo_items')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Toggle do flag "oficial"
export function useToggleOficialCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      is_oficial,
    }: {
      id: number
      is_oficial: boolean
    }) => {
      const { data, error } = await supabase
        .from('catalogo_items')
        .update({
          is_oficial,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Soft delete: marca ativo=false
export function useDeletarItemCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await supabase
        .from('catalogo_items')
        .update({
          ativo: false,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Upload de foto: envia ao bucket, pega URL pública e atualiza foto_url do item
export function useUploadFotoCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      file,
    }: {
      id: number
      file: File
    }): Promise<{ url: string }> => {
      const extFromName = file.name.includes('.')
        ? file.name.split('.').pop()
        : null
      const extFromType = file.type.split('/').pop()
      const ext = (extFromName || extFromType || 'jpg').toLowerCase()
      const timestamp = Date.now()
      const path = `items/${id}-${timestamp}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_FOTOS)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        })
      if (uploadError) throw uploadError

      const { data: publicData } = supabase.storage
        .from(BUCKET_FOTOS)
        .getPublicUrl(path)

      const url = publicData.publicUrl

      const { error: updateError } = await supabase
        .from('catalogo_items')
        .update({
          foto_url: url,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
      if (updateError) throw updateError

      return { url }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Remove foto: deleta do bucket e limpa foto_url do item
export function useRemoverFotoCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data: item, error: fetchError } = await supabase
        .from('catalogo_items')
        .select('foto_url')
        .eq('id', id)
        .single()
      if (fetchError) throw fetchError

      const fotoUrl = (item as { foto_url: string | null } | null)?.foto_url
      if (fotoUrl) {
        const path = extrairPathDaUrl(fotoUrl)
        if (path) {
          const { error: removeError } = await supabase.storage
            .from(BUCKET_FOTOS)
            .remove([path])
          if (removeError) throw removeError
        }
      }

      const { error: updateError } = await supabase
        .from('catalogo_items')
        .update({
          foto_url: null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
      if (updateError) throw updateError

      return { id }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Estatísticas agregadas do catálogo para o painel admin
export interface CatalogoStats {
  total: number
  oficiais: number
  pendentes: number
  com_foto: number
  com_motor: number
}

export function useStatsCatalogo() {
  return useQuery({
    queryKey: ['catalogo-stats'],
    queryFn: async (): Promise<CatalogoStats> => {
      const base = () =>
        supabase
          .from('catalogo_items')
          .select('*', { count: 'exact', head: true })

      const [totalRes, oficiaisRes, comFotoRes, comMotorRes] = await Promise.all([
        base().eq('ativo', true),
        base().eq('ativo', true).eq('is_oficial', true),
        base().eq('ativo', true).not('foto_url', 'is', null),
        base().eq('ativo', true).not('motor_padrao_cv', 'is', null),
      ])

      if (totalRes.error) throw totalRes.error
      if (oficiaisRes.error) throw oficiaisRes.error
      if (comFotoRes.error) throw comFotoRes.error
      if (comMotorRes.error) throw comMotorRes.error

      const total = totalRes.count ?? 0
      const oficiais = oficiaisRes.count ?? 0
      const com_foto = comFotoRes.count ?? 0
      const com_motor = comMotorRes.count ?? 0
      const pendentes = Math.max(total - oficiais, 0)

      return { total, oficiais, pendentes, com_foto, com_motor }
    },
    staleTime: 30_000,
  })
}
