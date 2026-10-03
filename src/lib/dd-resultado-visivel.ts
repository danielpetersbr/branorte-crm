import type { DDConsulta, DDConsultaResponse } from '../hooks/useDueDiligence'

/** Um link de histórico só pode exibir sua própria consulta, mesmo em falha/loading. */
export function selecionarConsultaVisivel(nova: DDConsultaResponse | undefined, historico: DDConsulta | null | undefined, historicoId?: string | null): DDConsulta | null {
  const id = historicoId ?? historico?.id
  if (id) return historico?.id === id ? historico : null
  return nova?.consulta ?? null
}
