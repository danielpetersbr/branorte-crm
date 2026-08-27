import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Painel do Time (antes: Relatório Diário do Líder)
//
// ⚠️ 27/08/2026: ACABOU o líder fixo. O time se acompanha sozinho e o Daniel
// chama cada time durante a semana pra analisar os números juntos. Por isso o
// o que o BANCO NÃO SABE: motivo.
//
// Regra que desenhou tudo aqui: o sistema já conta volume sozinho (ligação,
// orçamento, mensagem). Perguntar volume ao líder seria duplicar dado e
// gastar o tempo dele. Então a tela MOSTRA o volume e PERGUNTA a causa.
// ============================================================================

export const TIMES = [
  { slug: 'esquadrao',    nome: 'Esquadrão Classe A', membros: ['ALVARO', 'IGOR', 'EDER'] },
  { slug: 'los-melhores', nome: 'Los Melhores',       membros: ['JARDEL', 'LUCAS', 'RAMON'] },
  { slug: 'caca-lead',    nome: 'Os Caça Lead',       membros: ['PEDRO', 'GUSTAVO', 'EDILSON JR'] },
] as const

export type TimeSlug = typeof TIMES[number]['slug']

export const OBSTACULOS = [
  'Preço / desconto',
  'Prazo de entrega',
  'Frete',
  'Dúvida técnica / dimensionamento',
  'FINAME / crédito',
  'Decisão do sócio ou da família',
  'Visita ou vídeo da fábrica',
  'Só depende do cliente responder',
] as const

export const MOTIVOS_PERDA = [
  'Preço acima do que o cliente esperava',
  'Fechou com concorrente',
  'Adiou — sem verba agora',
  'Fora do perfil (peixe, peletizado, pequeno demais)',
  'Sumiu / não responde mais',
  'Frete inviabilizou',
  'Crédito negado',
  'Prazo de entrega longo demais',
  'Outro',
] as const

export const MOTIVOS_ABAIXO = [
  'Ausente (folga, viagem, atestado)',
  'Dia consumido por pedido/projeto em andamento',
  'Esperando resposta interna (preço, frete, engenharia)',
  'Problema técnico (WhatsApp, CRM, internet)',
  'Sem lead novo pra trabalhar',
  'Ritmo baixo / desânimo',
  'Estava em visita ou em campo',
  'Nada — foi só um dia fraco',
] as const

export const DESVIOS_LEAD = [
  'Pequeno demais',
  'Peixe / peletizado (não fabricamos)',
  'Curioso ou estudante',
  'Revendedor',
  'Região sem frete viável',
] as const

export const PREVISOES = [
  { v: 'hoje',     label: 'Hoje' },
  { v: 'semana',   label: 'Esta semana' },
  { v: 'proxima',  label: 'Próxima semana' },
  { v: 'sem_data', label: 'Sem data' },
] as const

// ─── Painel: os números de cada vendedor do time no dia ─────────────────────

export interface VendedorPainel {
  vendedor_nome: string
  ordem: number
  ligacoes: number
  ligacoes_feitas: number
  ligacoes_recebidas: number
  orcamentos: number
  orcamentos_valor: number
  msgs_enviadas: number
  clientes_respondidos: number
  funil_quente: number
  funil_followup: number
  funil_novo_lead: number
  funil_orcamento: number
  funil_aberto: number
  /** null = a extensão daquele vendedor nunca reportou. Zero mensagem com sync
   *  morto NÃO é preguiça — a tela precisa saber separar as duas coisas. */
  sync_minutos: number | null
  /** Faixa que a RPC de fato usou — a tela calcula a meta em cima dela. */
  periodo_de: string
  periodo_ate: string
}

export type Periodo = 'dia' | 'semana' | 'mes'

export function usePainelTime(time: TimeSlug | null, periodo: Periodo = 'dia') {
  return useQuery({
    queryKey: ['rel-lider-painel', time, periodo],
    enabled: !!time,
    staleTime: 60_000,
    queryFn: async (): Promise<VendedorPainel[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_painel', {
        p_time: time, p_periodo: periodo,
      })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        orcamentos_valor: Number(r.orcamentos_valor ?? 0),
      })) as VendedorPainel[]
    },
  })
}

// ─── Série: últimos N dias do time, pros gráficos ───────────────────────────

export interface DiaSerie {
  dia: string
  ligacoes: number
  orcamentos: number
  orcamentos_valor: number
  msgs_enviadas: number
}
// ⚠️ tinha um campo `termometro` aqui, que a RPC lia de public.relatorio_lider
// pra pintar o gráfico. A tabela foi dropada junto com o relatório diário (não
// há mais líder pra respondê-lo) e a RPC passou a estourar
// "relation does not exist" EM TEMPO DE EXECUÇÃO: o gráfico vinha vazio, sem
// erro na tela e sem erro no build. Só apareceu abrindo a página.

export function useSerieTime(time: TimeSlug | null, dias = 14) {
  return useQuery({
    queryKey: ['rel-lider-serie', time, dias],
    enabled: !!time,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DiaSerie[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_serie', {
        p_time: time, p_dias: dias,
      })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        orcamentos_valor: Number(r.orcamentos_valor ?? 0),
      })) as DiaSerie[]
    },
  })
}

// ─── Metas ──────────────────────────────────────────────────────────────────

/** Meta de ligação: 10 por pessoa, por dia útil. */
export const META_LIGACOES_PESSOA_DIA = 10
/** Meta de venda por time. Fixa aqui porque o ranking-vendas devolve meta 0 —
 *  mesmo motivo pelo qual o placar_times_monitor.py também a carrega hardcoded. */
export const META_VENDA_TIME_MES = 833_000

/** Dias úteis (seg–sex) entre duas datas, inclusive. Feriado não é descontado:
 *  não temos calendário de feriado no banco, e chutar erraria a meta pra baixo. */
export function diasUteis(de: Date, ate: Date): number {
  let n = 0
  const d = new Date(de.getFullYear(), de.getMonth(), de.getDate())
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate())
  while (d <= fim) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) n++
    d.setDate(d.getDate() + 1)
  }
  return Math.max(n, 1)
}

export interface VendasTime { vendido: number; pedidos: number }

/**
 * Vendido do mês por time. Fonte: edge `ranking-vendas` do projeto do
 * pedido-de-venda (outro Supabase) — a MESMA que o Nova Venda e o Placar dos
 * Times usam. É `pedidos_venda`, a única prova real de venda: etiqueta VENDIDO
 * e contacts.status inflam.
 */
export function useVendasTime(time: TimeSlug | null) {
  return useQuery({
    queryKey: ['rel-lider-vendas', time],
    enabled: !!time,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VendasTime> => {
      const r = await fetch('https://kfucuvwrnwrkshxpsmyq.supabase.co/functions/v1/ranking-vendas')
      if (!r.ok) throw new Error('ranking-vendas ' + r.status)
      const j = await r.json() as { ranking?: { vendedor: string; vendido: number; pedidos: number }[] }
      const membros = (TIMES.find(t => t.slug === time)?.membros ?? []) as unknown as string[]
      // casa pelo PRIMEIRO TOKEN, igual ao resolvedor do placar: o ranking manda
      // "EDILSON JR" e o time também, mas nome completo em qualquer das pontas quebraria o ===.
      const chave = (s: string) => s.trim().toUpperCase().split(' ')[0]
      const meus = (j.ranking ?? []).filter(v => membros.some(m => chave(m) === chave(v.vendedor)))
      return {
        vendido: meus.reduce((s, v) => s + (v.vendido || 0), 0),
        pedidos: meus.reduce((s, v) => s + (v.pedidos || 0), 0),
      }
    },
  })
}

// ─── Listas clicáveis + acompanhamento ──────────────────────────────────────

/** Os 3 botões que o líder aperta no cartão do cliente. */
export const ANDAMENTOS = [
  { v: 'negociando',        label: 'Negociando',      cor: 'info' },
  { v: 'aguardando_cliente', label: 'Aguardando ele', cor: 'warning' },
  { v: 'cliente_retornou',  label: 'Cliente voltou',  cor: 'success' },
] as const

export type Andamento = typeof ANDAMENTOS[number]['v']

export interface OrcamentoLinha {
  id: number; numero: string; cliente: string; vendedor_nome: string
  valor: number; emitido_em: string; dias: number
  status: Andamento | null; anotado_por: string | null; anotado_em: string | null
}

export interface QuenteLinha {
  chat_id: string; cliente: string; telefone: string; vendedor_nome: string
  ultima_msg: string | null
  /** true = o VENDEDOR falou por último. false = o cliente falou e ninguém respondeu. */
  ultima_foi_minha: boolean | null
  dias_parado: number | null
  status: Andamento | null; anotado_por: string | null; anotado_em: string | null
}

export function useOrcamentosTime(time: TimeSlug | null, periodo: Periodo, ligado: boolean) {
  return useQuery({
    queryKey: ['rel-lider-orcamentos', time, periodo],
    enabled: !!time && ligado,
    staleTime: 60_000,
    queryFn: async (): Promise<OrcamentoLinha[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_orcamentos', {
        p_time: time, p_periodo: periodo,
      })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r, valor: Number(r.valor ?? 0),
      })) as OrcamentoLinha[]
    },
  })
}

export function useQuentesTime(time: TimeSlug | null, ligado = true) {
  return useQuery({
    queryKey: ['rel-lider-quentes', time],
    enabled: !!time && ligado,
    staleTime: 60_000,
    queryFn: async (): Promise<QuenteLinha[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_quentes', { p_time: time })
      if (error) throw error
      return (data ?? []) as QuenteLinha[]
    },
  })
}

/** Marca (ou desmarca, clicando de novo) o andamento de um cliente. */
export function useMarcarAndamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: {
      time_slug: string; tipo: 'orcamento' | 'quente'; chave: string
      cliente: string; vendedor_nome: string; status: Andamento | null; anotado_por: string
    }) => {
      if (p.status === null) {
        const { error } = await supabase.from('relatorio_lider_acompanhamento')
          .delete().eq('tipo', p.tipo).eq('chave', p.chave)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('relatorio_lider_acompanhamento')
        .upsert({
          time_slug: p.time_slug, tipo: p.tipo, chave: p.chave,
          cliente: p.cliente, vendedor_nome: p.vendedor_nome,
          status: p.status, anotado_por: p.anotado_por, anotado_em: new Date().toISOString(),
        }, { onConflict: 'tipo,chave' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rel-lider-orcamentos'] })
      qc.invalidateQueries({ queryKey: ['rel-lider-quentes'] })
    },
  })
}


// ─── "Precisa de atenção": o sistema aponta, ninguém acusa ninguém ──────────

/**
 * Substitui a pergunta "quem ficou abaixo hoje?" do modelo com líder.
 * Sem líder, pedir a um vendedor pra justificar o colega vira delação — e
 * mata o preenchimento na primeira semana. Aqui tudo é FATO, apurado pelo
 * banco: cliente sem resposta, orçamento sem andamento, ligação abaixo da meta.
 */
export interface AtencaoLinha {
  severidade: 'alta' | 'media'
  tipo: 'sem_resposta' | 'orcamento_parado' | 'abaixo_meta'
  cliente: string | null
  vendedor_nome: string | null
  detalhe: string
  valor: number | null
  dias: number
}

export function useAtencaoTime(time: TimeSlug | null) {
  return useQuery({
    queryKey: ['painel-atencao', time],
    enabled: !!time,
    staleTime: 60_000,
    queryFn: async (): Promise<AtencaoLinha[]> => {
      const { data, error } = await supabase.rpc('painel_time_atencao', { p_time: time })
      if (error) throw error
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r, valor: r.valor == null ? null : Number(r.valor),
      })) as AtencaoLinha[]
    },
  })
}
