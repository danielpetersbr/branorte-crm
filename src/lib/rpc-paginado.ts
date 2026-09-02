/**
 * Junta TODAS as linhas de uma RPC que devolve conjunto, página a página.
 *
 * O PostgREST corta a resposta em `max_rows` linhas (10.000 neste projeto) e NÃO
 * avisa — status 206, array menor, nenhum erro no cliente. Apanhado em 02/09/2026
 * no /mapa-visitas: `mapa_etiquetas_wa` devolve 17 mil conversas e
 * `lista_orcamentos_mapa` 11,8 mil orçamentos; o navegador recebia 10.000 de cada
 * (`content-range: 0-9999/17250`). 24 dos 36 clientes do DANIEL apareciam como
 * "Sem WhatsApp sincronizado" TENDO conversa sincronizada, porque a linha deles
 * vinha depois da 10.000ª.
 *
 * Puro (sem Supabase) pra ser testável: recebe a função que busca UMA página
 * (`de` e `ate` inclusivos, como o `.range()` do supabase-js) e devolve as
 * linhas e, se o servidor informou (`Prefer: count=exact`), o total.
 *
 * Com o total conhecido, o resto vai em PARALELO: 17 mil linhas são 1 chamada e
 * mais 3 de uma vez, não 4 em fila. Se alguma faixa vier curta (teto do servidor
 * menor que a página — alguém baixou o `max_rows`), as faixas são descartadas e
 * o resto vem em sequência, senão ficaria buraco no meio. Sem total, página curta
 * é o fim — por isso o hook sempre pede o count.
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
  const primeira = await buscar(0, tamanho - 1)
  const tudo: T[] = [...primeira.linhas]
  if (primeira.linhas.length === 0) return tudo

  const total = primeira.total
  if (total != null) {
    if (tudo.length >= total) return tudo
    const faixas: [number, number][] = []
    // a 1ª página já conta em maxPaginas
    for (let de = tudo.length; de < total && faixas.length < maxPaginas - 1; de += tamanho) {
      faixas.push([de, Math.min(de + tamanho, total) - 1])
    }
    const paginas = await Promise.all(faixas.map(([de, ate]) => buscar(de, ate)))
    const todasCheias = paginas.every((p, i) => p.linhas.length === faixas[i][1] - faixas[i][0] + 1)
    if (todasCheias) {
      for (const p of paginas) tudo.push(...p.linhas)
      return tudo
    }
  }

  // Sem total, ou faixa curta: uma página por vez, até vir curta ou vazia (a 1ª já conta).
  for (let i = 1; i < maxPaginas; i++) {
    const de = tudo.length
    const { linhas, total: t } = await buscar(de, de + tamanho - 1)
    tudo.push(...linhas)
    if (linhas.length === 0) return tudo
    if (t != null) {
      if (tudo.length >= t) return tudo
      continue
    }
    if (linhas.length < tamanho) return tudo
  }
  return tudo
}
