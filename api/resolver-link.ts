// Resolve link CURTO de mapa (maps.app.goo.gl, goo.gl/maps, g.co/kgs) na
// coordenada que está do outro lado do redirecionamento.
//
// POR QUE SERVER-SIDE: o navegador não consegue. O encurtador do Google não
// manda CORS, então um fetch do front morre antes de ver o Location. E é
// exatamente esse o link que o cliente manda pelo celular — sem isto, o vendedor
// cola o link, não acontece nada, e a propriedade fica no centro da cidade.
//
// CONTRATO DE FALHA — nunca 500 silencioso: sempre HTTP 200 com
// { ok: false, motivo: '<texto pt-BR>' }, pra UI dizer o que fazer em vez de
// mostrar "erro" e deixar o vendedor sem saída.
//
// PRIVACIDADE: a URL resolvida carrega a coordenada do cliente. Nada dela entra
// em log — só o host de origem e o status.
import type { VercelRequest, VercelResponse } from '@vercel/node'

const HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co']
const UA = 'BranorteCRM/1.0 (planejamento de viagem; contato: daniel.peters.br@gmail.com)'
const TIMEOUT_MS = 8000
/** Teto do TOTAL, não de cada salto. 5 saltos x 8 s davam 40 s de pior caso, e a
 *  função não tem maxDuration declarado no vercel.json: a plataforma cortava
 *  antes, e aí o contrato "nunca 500 silencioso" virava exatamente isso. */
const TIMEOUT_TOTAL_MS = 12000
/** Encurtador às vezes encadeia. Mais que isso é laço ou armadilha. */
const MAX_SALTOS = 5

interface Ok { ok: true; lat: number; lng: number; url: string }
interface Falha { ok: false; motivo: string }

const BR = { latMin: -34.5, latMax: 6, lngMin: -74.5, lngMax: -32.5 }
const noBrasil = (lat: number, lng: number) =>
  lat >= BR.latMin && lat <= BR.latMax && lng >= BR.lngMin && lng <= BR.lngMax

/** Mesma ordem de prioridade do src/lib/local-link.ts: o PINO ganha da CÂMERA. */
function coordDaUrl(u: string): { lat: number; lng: number } | null {
  const res = [
    /!3d(-?\d+[.,]\d+)!4d(-?\d+[.,]\d+)/,
    /@(-?\d+[.,]\d+),(-?\d+[.,]\d+)/,
    /[?&](?:q|ll|sll|center|destination)=(-?\d+[.,]\d+),\s*(-?\d+[.,]\d+)/i,
    /\/(?:dir|place|search)\/(-?\d+[.,]\d+),(-?\d+[.,]\d+)/,
  ]
  for (const re of res) {
    const m = u.match(re)
    if (!m) continue
    const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'))
    if (Number.isFinite(lat) && Number.isFinite(lng) && noBrasil(lat, lng)) return { lat, lng }
  }
  return null
}

/**
 * Só encurtador conhecido. Sem esta trava o endpoint vira SSRF: qualquer um
 * mandaria uma URL interna e usaria o servidor pra alcançar o que o navegador
 * dele não alcança.
 */
function hostPermitido(u: string): boolean {
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return HOSTS.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, motivo: 'Método não permitido.' } satisfies Falha)
    return
  }
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url || !hostPermitido(url)) {
    res.status(200).json({ ok: false, motivo: 'Isso não é um link curto de mapa do Google.' } satisfies Falha)
    return
  }

  const t0 = Date.now()
  let atual = url
  try {
    for (let salto = 0; salto < MAX_SALTOS; salto++) {
      if (Date.now() - t0 > TIMEOUT_TOTAL_MS) {
        console.log(`[resolver-link] estourou o total host=${new URL(url).hostname} saltos=${salto}`)
        res.status(200).json({
          ok: false,
          motivo: 'O link demorou demais pra responder. Tente de novo em alguns segundos.',
        } satisfies Falha)
        return
      }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
      let r: Response
      try {
        // `manual` pra LER o Location em vez de seguir: a coordenada está nele,
        // e seguir até o fim gastaria tempo baixando a página inteira do Maps.
        r = await fetch(atual, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' },
          signal: ac.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      const destino = r.headers.get('location')
      if (destino) {
        const proximo = destino.startsWith('http') ? destino : new URL(destino, atual).toString()
        // A coordenada pode estar no Location SEM que a gente precise seguir.
        // Lê primeiro, e só depois decide se vale continuar.
        const achouAqui = coordDaUrl(proximo)
        // ALLOWLIST A CADA SALTO, não só na entrada. Antes, o destino lido do
        // Location era refetchado na volta seguinte sem passar por
        // hostPermitido(): bastava um host da lista responder 30x apontando pra
        // um endereço interno e o servidor ia atrás. O que segurava era o Google
        // não ter open redirect — não havia defesa no código.
        if (!achouAqui && !hostPermitido(proximo)) {
          console.log(`[resolver-link] salto barrado host=${new URL(url).hostname}`)
          res.status(200).json({
            ok: false,
            motivo: 'Esse link redireciona pra fora do Google Maps. Não vou seguir.',
          } satisfies Falha)
          return
        }
        atual = proximo
        const achou = achouAqui
        if (achou) {
          console.log(`[resolver-link] ok host=${new URL(url).hostname} saltos=${salto + 1} ms=${Date.now() - t0}`)
          res.status(200).json({ ok: true, ...achou, url: atual } satisfies Ok)
          return
        }
        continue
      }

      // Sem redirect: o Google às vezes devolve a página com a coordenada dentro
      // (link de "lugar" que já resolveu). Vale procurar no corpo.
      if (r.ok) {
        const corpo = (await r.text()).slice(0, 400_000)
        const achou = coordDaUrl(corpo)
        if (achou) {
          console.log(`[resolver-link] ok-corpo host=${new URL(url).hostname} ms=${Date.now() - t0}`)
          res.status(200).json({ ok: true, ...achou, url: atual } satisfies Ok)
          return
        }
      }
      break
    }
    console.log(`[resolver-link] sem-coord host=${new URL(url).hostname} ms=${Date.now() - t0}`)
    res.status(200).json({
      ok: false,
      motivo: 'O link abriu, mas não tem coordenada dentro. Peça pro cliente usar "Compartilhar localização" no WhatsApp, ou abra o link e copie o endereço.',
    } satisfies Falha)
  } catch (e) {
    const abortou = (e as Error)?.name === 'AbortError'
    console.log(`[resolver-link] falha abort=${abortou} ms=${Date.now() - t0}`)
    res.status(200).json({
      ok: false,
      motivo: abortou
        ? 'O link demorou demais pra responder. Tente de novo em alguns segundos.'
        : 'Não consegui abrir esse link. Confira se ele está completo.',
    } satisfies Falha)
  }
}
