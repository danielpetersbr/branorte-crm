/**
 * Junta TODAS as linhas de uma RPC que devolve conjunto, página a página.
 *
 * O PostgREST corta a resposta em `max_rows` linhas (10.000 neste projeto) e NÃO
 * avisa — status 200, array menor. Apanhado em 02/09/2026 no /mapa-visitas:
 * `mapa_etiquetas_wa` devolve 17 mil conversas e `lista_orcamentos_mapa` 11,8 mil
 * orçamentos. 24 dos 36 clientes do DANIEL apareciam como "Sem WhatsApp
 * sincronizado" TENDO conversa sincronizada, porque a linha deles vinha depois
 * da 10.000ª e nunca chegava no navegador.
 *
 * Puro (sem Supabase) pra ser testável: recebe a função que busca UMA página
 * (`de` e `ate` inclusivos, como o `.range()` do supabase-js) e devolve as
 * linhas e, se o servidor informou (`Prefer: count=exact`), o total. Para quando
 * junta o total; sem total, para na primeira página curta ou vazia.
 *
 * O tamanho da página fica ABAIXO do teto de propósito: se alguém baixar o
 * `max_rows` no painel, a página vem curta, mas o total ainda diz que falta —
 * e a gente continua. Sem o total, uma página curta é o fim (e um teto menor que
 * a página voltaria a cortar calado — por isso o hook sempre pede o total).
 */
export interface PaginaRpc<T> {
  linhas: T[]
  /** Total de linhas no servidor, ou null se ele não informou. */
  total: number | null
}

export async function todasAsLinhas<T>(
  buscar: (de: number, ate: number) => Promise<PaginaRpc<T>>,
  tamanho = 5000,
  maxPaginas = 200,
): Promise<T[]> {
  const tudo: T[] = []
  for (let i = 0; i < maxPaginas; i++) {
    const de = tudo.length
    const { linhas, total } = await buscar(de, de + tamanho - 1)
    tudo.push(...linhas)
    if (linhas.length === 0) return tudo
    if (total != null) {
      if (tudo.length >= total) return tudo
      continue
    }
    if (linhas.length < tamanho) return tudo
  }
  return tudo
}
