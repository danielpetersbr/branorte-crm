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

// ── Camada de ORÇAMENTOS no mapa ──────────────────────────────────────────
// 1 ponto por cliente (telefone): orçamento mais recente define a idade/cor,
// total = soma dos orçamentos do cliente. lat/lng vem do cache de cidade.
export interface OrcamentoPonto {
  cliente: string | null
  telefone: string | null
  fone: string | null
  numeros: string | null
  cidade: string | null
  uf: string | null
  total: number | null
  n_orcamentos: number
  data_recente: string | null
  vendedor: string | null
  vendido: boolean
  lat: number
  lng: number
}

export function useOrcamentosMapa() {
  return useQuery<OrcamentoPonto[]>({
    queryKey: ['orcamentos-mapa'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mapa_orcamentos')
      if (error) throw error
      return (data ?? []) as OrcamentoPonto[]
    },
  })
}

// Lista per-orçamento (tabela + filtro de raio): nº, data, cliente, equipamento, cidade, vendido, coords
export interface OrcamentoLinha {
  numero: string | null
  data_emissao: string | null
  cliente: string | null
  equipamento: string | null
  cidade: string | null
  uf: string | null
  total: number | null
  vendido: boolean
  lat: number | null
  lng: number | null
}

export function useListaOrcamentos() {
  return useQuery<OrcamentoLinha[]>({
    queryKey: ['lista-orcamentos-mapa'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('lista_orcamentos_mapa')
      if (error) throw error
      return (data ?? []) as OrcamentoLinha[]
    },
  })
}

// Geocoda as cidades de orçamento que ainda não estão no cache (Nominatim, server-side)
export function useGeocodarCidades() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/geocode-cidades', { method: 'POST' })
      if (!r.ok) throw new Error('Falha no geocoding de cidades')
      return r.json() as Promise<{ atualizados: number; pendentes: number; falhas?: string[] }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orcamentos-mapa'] }),
  })
}
