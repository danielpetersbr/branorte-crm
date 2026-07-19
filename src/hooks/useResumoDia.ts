import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeForPreset, type DashboardPreset } from './useDashboard'

// ============================================================================
// Resumo por vendedor — leads / orçamentos / atendidos seguem o FILTRO de período
// do topo do Dashboard (RPC escritorio_fluxo_periodo, p_from/p_to null = Tudo).
// followup / quente / carteira continuam SNAPSHOT ("agora", via escritorio_funil_vivo).
// "Negociação" = Follow-up + Quente (decisão de negócio do Daniel).
// Atendidos em "Hoje/Tudo" usa o funil_vivo (paridade com as mesas do /disparos);
// nos demais períodos usa wa_daily_activity (existe desde 2026-05-07).
// ============================================================================

type FunilRow = {
  aberto: number; prospec: number; novoLead: number; tentativa: number
  followup: number; quente: number; orcamento: number; vendido: number
  perdidos: number; totalChats: number; atendimentos: number; msgs: number
}

export interface ResumoDiaVendedor {
  nome: string
  online: boolean
  leads: number
  orcamentos: number
  atendimentos: number
  followup: number
  quente: number
  negociacao: number
  carteira: number
}

const firstKey = (nome: string) => (nome.split(/\s+/)[0] || '').toUpperCase()
const EXCLUIR_DO_RESUMO = new Set(['DANIEL'])

export function useResumoDia(preset: DashboardPreset = '') {
  const range = rangeForPreset(preset, new Date())
  const pFrom = range ? range.from.toISOString() : null
  const pTo = range ? range.to.toISOString() : null
  const liveHoje = preset === '' || preset === 'hoje'

  const vendedoresQ = useQuery<Array<{ vendedor_nome: string; online: boolean }>>({
    queryKey: ['vendor-dispatch-status', 'resumo-dia'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vendor_dispatch_status')
        .select('vendedor_nome, online')
        .order('vendedor_nome')
      return ((data ?? []) as Array<{ vendedor_nome: string | null; online: boolean | null }>)
        .filter(v => !!v.vendedor_nome)
        .map(v => ({ vendedor_nome: v.vendedor_nome as string, online: !!v.online }))
    },
    refetchInterval: 30000,
  })

  // Leads + orçamentos + atendidos por vendedor, PARAMETRIZADO pelo período do filtro.
  const fluxoQ = useQuery<Record<string, { leads: number; orcamentos: number; atendimentos: number }>>({
    queryKey: ['escritorio-fluxo-periodo', pFrom, pTo],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_fluxo_periodo', { p_from: pFrom, p_to: pTo })
      const m: Record<string, { leads: number; orcamentos: number; atendimentos: number }> = {}
      for (const r of (data ?? []) as Array<{ vend: string; leads: number; orcamentos: number; atendimentos: number }>)
        m[r.vend] = { leads: r.leads, orcamentos: r.orcamentos, atendimentos: r.atendimentos }
      return m
    },
    refetchInterval: 30000,
  })

  // Funil ao vivo por vendedor (etiquetas do heartbeat) — SNAPSHOT, alimenta followup/quente/carteira.
  const funilQ = useQuery<Record<string, FunilRow>>({
    queryKey: ['escritorio-funil'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_funil_vivo')
      const m: Record<string, FunilRow> = {}
      for (const r of (data ?? []) as Array<Record<string, any>>) {
        m[r.vendedor_nome] = {
          aberto: r.aberto, prospec: r.prospec, novoLead: r.novo_lead, tentativa: r.tentativa,
          followup: r.followup, quente: r.quente, orcamento: r.orcamento, vendido: r.vendido,
          perdidos: r.perdidos, totalChats: r.total_chats, atendimentos: r.atendimentos, msgs: r.msgs,
        }
      }
      return m
    },
    refetchInterval: 20000,
  })

  const linhas: ResumoDiaVendedor[] = useMemo(() => (vendedoresQ.data ?? [])
    .filter(v => !EXCLUIR_DO_RESUMO.has(v.vendedor_nome.trim().toUpperCase()))
    .map(v => {
      const nome = v.vendedor_nome
      const f = funilQ.data?.[nome]
      const fx = fluxoQ.data?.[firstKey(nome)]
      const followup = f?.followup ?? 0
      const quente = f?.quente ?? 0
      return {
        nome,
        online: v.online,
        leads: fx?.leads ?? 0,
        orcamentos: fx?.orcamentos ?? 0,
        atendimentos: liveHoje ? (f?.atendimentos ?? 0) : (fx?.atendimentos ?? 0),
        followup,
        quente,
        negociacao: followup + quente,
        carteira: f?.totalChats ?? 0,
      }
    }), [vendedoresQ.data, funilQ.data, fluxoQ.data, liveHoje])

  return {
    linhas,
    isLoading: vendedoresQ.isLoading,
    isError: vendedoresQ.isError,
  }
}
