import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Resumo do dia por vendedor — MESMA fonte "ao vivo" das mesas do /disparos
// (EscritorioMapa). Reaproveita as queryKeys do escritório, então o React Query
// compartilha o cache (sem refetch duplicado quando as duas telas estão abertas).
//   • leads que chegaram hoje  → RPC escritorio_leads_hoje
//   • orçamentos feitos hoje   → tabela orcamentos_gerados (created_at hoje)
//   • atendimentos / followup / quente / carteira → RPC escritorio_funil_vivo
// "Negociação" = Follow-up + Quente (decisão de negócio do Daniel).
// ============================================================================

type FunilRow = {
  aberto: number; prospec: number; novoLead: number; tentativa: number
  followup: number; quente: number; orcamento: number; vendido: number
  perdidos: number; totalChats: number; atendimentos: number; msgs: number
}

export interface ResumoDiaVendedor {
  nome: string
  online: boolean
  leads: number        // leads que chegaram hoje
  orcamentos: number   // orçamentos montados hoje
  atendimentos: number // chats trabalhados hoje
  followup: number     // etiqueta FOLLOW UP (atual)
  quente: number       // etiqueta LEAD QUENTE (atual)
  negociacao: number   // followup + quente
  carteira: number     // total de conversas do vendedor
}

const firstKey = (nome: string) => (nome.split(/\s+/)[0] || '').toUpperCase()

// Fora do resumo do Dashboard (pedido do Daniel 07/07) — segue normal no /disparos.
const EXCLUIR_DO_RESUMO = new Set(['DANIEL'])

export function useResumoDia() {
  // Lista de vendedores — MESMA fonte das mesas do /disparos (vendor_dispatch_status).
  // Chave namespaced pra NÃO colidir com o cache de Disparos.tsx (que usa a mesma
  // tabela com select('*') e shape diferente — colisão contaminaria os toggles de lá).
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

  // Orçamentos feitos hoje por vendedor — via RPC SECURITY DEFINER. A RLS da tabela
  // orcamentos_gerados só libera admin/vendor, mas o Dashboard também é visto por
  // gerente/marketing/visualizador; ler direto zeraria a coluna pra eles em silêncio.
  // Chave namespaced (queryFn difere da leitura direta do /disparos).
  const orcQ = useQuery<Record<string, number>>({
    queryKey: ['escritorio-orcamentos-hoje', 'resumo-dia'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_orcamentos_hoje')
      const m: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ vend: string; orcamentos: number }>) m[r.vend] = r.orcamentos
      return m
    },
    refetchInterval: 30000,
  })

  // Leads recebidos hoje — mesma fonte da página Atendimentos.
  const leadsQ = useQuery<Record<string, number>>({
    queryKey: ['escritorio-leads-hoje'],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_leads_hoje')
      const m: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ vend: string; leads: number }>) m[r.vend] = r.leads
      return m
    },
    refetchInterval: 30000,
  })

  // Funil ao vivo por vendedor (etiquetas do heartbeat via RPC).
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
    const followup = f?.followup ?? 0
    const quente = f?.quente ?? 0
    return {
      nome,
      online: v.online,
      leads: leadsQ.data?.[firstKey(nome)] ?? 0,
      orcamentos: orcQ.data?.[firstKey(nome)] ?? 0,
      atendimentos: f?.atendimentos ?? 0,
      followup,
      quente,
      negociacao: followup + quente,
      carteira: f?.totalChats ?? 0,
    }
    }), [vendedoresQ.data, funilQ.data, leadsQ.data, orcQ.data])

  return {
    linhas,
    // A lista de vendedores decide se HÁ linhas; funil/leads/orç só preenchem colunas
    // (degradam pra 0 se falharem, igual às mesas do /disparos — não derrubam o card).
    isLoading: vendedoresQ.isLoading,
    isError: vendedoresQ.isError,
  }
}
