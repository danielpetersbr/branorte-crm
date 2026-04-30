import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface OrcamentoFile {
  id: number
  ano: number
  numero: string
  cliente: string
  equipamento: string | null
  fase_eletrica: string | null
  extras: string | null
  status_kanban: string
  subpasta: string | null
  path_principal: string
  extensoes_disponiveis: string[] | null
  qtd_arquivos_total: number | null
  mtime_iso: string | null
  size_bytes_principal: number | null
  contact_id: string | null
  vendor_id: string | null
  vendor_raw: string | null
}

export interface OrcamentosFilters {
  search: string         // busca em cliente + equipamento
  ano: string            // '' = todos
  status: string         // '' = todos
  comContato: '' | 'sim' | 'nao'
  page: number
}

export const ORCAMENTOS_PAGE_SIZE = 50

export function useOrcamentosFiles(filters: OrcamentosFilters) {
  return useQuery({
    queryKey: ['orcamentos-files', filters],
    queryFn: async () => {
      let query = supabase
        .from('orcamentos_files')
        .select('*', { count: 'exact' })

      if (filters.search) {
        const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
        query = query.or(`cliente.ilike.%${escaped}%,equipamento.ilike.%${escaped}%`)
      }
      if (filters.ano) query = query.eq('ano', Number(filters.ano))
      if (filters.status) query = query.eq('status_kanban', filters.status)
      if (filters.comContato === 'sim') query = query.not('contact_id', 'is', null)
      if (filters.comContato === 'nao') query = query.is('contact_id', null)

      // Mais recentes primeiro (mtime). Empate quebrado por id desc (=ordem de import).
      query = query
        .order('mtime_iso', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })

      const from = filters.page * ORCAMENTOS_PAGE_SIZE
      query = query.range(from, from + ORCAMENTOS_PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return {
        rows: (data ?? []) as OrcamentoFile[],
        total: count ?? 0,
      }
    },
    placeholderData: prev => prev,
    staleTime: 60_000,
  })
}
