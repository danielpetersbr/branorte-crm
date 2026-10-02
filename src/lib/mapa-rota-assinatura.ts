import type { ConfigViagem, Coord, Parada } from './viagem'

const ponto = (p: Coord | null) => p ? [p.lat, p.lng] : null

export function assinaturaRota(
  paradas: readonly Pick<Parada, 'id' | 'lat' | 'lng'>[],
  config: Pick<ConfigViagem, 'origem' | 'destino' | 'retornarOrigem' | 'modo'>,
  modoViagem: boolean,
): string {
  // Tuplas preservam ordem e precisão; JSON não colide com delimitadores nos IDs.
  return JSON.stringify([
    modoViagem, config.modo, config.retornarOrigem,
    ponto(config.origem), ponto(config.destino),
    paradas.map(p => [p.id, p.lat, p.lng]),
  ])
}
