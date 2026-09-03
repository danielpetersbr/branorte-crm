/**
 * Resolver de município: descobre em que UF a cidade digitada realmente fica.
 *
 * Nasceu de um bug medido em 03/09/2026: o geocode buscava `cidade, UF, Brasil` e
 * aceitava o primeiro resultado. Pedindo "Fortaleza" dentro de SC, o Nominatim
 * devolve *alguma* Fortaleza catarinense com cara de acerto — e o cliente do Ceará
 * ficou 2.801 km fora do lugar. A UF é digitada à mão e erra; o NOME da cidade é o
 * que se pode conferir contra o IBGE.
 *
 * Usado pelos dois geocodes (visitas e cidades de orçamento), que tinham a mesma
 * falha. Manter aqui em vez de copiar: as duas cópias iam divergir na primeira
 * correção que alguém fizesse só de um lado.
 */

export const UF_CENTRO: Record<string, { lat: number; lng: number }> = {
  AC: { lat: -8.77, lng: -70.55 }, AL: { lat: -9.62, lng: -36.82 }, AM: { lat: -3.47, lng: -65.10 },
  AP: { lat: 1.41, lng: -51.77 }, BA: { lat: -12.96, lng: -41.70 }, CE: { lat: -5.20, lng: -39.53 },
  DF: { lat: -15.78, lng: -47.93 }, ES: { lat: -19.19, lng: -40.34 }, GO: { lat: -15.98, lng: -49.86 },
  MA: { lat: -5.42, lng: -45.44 }, MG: { lat: -18.10, lng: -44.38 }, MS: { lat: -20.51, lng: -54.54 },
  MT: { lat: -12.64, lng: -55.42 }, PA: { lat: -3.79, lng: -52.48 }, PB: { lat: -7.28, lng: -36.72 },
  PE: { lat: -8.38, lng: -37.86 }, PI: { lat: -6.60, lng: -42.28 }, PR: { lat: -24.89, lng: -51.55 },
  RJ: { lat: -22.25, lng: -42.66 }, RN: { lat: -5.81, lng: -36.59 }, RO: { lat: -10.83, lng: -63.34 },
  RR: { lat: 1.99, lng: -61.33 }, RS: { lat: -30.17, lng: -53.50 }, SC: { lat: -27.45, lng: -50.95 },
  SE: { lat: -10.57, lng: -37.45 }, SP: { lat: -22.19, lng: -48.79 }, TO: { lat: -10.17, lng: -48.30 },
}

/** Nome do estado como o Nominatim devolve em `address.state`. */
export const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
  PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
}

export const NOME_UF: Record<string, string> = Object.fromEntries(
  Object.entries(UF_NOME).map(([uf, nome]) => [norm(nome), uf]))

export function norm(s: string): string {
  return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Distância de edição, com teto: quem passa de `max` não interessa e sai cedo.
 * Existe pra pegar o typo do cadastro — "Rolin de Moura", "Bruritis", "Impoeratriz",
 * "Luiz Eduardo Magalhães" (o município é "Luís", com S) — antes de o Nominatim
 * devolver um homônimo qualquer. O caso do "Luiz" custou 887 km: o pino foi parar no
 * litoral sul da Bahia e o município fica no oeste.
 */
export function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    let melhor = i
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(atual[j - 1] + 1, ant[j] + 1, ant[j - 1] + custo)
      atual.push(v)
      if (v < melhor) melhor = v
    }
    if (melhor > max) return max + 1
    ant = atual
  }
  return ant[b.length]
}

export type IndiceMunicipios = Map<string, Set<string>>

/** nome normalizado -> UFs onde esse município existe. */
export function indexar(linhas: { municipio: string | null; UF: string | null }[]): IndiceMunicipios {
  const idx: IndiceMunicipios = new Map()
  for (const m of linhas) {
    const nome = norm(m.municipio || '')
    const uf = (m.UF || '').toUpperCase()
    if (!nome || !uf) continue
    if (!idx.has(nome)) idx.set(nome, new Set())
    idx.get(nome)!.add(uf)
  }
  return idx
}

export interface Resolvido {
  /** Nome pra buscar no geocoder (o oficial do IBGE, quando houve correção de typo). */
  nome: string
  /** UF a usar, ou null quando não dá pra decidir (aí a busca vai livre ou desiste). */
  uf: string | null
  /** true = a UF digitada não é a que vale; quem chamou deve corrigir o cadastro. */
  corrigiuUf: boolean
  /** true = ambíguo COM UF digitada (cidade existe em várias outras): não force nada. */
  ambiguo: boolean
}

/**
 * Decide nome e UF a partir do que foi digitado.
 *
 * 1. cidade existe na UF digitada -> usa as duas
 * 2. existe em exatamente 1 outra UF -> a UF digitada é que está errada
 * 3. existe em várias outras (e o vendedor digitou uma delas) -> ambíguo
 * 4. não é município (distrito, typo forte) ou não veio UF -> uf null: busca livre
 */
export function resolverMunicipio(cidade: string, ufDigitada: string, idx: IndiceMunicipios): Resolvido {
  const uf = (ufDigitada || '').trim().toUpperCase()
  let nome = (cidade || '').trim()
  let ufs = idx.get(norm(nome))

  if (!ufs) {
    // typo: procura o município mais parecido, preferindo o da UF digitada
    const alvo = norm(nome)
    const max = alvo.length <= 6 ? 1 : 2
    let melhor: { nome: string; uf: string; d: number } | null = null
    let empate = false
    for (const [n, us] of idx) {
      const d = distancia(alvo, n, max)
      if (d > max) continue
      for (const u of us) {
        const ganha = !melhor || d < melhor.d || (d === melhor.d && u === uf && melhor.uf !== uf)
        if (ganha) { empate = false; melhor = { nome: n, uf: u, d } }
        // Só é empate quando NENHUM candidato está na UF digitada — "Bruritis"/RO
        // casa com Buritis, que existe em MG e RO, e o RO desempata sozinho.
        else if (melhor && d === melhor.d && u !== melhor.uf && melhor.uf !== uf) empate = true
      }
    }
    // ⚠️ Trocar de ESTADO por semelhança só com typo de UMA letra. "Cristsilna"/GO
    // está a 2 de "Cristina"/MG e a 3 de "Cristalina"/GO — o mais parecido levava o
    // cliente de Goiás pra Minas. Com distância 2+ e UF diferente, a resposta certa é
    // não adivinhar: fica no centro do estado que o cadastro afirma.
    const trocaDeUf = !!melhor && !!uf && melhor.uf !== uf
    if (melhor && !empate && (!trocaDeUf || melhor.d <= 1)) { nome = melhor.nome; ufs = new Set([melhor.uf]) }
  }

  const outras = ufs ? [...ufs].filter(u => u !== uf) : []
  if (ufs?.has(uf)) return { nome, uf, corrigiuUf: false, ambiguo: false }
  if (outras.length === 1) return { nome, uf: outras[0], corrigiuUf: !!uf, ambiguo: false }
  if (outras.length > 1 && uf) return { nome, uf: null, corrigiuUf: false, ambiguo: true }
  return { nome, uf: null, corrigiuUf: false, ambiguo: false }
}

export interface Hit { lat: string; lon: string; address?: { state?: string } }
export interface Achado { lat: number; lng: number; uf: string }

/** Primeiro hit dentro da UF pedida (ou, com `ufPedida` null, o primeiro em UF conhecida). */
export function escolherHit(hits: Hit[], ufPedida: string | null): Achado | null {
  for (const h of hits) {
    const uf = NOME_UF[norm(h.address?.state || '')]
    if (!uf) continue
    if (ufPedida && uf !== ufPedida) continue
    return { lat: parseFloat(h.lat), lng: parseFloat(h.lon), uf }
  }
  return null
}

/** Nominatim com os parâmetros que o resto do código espera (inclui `address`). */
export async function buscarNominatim(q: string, userAgent: string): Promise<Hit[]> {
  const url = 'https://nominatim.openstreetmap.org/search?'
    + new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'br', addressdetails: '1' })
  const r = await fetch(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR' } })
  if (!r.ok) return []
  return (await r.json()) as Hit[]
}
