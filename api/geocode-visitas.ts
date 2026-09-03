// Geocodifica registros de cliente_dados_visita que ainda não têm lat/lng.
//
// ⚠️ A UF digitada NÃO é confiável — e confiar nela plantava cliente no estado
// errado. Medido em 03/09/2026 sobre os 167 pinos de visita: "Brasília/SC" caiu em
// Criciúma (-28,67), "Fortaleza/SC" no vale do Itajaí, "Lagarto/SC" (Lagarto é SE)
// no planalto catarinense. A busca era `cidade, UF, Brasil` e aceitava o primeiro
// resultado sem conferir nada: pedindo Fortaleza dentro de SC, o Nominatim acha
// *alguma* Fortaleza em SC e devolve com cara de acerto.
//
// Quem manda agora é o NOME da cidade, conferido no IBGE — a mesma regra do geocode
// de cidades de orçamento, que vive em api/_lib/geo-municipios.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  UF_CENTRO, UF_NOME, buscarNominatim, escolherHit, indexar, resolverMunicipio,
  type Achado,
} from './_lib/geo-municipios.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const UA = 'BranorteCRM/1.0 (mapa de visitas; contato: daniel.peters.br@gmail.com)'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

  const { data: mun } = await db.from('municipios_tom_ibge').select('municipio, UF').not('UF', 'is', null)
  const idx = indexar((mun ?? []) as { municipio: string | null; UF: string | null }[])

  const cache = new Map<string, Achado | null>()
  let atualizados = 0
  let ufCorrigida = 0
  const falhas: string[] = []
  const corrigidos: string[] = []

  for (const row of pend) {
    const cidade = (row.cidade || '').trim()
    const uf = (row.estado || '').trim().toUpperCase()
    let achado: Achado | null = null

    if (cidade) {
      const chave = `${cidade.toLowerCase()}|${uf}`
      const emCache = cache.get(chave)
      if (emCache !== undefined) {
        achado = emCache
      } else {
        const r = resolverMunicipio(cidade, uf, idx)
        if (!r.ambiguo) {
          const q = r.uf ? `${r.nome}, ${UF_NOME[r.uf] || r.uf}, Brasil` : `${r.nome}, Brasil`
          achado = escolherHit(await buscarNominatim(q, UA), r.uf)
          await sleep(1100)
        }
        cache.set(chave, achado)
      }
    }

    const coord = achado ?? (UF_CENTRO[uf] ? { ...UF_CENTRO[uf], uf } : null)
    if (!coord) { falhas.push(`${cidade || '(sem cidade)'}/${uf || '?'}`); continue }

    // A UF do registro acompanha onde o pino caiu — senão o filtro de estado do mapa
    // continua mostrando o cliente no estado errado, mesmo com o pino no lugar certo.
    const mudouUf = !!coord.uf && coord.uf !== uf
    const patch: Record<string, unknown> = { lat: coord.lat, lng: coord.lng }
    if (mudouUf) patch.estado = coord.uf

    const { error: upErr } = await db.from('cliente_dados_visita').update(patch).eq('id', row.id)
    if (!upErr) {
      atualizados++
      if (mudouUf) { ufCorrigida++; corrigidos.push(`${cidade}: ${uf || '?'} -> ${coord.uf}`) }
    }
  }

  return res.status(200).json({ atualizados, pendentes: pend.length, ufCorrigida, corrigidos, falhas })
}
