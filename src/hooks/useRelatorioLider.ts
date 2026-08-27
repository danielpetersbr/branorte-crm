import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Relatório Diário do Líder de Time
//
// 9 vendedores, 3 times, 1 líder por time por semana. O líder continua
// vendendo — no fim do dia ele abre a tela, vê os números dos 3 e responde
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
}

export function usePainelTime(time: TimeSlug | null, dia?: string) {
  return useQuery({
    queryKey: ['rel-lider-painel', time, dia ?? 'hoje'],
    enabled: !!time,
    staleTime: 60_000,
    queryFn: async (): Promise<VendedorPainel[]> => {
      const { data, error } = await supabase.rpc('relatorio_lider_painel', {
        p_time: time, p_dia: dia ?? null,
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
  termometro: 'verde' | 'amarelo' | 'vermelho' | null
}

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

// ─── O relatório em si ──────────────────────────────────────────────────────

export interface NegocioForm {
  tipo: 'quente' | 'perdido'
  cliente: string
  vendedor_nome: string
  valor: number | null
  previsao?: string
  obstaculo?: string
  motivo?: string
  concorrente?: string
}

export interface RelatorioForm {
  time_slug: string
  lider_nome: string
  abaixo_vendedor: string | null
  abaixo_motivo: string | null
  qualidade_lead: 'bons' | 'mistos' | 'ruins' | null
  qualidade_lead_motivo: string | null
  termometro: 'verde' | 'amarelo' | 'vermelho'
  termometro_obs: string | null
  negocios: NegocioForm[]
}

/** Relatório de hoje daquele time, se já existir (o líder pode corrigir). */
export function useRelatorioDoDia(time: TimeSlug | null, dia?: string) {
  return useQuery({
    queryKey: ['rel-lider-dia', time, dia ?? 'hoje'],
    enabled: !!time,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase.from('relatorio_lider')
        .select('*, negocios:relatorio_lider_negocio(*)')
        .eq('time_slug', time!)
      q = dia ? q.eq('dia', dia) : q.gte('dia', hojeSP())
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function hojeSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function useSalvarRelatorio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (form: RelatorioForm) => {
      // upsert por (time_slug, dia): reabrir a tela no mesmo dia CORRIGE o
      // relatório em vez de criar um segundo. Dois relatórios do mesmo time
      // no mesmo dia quebrariam o placar da semana.
      const { data: rel, error: e1 } = await supabase
        .from('relatorio_lider')
        .upsert({
          time_slug: form.time_slug,
          dia: hojeSP(),
          lider_nome: form.lider_nome,
          abaixo_vendedor: form.abaixo_vendedor,
          abaixo_motivo: form.abaixo_motivo,
          qualidade_lead: form.qualidade_lead,
          qualidade_lead_motivo: form.qualidade_lead_motivo,
          termometro: form.termometro,
          termometro_obs: form.termometro_obs,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'time_slug,dia' })
        .select('id')
        .single()
      if (e1) throw e1

      // Negócios são reescritos por inteiro: mais simples e sem risco de
      // duplicar quando o líder corrige. O volume é de 1 a 3 linhas por dia.
      const { error: e2 } = await supabase
        .from('relatorio_lider_negocio').delete().eq('relatorio_id', rel.id)
      if (e2) throw e2

      if (form.negocios.length) {
        const { error: e3 } = await supabase.from('relatorio_lider_negocio').insert(
          form.negocios.map(n => ({ ...n, relatorio_id: rel.id })),
        )
        if (e3) throw e3
      }
      return rel.id as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rel-lider-dia'] })
      qc.invalidateQueries({ queryKey: ['rel-lider-serie'] })
    },
  })
}
