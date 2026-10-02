import type { OrcamentoLinha, OrcamentoPonto } from '../hooks/useVisitas'
import { semSeparadores } from './busca-numero-orcamento'

/** Search normalization is separate from persisted visit-marker identities. */
export function normalizarBuscaMapa(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[-–—]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function criarIndiceBusca<T extends object>(itens: readonly T[], campos: (item: T) => (string | null)[]): Map<T, string[]> {
  return new Map(itens.map(item => [item, campos(item).map(normalizarBuscaMapa)]))
}

export function passaBuscaMapa(campos: readonly string[] | undefined, termo: string): boolean {
  return !termo || !!campos?.some(campo => campo.includes(termo))
}

/** Table RPC has no phone/cli_key: exact proposal first, unambiguous name+UF second. */
export function indexarClientesDaLista(pontos: readonly OrcamentoPonto[], linhas: readonly OrcamentoLinha[] = []) {
  const porNumero = new Map<string, OrcamentoPonto[]>()
  const porNomeUf = new Map<string, OrcamentoPonto[]>()
  const chaveNome = (cliente: string | null, uf: string | null) => `${normalizarBuscaMapa(cliente)}|${(uf || '').trim().toUpperCase()}`
  const linhasPorNomeUf = new Map<string, number>()
  for (const r of linhas) {
    const k = chaveNome(r.cliente, r.uf)
    linhasPorNomeUf.set(k, (linhasPorNomeUf.get(k) ?? 0) + 1)
  }
  const adicionar = (mapa: Map<string, OrcamentoPonto[]>, chave: string, p: OrcamentoPonto) => {
    const encontrados = mapa.get(chave)
    if (encontrados) { if (!encontrados.includes(p)) encontrados.push(p) }
    else mapa.set(chave, [p])
  }
  for (const p of pontos) {
    if (p.cliente?.trim()) adicionar(porNomeUf, chaveNome(p.cliente, p.uf), p)
    for (const numero of (p.numeros || '').split(',')) {
      const chave = semSeparadores(numero)
      if (chave) adicionar(porNumero, chave, p)
    }
  }
  return (r: OrcamentoLinha): OrcamentoPonto[] => {
    const numero = semSeparadores(r.numero || '')
    const numeros = porNumero.get(numero)
    if (numeros?.length === 1) return numeros
    if (numeros?.length) {
      const mesmos = numeros.filter(p => chaveNome(p.cliente, p.uf) === chaveNome(r.cliente, r.uf))
      return mesmos.length === 1 ? mesmos : []
    }
    // A supplied but unknown proposal cannot borrow an unrelated homonym's phone.
    if (numero || !r.cliente?.trim() || !r.cidade?.trim()) return []
    const chave = chaveNome(r.cliente, r.uf)
    if (linhasPorNomeUf.get(chave) !== 1) return []
    const nomes = porNomeUf.get(chave) ?? []
    return nomes.length === 1 && normalizarBuscaMapa(nomes[0].cidade) === normalizarBuscaMapa(r.cidade) ? nomes : []
  }
}

export function chaveCoordenadaMapa(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/** Unique coordinates define camera bounds; counts only affect pin spreading. */
export function geometriaDosPontos(coordenadas: readonly [number, number][]) {
  const totalPorCoord = new Map<string, number>()
  for (const [lat, lng] of coordenadas) {
    const k = chaveCoordenadaMapa(lat, lng)
    totalPorCoord.set(k, (totalPorCoord.get(k) ?? 0) + 1)
  }
  const chaves = [...totalPorCoord.keys()].sort()
  return { totalPorCoord, chave: chaves.join('|'),
    bounds: chaves.map(k => k.split(',').map(Number) as [number, number]) }
}

/** One cache entry: a color/marker/count change reuses the coordinate-only work. */
export function criarCacheLimitesMapa() {
  let anterior = '', limites = new Map<string, number>()
  return (geometria: ReturnType<typeof geometriaDosPontos>) => {
    if (geometria.chave !== anterior) {
      anterior = geometria.chave
      limites = new Map()
    }
    for (const [lat, lng] of geometria.bounds) {
      const chave = chaveCoordenadaMapa(lat, lng)
      if ((geometria.totalPorCoord.get(chave) ?? 1) <= 1 || limites.has(chave)) continue
      let min = Infinity
      const cosLat = Math.cos((lat * Math.PI) / 180)
      for (const [outraLat, outraLng] of geometria.bounds) {
        if (lat === outraLat && lng === outraLng) continue
        const dx = (outraLng - lng) * cosLat
        const dy = outraLat - lat
        min = Math.min(min, dx * dx + dy * dy)
      }
      limites.set(chave, min < Infinity ? (Math.sqrt(min) * 111320) / 2 : Infinity)
    }
    return limites
  }
}
