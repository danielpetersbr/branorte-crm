import type { QueryClient } from '@tanstack/react-query'
import type { Reuniao } from '../hooks/useReunioes'

export const REUNIOES_KEY = ['reunioes']
export const REUNIOES_MUTATION_KEY = ['reunioes-update']
export const REUNIOES_MUTATION_SCOPE = { id: 'reunioes-write' }

// Gravações têm RPCs atômicas; o update genérico nunca deve substituir o array.
export type AtualizacaoReuniao = { id: string } & Partial<Pick<Reuniao,
  'titulo' | 'data_reuniao' | 'status' | 'pauta' | 'tarefas' | 'resumo' | 'apresentacao_manifesto'>>

export function inserirReuniaoNoCache(old: Reuniao[] | undefined, criada: Reuniao): Reuniao[] {
  return [criada, ...(old ?? []).filter(r => r.id !== criada.id)]
    .sort((a, b) => b.data_reuniao.localeCompare(a.data_reuniao))
}

export function aplicarAtualizacaoReuniao(old: Reuniao[] | undefined, input: AtualizacaoReuniao) {
  return old?.map(r => r.id === input.id ? { ...r, ...input } : r)
}

export function reverterAtualizacaoReuniao(
  old: Reuniao[] | undefined, anterior: Reuniao | undefined, input: AtualizacaoReuniao,
) {
  if (!anterior) return old
  return old?.map(r => {
    if (r.id !== input.id) return r
    const restaurar: Record<string, unknown> = {}
    for (const campo of Object.keys(input) as (keyof AtualizacaoReuniao)[]) {
      if (campo === 'id') continue
      // O React Query compartilha estruturalmente arrays/objetos: referência
      // não basta. Só reverta o campo se nenhuma edição posterior o alterou.
      if (JSON.stringify(r[campo]) === JSON.stringify(input[campo])) restaurar[campo] = anterior[campo]
    }
    return { ...r, ...restaurar }
  })
}

export function invalidarReunioesAposEscritas(qc: QueryClient) {
  // onSettled ainda conta a própria mutation. RPCs de gravação usam a mesma
  // chave para não disparar refetch sobre uma edição otimista pendente.
  if (qc.isMutating({ mutationKey: REUNIOES_MUTATION_KEY }) === 1) {
    return qc.invalidateQueries({ queryKey: REUNIOES_KEY })
  }
}

export async function excluirReuniaoComAudios(
  excluirRegistro: () => Promise<void>, excluirAudios: () => Promise<void>,
): Promise<{ cleanupError?: string }> {
  await excluirRegistro()
  try {
    await excluirAudios()
    return {}
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return { cleanupError: `Reunião excluída, mas não foi possível limpar os áudios: ${detalhe}` }
  }
}
