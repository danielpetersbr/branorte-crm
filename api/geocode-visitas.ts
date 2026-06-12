// Geocodifica registros de cliente_dados_visita que ainda não têm lat/lng,
// usando Nominatim (OpenStreetMap, grátis). Geocoda por cidade+UF (centro
// da cidade — basta pro mapa de visitas) com cache por cidade na request.
// Atualiza o banco via service role. Respeita o rate-limit do Nominatim (~1/s).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const UA = 'BranorteCRM/1.0 (mapa de visitas; contato: daniel.peters.br@gmail.com)'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function geocodar(cidade: string, uf: string): Promise<{ lat: number; lng: number } | null> {
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

  // pega pendentes (sem coordenada e com cidade)
  const { data: pend, error } = await db
    .from('cliente_dados_visita')
    .select('id, cidade, estado')
    .is('lat', null)
    .not('cidade', 'is', null)
    .limit(40) // teto por chamada pra respeitar rate-limit e timeout serverless

  if (error) return res.status(502).json({ error: error.message })
  if (!pend?.length) return res.status(200).json({ atualizados: 0, pendentes: 0 })

  const cache = new Map<string, { lat: number; lng: number } | null>()
  let atualizados = 0
  const falhas: string[] = []

  for (const row of pend) {
    const cidade = (row.cidade || '').trim()
    const uf = (row.estado || '').trim()
    if (!cidade) continue
    const chave = `${cidade.toLowerCase()}|${uf.toLowerCase()}`

    let coord = cache.get(chave)
    if (coord === undefined) {
      coord = await geocodar(cidade, uf)
      cache.set(chave, coord)
      await sleep(1100) // política do Nominatim: máx ~1 req/s
    }
    if (!coord) { falhas.push(`${cidade}/${uf}`); continue }

    const { error: upErr } = await db
      .from('cliente_dados_visita')
      .update({ lat: coord.lat, lng: coord.lng })
      .eq('id', row.id)
    if (!upErr) atualizados++
  }

  return res.status(200).json({ atualizados, pendentes: pend.length, falhas })
}
