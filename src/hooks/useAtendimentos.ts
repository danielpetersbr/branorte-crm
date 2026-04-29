import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseAuditoria } from '@/lib/supabase'
import { ATENDIMENTO_PAGE_SIZE, type Atendimento, type StatusReal } from '@/types/atendimento'
import { DDD_TO_UF } from '@/lib/ddd-uf'

export type DataPreset = '' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes'

export interface AtendimentoFilters {
  search: string
  responsavel: string
  status_real: string
  uf: string
  data: DataPreset
  page: number
}

function dateRangeFromPreset(preset: DataPreset): { from?: string; to?: string } {
  if (!preset) return {}
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  if (preset === 'hoje') {
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'ontem') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() }
  }
  if (preset === '7d') {
    const f = new Date(now); f.setDate(f.getDate() - 6)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === '30d') {
    const f = new Date(now); f.setDate(f.getDate() - 29)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  if (preset === 'mes') {
    const f = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: startOfDay(f).toISOString(), to: endOfDay(now).toISOString() }
  }
  return {}
}

export function useAtendimentos(filters: AtendimentoFilters) {
  return useQuery({
    queryKey: ['atendimentos', filters],
    queryFn: async () => {
      let query = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('*', { count: 'exact' })
        .eq('is_internal', false)
        .order('ultima_msg', { ascending: false, nullsFirst: false })

      if (filters.search) {
        const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
        query = query.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`)
      }
      if (filters.responsavel) query = query.eq('responsavel', filters.responsavel)
      if (filters.status_real) query = query.eq('status_real', filters.status_real)
      const range = dateRangeFromPreset(filters.data)
      if (range.from) query = query.gte('data', range.from)
      if (range.to)   query = query.lte('data', range.to)
      if (filters.uf) {
        const ddds = Object.entries(DDD_TO_UF)
          .filter(([, uf]) => uf === filters.uf)
          .map(([ddd]) => ddd)
        if (ddds.length > 0) {
          const orExpr = ddds.map(ddd => `telefone.like.+55${ddd}%`).join(',')
          query = query.or(orExpr)
        }
      }

      const from = filters.page * ATENDIMENTO_PAGE_SIZE
      query = query.range(from, from + ATENDIMENTO_PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as Atendimento[], total: count ?? 0 }
    },
    placeholderData: prev => prev,
  })
}

export interface AtendimentoKpis {
  total: number
  byStatus: Record<StatusReal, number>
}

export function useAtendimentoKpis() {
  return useQuery({
    queryKey: ['atendimentos-kpis'],
    queryFn: async (): Promise<AtendimentoKpis> => {
      // 1 query agregada por status_real (Supabase REST não tem GROUP BY direto, então
      // fazemos uma chamada por status — barato porque são 6 buckets só).
      const statuses: StatusReal[] = [
        'Vendido', 'Em-andamento', 'Aguardando-Vendedor',
        'Abandonado', 'Sem-Resposta', 'Perdido',
      ]
      const totalReq = supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('*', { count: 'exact', head: true })
        .eq('is_internal', false)
      const statusReqs = statuses.map(s =>
        supabaseAuditoria
          .from('atendimentos_por_cliente')
          .select('*', { count: 'exact', head: true })
          .eq('is_internal', false)
          .eq('status_real', s)
      )
      const [totalRes, ...statusRes] = await Promise.all([totalReq, ...statusReqs])
      if (totalRes.error) throw totalRes.error

      const byStatus = {} as Record<StatusReal, number>
      statuses.forEach((s, i) => {
        byStatus[s] = statusRes[i].count ?? 0
      })

      return { total: totalRes.count ?? 0, byStatus }
    },
  })
}

export function useAtendimentoResponsaveis() {
  return useQuery({
    queryKey: ['atendimentos-responsaveis'],
    queryFn: async () => {
      // Distinct via: pegar responsaveis únicos da view (limit grande).
      const { data, error } = await supabaseAuditoria
        .from('atendimentos_por_cliente')
        .select('responsavel')
        .eq('is_internal', false)
        .not('responsavel', 'is', null)
        .limit(2000)
      if (error) throw error
      const set = new Set<string>()
      for (const r of (data ?? []) as { responsavel: string | null }[]) {
        if (r.responsavel) set.add(r.responsavel)
      }
      return Array.from(set).sort()
    },
    staleTime: 5 * 60_000,
  })
}

// Exclui um atendimento (ou todas as rows do mesmo cliente, via auditoria_ids).
// Usa RPC SECURITY DEFINER pq anon nao tem DELETE direto na tabela.
export function useDeleteAtendimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) throw new Error('Nenhum id pra excluir')
      const { data, error } = await supabaseAuditoria.rpc('delete_atendimentos', { p_ids: ids })
      if (error) throw error
      return data as { success: boolean; deleted?: number; error?: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['atendimentos'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-kpis'] })
      qc.invalidateQueries({ queryKey: ['atendimentos-responsaveis'] })
    },
  })
}
