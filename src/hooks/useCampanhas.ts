import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Ritmos possíveis. Faixa fechada de propósito: se o vendedor puder digitar o
// intervalo, alguém vai digitar 5 segundos e queimar o próprio número. Os valores
// reais (segundos entre um envio e outro) moram na edge campanha-poll — aqui só o
// rótulo, pra UI e pro texto explicativo baterem com o que o servidor faz.
export const RITMOS = [
  {
    value: 'cauteloso' as const,
    label: 'Cauteloso',
    detalhe: '~1 a cada 2min30',
    porHora: 24,   // INTERVALO_SEG.cauteloso = 150s
  },
  {
    value: 'normal' as const,
    label: 'Normal',
    detalhe: '~1 a cada 1min30',
    porHora: 40,   // INTERVALO_SEG.normal = 90s, e é o mesmo valor do TETO_HORA
  },
]

export type Ritmo = (typeof RITMOS)[number]['value']
export type CampanhaStatus = 'rascunho' | 'ativa' | 'pausada' | 'concluida' | 'cancelada'

export interface Campanha {
  id: string
  vendedor_nome: string
  titulo: string
  sequencia_id: string
  ritmo: Ritmo
  status: CampanhaStatus
  total_alvos: number
  origem_filtro: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface CampanhaProgresso extends Campanha {
  sequencia_titulo: string | null
  enviados: number
  pendentes: number
  falhas: number
}

export interface SequenciaResumo {
  id: string
  title: string
  category: string | null
  passos: number
  temAudio: boolean
}

/** Nome do vendedor logado no mesmo formato que a extensão usa (UPPER, ex: "EDER"). */
export function useVendedorAtual() {
  return useQuery({
    queryKey: ['vendedor-atual'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any).rpc('current_vendedor_nome')
      if (error) throw error
      const nome = (data as string | null)?.trim()
      return nome ? nome.toUpperCase() : null
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * Sequências disponíveis pro vendedor — é de onde sai a mensagem da campanha.
 * Não duplicamos editor: o construtor de sequências da extensão já faz texto,
 * áudio, imagem e delay por passo.
 */
export function useSequenciasDisponiveis(vendedorNome: string | null | undefined) {
  return useQuery({
    queryKey: ['sequencias-disponiveis', vendedorNome ?? ''],
    enabled: !!vendedorNome,
    queryFn: async (): Promise<SequenciaResumo[]> => {
      const { data, error } = await (supabase as any)
        .from('quick_sequences')
        .select('id, title, category, steps, vendedor_nome, is_shared')
        .or(`vendedor_nome.eq.${vendedorNome},is_shared.eq.true`)
        .order('title')
      if (error) throw error
      return ((data ?? []) as any[]).map(s => {
        const steps = Array.isArray(s.steps) ? s.steps : []
        return {
          id: s.id,
          title: s.title,
          category: s.category ?? null,
          // 'start' é o nó inicial do canvas do construtor, não é passo enviável.
          passos: steps.filter((p: any) => p?.tipo && p.tipo !== 'start').length,
          temAudio: steps.some((p: any) => p?.tipo === 'audio'),
        }
      })
    },
    staleTime: 60_000,
  })
}

export interface NovaCampanhaInput {
  vendedorNome: string
  titulo: string
  sequenciaId: string
  ritmo: Ritmo
  alvos: { telefone: string; nome: string | null }[]
  origemFiltro?: Record<string, unknown>
}

/**
 * Cria a campanha já com os alvos. Nasce como 'rascunho': o disparo só começa
 * quando o vendedor confirmar (mudança pra 'ativa'), pra não existir caminho em
 * que fechar um modal sem querer manda mensagem pra 300 pessoas.
 */
export function useCriarCampanha() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: NovaCampanhaInput): Promise<Campanha> => {
      const alvosValidos = input.alvos.filter(a => (a.telefone || '').replace(/\D/g, '').length >= 10)
      if (alvosValidos.length === 0) throw new Error('Nenhum telefone válido na seleção.')

      const { data: campanha, error: errCamp } = await (supabase as any)
        .from('wa_campanhas')
        .insert({
          vendedor_nome: input.vendedorNome,
          titulo: input.titulo,
          sequencia_id: input.sequenciaId,
          ritmo: input.ritmo,
          status: 'rascunho',
          total_alvos: alvosValidos.length,
          origem_filtro: input.origemFiltro ?? null,
        })
        .select()
        .single()
      if (errCamp) throw errCamp

      const { error: errAlvos } = await (supabase as any)
        .from('wa_campanha_alvos')
        .insert(alvosValidos.map(a => ({
          campanha_id: campanha.id,
          telefone: a.telefone,
          nome: a.nome,
        })))
      // Órfã (campanha sem alvos) é pior que campanha nenhuma: some sozinha.
      if (errAlvos) {
        await (supabase as any).from('wa_campanhas').delete().eq('id', campanha.id)
        throw errAlvos
      }

      // O total real pode ser menor que alvosValidos.length: o índice único
      // (campanha_id, telefone_norm) descarta o mesmo número repetido na seleção.
      const { count } = await (supabase as any)
        .from('wa_campanha_alvos')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campanha.id)
      if (typeof count === 'number' && count !== campanha.total_alvos) {
        await (supabase as any).from('wa_campanhas').update({ total_alvos: count }).eq('id', campanha.id)
        campanha.total_alvos = count
      }

      qc.invalidateQueries({ queryKey: ['campanhas'] })
      return campanha as Campanha
    },
  })
}

/** Liga/pausa/cancela. É o único caminho que faz mensagem começar a sair. */
export function useMudarStatusCampanha() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CampanhaStatus }) => {
      const patch: Record<string, unknown> = { status }
      if (status === 'ativa') patch.started_at = new Date().toISOString()
      if (status === 'concluida' || status === 'cancelada') patch.finished_at = new Date().toISOString()
      const { error } = await (supabase as any).from('wa_campanhas').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campanhas'] }),
  })
}

/** Campanhas do vendedor com progresso (enviados/pendentes/falhas). */
export function useCampanhas(vendedorNome: string | null | undefined) {
  return useQuery({
    queryKey: ['campanhas', vendedorNome ?? ''],
    enabled: !!vendedorNome,
    queryFn: async (): Promise<CampanhaProgresso[]> => {
      const { data: camps, error } = await (supabase as any)
        .from('wa_campanhas')
        .select('*, quick_sequences(title)')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      const lista = (camps ?? []) as any[]
      if (lista.length === 0) return []

      const { data: alvos, error: errAlvos } = await (supabase as any)
        .from('wa_campanha_alvos')
        .select('campanha_id, status')
        .in('campanha_id', lista.map(c => c.id))
      if (errAlvos) throw errAlvos

      const porCampanha = new Map<string, { enviados: number; pendentes: number; falhas: number }>()
      for (const a of (alvos ?? []) as any[]) {
        const acc = porCampanha.get(a.campanha_id) ?? { enviados: 0, pendentes: 0, falhas: 0 }
        if (a.status === 'sent') acc.enviados++
        else if (a.status === 'pending' || a.status === 'sending') acc.pendentes++
        else if (a.status === 'failed') acc.falhas++
        porCampanha.set(a.campanha_id, acc)
      }

      return lista.map(c => ({
        ...c,
        sequencia_titulo: c.quick_sequences?.title ?? null,
        ...(porCampanha.get(c.id) ?? { enviados: 0, pendentes: 0, falhas: 0 }),
      })) as CampanhaProgresso[]
    },
    refetchInterval: 20_000,
  })
}
