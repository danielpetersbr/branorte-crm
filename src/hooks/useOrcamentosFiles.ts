import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  docx_phone: string | null
  docx_phone_normalizado: string | null
  docx_ac: string | null
  status_manual: string | null
  status_manual_at: string | null
  ultimo_contato_em: string | null
  ultimo_contato_by: string | null
}

export type FollowUpFilter = '' | 'sem_contato' | 'recente' | 'medio' | 'vencido'
export type OrcamentoSort = 'recente' | 'follow_up'

export interface OrcamentosFilters {
  search: string         // busca em cliente + equipamento
  ano: string            // '' = todos
  mes: string            // '' = todos. '01'..'12'
  vendor_id: string      // '' = todos. 'unassigned' = sem vendor
  comContato: '' | 'sim' | 'nao'
  followUp: FollowUpFilter  // filtro por dias desde ultimo_contato_em
  sort: OrcamentoSort       // 'recente' = mtime; 'follow_up' = mais antigos sem contato primeiro
  page: number
}

// Limite de dias pra considerar lead "frio" — sem contato recente.
export const DIAS_FRIO = 14
export const DIAS_RECENTE = 7

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
      if (filters.mes && filters.ano) {
        // mes 1-12 + ano → range mtime_iso
        const m = Number(filters.mes)
        const yr = Number(filters.ano)
        const monthStr = String(m).padStart(2, '0')
        const nextYr = m === 12 ? yr + 1 : yr
        const nextMonth = m === 12 ? '01' : String(m + 1).padStart(2, '0')
        query = query
          .gte('mtime_iso', `${yr}-${monthStr}-01T00:00:00Z`)
          .lt('mtime_iso', `${nextYr}-${nextMonth}-01T00:00:00Z`)
      }
      if (filters.vendor_id === 'unassigned') {
        query = query.is('vendor_id', null)
      } else if (filters.vendor_id) {
        query = query.eq('vendor_id', filters.vendor_id)
      }
      if (filters.comContato === 'sim') query = query.not('contact_id', 'is', null)
      if (filters.comContato === 'nao') query = query.is('contact_id', null)

      // Filtro de follow-up — baseado em dias desde ultimo_contato_em
      if (filters.followUp) {
        const now = Date.now()
        const limiteRecente = new Date(now - DIAS_RECENTE * 86400_000).toISOString()
        const limiteFrio    = new Date(now - DIAS_FRIO    * 86400_000).toISOString()
        if (filters.followUp === 'sem_contato') {
          query = query.is('ultimo_contato_em', null)
        } else if (filters.followUp === 'recente') {
          query = query.gte('ultimo_contato_em', limiteRecente)
        } else if (filters.followUp === 'medio') {
          query = query.gte('ultimo_contato_em', limiteFrio).lt('ultimo_contato_em', limiteRecente)
        } else if (filters.followUp === 'vencido') {
          // Vencido = nunca contatou OU contatou há mais de DIAS_FRIO dias
          query = query.or(`ultimo_contato_em.is.null,ultimo_contato_em.lt.${limiteFrio}`)
        }
      }

      // Sort
      if (filters.sort === 'follow_up') {
        // Mais antigos sem contato primeiro (NULL = nunca falou, prioridade alta)
        query = query
          .order('ultimo_contato_em', { ascending: true, nullsFirst: true })
          .order('id', { ascending: false })
      } else {
        // Default: mais recentes primeiro (mtime). Empate quebrado por id desc.
        query = query
          .order('mtime_iso', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
      }

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

/** Atualiza ultimo_contato_em (vendor marca quando falou com o lead). */
export function useUpdateUltimoContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, dataIso }: { id: number; dataIso: string | null }) => {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user.id ?? null
      const { error } = await supabase
        .from('orcamentos_files')
        .update({
          ultimo_contato_em: dataIso,
          ultimo_contato_by: dataIso ? userId : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-files'] })
    },
  })
}

/** Atualiza status_manual de um orçamento (vendor pode mudar status visualmente). */
export function useUpdateOrcamentoStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string | null }) => {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user.id ?? null
      const { error } = await supabase
        .from('orcamentos_files')
        .update({
          status_manual: status,
          status_manual_at: status ? new Date().toISOString() : null,
          status_manual_by: status ? userId : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-files'] })
    },
  })
}
