import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Visita de campo: check-in, relatório e check-out.
//
// Tudo passa por RPC SECURITY DEFINER de propósito. viagens, viagem_paradas e
// agenda_itens têm policy RESTRICTIVE "NOT papel_restrito()", e 'representante'
// está em papel_restrito() — ele não lê nem a própria viagem pela tabela. Um
// .update() direto aqui não daria erro: daria 0 linhas afetadas, e a tela ia
// parecer que salvou. A checagem de dono mora dentro de posso_visitar_parada().

export interface MinhaVisita {
  parada_id: string
  viagem_id: string
  viagem_nome: string | null
  dia: number
  ordem: number | null
  data_prevista: string | null
  cliente: string
  cidade: string | null
  uf: string | null
  telefone: string | null
  equipamento: string | null
  valor: number | null
  lat: number | null
  lng: number | null
  ponto_confiavel: boolean
  confirmacao: string | null
  notas: string | null
  checkin_at: string | null
  checkout_at: string | null
  distancia_m: number | null
  tem_relatorio: boolean
  resultado: string | null
  proxima_data: string | null
  // o relatório inteiro volta junto: o formulário de edição precisa abrir
  // preenchido, senão salvar de novo grava null por cima do que já existia.
  proximo_passo: string | null
  interesse: string | null
  valor_potencial: number | null
  concorrente: string | null
  objecao: string | null
}

export interface MinhaAtividade {
  id: number
  titulo: string
  descricao: string | null
  data: string | null
  hora: string | null
  concluido: boolean
  contato_nome: string | null
}

export interface CheckinResultado {
  ja_tinha_checkin: boolean
  checkin_at: string
  distancia_m: number | null
  ponto_confiavel: boolean
  sem_gps: boolean
  fora_do_ponto: boolean
  fora_do_roteiro: boolean
}

export interface CheckoutResultado {
  ja_encerrada: boolean
  checkout_at: string
  minutos: number
  visita_relampago: boolean
}

export const RESULTADOS = [
  { value: 'venda', label: 'Fechou venda' },
  { value: 'proposta', label: 'Vai receber proposta' },
  { value: 'negociacao', label: 'Em negociação' },
  { value: 'remarcar', label: 'Remarcar' },
  { value: 'sem_interesse', label: 'Sem interesse' },
  { value: 'nao_encontrou', label: 'Não encontrou o cliente' },
] as const

export const RESULTADO_LABEL: Record<string, string> =
  Object.fromEntries(RESULTADOS.map(r => [r.value, r.label]))

// Check-in muda estado que aparece na lista do representante, na agenda dele e
// no painel do gestor. Invalidar só a lista já causou bug neste repo antes:
// o vendedor corrigia e a outra tela ficava no valor velho até dar F5.
function invalidarTudo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['minhas-visitas'] })
  qc.invalidateQueries({ queryKey: ['minhas-atividades'] })
  qc.invalidateQueries({ queryKey: ['rep-painel'] })
  qc.invalidateQueries({ queryKey: ['rep-visitas'] })
}

export function useMinhasVisitas(de?: string | null, ate?: string | null) {
  return useQuery({
    queryKey: ['minhas-visitas', de ?? null, ate ?? null],
    queryFn: async (): Promise<MinhaVisita[]> => {
      const { data, error } = await (supabase as any).rpc('minhas_visitas', {
        p_de: de ?? null, p_ate: ate ?? null,
      })
      if (error) throw error
      return (data ?? []) as MinhaVisita[]
    },
  })
}

export function useMinhasAtividades(de?: string | null, ate?: string | null) {
  return useQuery({
    queryKey: ['minhas-atividades', de ?? null, ate ?? null],
    queryFn: async (): Promise<MinhaAtividade[]> => {
      const { data, error } = await (supabase as any).rpc('minhas_atividades', {
        p_de: de ?? null, p_ate: ate ?? null,
      })
      if (error) throw error
      return (data ?? []) as MinhaAtividade[]
    },
  })
}

// Pega a posição SEM travar o check-in. GPS negado ou fora do ar devolve null:
// a visita entra marcada como "sem GPS" e o gestor decide. Bloquear aqui faria
// o representante em fazenda sem sinal parar de bater ponto — e aí não se mede
// mais nada.
export function pegarPosicao(timeoutMs = 8000): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ lat: null, lng: null })
      return
    }
    let respondeu = false
    const fim = (lat: number | null, lng: number | null) => {
      if (respondeu) return
      respondeu = true
      resolve({ lat, lng })
    }
    // timeout próprio: em alguns Android o callback do getCurrentPosition
    // simplesmente não volta, e o botão ficaria girando pra sempre.
    const t = setTimeout(() => fim(null, null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); fim(p.coords.latitude, p.coords.longitude) },
      () => { clearTimeout(t); fim(null, null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

export function useCheckin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (parada_id: string): Promise<CheckinResultado> => {
      const pos = await pegarPosicao()
      const { data, error } = await (supabase as any).rpc('visita_checkin', {
        p_parada: parada_id, p_lat: pos.lat, p_lng: pos.lng,
      })
      if (error) throw error
      return data as CheckinResultado
    },
    onSuccess: () => invalidarTudo(qc),
  })
}

export function useCheckout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (parada_id: string): Promise<CheckoutResultado> => {
      const { data, error } = await (supabase as any).rpc('visita_checkout', { p_parada: parada_id })
      if (error) throw error
      return data as CheckoutResultado
    },
    onSuccess: () => invalidarTudo(qc),
  })
}

export interface RelatorioInput {
  parada_id: string
  resultado: string
  proximo_passo: string
  interesse?: string | null
  valor_potencial?: number | null
  concorrente?: string | null
  objecao?: string | null
  proxima_data?: string | null
}

export const PROXIMO_PASSO_MIN = 10

export function useSalvarRelatorio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RelatorioInput) => {
      // O CHECK do banco exige 10 caracteres. Deixar estourar entregaria ao
      // representante um "violates check constraint" cru — o repo previne antes
      // do round-trip em vez de traduzir erro de Postgres depois.
      if (input.proximo_passo.trim().length < PROXIMO_PASSO_MIN) {
        throw new Error(`Escreva o próximo passo com pelo menos ${PROXIMO_PASSO_MIN} caracteres.`)
      }
      if (!input.resultado) throw new Error('Escolha o resultado da visita.')
      const { error } = await (supabase as any).rpc('visita_relatorio_salvar', {
        p_parada: input.parada_id,
        p_resultado: input.resultado,
        p_proximo_passo: input.proximo_passo.trim(),
        p_interesse: input.interesse || null,
        p_valor_potencial: input.valor_potencial ?? null,
        p_concorrente: input.concorrente || null,
        p_objecao: input.objecao || null,
        p_proxima_data: input.proxima_data || null,
      })
      if (error) throw error
    },
    onSuccess: () => invalidarTudo(qc),
  })
}

export function useConcluirAtividade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: number; concluido: boolean }) => {
      const { error } = await (supabase as any).rpc('minha_atividade_concluir', {
        p_id: input.id, p_concluido: input.concluido,
      })
      if (error) throw error
    },
    onSuccess: () => invalidarTudo(qc),
  })
}
