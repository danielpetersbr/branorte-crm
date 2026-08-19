import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// Central de Performance de Ligações — dados.
//
// Fonte: `wa_ligacoes`, alimentada pela extensão a partir do HISTÓRICO do
// WhatsApp (a aba "Ligações"), não do CallStore ao vivo. Por isso é retroativa
// e cobre a carteira inteira, com ou sem etiqueta do funil.
//
// ⚠️ TUDO roda com a RLS da tabela: admin enxerga o time, vendedor enxerga só as
// próprias ligações. As RPCs são SECURITY INVOKER de propósito.
//
// ATUALIZAÇÃO AUTOMÁTICA: 60s. A extensão sobe ligação a cada ciclo de ~30s, então
// olhar mais rápido que isso é gastar consulta à toa. O app tem
// `refetchOnWindowFocus: false` no global — sem `refetchInterval` a tela buscava UMA vez
// ao abrir e congelava até alguém recarregar (era o caso até 17/08/2026).
// ⚠️ `refetchIntervalInBackground` fica no padrão (false): com a aba em segundo plano o
// relógio para, senão 10 abas esquecidas abertas viram 10 consultas por minuto pra sempre.
//
// PERFORMANCE: são 4 consultas por período (resumo, resumo anterior, série
// diária, horas) e mais UMA sob demanda quando alguém abre um vendedor. Os
// gráficos "Evolução" e "Ligações no mês" saem da MESMA série diária — não há
// consulta duplicada. Nada é agregado no browser além de somas sobre listas de
// no máximo algumas dezenas de linhas.
// ============================================================================

export type Periodo = 'hoje' | '7d' | 'mes' | 'tudo' | 'custom'

export interface Janela { from: string | null; to: string | null }

export interface LigacaoResumo {
  vendedor: string
  fez: number
  recebeu: number
  atendidas: number
  // Das que ELE ligou, quantas atenderam. A taxa não pode usar (fez+recebeu):
  // misturaria o que o vendedor controla com o que só acontece com ele.
  atendidas_fez: number
  // ⚠️ perdidas = só das que ELE FEZ. Contar os dois sentidos dava 52 atendidas + 53
  // perdidas = 105 contra 98 ligações feitas, e o donut fechava 50% com o KPI em 53,1%.
  perdidas: number
  // Chamada que ELE recebeu e não atendeu — outra pergunta, campo separado.
  // ⚠️ Inclui `Canceled` (cliente desligou antes de ser atendido) desde 19/08/2026. Antes
  // era só Missed/Rejected, e isso escondia a maioria dos casos de quem deixa tocar: no
  // mês, JARDEL aparecia com 6 quando eram 50 e EDER com 1 quando eram 13.
  perdidas_recebidas: number
  // Dessas perdidas, quantas ele devolveu ligando de volta em até 2h. Existe pra que o
  // campo de cima não vire cobrança cega: quem retorna em 6 minutos não é quem sumiu.
  retornadas: number
  tempo_seg: number
  dur_media: number
  clientes: number
  clientes_fez: number
  clientes_recebeu: number
  video_fez: number
  clientes_video: number
  ultima: string | null
}

export interface SerieDia {
  dia: string
  feitas: number
  atendidas: number
  perdidas: number
  video: number
  recebidas: number
}

export interface HoraLigacao { hora: number; feitas: number; atenderam: number }

export interface Ligacao {
  call_id: string
  vendedor_nome: string
  peer: string | null
  outgoing: boolean | null
  estado: string | null
  duracao_seg: number | null
  offer_time: string | null
  is_video: boolean
  cliente_nome: string | null
  cliente_fone: string | null
}

// ── Janelas de tempo ────────────────────────────────────────────────────────
// Tudo em horário de Brasília. `to` é EXCLUSIVO (o SQL usa `< p_to`), então
// períodos consecutivos não contam a mesma ligação duas vezes.

function meiaNoiteBRT(d: Date): Date {
  // pega Y/M/D como vistos em São Paulo e remonta o instante correspondente
  const s = d.toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [y, m, dia] = s.split('-').map(Number)
  // -03:00 é o fuso do Brasil desde o fim do horário de verão (2019)
  return new Date(Date.UTC(y, m - 1, dia, 3, 0, 0))
}

export function janelaDoPeriodo(p: Periodo, custom?: Janela): Janela {
  if (p === 'custom') return custom ?? { from: null, to: null }
  if (p === 'tudo') return { from: null, to: null }
  const hoje0 = meiaNoiteBRT(new Date())
  if (p === 'hoje') return { from: hoje0.toISOString(), to: null }
  if (p === '7d') {
    const d = new Date(hoje0); d.setUTCDate(d.getUTCDate() - 6)
    return { from: d.toISOString(), to: null }
  }
  const d = new Date(hoje0); d.setUTCDate(1)
  return { from: d.toISOString(), to: null }
}

// Período ANTERIOR de mesmo tamanho: hoje→ontem, 7d→7 dias antes, mês→mês passado.
// "Tudo" não tem anterior — e comparar com o nada seria inventar contexto.
export function janelaAnterior(p: Periodo, custom?: Janela): Janela | null {
  if (p === 'tudo') return null
  const hoje0 = meiaNoiteBRT(new Date())
  if (p === 'hoje') {
    const ini = new Date(hoje0); ini.setUTCDate(ini.getUTCDate() - 1)
    return { from: ini.toISOString(), to: hoje0.toISOString() }
  }
  if (p === '7d') {
    const fim = new Date(hoje0); fim.setUTCDate(fim.getUTCDate() - 6)
    const ini = new Date(fim); ini.setUTCDate(ini.getUTCDate() - 7)
    return { from: ini.toISOString(), to: fim.toISOString() }
  }
  if (p === 'mes') {
    const inicioMes = new Date(hoje0); inicioMes.setUTCDate(1)
    const iniAnterior = new Date(inicioMes); iniAnterior.setUTCMonth(iniAnterior.getUTCMonth() - 1)
    return { from: iniAnterior.toISOString(), to: inicioMes.toISOString() }
  }
  // custom: janela de mesma duração, imediatamente antes
  if (custom?.from) {
    const ini = new Date(custom.from)
    const fim = custom.to ? new Date(custom.to) : new Date()
    const dur = fim.getTime() - ini.getTime()
    return { from: new Date(ini.getTime() - dur).toISOString(), to: custom.from }
  }
  return null
}

// ── Consultas ───────────────────────────────────────────────────────────────

// 60s: a extensão sobe ligação a cada ~30s, então este é o menor intervalo que
// ainda faz diferença. Ver o comentário do topo.
export const REFETCH_MS = 60_000

const args = (j: Janela, vendedor: string | null) => ({
  p_from: j.from, p_to: j.to, p_vendedor: vendedor,
})

// `auto` desliga o intervalo. A lista do seletor de vendedores usa a janela ABERTA
// (sem from/to), então cada refetch dela varre a tabela inteira — e o nome de quem
// tem ligação não muda de minuto em minuto. Medido: sem isso eram 3 chamadas de
// ligacoes_resumo por ciclo, uma delas o agregado completo.
export function useLigacoesResumo(j: Janela, vendedor: string | null, ativo = true, auto = true) {
  return useQuery({
    queryKey: ['ligacoes-resumo', j.from, j.to, vendedor],
    enabled: ativo,
    queryFn: async (): Promise<LigacaoResumo[]> => {
      const { data, error } = await supabase.rpc('ligacoes_resumo', args(j, vendedor))
      if (error) throw error
      return ((data ?? []) as LigacaoResumo[]).sort((a, b) => b.fez - a.fez || b.atendidas_fez - a.atendidas_fez)
    },
    staleTime: auto ? 45_000 : 10 * 60_000,
    refetchInterval: auto ? REFETCH_MS : false,
  })
}

export function useLigacoesSerie(j: Janela, vendedor: string | null) {
  return useQuery({
    queryKey: ['ligacoes-serie', j.from, j.to, vendedor],
    queryFn: async (): Promise<SerieDia[]> => {
      const { data, error } = await supabase.rpc('ligacoes_serie_dia', args(j, vendedor))
      if (error) throw error
      return ((data ?? []) as SerieDia[]).sort((a, b) => a.dia.localeCompare(b.dia))
    },
    staleTime: 45_000,
    refetchInterval: REFETCH_MS,
  })
}

export function useLigacoesPorHora(j: Janela, vendedor: string | null) {
  return useQuery({
    queryKey: ['ligacoes-hora', j.from, j.to, vendedor],
    queryFn: async (): Promise<HoraLigacao[]> => {
      const { data, error } = await supabase.rpc('ligacoes_por_hora', args(j, vendedor))
      if (error) throw error
      return ((data ?? []) as HoraLigacao[]).sort((a, b) => a.hora - b.hora)
    },
    staleTime: 45_000,
    refetchInterval: REFETCH_MS,
  })
}

// Lista detalhada de um vendedor. Só carrega quando alguém abre a linha — são
// milhares de registros no total e ninguém olha todos de uma vez.
export function useLigacoesDe(vendedor: string | null, j: Janela) {
  return useQuery({
    queryKey: ['ligacoes-lista', vendedor, j.from, j.to],
    enabled: !!vendedor,
    queryFn: async (): Promise<Ligacao[]> => {
      let q = supabase
        .from('wa_ligacoes_cliente')
        .select('call_id,vendedor_nome,peer,outgoing,estado,duracao_seg,offer_time,is_video,cliente_nome,cliente_fone')
        .eq('vendedor_nome', vendedor as string)
        .not('offer_time', 'is', null)
        .order('offer_time', { ascending: false })
        .limit(300)
      if (j.from) q = q.gte('offer_time', j.from)
      if (j.to) q = q.lt('offer_time', j.to)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Ligacao[]
    },
    staleTime: 60_000,
  })
}
