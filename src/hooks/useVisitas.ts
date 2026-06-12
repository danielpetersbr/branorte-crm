import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface Visita {
  id: string
  telefone: string | null
  nome: string | null
  cidade: string | null
  estado: string | null
  interesse: string | null
  vendedor_nome: string | null
  etiquetas: string[] | null
  valor_negociando: number | null
  lat: number | null
  lng: number | null
  created_at: string
}

export function useVisitas() {
  return useQuery<Visita[]>({
    queryKey: ['visitas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cliente_dados_visita')
        .select('id, telefone, nome, cidade, estado, interesse, vendedor_nome, etiquetas, valor_negociando, lat, lng, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Visita[]
    },
  })
}

// Dispara o geocoding dos registros sem coordenada (server-side via Nominatim)
export function useGeocodarVisitas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/geocode-visitas', { method: 'POST' })
      if (!r.ok) throw new Error('Falha no geocoding')
      return r.json() as Promise<{ atualizados: number; pendentes: number; falhas?: string[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitas'] }),
  })
}
