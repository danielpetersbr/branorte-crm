import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** KPIs de conversão dos orçamentos (últimos N dias) */
export interface ConversaoSummary {
  total: number
  enviados: number
  aprovados: number
  perdidos: number
  rascunhos: number
  conversaoPct: number          // aprovados / (aprovados + perdidos) * 100
  ticketMedioEnviado: number    // R$ médio dos enviados
  ticketMedioAprovado: number   // R$ médio dos aprovados
  totalEnviadoBRL: number
  totalAprovadoBRL: number
  // Tempo médio em dias entre 'enviado' e 'aprovado/perdido'
  tempoMedioDias: number | null
}

export interface VendedorRanking {
  vendedor_nome: string
  total: number
  aprovados: number
  perdidos: number
  conversaoPct: number
  totalAprovadoBRL: number
}

interface OrcamentoRow {
  id: number
  numero: string
  vendedor_nome: string
  status: string
  total_proposta: number
  enviado_em: string | null
  created_at: string
  updated_at: string
}

export function useOrcamentosConversao(diasJanela = 90) {
  return useQuery({
    queryKey: ['orcamentos-conversao', diasJanela],
    queryFn: async () => {
      const desde = new Date(Date.now() - diasJanela * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('orcamentos_gerados')
        .select('id, numero, vendedor_nome, status, total_proposta, enviado_em, created_at, updated_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as OrcamentoRow[]

      // Summary
      const enviados = rows.filter(r => r.status === 'enviado' || r.status === 'aprovado' || r.status === 'perdido')
      const aprovados = rows.filter(r => r.status === 'aprovado')
      const perdidos = rows.filter(r => r.status === 'perdido')
      const rascunhos = rows.filter(r => r.status === 'rascunho')
      const decididos = aprovados.length + perdidos.length

      const totalEnviadoBRL = enviados.reduce((s, r) => s + (Number(r.total_proposta) || 0), 0)
      const totalAprovadoBRL = aprovados.reduce((s, r) => s + (Number(r.total_proposta) || 0), 0)

      // Tempo médio entre enviado_em → updated_at (decisão)
      const decisoesComTempo = [...aprovados, ...perdidos].filter(r => r.enviado_em && r.updated_at)
      const tempoMedioMs = decisoesComTempo.length > 0
        ? decisoesComTempo.reduce((s, r) => s + (new Date(r.updated_at).getTime() - new Date(r.enviado_em!).getTime()), 0) / decisoesComTempo.length
        : null

      const summary: ConversaoSummary = {
        total: rows.length,
        enviados: enviados.length,
        aprovados: aprovados.length,
        perdidos: perdidos.length,
        rascunhos: rascunhos.length,
        conversaoPct: decididos > 0 ? (aprovados.length / decididos) * 100 : 0,
        ticketMedioEnviado: enviados.length > 0 ? totalEnviadoBRL / enviados.length : 0,
        ticketMedioAprovado: aprovados.length > 0 ? totalAprovadoBRL / aprovados.length : 0,
        totalEnviadoBRL,
        totalAprovadoBRL,
        tempoMedioDias: tempoMedioMs != null ? tempoMedioMs / (1000 * 60 * 60 * 24) : null,
      }

      // Ranking por vendedor
      const porVendedor = new Map<string, VendedorRanking>()
      for (const r of rows) {
        const k = r.vendedor_nome || '—'
        const v = porVendedor.get(k) ?? {
          vendedor_nome: k, total: 0, aprovados: 0, perdidos: 0, conversaoPct: 0, totalAprovadoBRL: 0,
        }
        v.total += 1
        if (r.status === 'aprovado') {
          v.aprovados += 1
          v.totalAprovadoBRL += Number(r.total_proposta) || 0
        }
        if (r.status === 'perdido') v.perdidos += 1
        porVendedor.set(k, v)
      }
      const ranking = [...porVendedor.values()]
        .map(v => ({ ...v, conversaoPct: (v.aprovados + v.perdidos) > 0 ? (v.aprovados / (v.aprovados + v.perdidos)) * 100 : 0 }))
        .sort((a, b) => b.totalAprovadoBRL - a.totalAprovadoBRL)

      return { summary, ranking, rows }
    },
    staleTime: 60 * 1000,
  })
}
