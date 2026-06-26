// Contagem REAL de orçamentos do Dashboard: leads (atendimentos que chegaram no
// período) cujo telefone tem orçamento montado em orcamentos_gerados (match por
// fone_canon). Substitui a contagem por etiqueta do WhatsApp, que subconta quando
// o vendedor esquece de marcar a etiqueta de "orçamento".
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseCustomRange, type DashboardPreset } from './useDashboard'

function rangeFor(preset: DashboardPreset): { from: string | null; to: string | null } {
  if (!preset) return { from: null, to: null } // 'Tudo' = sem corte de data
  const c = parseCustomRange(preset)
  if (c) return { from: c.from.toISOString(), to: c.to.toISOString() }
  const now = new Date()
  const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  if (preset === 'hoje') return { from: sod(now).toISOString(), to: eod(now).toISOString() }
  if (preset === 'ontem') { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: sod(y).toISOString(), to: eod(y).toISOString() } }
  if (preset === '7d') { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: sod(f).toISOString(), to: eod(now).toISOString() } }
  if (preset === '30d') { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: sod(f).toISOString(), to: eod(now).toISOString() } }
  if (preset === 'mes') return { from: sod(new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(), to: eod(now).toISOString() }
  return { from: null, to: null }
}

/** Nº de leads no período com orçamento montado (match por telefone). */
export function useDashboardOrcamentos(preset: DashboardPreset) {
  const { from, to } = rangeFor(preset)
  return useQuery({
    queryKey: ['dashboard-orcamentos', from, to],
    queryFn: async (): Promise<number> => {
      const { data, error } = await (supabase as any).rpc('dashboard_orcamentos_periodo', { p_from: from, p_to: to })
      if (error) throw error
      return Number(data ?? 0)
    },
    staleTime: 60_000,
  })
}

export type VendasPeriodo = { qtd: number; valor: number; qtdLead: number; valorLead: number }

/** Vendas (pedidos não-cancelados) com data_venda no período + valor convertido (R$).
 *  Detecta a venda pelo pedido (orçamento→pedido), não só pela etiqueta VENDIDO.
 *  qtdLead/valorLead = subconjunto amarrado a um lead do atendimento (orçamento→telefone→atendimento). */
export function useDashboardVendas(preset: DashboardPreset) {
  const { from, to } = rangeFor(preset)
  return useQuery({
    queryKey: ['dashboard-vendas', from, to],
    queryFn: async (): Promise<VendasPeriodo> => {
      const { data, error } = await (supabase as any).rpc('dashboard_vendas_periodo', { p_from: from, p_to: to })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return {
        qtd: Number(row?.qtd ?? 0),
        valor: Number(row?.valor ?? 0),
        qtdLead: Number(row?.qtd_lead ?? 0),
        valorLead: Number(row?.valor_lead ?? 0),
      }
    },
    staleTime: 60_000,
  })
}

// ─── Atribuição de orçamento/venda REAIS por criativo e por origem ──────────
// Cruza os leads do período (atendimentos) com orcamentos_gerados (orçamento real,
// match por telefone) e mirror_pedidos_venda (venda real, via orçamento→pedido).
// Substitui a contagem por ETIQUETA nas tabelas "por criativo" e "por origem",
// que subconta. Keyed por criativo_codigo / origem crua (mesma chave do dashboard).
export type OrcVendaAttr = { orc: number; venda: number; valor: number }

function buildAttrMap(rows: any[], keyField: string): Map<string, OrcVendaAttr> {
  const m = new Map<string, OrcVendaAttr>()
  for (const r of (rows ?? [])) {
    const k = r?.[keyField]
    if (k == null) continue
    m.set(String(k), { orc: Number(r.orc ?? 0), venda: Number(r.venda ?? 0), valor: Number(r.valor ?? 0) })
  }
  return m
}

export function useDashboardOrcVendaPorCriativo(preset: DashboardPreset) {
  const { from, to } = rangeFor(preset)
  return useQuery({
    queryKey: ['dash-orcvenda-criativo', from, to],
    queryFn: async (): Promise<Map<string, OrcVendaAttr>> => {
      const { data, error } = await (supabase as any).rpc('dashboard_orcvenda_por_criativo', { p_from: from, p_to: to })
      if (error) throw error
      return buildAttrMap(data, 'criativo')
    },
    staleTime: 60_000,
  })
}

export function useDashboardOrcVendaPorOrigem(preset: DashboardPreset) {
  const { from, to } = rangeFor(preset)
  return useQuery({
    queryKey: ['dash-orcvenda-origem', from, to],
    queryFn: async (): Promise<Map<string, OrcVendaAttr>> => {
      const { data, error } = await (supabase as any).rpc('dashboard_orcvenda_por_origem', { p_from: from, p_to: to })
      if (error) throw error
      return buildAttrMap(data, 'origem')
    },
    staleTime: 60_000,
  })
}
