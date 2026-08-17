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
  ligacoes: number
  score: number
}

// SCORE = quantos clientes VIVOS o vendedor tem na mão, somando as 5 etiquetas
// do funil aberto: PROSPECÇÃO + NOVO LEAD + 2ª TENTATIVA + FOLLOW UP + LEAD QUENTE.
//
// ⚠️ ORÇAMENTO ENVIADO ficou de FORA de propósito (decisão do Daniel em 17/08/2026,
// tomada em cima do dado). A etiqueta mede quem tem o hábito de etiquetar, não quem
// envia orçamento: medido em 60 dias, IGOR gerou 136 orçamentos e tem ZERO dessa
// etiqueta, PEDRO gerou 43 e tem zero, JARDEL gerou 87 e tem 3 — enquanto EDILSON
// gerou 58 e carrega 112 etiquetas paradas. Incluir isso colocaria quem menos
// orçou na frente de quem mais orçou.
//
// VENDIDO e PERDIDO também ficam fora: saíram do jogo. É justamente isso que
// separa o score da "Carteira" (total_chats), que é ~70% perdido em quase todo
// mundo (PEDRO: 846 perdidos de 1.223).
const somaScore = (f?: FunilRow): number =>
  f ? (f.prospec ?? 0) + (f.novoLead ?? 0) + (f.tentativa ?? 0) + (f.followup ?? 0) + (f.quente ?? 0) : 0

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
  const fluxoQ = useQuery<Record<string, { leads: number; orcamentos: number; atendimentos: number; ligacoes: number }>>({
    queryKey: ['escritorio-fluxo-periodo', pFrom, pTo],
    queryFn: async () => {
      const { data } = await supabase.rpc('escritorio_fluxo_periodo', { p_from: pFrom, p_to: pTo })
      const m: Record<string, { leads: number; orcamentos: number; atendimentos: number; ligacoes: number }> = {}
      for (const r of (data ?? []) as Array<{ vend: string; leads: number; orcamentos: number; atendimentos: number; ligacoes: number }>)
        m[r.vend] = { leads: r.leads, orcamentos: r.orcamentos, atendimentos: r.atendimentos, ligacoes: r.ligacoes ?? 0 }
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
        // Ligacoes FEITAS no periodo (wa_chat_messages tipo=call_log). PISO: so cobre
        // chats das etiquetas do funil — ver a view wa_ligacoes_por_vendedor.
        ligacoes: fx?.ligacoes ?? 0,
        // SNAPSHOT como carteira/negociacao: e estado AGORA, nao movimento do periodo.
        score: somaScore(f),
      }
    }), [vendedoresQ.data, funilQ.data, fluxoQ.data, liveHoje])

  return {
    linhas,
    isLoading: vendedoresQ.isLoading,
    isError: vendedoresQ.isError,
    // ⚠️ Negociando/Quentes/Carteira vêm SÓ do funil vivo. Quando essa query falha
    // (ou volta vazia), o `f?.x ?? 0` pinta ZERO em todo mundo — e zero, num painel de
    // gestão, é lido como "ninguém está negociando", não como "não carregou". São coisas
    // diferentes e a tela precisa saber distinguir. Visto em produção 13/08: a RPC
    // respondia certo no banco (10 linhas) e a tela mostrava a coluna inteira zerada.
    funilIndisponivel: funilQ.isError || (!funilQ.isLoading && Object.keys(funilQ.data ?? {}).length === 0),
  }
}
