import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Resumo das PROPOSTAS montadas no builder de orçamento (tabela orcamentos_gerados).
// É a única fonte real de R$ no fluxo de lead. O status 'enviado'/'rascunho' do
// builder NÃO é confiável (o vendedor manda a proposta pro cliente de qualquer jeito,
// independente de marcar no sistema), então contamos a PROPOSTA MONTADA, sem distinguir
// enviada de rascunho. Daniel (dono fazendo testes) fica de fora.

export interface OrcamentosResumo {
  geradas: number          // propostas montadas no período
  valorTotalBRL: number    // soma total_proposta de todas as montadas
  ticketMedioBRL: number   // valorTotalBRL / geradas
  porVendedor: {
    vendedor: string
    n: number              // propostas montadas
    brl: number            // valor total montado
    ultimaDias: number | null  // dias desde a última proposta (null = nenhuma)
  }[]
}

interface OrcRow {
  vendedor_nome: string | null
  status: string | null
  total_proposta: number | null
  created_at: string
}

// '' (Tudo) = sem limite inferior. Demais presets espelham a janela do dashboard.
function desdeFromPreset(preset: DashboardPreset): string | null {
  const now = new Date()
  const d = (back: number) => { const x = new Date(now); x.setDate(x.getDate() - back); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'hoje') { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.toISOString() }
  if (preset === 'ontem') return d(1)
  if (preset === '7d') return d(6)
  if (preset === '30d') return d(29)
  if (preset === 'mes') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return null // Tudo
}

export function useOrcamentosResumo(preset: DashboardPreset = '') {
  return useQuery({
    queryKey: ['orcamentos-resumo-v2', preset],
    queryFn: async (): Promise<OrcamentosResumo> => {
      const desde = desdeFromPreset(preset)
      let q = supabase
        .from('orcamentos_gerados')
        .select('vendedor_nome, status, total_proposta, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      if (desde) q = q.gte('created_at', desde)
      const { data, error } = await q
      if (error) throw error
      // Daniel = dono fazendo testes; fora de todos os totais.
      const rows = ((data ?? []) as OrcRow[]).filter(r => !/daniel/i.test(r.vendedor_nome || ''))

      let valorTotalBRL = 0
      type Acc = { vendedor: string; n: number; brl: number; maxMs: number }
      const map = new Map<string, Acc>()
      for (const r of rows) {
        const v = Number(r.total_proposta) || 0
        valorTotalBRL += v
        const nome = (r.vendedor_nome || '—').trim() || '—'
        const acc = map.get(nome) ?? { vendedor: nome, n: 0, brl: 0, maxMs: 0 }
        acc.n += 1
        acc.brl += v
        const ms = new Date(r.created_at).getTime()
        if (Number.isFinite(ms) && ms > acc.maxMs) acc.maxMs = ms
        map.set(nome, acc)
      }
      const geradas = rows.length
      const agora = Date.now()
      return {
        geradas,
        valorTotalBRL,
        ticketMedioBRL: geradas > 0 ? valorTotalBRL / geradas : 0,
        porVendedor: [...map.values()]
          .map(a => ({
            vendedor: a.vendedor, n: a.n, brl: a.brl,
            ultimaDias: a.maxMs > 0 ? Math.floor((agora - a.maxMs) / 86_400_000) : null,
          }))
          .sort((a, b) => b.brl - a.brl),
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
