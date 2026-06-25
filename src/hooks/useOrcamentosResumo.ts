import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { parseCustomRange, type DashboardPreset } from './useDashboard'

// Resumo das PROPOSTAS montadas no builder de orçamento (tabela orcamentos_gerados).
// É a única fonte real de R$ no fluxo de lead. O status 'enviado'/'rascunho' do builder
// NÃO é confiável, então contamos a PROPOSTA MONTADA sem distinguir.
// DEDUPE POR CLIENTE: o vendedor re-orça o mesmo cliente várias vezes (versões/ALT/
// re-cotação) — conta 1 por cliente, pegando a ÚLTIMA proposta (mais recente). Senão o
// R$ infla (ex.: Gustavo tinha 62 propostas mas só 30 clientes). Daniel (testes) fora.

export interface OrcamentosResumo {
  geradas: number          // clientes distintos com proposta (não propostas brutas)
  propostasBrutas: number  // total de propostas montadas (com repetição de cliente)
  valorTotalBRL: number    // soma da última proposta de cada cliente
  ticketMedioBRL: number   // valorTotalBRL / clientes distintos
  porVendedor: {
    vendedor: string
    n: number              // clientes distintos com proposta
    propostasN: number     // propostas brutas (com repetição)
    brl: number            // soma da última proposta por cliente
    ultimaDias: number | null  // dias desde a última proposta (null = nenhuma)
  }[]
}

interface OrcRow {
  vendedor_nome: string | null
  total_proposta: number | null
  created_at: string
  cliente_dados: { fone?: string | null; nome?: string | null } | null
  cliente_nome: string | null
}

function desdeFromPreset(preset: DashboardPreset): string | null {
  const _custom = parseCustomRange(preset)
  if (_custom) return _custom.from.toISOString()
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
    queryKey: ['orcamentos-resumo-v3', preset],
    queryFn: async (): Promise<OrcamentosResumo> => {
      const desde = desdeFromPreset(preset)
      let q = supabase
        .from('orcamentos_gerados')
        .select('vendedor_nome, total_proposta, created_at, cliente_dados, cliente_nome')
        .order('created_at', { ascending: false }) // mais recente primeiro → 1º visto = última proposta
        .limit(5000)
      if (desde) q = q.gte('created_at', desde)
      const { data, error } = await q
      if (error) throw error
      const rows = ((data ?? []) as OrcRow[]).filter(r => !/daniel/i.test(r.vendedor_nome || ''))

      type Acc = { vendedor: string; n: number; propostasN: number; brl: number; maxMs: number; clientes: Set<string> }
      const map = new Map<string, Acc>()
      rows.forEach((r, i) => {
        const nome = (r.vendedor_nome || '—').trim() || '—'
        const fone = String(r.cliente_dados?.fone ?? '').replace(/\D/g, '')
        const cli = String(r.cliente_dados?.nome ?? r.cliente_nome ?? '').trim().toLowerCase()
        const clientKey = fone || cli || `__sem-cliente-${i}` // sem cliente identificável = não dedupa
        const acc = map.get(nome) ?? { vendedor: nome, n: 0, propostasN: 0, brl: 0, maxMs: 0, clientes: new Set<string>() }
        acc.propostasN += 1
        const ms = new Date(r.created_at).getTime()
        if (Number.isFinite(ms) && ms > acc.maxMs) acc.maxMs = ms
        if (!acc.clientes.has(clientKey)) {            // 1ª vez = proposta mais recente desse cliente
          acc.clientes.add(clientKey)
          acc.n += 1
          acc.brl += Number(r.total_proposta) || 0
        }
        map.set(nome, acc)
      })

      const agora = Date.now()
      const porVendedor = [...map.values()]
        .map(a => ({
          vendedor: a.vendedor, n: a.n, propostasN: a.propostasN, brl: a.brl,
          ultimaDias: a.maxMs > 0 ? Math.floor((agora - a.maxMs) / 86_400_000) : null,
        }))
        .sort((a, b) => b.brl - a.brl)
      const geradas = porVendedor.reduce((s, v) => s + v.n, 0)
      const valorTotalBRL = porVendedor.reduce((s, v) => s + v.brl, 0)
      return {
        geradas,
        propostasBrutas: rows.length,
        valorTotalBRL,
        ticketMedioBRL: geradas > 0 ? valorTotalBRL / geradas : 0,
        porVendedor,
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
  })
}
