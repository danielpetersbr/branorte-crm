// Filtro "Nunca respondeu (auto)" da /atendimentos com a lista GRANDE de telefones.
//
// (29/09/2026) A RPC atendimentos_telefones_sem_resposta devolve ~3.600 telefones e a
// listagem mandava todos num `.in('telefone_norm', …)`. O `.in()` vai na URL: 58 KB de
// query string, e o proxy do Supabase devolve 400 antes de chegar no PostgREST (medido:
// 1.200 telefones / 19 KB ainda passam; 3.621 / 58 KB não). Com `placeholderData` a tela
// continuava mostrando a lista ANTERIOR com o card aceso — o filtro nunca aparecia.
//
// A saída sem mexer no banco: perguntar em lotes que cabem na URL só a chave e a
// ordenação (telefone_norm, ultima_msg), juntar, ordenar e paginar aqui, e depois buscar
// a linha inteira só dos telefones da página. Estas duas funções são a parte pura disso.

/** Parte a lista em pedaços de no máximo `tamanho` itens, na ordem original. */
export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error(`tamanho de lote inválido: ${tamanho}`)
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}

export interface ChaveAtendimento {
  telefone_norm: string | null
  ultima_msg: string | null
}

/**
 * Ordena como a listagem ordena (`ultima_msg` desc, sem data por último) e devolve os
 * telefones da página pedida mais o total. Telefone repetido (dois lotes não se
 * sobrepõem, mas a lista da RPC pode trazer duplicata) conta uma vez só. Empate de
 * `ultima_msg` desempata pelo telefone — sem isso a mesma linha podia aparecer em duas
 * páginas, porque cada página é uma consulta nova.
 */
export function paginaPorUltimaMsg(
  linhas: readonly ChaveAtendimento[],
  pagina: number,
  tamanhoPagina: number,
): { total: number; telefones: string[] } {
  const porTelefone = new Map<string, number>()
  for (const l of linhas) {
    if (!l.telefone_norm) continue
    const t = l.ultima_msg ? Date.parse(l.ultima_msg) : NaN
    const ms = Number.isNaN(t) ? -Infinity : t
    const atual = porTelefone.get(l.telefone_norm)
    if (atual === undefined || ms > atual) porTelefone.set(l.telefone_norm, ms)
  }
  const ordenados = [...porTelefone.entries()].sort((a, b) =>
    b[1] !== a[1] ? (b[1] > a[1] ? 1 : -1) : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )
  const de = Math.max(0, pagina) * tamanhoPagina
  return {
    total: ordenados.length,
    telefones: ordenados.slice(de, de + tamanhoPagina).map(([tel]) => tel),
  }
}
