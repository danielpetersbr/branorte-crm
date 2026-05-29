import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface WascriptEtiqueta {
  id: number
  vendor_id: string | null
  vendedor_nome: string
  etiqueta_id_wascript: number
  etiqueta_nome: string
  etiqueta_nome_normalizado: string
  is_canonica: boolean
  total_contatos: number
  synced_at: string
}

/**
 * Lista todas as etiquetas Wascript persistidas (todos os vendedores).
 * UI agrupa client-side por vendedor.
 */
export function useEtiquetas() {
  return useQuery({
    queryKey: ['wascript-etiquetas'],
    queryFn: async (): Promise<WascriptEtiqueta[]> => {
      const { data, error } = await supabase
        .from('wascript_etiquetas')
        .select('*')
        .order('vendedor_nome')
        .order('total_contatos', { ascending: false })
        .order('etiqueta_nome_normalizado')
      if (error) throw error
      return (data ?? []) as WascriptEtiqueta[]
    },
    staleTime: 5 * 60_000,
  })
}

/** Agrupa etiquetas por nome normalizado do vendedor */
export function groupEtiquetasByVendedor(items: WascriptEtiqueta[]): Map<string, WascriptEtiqueta[]> {
  const m = new Map<string, WascriptEtiqueta[]>()
  for (const e of items) {
    const k = e.vendedor_nome.toUpperCase()
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(e)
  }
  return m
}
