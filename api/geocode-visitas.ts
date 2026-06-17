// Geocodifica registros de cliente_dados_visita que ainda não têm lat/lng.
// - Tem cidade: Nominatim (centro da cidade, OpenStreetMap grátis, ~1 req/s).
// - Só tem estado (sem cidade): cai pro CENTRO DO ESTADO (UF) — assim o cliente
//   aparece no mapa mesmo sem cidade, em vez de ficar preso em "sem localização".
// - Cidade não encontrada mas UF conhecida: fallback pro centro do estado.
// Atualiza o banco via service role.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const UA = 'BranorteCRM/1.0 (mapa de visitas; contato: daniel.peters.br@gmail.com)'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Centro aproximado de cada estado — usado quando o cliente só tem UF (sem cidade)
// ou quando a cidade não é encontrada. Pino estadual aproximado já basta pro mapa.
const UF_CENTRO: Record<string, { lat: number; lng: number }> = {
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

async function geocodarCidade(cidade: string, uf: string): Promise<{ lat: number; lng: number } | null> {
  const q = encodeURIComponent(`${cidade}, ${uf}, Brasil`)
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } })
  if (!r.ok) return null
  const arr = (await r.json()) as Array<{ lat: string; lon: string }>
  if (!arr?.length) return null
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })
  if (!SVC_KEY) return res.status(501).json({ error: 'Geocoding não configurado' })

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  // Pendentes: sem coordenada E com cidade OU estado (estado-only cai pro centro do estado).
  const { data: pend, error } = await db
    .from('cliente_dados_visita')
    .select('id, cidade, estado')
    .is('lat', null)
    .or('cidade.not.is.null,estado.not.is.null')
    .limit(40) // teto por chamada pra respeitar rate-limit e timeout serverless

  if (error) return res.status(502).json({ error: error.message })
  if (!pend?.length) return res.status(200).json({ atualizados: 0, pendentes: 0 })

  const cache = new Map<string, { lat: number; lng: number } | null>()
  let atualizados = 0
  const falhas: string[] = []

  for (const row of pend) {
    const cidade = (row.cidade || '').trim()
    const uf = (row.estado || '').trim().toUpperCase()
    let coord: { lat: number; lng: number } | null | undefined

    if (cidade) {
      const chave = `c:${cidade.toLowerCase()}|${uf.toLowerCase()}`
      coord = cache.get(chave)
      if (coord === undefined) {
        coord = await geocodarCidade(cidade, uf)
        cache.set(chave, coord)
        await sleep(1100) // política do Nominatim: máx ~1 req/s
      }
      // Cidade não achada mas UF conhecida → centro do estado (não deixa "sem localização")
      if (!coord && UF_CENTRO[uf]) coord = UF_CENTRO[uf]
    } else if (uf && UF_CENTRO[uf]) {
      coord = UF_CENTRO[uf] // só tem estado → centro do estado (sem chamar Nominatim)
    }

    if (!coord) { falhas.push(`${cidade || '(sem cidade)'}/${uf || '?'}`); continue }

    const { error: upErr } = await db
      .from('cliente_dados_visita')
      .update({ lat: coord.lat, lng: coord.lng })
      .eq('id', row.id)
    if (!upErr) atualizados++
  }

  return res.status(200).json({ atualizados, pendentes: pend.length, falhas })
}
