import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Métricas extras do Dashboard (RPC public.dashboard_extra), janela fixa 30 dias
// para as séries. aberto/negociação/avaliação/atendimentos são snapshots.
export interface DashboardExtra {
  orcamentos_por_dia: { dia: string; total: number }[]
  fechados_por_dia: { dia: string; total: number }[]   // não usado na UI (sinal poluído por sync)
  avaliacao: { media: number; total: number; por_nota: { nota: number; qtd: number }[] }
  aberto: { total: number; prospeccao: number; novo_lead: number; follow_up: number; lead_quente: number; em_negociacao: number }
  negociacao: { follow_up: number; lead_quente: number; em_negociacao: number; com_orcamento: number; valor: number; valor_followup: number; com_orcamento_followup: number }
  /**
   * null = a RPC não devolveu o bloco (o tile mostra "indisponível", não 0).
   * `ontem_ate_agora`: ontem só até a mesma hora de agora — é contra ele que o dia
   * parcial de hoje se compara (antes era contra o dia inteiro: −44% às 16h que eram −18%).
   */
  atendimentos: { hoje: number; ontem: number; ontem_ate_agora?: number } | null
  /**
   * (21/10/2026, issue #227) "Atendimentos hoje" pela régua do Daniel: conversa com 2 idas e voltas no dia (o cliente
   * manda, a Branorte responde, o cliente manda, a Branorte responde), 1 por cliente. RPC dashboard_atendimentos_troca,
   * buscada junto com a dashboard_extra; se só ela falhar, fica null e o tile diz "indisponível" (não 0). O `atendimentos`
   * acima é a régua antiga (lead novo do dia) e ficou sem leitor na tela.
   */
  atendimentosTroca: AtendimentosTroca | null
}

export interface AtendimentosTroca {
  hoje: number
  hojeComVendedor: number
  hojeSoAna: number
  ontem: number
  /** clientes de ontem que já tinham as 2 idas e voltas na mesma hora de agora */
  ontemAteAgora: number
  /** contas cujo espelho de mensagens não está copiando hoje (os atendimentos delas ficam de fora) */
  semEspelho: string[]
}

function lerTroca(d: unknown): AtendimentosTroca | null {
  if (!d || typeof d !== 'object') return null
  const r = d as Record<string, unknown>
  const num = (v: unknown) => Number(v) || 0
  return {
    hoje: num(r.hoje),
    hojeComVendedor: num(r.hoje_com_vendedor),
    hojeSoAna: num(r.hoje_so_ana),
    ontem: num(r.ontem),
    ontemAteAgora: num(r.ontem_ate_agora),
    semEspelho: Array.isArray(r.sem_espelho) ? r.sem_espelho.map(String) : [],
  }
}

export function useDashboardExtra() {
  return useQuery({
    queryKey: ['dashboard-extra-v1'],
    queryFn: async (): Promise<DashboardExtra> => {
      const to = new Date()
      const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0)
      const toExcl = new Date(to); toExcl.setDate(toExcl.getDate() + 1); toExcl.setHours(0, 0, 0, 0)
      const [extraRes, trocaRes] = await Promise.all([
        supabase.rpc('dashboard_extra', {
          p_from: from.toISOString(),
          p_to: toExcl.toISOString(),
        }),
        supabase.rpc('dashboard_atendimentos_troca'),
      ])
      const { data, error } = extraRes
      if (error) throw error
      const r = (data ?? {}) as Partial<DashboardExtra>
      const av = r.avaliacao ?? { media: 0, total: 0, por_nota: [] }
      return {
        orcamentos_por_dia: r.orcamentos_por_dia ?? [],
        fechados_por_dia: r.fechados_por_dia ?? [],
        avaliacao: { media: Number(av.media) || 0, total: Number(av.total) || 0, por_nota: (av.por_nota ?? []).map(p => ({ nota: Number(p.nota), qtd: Number(p.qtd) })) },
        aberto: r.aberto ?? { total: 0, prospeccao: 0, novo_lead: 0, follow_up: 0, lead_quente: 0, em_negociacao: 0 },
        negociacao: r.negociacao ?? { follow_up: 0, lead_quente: 0, em_negociacao: 0, com_orcamento: 0, valor: 0, valor_followup: 0, com_orcamento_followup: 0 },
        atendimentos: r.atendimentos ?? null,
        atendimentosTroca: trocaRes.error ? null : lerTroca(trocaRes.data),
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
  })
}
