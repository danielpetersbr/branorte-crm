import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Painel de gestão da rede de representantes.
//
// As duas RPCs são SECURITY DEFINER e checam pode_gerir_representantes() lá
// dentro: quem não gere recebe ZERO linha, não uma tela bonita com dado alheio.
// O guard de rota no App.tsx só escolhe a tela — a trava é essa.

export interface RepKpi {
  rep: string
  rep_nome: string | null
  planejadas: number
  realizadas: number
  execucao: number | null
  sem_relatorio: number
  minutos_medios: number | null
  km: number | null
  custo_visita: number | null
  clientes_novos: number
  cobertura: number | null
  propostas: number
  visita_para_proposta: number | null
  vendas: number
  proposta_para_venda: number | null
  ticket: number | null
  receita: number | null
  ciclo_dias: number | null
  pipeline: number | null
  atividades_vencidas: number
}

export interface RepVisita {
  parada_id: string
  rep: string
  rep_nome: string | null
  cliente: string
  data_prevista: string | null
  cidade: string | null
  uf: string | null
  lat: number | null
  lng: number | null
  ponto_exato: boolean
  checkin_at: string | null
  checkout_at: string | null
  minutos: number | null
  checkin_lat: number | null
  checkin_lng: number | null
  distancia_m: number | null
  ponto_confiavel: boolean | null
  resultado: string | null
  valor_potencial: number | null
  sem_relatorio: boolean
  fora_do_ponto: boolean
  sem_gps: boolean
  visita_relampago: boolean
  fora_do_roteiro: boolean
  nao_compareceu: boolean
  sem_como_conferir: boolean
}

// Estado da visita — é ele que dá a cor do pino no mapa gerencial.
//
// 'sem_conferencia' existe porque o verde estava mentindo: fora_do_ponto só é
// calculado quando o pino do cliente é confiável, e hoje quase todo pino é o
// centro do município. Sem esse estado, a visita que NÃO TEVE COMO ser conferida
// saía do mesmo verde de "conferida e certa" — o mapa afirmava uma verificação
// que nunca aconteceu.
export type EstadoVisita = 'alerta' | 'ok' | 'sem_conferencia' | 'a_visitar'

export function estadoDaVisita(v: RepVisita): EstadoVisita {
  if (temAlerta(v)) return 'alerta'
  if (!v.checkin_at) return 'a_visitar'
  return v.sem_como_conferir ? 'sem_conferencia' : 'ok'
}

// severidade pro desenho: quanto maior, mais por cima o pino fica. Sem isto o
// alerta some debaixo de um pino verde quando os dois caem no mesmo centroide.
export const PESO_ESTADO: Record<EstadoVisita, number> = {
  a_visitar: 0, ok: 1, sem_conferencia: 2, alerta: 3,
}

export function usePodeGerirRepresentantes() {
  return useQuery({
    queryKey: ['pode-gerir-representantes'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as any).rpc('pode_gerir_representantes')
      if (error) throw error
      return data === true
    },
    staleTime: 60_000,
  })
}

export function useRepPainel(de: string, ate: string, rep?: string | null) {
  return useQuery({
    queryKey: ['rep-painel', de, ate, rep ?? null],
    queryFn: async (): Promise<RepKpi[]> => {
      const { data, error } = await (supabase as any).rpc('rep_painel', {
        p_de: de, p_ate: ate, p_rep: rep || null,
      })
      if (error) throw error
      return (data ?? []) as RepKpi[]
    },
  })
}

export function useRepVisitas(de: string, ate: string, rep?: string | null, soAlertas = false) {
  return useQuery({
    queryKey: ['rep-visitas', de, ate, rep ?? null, soAlertas],
    queryFn: async (): Promise<RepVisita[]> => {
      const { data, error } = await (supabase as any).rpc('rep_visitas', {
        p_de: de, p_ate: ate, p_rep: rep || null, p_so_alertas: soAlertas,
      })
      if (error) throw error
      return (data ?? []) as RepVisita[]
    },
  })
}

export function temAlerta(v: RepVisita): boolean {
  return v.sem_relatorio || v.fora_do_ponto || v.sem_gps
      || v.visita_relampago || v.fora_do_roteiro || v.nao_compareceu
}

export function alertasDe(v: RepVisita): string[] {
  const a: string[] = []
  // o dia passou e ninguém foi — num painel de execução, é o alerta que mais pesa
  if (v.nao_compareceu) a.push('não foi visitada')
  if (v.sem_relatorio) a.push('sem relatório')
  if (v.fora_do_ponto) a.push(`${((v.distancia_m ?? 0) / 1000).toFixed(1)} km do cliente`)
  if (v.sem_gps) a.push('sem GPS')
  if (v.visita_relampago) a.push('menos de 5 min')
  if (v.fora_do_roteiro) a.push('fora do dia planejado')
  return a
}

// ============================================================================
// CANDIDATURAS — quem se cadastrou no formulário público /seja-representante
// ============================================================================
// A leitura passa pela RLS de representante_candidaturas (policy rc_select_gestor
// → pode_gerir_representantes()). Vendedor comum recebe ZERO linha, não erro.
// Score/faixa/flags são calculados pelo trigger no banco — nunca pelo cliente.

export interface CandidaturaFlag { t: 'red' | 'amber' | 'green'; k: string; m: string }

export interface Candidatura {
  id: string
  created_at: string
  nome: string
  telefone: string
  cidade: string
  uf: string
  ufs_desejadas: string[]
  cidades_atendidas: string
  cnpj: 'sim' | 'abrindo' | 'nao'
  veiculo: boolean
  anos_agro: number
  linha_principal: string
  marcas: string
  conflito: boolean
  especies: string[]
  clientes_ativos: number
  visitados_90d: number
  visitas_semana: number
  km_mes: number
  ticket_faixa: number
  maior_venda: string
  clientes_racao: number
  tres_clientes: string
  referencia: string
  score: number
  faixa: string
  flags: CandidaturaFlag[]
  detalhe_score: Record<string, number>
  status: string
  notas_internas: string | null
}

export const CAND_STATUS: Record<string, string> = {
  novo: 'Novo',
  em_analise: 'Em análise',
  chamado: 'Chamado pra conversa',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  banco_talentos: 'Banco de talentos',
}

export const LINHA_LABEL: Record<string, string> = {
  nutricao: 'Nutrição animal',
  equip: 'Equipamento pecuário',
  silo: 'Silos / armazenagem',
  vet: 'Medicamento veterinário',
  consult: 'Consultoria técnica',
  insumo: 'Insumo agrícola',
  outro: 'Outra',
}

export const TICKET_LABEL: Record<number, string> = {
  1: 'até R$ 5 mil', 2: 'R$ 5–20 mil', 3: 'R$ 20–50 mil',
  4: 'R$ 50–150 mil', 5: 'acima de R$ 150 mil',
}

export function useCandidaturas(status?: string | null) {
  return useQuery({
    queryKey: ['rep-candidaturas', status ?? null],
    queryFn: async (): Promise<Candidatura[]> => {
      let q = (supabase as any)
        .from('representante_candidaturas')
        .select('*')
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Candidatura[]
    },
    staleTime: 30_000,
  })
}

export async function salvarTriagem(id: string, patch: { status?: string; notas_internas?: string }) {
  const { error } = await (supabase as any)
    .from('representante_candidaturas')
    .update({ ...patch, avaliado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
