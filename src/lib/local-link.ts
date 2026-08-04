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
  const t = (texto || '').trim()
  if (!t) return null

  const tentativas: Array<{ re: RegExp; fonte: string }> = [
    // pino de um lugar do Google (mais confiável que a câmera)
    { re: /!3d(-?\d+[.,]\d+)!4d(-?\d+[.,]\d+)/, fonte: 'google_maps_pino' },
    // câmera da URL do Google Maps
    { re: /@(-?\d+[.,]\d+),(-?\d+[.,]\d+)/, fonte: 'google_maps_url' },
    // WhatsApp / maps?q= / ?ll= / ?daddr= / ?destination=
    { re: /[?&](?:q|ll|sll|daddr|destination|center)=(-?\d+[.,]\d+),\s*(-?\d+[.,]\d+)/i, fonte: 'whatsapp_ou_query' },
    // geo: do Android
    { re: /geo:(-?\d+[.,]\d+),(-?\d+[.,]\d+)/i, fonte: 'geo_android' },
    // /dir/ e /place/ com coordenada no caminho
    { re: /\/(?:dir|place|search)\/(-?\d+[.,]\d+),(-?\d+[.,]\d+)/, fonte: 'google_maps_caminho' },
    // colado na mão: "-5.1, -42.6" ou "-5.1 -42.6" (a linha INTEIRA, pra não
    // casar com números soltos no meio de um endereço)
    { re: /^(-?\d+[.,]\d+)\s*[,;\s]\s*(-?\d+[.,]\d+)$/, fonte: 'coordenada_colada' },
  ]

  for (const { re, fonte } of tentativas) {
    const m = t.match(re)
    if (!m) continue
    const lat = num(m[1]), lng = num(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    if (dentroDoBrasil(lat, lng)) return { lat, lng, fonte }
    // Invertido? Acontece com quem copia de planilha. Só aceito quando a troca
    // cai no Brasil E a ordem original não caía — assim não "conserto" o que
    // estava certo.
    if (dentroDoBrasil(lng, lat)) return { lat: lng, lng: lat, fonte: `${fonte}_invertido` }
    // Coordenada válida em número mas fora do Brasil: NÃO devolvo. É quase
    // sempre lixo, e marcar cliente no Atlântico é pior que não marcar.
    return null
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
