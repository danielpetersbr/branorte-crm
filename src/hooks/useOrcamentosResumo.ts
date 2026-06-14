import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DashboardPreset } from './useDashboard'

// Resumo financeiro das PROPOSTAS montadas no sistema (tabela orcamentos_gerados,
// o builder de orçamento). É a única fonte real de R$ no fluxo de lead: a view
// atendimentos_por_cliente tem orcamento_valor/status zerados (venda fechada vive
// em /controle). Aqui medimos o VALOR em propostas geradas no período — a ponte
// entre o lead qualificado e a venda. Casado com o filtro de período do dashboard.

export interface OrcamentosResumo {
  geradas: number          // propostas criadas no período
  enviadas: number         // status = 'enviado'
  rascunhos: number        // status = 'rascunho'
  valorEnviadoBRL: number  // soma total_proposta das enviadas (valor real "na rua")
  valorTotalBRL: number    // soma total_proposta de todas as geradas
  ticketMedioBRL: number   // valorEnviadoBRL / enviadas (ou geradas se nenhuma enviada)
  porVendedor: { vendedor: string; n: number; brl: number }[]  // n = enviadas, brl = valor enviado
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
    queryKey: ['orcamentos-resumo-v1', preset],
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
      const rows = (data ?? []) as OrcRow[]

      let enviadas = 0, rascunhos = 0, valorEnviadoBRL = 0, valorTotalBRL = 0
      const porVendedorMap = new Map<string, { vendedor: string; n: number; brl: number }>()
      for (const r of rows) {
        const v = Number(r.total_proposta) || 0
        valorTotalBRL += v
        const enviada = r.status === 'enviado'
        if (enviada) { enviadas++; valorEnviadoBRL += v }
        else if (r.status === 'rascunho') rascunhos++
        const nome = (r.vendedor_nome || '—').trim() || '—'
        const acc = porVendedorMap.get(nome) ?? { vendedor: nome, n: 0, brl: 0 }
        if (enviada) { acc.n += 1; acc.brl += v }
        porVendedorMap.set(nome, acc)
      }
      const geradas = rows.length
      const ticketBase = enviadas > 0 ? enviadas : geradas
      const ticketValor = enviadas > 0 ? valorEnviadoBRL : valorTotalBRL
      return {
        geradas,
        enviadas,
        rascunhos,
        valorEnviadoBRL,
        valorTotalBRL,
        ticketMedioBRL: ticketBase > 0 ? ticketValor / ticketBase : 0,
        porVendedor: [...porVendedorMap.values()].sort((a, b) => b.brl - a.brl),
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
