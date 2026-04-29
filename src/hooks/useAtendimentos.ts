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
  hoje: number
  quentes: number
  clicaramBotao: number
  naoClicaram: number
  qualificados: number
  emAndamento: number
  byStatus: Record<StatusReal, number>
}

function startOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// Aplica os filtros base (search/responsavel/status/uf/data) na query head-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBaseFilters(query: any, filters?: Partial<AtendimentoFilters>): any {
  let q = query
  if (filters?.search) {
    const escaped = filters.search.replace(/[%_]/g, c => `\\${c}`)
    q = q.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`)
  }
  if (filters?.responsavel) q = q.eq('responsavel', filters.responsavel)
  if (filters?.status_real) q = q.eq('status_real', filters.status_real)
  if (filters?.uf) {
    const ddds = Object.entries(DDD_TO_UF).filter(([, uf]) => uf === filters.uf).map(([d]) => d)
    if (ddds.length > 0) q = q.or(ddds.map(d => `telefone.like.+55${d}%`).join(','))
  }
  if (filters?.data) {
    const range = dateRangeFromPreset(filters.data)
    if (range.from) q = q.gte('data', range.from)
    if (range.to)   q = q.lte('data', range.to)
  }
  return q
}

export function useAtendimentoKpis(filters?: Partial<AtendimentoFilters>) {
  // Cache key estavel ignorando page (KPIs nao paginam)
  const filterKey = JSON.stringify({
    search: filters?.search ?? '',
    responsavel: filters?.responsavel ?? '',
    status_real: filters?.status_real ?? '',
    uf: filters?.uf ?? '',
    data: filters?.data ?? '',
  })
  return useQuery({
    queryKey: ['atendimentos-kpis', filterKey],
    queryFn: async (): Promise<AtendimentoKpis> => {
      const baseQ = () => {
        const q = supabaseAuditoria
          .from('atendimentos_por_cliente')
          .select('*', { count: 'exact', head: true })
          .eq('is_internal', false)
        return applyBaseFilters(q, filters)
      }

      const todayIso = startOfTodayISO()

      const [
        totalRes,
        hojeRes,
        quentesRes,
        clicaramRes,
        naoClicaramRes,
        qualificadosRes,
        emAndamentoRes,
        vendidoRes, abandonadoRes, semRespostaRes, aguardandoRes, perdidoRes,
      ] = await Promise.all([
        baseQ(),
        baseQ().gte('data', todayIso),
        baseQ().eq('quando_investir', 'Agora'),
        baseQ().not('tocou_botao_em', 'is', null),
        baseQ().is('tocou_botao_em', null),
        baseQ().not('finalidade_fabrica', 'is', null).not('qual_animal', 'is', null),
        baseQ().eq('status_real', 'Em-andamento'),
        baseQ().eq('status_real', 'Vendido'),
        baseQ().eq('status_real', 'Abandonado'),
        baseQ().eq('status_real', 'Sem-Resposta'),
        baseQ().eq('status_real', 'Aguardando-Vendedor'),
        baseQ().eq('status_real', 'Perdido'),
      ])
      if (totalRes.error) throw totalRes.error

      const byStatus = {
        'Vendido':              vendidoRes.count ?? 0,
        'Em-andamento':         emAndamentoRes.count ?? 0,
        'Aguardando-Vendedor':  aguardandoRes.count ?? 0,
        'Abandonado':           abandonadoRes.count ?? 0,
        'Sem-Resposta':         semRespostaRes.count ?? 0,
        'Perdido':              perdidoRes.count ?? 0,
      } as Record<StatusReal, number>

      return {
        total:          totalRes.count ?? 0,
        hoje:           hojeRes.count ?? 0,
        quentes:        quentesRes.count ?? 0,
        clicaramBotao:  clicaramRes.count ?? 0,
        naoClicaram:    naoClicaramRes.count ?? 0,
        qualificados:   qualificadosRes.count ?? 0,
        emAndamento:    emAndamentoRes.count ?? 0,
        byStatus,
      }
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
