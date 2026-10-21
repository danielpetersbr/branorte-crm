import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rangeForPreset, type DashboardPreset } from './useDashboard'
import { paramsRpcPeriodo } from '@/lib/periodo-preset'
import type { LigacaoResumo } from './useLigacoes'

// Painel "Operação agora" do Dashboard › Visão geral (21/10/2026, pedido do Daniel): ao lado da Meta do mês,
//  - atendimentos em aberto (etiqueta de PROSPECÇÃO até LEAD QUENTE), no total e por conta — ESTADO DE AGORA;
//  - follow up e lead quente com a proposta mais nova de cada cliente — ESTADO DE AGORA;
//  - gasto de anúncio Meta e Google e ligações (tentativas × conversadas) — SEGUEM O FILTRO do topo.
// RPCs: dashboard_atendimentos_abertos, dashboard_gasto_anuncios (supabase/migrations/20261021120000_dashboard_operacao_agora.sql)
// e ligacoes_resumo (a mesma da tela Ligações, com a RLS de wa_ligacoes).

export type EtapaAberta = 'prospeccao' | 't2' | 't3' | 'novo_lead' | 'orcamento_enviado' | 'follow_up' | 'lead_quente'
export const ETAPAS_ABERTAS: { k: EtapaAberta; rotulo: string }[] = [
  { k: 'prospeccao', rotulo: 'Prospecção' },
  { k: 't2', rotulo: '2ª tentativa' },
  { k: 't3', rotulo: '3ª tentativa' },
  { k: 'novo_lead', rotulo: 'Novo lead' },
  // (21/10/2026, auditoria) entre novo lead e follow up: quem já tem FOLLOW UP ou LEAD QUENTE continua contado lá
  { k: 'orcamento_enviado', rotulo: 'Orçamento enviado' },
  { k: 'follow_up', rotulo: 'Follow up' },
  { k: 'lead_quente', rotulo: 'Lead quente' },
]

export interface AbertosConta extends Record<EtapaAberta, number> {
  vendedor: string
  abertos: number
  conversas_lidas: number
  /** false = o WhatsApp dessa conta não está sendo lido (sem sinal em 24 h ou vendo menos de 20 conversas): o 0 não é zero */
  leitura_ok: boolean
}
export interface Projecao { clientes: number; comProposta: number; brl: number }
export interface AtendimentosAbertos {
  contatos: number
  porEtapa: Record<EtapaAberta, number>
  orcamentoEnviado: Projecao
  followUp: Projecao
  leadQuente: Projecao
  porConta: AbertosConta[]
  atualizadoEm: string | null
}

const num = (v: unknown) => Number(v) || 0
const proj = (o: unknown): Projecao => {
  const r = (o ?? {}) as Record<string, unknown>
  return { clientes: num(r.clientes), comProposta: num(r.com_proposta), brl: num(r.brl) }
}

export function useAtendimentosAbertos() {
  return useQuery({
    queryKey: ['dashboard-atendimentos-abertos-v1'],
    queryFn: async (): Promise<AtendimentosAbertos | null> => {
      const { data, error } = await supabase.rpc('dashboard_atendimentos_abertos')
      if (error) throw error
      if (!data) return null
      const d = data as Record<string, unknown>
      const pe = (d.por_etapa ?? {}) as Record<string, unknown>
      return {
        contatos: num(d.contatos),
        porEtapa: Object.fromEntries(ETAPAS_ABERTAS.map(e => [e.k, num(pe[e.k])])) as Record<EtapaAberta, number>,
        orcamentoEnviado: proj(d.orcamento_enviado),
        followUp: proj(d.follow_up),
        leadQuente: proj(d.lead_quente),
        porConta: ((d.por_vendedor ?? []) as Record<string, unknown>[]).map(r => ({
          vendedor: String(r.vendedor ?? ''),
          abertos: num(r.abertos),
          prospeccao: num(r.prospeccao), t2: num(r.t2), t3: num(r.t3), novo_lead: num(r.novo_lead), orcamento_enviado: num(r.orcamento_enviado), follow_up: num(r.follow_up), lead_quente: num(r.lead_quente),
          conversas_lidas: num(r.conversas_lidas),
          leitura_ok: r.leitura_ok === true,
        })),
        atualizadoEm: typeof d.atualizado_em === 'string' ? d.atualizado_em : null,
      }
    },
    // a extensão regrava as etiquetas a cada ~1 min
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export interface GastoAnuncios { meta: number; google: number; metaAtualizadoEm: string | null; googleAtualizadoEm: string | null }

export function useGastoAnuncios(preset: DashboardPreset) {
  return useQuery({
    queryKey: ['dashboard-gasto-anuncios-v1', preset],
    queryFn: async (): Promise<GastoAnuncios | null> => {
      const { data, error } = await supabase.rpc('dashboard_gasto_anuncios', paramsRpcPeriodo(rangeForPreset(preset, new Date())))
      if (error) throw error
      if (!data) return null
      const d = data as Record<string, unknown>
      return {
        meta: num(d.meta), google: num(d.google),
        metaAtualizadoEm: typeof d.meta_atualizado_em === 'string' ? d.meta_atualizado_em : null,
        googleAtualizadoEm: typeof d.google_atualizado_em === 'string' ? d.google_atualizado_em : null,
      }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}

export interface LigacoesPeriodo {
  /** todas as chamadas do período, feitas e recebidas */
  tentativas: number
  feitas: number
  recebidas: number
  /** chamadas atendidas nos dois sentidos (Completed / AcceptedElsewhere): quem ligou não importa */
  conversadas: number
  /** soma por conta de clientes distintos com quem houve conversa (o mesmo cliente em duas contas conta 2) */
  clientesConversados: number
}

export function somarLigacoes(linhas: Pick<LigacaoResumo, 'fez' | 'recebeu' | 'atendidas' | 'clientes_falados'>[]): LigacoesPeriodo {
  const s = (k: 'fez' | 'recebeu' | 'atendidas' | 'clientes_falados') => linhas.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  const feitas = s('fez'), recebidas = s('recebeu')
  return { tentativas: feitas + recebidas, feitas, recebidas, conversadas: s('atendidas'), clientesConversados: s('clientes_falados') }
}

export function useLigacoesPeriodo(preset: DashboardPreset) {
  return useQuery({
    queryKey: ['dashboard-ligacoes-periodo-v1', preset],
    queryFn: async (): Promise<LigacoesPeriodo> => {
      const { data, error } = await supabase.rpc('ligacoes_resumo', { ...paramsRpcPeriodo(rangeForPreset(preset, new Date())), p_vendedor: null })
      if (error) throw error
      return somarLigacoes((data ?? []) as LigacaoResumo[])
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: prev => prev,
    retry: 1,
  })
}
