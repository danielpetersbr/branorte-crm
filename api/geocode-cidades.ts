// Preenche cidade_geocache com as cidades dos ORÇAMENTOS (orcamentos_cidades_distintas)
// que ainda não têm coordenada. Cidade via Nominatim; sem cidade encontrada (ou só UF) cai
// pro centro do estado. Reaproveitado pelo RPC mapa_orcamentos() pra montar os pinos.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const UA = 'BranorteCRM/1.0 (mapa de orcamentos; contato: daniel.peters.br@gmail.com)'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

  const { data: cidades, error: e1 } = await db.from('orcamentos_cidades_distintas').select('cidade, uf')
  if (e1) return res.status(502).json({ error: e1.message })
  const { data: cache, error: e2 } = await db.from('cidade_geocache').select('cidade, uf')
  if (e2) return res.status(502).json({ error: e2.message })

  const have = new Set((cache || []).map(c => `${(c.cidade || '').toLowerCase()}|${c.uf || ''}`))
  const faltam = (cidades || []).filter(c => c.cidade && !have.has(`${c.cidade.toLowerCase()}|${c.uf || ''}`))
  const lote = faltam.slice(0, 30) // teto por chamada (rate-limit Nominatim + timeout)

  let atualizados = 0
  const falhas: string[] = []

  for (const row of lote) {
    const cidade = (row.cidade || '').trim()
    const uf = (row.uf || '').trim().toUpperCase()
    let coord: { lat: number; lng: number } | null = null
    if (cidade) {
      coord = await geocodarCidade(cidade, uf)
      await sleep(1100)
      if (!coord && UF_CENTRO[uf]) coord = UF_CENTRO[uf]
    } else if (UF_CENTRO[uf]) {
      coord = UF_CENTRO[uf]
    }
    if (!coord) { falhas.push(`${cidade || '(s/cidade)'}/${uf || '?'}`); continue }
    const { error } = await db.from('cidade_geocache').upsert(
      { cidade, uf, lat: coord.lat, lng: coord.lng },
      { onConflict: 'cidade,uf' },
    )
    if (!error) atualizados++
  }

  return res.status(200).json({ atualizados, pendentes: faltam.length - atualizados, falhas })
}
