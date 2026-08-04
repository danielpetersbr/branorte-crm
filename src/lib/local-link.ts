// Extrai coordenada de QUALQUER coisa que um cliente manda quando o vendedor
// pede "me passa sua localização".
//
// Por que isto é um arquivo próprio, e testado: o parser vivia inline dentro do
// BuscaLocal do painel, cobrindo só dois formatos (@lat,lng e ?q=). Na prática o
// que chega é o que o CELULAR gera — e o formato mais comum, o link curto do
// app, não tem coordenada NENHUMA dentro. Sem tratar isso, o vendedor cola o
// link, não acontece nada, e a propriedade continua marcada no centro da cidade.
//
// O que chega de verdade, por origem:
//   WhatsApp "Enviar localização"  -> https://maps.google.com/maps?q=-5.1,-42.6
//   Google Maps app "Compartilhar" -> https://maps.app.goo.gl/AbC123   (CURTO)
//   Google Maps web                -> .../@-5.1,-42.6,15z/...
//   Google Maps lugar salvo        -> ...!3d-5.1!4d-42.6...
//   Android "Compartilhar coords"  -> geo:-5.1,-42.6?q=...
//   Pessoa copiando na mão         -> -5.1, -42.6   ou   -5.1 -42.6

export interface LocalLido {
  lat: number
  lng: number
  /** De onde saiu — vai pro campo `fonte` de cliente_localizacao. */
  fonte: string
}

/**
 * Faixa do Brasil, com folga. Serve pra pegar o erro clássico de lat/lng
 * TROCADOS: -42,-5 passaria como coordenada válida e jogaria o cliente no meio
 * do Atlântico sem ninguém perceber até o vendedor dirigir pra lá.
 */
const BR = { latMin: -34.5, latMax: 6, lngMin: -74.5, lngMax: -32.5 }

/** Teto do texto analisado. Ninguém cola link de 8 KB; o que chega grande é
 *  planilha inteira, e ela não tem por que passar por regex. */
const LIMITE_TEXTO = 8192

export function dentroDoBrasil(lat: number, lng: number): boolean {
  return lat >= BR.latMin && lat <= BR.latMax && lng >= BR.lngMin && lng <= BR.lngMax
}

/** Link encurtado: a coordenada só existe DEPOIS de seguir o redirecionamento. */
export function ehLinkCurto(texto: string): boolean {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\/\S+/i.test(texto)
}

/** A URL curta em si, pra mandar pro resolvedor server-side. */
export function urlCurta(texto: string): string | null {
  const m = texto.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\/\S+/i)
  return m ? m[0] : null
}

const num = (s: string) => Number(s.replace(',', '.'))

/**
 * Lê a coordenada do texto colado. `null` = não deu — pode ser link curto
 * (teste com `ehLinkCurto`) ou endereço em texto (aí é busca no Nominatim).
 *
 * A ORDEM DOS PADRÕES IMPORTA: uma URL do Google traz `@lat,lng` (onde a câmera
 * está) E `!3dlat!4dlng` (onde o PINO está). Quando os dois aparecem, o pino é
 * que vale — a câmera pode estar deslocada. Por isso !3d!4d é testado primeiro.
 */
export function lerLocal(texto: string): LocalLido | null {
  const t = (texto || '').trim().slice(0, LIMITE_TEXTO)
  if (!t) return null

  // Link de DIREÇÕES: o `@` é o CENTRO DA CÂMERA, que fica no MEIO DO CAMINHO
  // entre origem e destino — não é nem o cliente nem o vendedor. Medido: numa
  // rota Uruçuí→Balsas isso dava um ponto 83 km fora da fazenda, e como 83 < 150
  // o aviso de salto grande não disparava: gravava errado em silêncio.
  const ehDirecoes = /\/maps\/dir\//.test(t)

  const tentativas: Array<{ re: RegExp; fonte: string; estruturado: boolean }> = [
    // pino de um lugar do Google (mais confiável que a câmera)
    { re: /!3d(-?\d+[.,]\d+)!4d(-?\d+[.,]\d+)/, fonte: 'google_maps_pino', estruturado: true },
    // WhatsApp / maps?q= / ?ll= / ?daddr= — é o que o cliente MANDA, então vale
    // mais que a câmera, que é só onde a tela estava.
    { re: /[?&](?:q|ll|sll|daddr|destination|center)=(-?\d+[.,]\d+),\s*(-?\d+[.,]\d+)/i, fonte: 'whatsapp_ou_query', estruturado: true },
    // geo: do Android
    { re: /geo:(-?\d+[.,]\d+),(-?\d+[.,]\d+)/i, fonte: 'geo_android', estruturado: true },
    // /place/ e /search/ com coordenada no caminho. `dir` saiu daqui: em rota, a
    // coordenada do caminho é a ORIGEM, que é o vendedor, não o cliente.
    { re: /\/(?:place|search)\/(-?\d+[.,]\d+),(-?\d+[.,]\d+)/, fonte: 'google_maps_caminho', estruturado: true },
    // câmera da URL — último recurso, e nunca em link de direções.
    ...(ehDirecoes ? [] : [{ re: /@(-?\d+[.,]\d+),(-?\d+[.,]\d+)/, fonte: 'google_maps_url', estruturado: true }]),
    // colado na mão: "-5.1, -42.6" ou "-5.1 -42.6" (a linha INTEIRA, pra não
    // casar com número solto no meio de um endereço).
    // A classe é UMA só com `+`: a versão anterior era `\s*[,;\s]\s*`, onde os
    // dois `\s*` disputavam os mesmos espaços — backtracking O(n²) que travava a
    // aba por 21 s com um texto de 125 KB colado de planilha.
    { re: /^(-?\d+[.,]\d+)[\s,;]+(-?\d+[.,]\d+)$/, fonte: 'coordenada_colada', estruturado: false },
  ]

  for (const { re, fonte, estruturado } of tentativas) {
    const m = t.match(re)
    if (!m) continue
    const lat = num(m[1]), lng = num(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    if (dentroDoBrasil(lat, lng)) return { lat, lng, fonte }

    // INVERSÃO só vale pra coordenada digitada/colada na mão. Em formato
    // ESTRUTURADO a ordem é definida pelo Google e não vem trocada — "consertar"
    // ali transforma URL corrompida em coordenada de aparência confiável, e
    // joga o cliente no meio do Atlântico com fonte de alta confiança.
    if (!estruturado && dentroDoBrasil(lng, lat)) {
      return { lat: lng, lng: lat, fonte: `${fonte}_invertido` }
    }
    // Fora da caixa: NÃO devolve, mas TAMBÉM não desiste — segue pros próximos
    // padrões. Antes era `return null`, e um bloco !3d!4d apontando pra outra
    // coisa (uma foto, um negócio vizinho) fazia perder a câmera correta logo
    // abaixo. O servidor em api/resolver-link.ts sempre fez `continue`; era o
    // mesmo link dando resposta diferente conforme fosse curto ou completo.
    continue
  }
  return null
}

/** Quanto o ponto novo se afasta do que já estava — o vendedor precisa ver isso
 *  antes de confirmar. 400 km de "correção" é erro de link, não propriedade. */
export function distanciaKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
