import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Central de Ligações — o que cada vendedor fez no telefone do WhatsApp.
//
// A fonte é `wa_ligacoes`, alimentada pela extensão a partir do HISTÓRICO do
// WhatsApp (a aba "Ligações"), não do CallStore ao vivo. Por isso é retroativa e
// cobre a carteira inteira, com ou sem etiqueta do funil.
//
// ⚠️ A RPC e o select abaixo rodam com a RLS da tabela: admin enxerga o time,
// vendedor enxerga só as próprias ligações.
// ============================================================================

export type Periodo = 'hoje' | '7d' | 'mes' | 'tudo'

export interface LigacaoResumo {
  vendedor: string
  fez: number
  recebeu: number
  atendidas: number
  // Das que ELE ligou, quantas atenderam. A taxa antiga usava atendidas/(fez+recebeu),
  // misturando o que ele controla com o que só acontece com ele.
  atendidas_fez: number
  perdidas: number
  tempo_seg: number
  dur_media: number
  clientes: number
  // Alcance ≠ esforço: 10 ligações pro mesmo cliente não valem 10 produtores diferentes.
  clientes_fez: number
  clientes_recebeu: number
  // Vídeo é interação de outra natureza: o vendedor MOSTRA o equipamento.
  video_fez: number
  clientes_video: number
  ultima: string | null
}

export interface Ligacao {
  call_id: string
  vendedor_nome: string
  peer: string | null
  outgoing: boolean | null
  estado: string | null
  duracao_seg: number | null
  offer_time: string | null
  is_video: boolean
  // Vêm do join com wa_chat_labels pelo @lid — sem isso a lista mostrava só
  // "contato do WhatsApp Business" e não dava pra saber pra quem ele ligou.
  cliente_nome: string | null
  cliente_fone: string | null
}

// Início do período em horário de Brasília, devolvido como ISO pro banco.
export function inicioDoPeriodo(p: Periodo): string | null {
  if (p === 'tudo') return null
  const agora = new Date()
  const brt = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  if (p === 'hoje') brt.setHours(0, 0, 0, 0)
  else if (p === '7d') { brt.setDate(brt.getDate() - 6); brt.setHours(0, 0, 0, 0) }
  else { brt.setDate(1); brt.setHours(0, 0, 0, 0) }
  // desfaz o deslocamento do toLocaleString pra voltar ao instante real
  const off = agora.getTime() - new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getTime()
  return new Date(brt.getTime() + off).toISOString()
}

export function useLigacoesResumo(periodo: Periodo) {
  return useQuery({
    queryKey: ['ligacoes-resumo', periodo],
    queryFn: async (): Promise<LigacaoResumo[]> => {
      const { data, error } = await supabase.rpc('ligacoes_resumo', {
        p_from: inicioDoPeriodo(periodo),
        p_to: null,
      })
      if (error) throw error
      return ((data ?? []) as LigacaoResumo[]).sort((a, b) => b.fez - a.fez || b.atendidas - a.atendidas)
    },
    staleTime: 60_000,
  })
}

// Lista detalhada de um vendedor. Só carrega quando alguém abre a linha —
// são milhares de registros no total e ninguém olha todos de uma vez.
export function useLigacoesDe(vendedor: string | null, periodo: Periodo) {
  return useQuery({
    queryKey: ['ligacoes-lista', vendedor, periodo],
    enabled: !!vendedor,
    queryFn: async (): Promise<Ligacao[]> => {
      let q = supabase
        .from('wa_ligacoes_cliente')
        .select('call_id,vendedor_nome,peer,outgoing,estado,duracao_seg,offer_time,is_video,cliente_nome,cliente_fone')
        .eq('vendedor_nome', vendedor as string)
        .not('offer_time', 'is', null)
        .order('offer_time', { ascending: false })
        .limit(300)
      const desde = inicioDoPeriodo(periodo)
      if (desde) q = q.gte('offer_time', desde)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Ligacao[]
    },
    staleTime: 60_000,
  })
}

export interface HoraLigacao { hora: number; feitas: number; atenderam: number }

// Que horas vale ligar. Variação medida em 17/08 sobre 567 ligações feitas:
// 15h atende 63%, 16h atende 40% — 23 pontos. Sem isso o time chuta o horário.
export function useLigacoesPorHora(periodo: Periodo) {
  return useQuery({
    queryKey: ['ligacoes-hora', periodo],
    queryFn: async (): Promise<HoraLigacao[]> => {
      const { data, error } = await supabase.rpc('ligacoes_por_hora', {
        p_from: inicioDoPeriodo(periodo), p_to: null,
      })
      if (error) throw error
      return ((data ?? []) as HoraLigacao[]).sort((a, b) => a.hora - b.hora)
    },
    staleTime: 60_000,
  })
}
