import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todasAsLinhas } from '@/lib/rpc-paginado'
import { selecionarMapaVisual, type ModoMapaVisual } from '@/lib/mapa-visual'
import type { OrcamentoPonto, Visita } from './useVisitas'

export interface MapaVisualResumo {
  vendidos: number
  orcados: number
  visitas: number
  visitas_no_mapa: number
  visitas_sem_localizacao: number
}

const STALE_TIME = 60_000
const PRAZO_MS = 20_000

function acessoNegadoMapaVisual(erro: unknown) {
  if (!erro || typeof erro !== 'object') return false
  const e = erro as { code?: string; status?: number }
  return e.status === 401 || e.status === 403
    || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(e.code ?? '')
}

function descartarPontosVisuais(qc: ReturnType<typeof useQueryClient>) {
  qc.removeQueries({ queryKey: ['visitas', 'visual'], type: 'inactive' })
  qc.removeQueries({ queryKey: ['orcamentos-mapa', 'visual'], type: 'inactive' })
}

// Um prazo para a operação inteira, inclusive autenticação e todas as páginas.
// O race também encerra a espera se o transporte ainda não alcançou o fetch.
export async function comPrazoMapaVisual<T>(
  signal: AbortSignal,
  operacao: (signal: AbortSignal) => Promise<T>,
  prazoMs = PRAZO_MS,
): Promise<T> {
  signal.throwIfAborted()
  const controller = new AbortController()
  let rejeitar!: (erro: unknown) => void
  const interrupcao = new Promise<never>((_, reject) => { rejeitar = reject })
  const interromper = (erro: unknown) => {
    controller.abort(erro)
    rejeitar(erro)
  }
  const cancelar = () => interromper(signal.reason)
  signal.addEventListener('abort', cancelar, { once: true })
  const timer = setTimeout(() => interromper(new Error('O carregamento demorou demais. Tente novamente.')), prazoMs)
  try {
    return await Promise.race([operacao(controller.signal), interrupcao])
  } catch (erro) {
    controller.abort(erro)
    throw erro
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancelar)
  }
}

export function validarResumoMapaVisual(data: unknown): MapaVisualResumo {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
    throw new Error('Não foi possível conferir as quantidades dos mapas.')
  }
  const r = data[0] as MapaVisualResumo
  const campos = ['vendidos', 'orcados', 'visitas', 'visitas_no_mapa', 'visitas_sem_localizacao'] as const
  if (!campos.every(c => Number.isSafeInteger(r[c]) && r[c] >= 0)
    || r.visitas !== r.visitas_no_mapa + r.visitas_sem_localizacao) {
    throw new Error('Não foi possível conferir as quantidades dos mapas.')
  }
  return r
}

export function useMapaVisualResumo(enabled = true) {
  const qc = useQueryClient()
  const consulta = useQuery<MapaVisualResumo>({
    queryKey: ['mapa-visual-resumo', 'orcados-24m'],
    enabled,
    staleTime: STALE_TIME,
    refetchInterval: STALE_TIME,
    retry: false,
    queryFn: ({ signal }) => comPrazoMapaVisual(signal, async abortSignal => {
      const { data, error, status } = await supabase.rpc('mapa_visual_resumo').abortSignal(abortSignal)
      if (error) throw Object.assign(new Error(error.message), error, { status })
      return validarResumoMapaVisual(data)
    }),
  })
  useEffect(() => {
    if (acessoNegadoMapaVisual(consulta.error)) descartarPontosVisuais(qc)
    if (!consulta.isSuccess || consulta.isStale || !consulta.data) return
    const r = consulta.data
    for (const [fonte, modo, quantidade] of [
      ['orcamentos-mapa', 'vendidos', r.vendidos], ['orcamentos-mapa', 'orcados', r.orcados],
      ['visitas', 'visitas', r.visitas_no_mapa],
    ] as const) {
      // Uma nova leitura do resumo pode refletir redução de UF mesmo com total
      // positivo. Pontos anteriores precisam validar o acesso na própria RPC.
      qc.removeQueries({ queryKey: [fonte, 'visual', modo, ...(modo === 'orcados' ? ['24m'] : [])], exact: true, type: 'inactive',
        predicate: query => quantidade === 0 || query.state.dataUpdatedAt <= consulta.dataUpdatedAt })
    }
  }, [qc, consulta.error, consulta.data, consulta.dataUpdatedAt, consulta.isSuccess, consulta.isStale])
  return consulta
}

export function useMapaVisualPontos(modo: ModoMapaVisual) {
  const qc = useQueryClient()
  const visitas = modo === 'visitas'
  const consulta = useQuery({
    // As invalidações do mapa completo também alcançam estes caches específicos.
    queryKey: [visitas ? 'visitas' : 'orcamentos-mapa', 'visual', modo, ...(modo === 'orcados' ? ['24m'] : [])],
    staleTime: STALE_TIME,
    refetchInterval: modo === 'orcados' ? STALE_TIME : false,
    retry: false,
    queryFn: ({ signal }) => comPrazoMapaVisual(signal, abortSignal =>
      todasAsLinhas<Visita | OrcamentoPonto>(async (de, ate) => {
        abortSignal.throwIfAborted()
        let query = supabase.rpc(
          visitas ? 'mapa_visual_visitas' : modo === 'orcados' ? 'mapa_visual_orcados' : 'mapa_orcamentos_v2', {}, { count: 'exact' },
        )
        if (modo === 'vendidos') query = query.or('vendido.eq.true,n_vendas.gt.0')
        else {
          if (visitas) query = query.eq('visitar', true)
          query = query.eq('vendido', false).lte('n_vendas', 0)
        }
        const { data, error, count, status } = await query.range(de, ate).abortSignal(abortSignal)
        if (error) throw Object.assign(new Error(error.message), error, { status })
        return { linhas: (data ?? []) as (Visita | OrcamentoPonto)[], total: count ?? null }
      })),
    select: dados => visitas
      ? selecionarMapaVisual([], dados as Visita[]).visitas
      : selecionarMapaVisual(dados as OrcamentoPonto[], [])[modo],
  })
  useEffect(() => {
    if (!acessoNegadoMapaVisual(consulta.error)) return
    descartarPontosVisuais(qc)
    qc.removeQueries({ queryKey: ['mapa-visual-resumo'], type: 'inactive' })
  }, [qc, consulta.error])
  return consulta
}
