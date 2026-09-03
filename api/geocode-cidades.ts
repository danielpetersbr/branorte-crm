// Preenche cidade_geocache com as cidades dos ORÇAMENTOS (orcamentos_cidades_distintas)
// que ainda não têm coordenada. Reaproveitado pelo RPC mapa_orcamentos_v2 pra montar
// os pinos: cidade sem linha aqui = cliente que NÃO EXISTE no mapa (a matview só
// guarda quem tem coordenada).
//
// ⚠️ Quem manda é o NOME da cidade, conferido no IBGE — não a UF digitada. A mesma
// falha do geocode de visitas vivia aqui: buscar `cidade, UF, Brasil` e aceitar o
// primeiro resultado planta o cliente onde ele não está. Ver api/_lib/geo-municipios.
//
// A chave gravada continua sendo a grafia ORIGINAL do orçamento (cidade, uf): é por
// ela que a matview procura, com `lower(cidade)` e sem unaccent. O nome corrigido
// serve só pra achar a coordenada certa.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  UF_CENTRO, UF_NOME, buscarNominatim, escolherHit, indexar, resolverMunicipio,
  type Achado,
} from './_lib/geo-municipios.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const UA = 'BranorteCRM/1.0 (mapa de orcamentos; contato: daniel.peters.br@gmail.com)'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })
  if (!SVC_KEY) return res.status(501).json({ error: 'Geocoding não configurado' })

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  const { data: cidades, error: e1 } = await db.from('orcamentos_cidades_distintas').select('cidade, uf')
  if (e1) return res.status(502).json({ error: e1.message })
  const { data: cache, error: e2 } = await db.from('cidade_geocache').select('cidade, uf, lat, lng')
  if (e2) return res.status(502).json({ error: e2.message })

  // Linha que está EM CIMA do centróide do estado é fallback, não é a cidade — tem
  // que ser tentada de novo. Sem isto o erro virava PERMANENTE: uma falha passageira
  // do Nominatim gravava o centro do estado, a cidade entrava no "já tenho" e nunca
  // mais era reprocessada. Em 05/08/2026 eram 118 linhas assim, e elas empurravam 110
  // clientes (R$ 19,4 mi) pra fora da rota como "sem localização real" — inclusive
  // Peritoró, Estreito e Santa Inês empilhados no mesmo ponto no meio do Maranhão.
  const ehCentroDoEstado = (uf: string, lat: number | null, lng: number | null) => {
    const c = UF_CENTRO[(uf || '').toUpperCase()]
    return !!c && lat != null && lng != null &&
      Math.abs(lat - c.lat) < 0.005 && Math.abs(lng - c.lng) < 0.005
  }
  const resolvidas = new Set(
    (cache || [])
      .filter(c => !ehCentroDoEstado(c.uf || '', c.lat, c.lng))
      .map(c => `${(c.cidade || '').toLowerCase()}|${c.uf || ''}`))
  const faltam = (cidades || []).filter(c => c.cidade && !resolvidas.has(`${c.cidade.toLowerCase()}|${c.uf || ''}`))

  // ⚠️ Cidade NOVA primeiro; retentativa de centro-do-estado depois.
  //
  // Sem esta ordem o lote de 30 era comido inteiro pelas MESMAS cidades a cada
  // chamada: nome digitado errado ("Senhor do Bonfm", "Fortaleça", "Colinas dos
  // Sul") nunca resolve no Nominatim, cai no centro do estado, e o centro do
  // estado é justamente o que marca a linha pra ser tentada de novo. Resultado
  // medido em 03/09/2026: 30 linhas impossíveis giravam eternamente e a cidade
  // recém-cadastrada NUNCA era geocodificada — 70 orçamentos de 2026,
  // R$ 6,9 milhões, ficaram fora do mapa.
  const noCache = new Set((cache || []).map(c => `${(c.cidade || '').toLowerCase()}|${c.uf || ''}`))
  const nuncaTentada = (c: { cidade: string | null; uf: string | null }) =>
    !noCache.has(`${(c.cidade || '').toLowerCase()}|${c.uf || ''}`)
  faltam.sort((a, b) => Number(nuncaTentada(b)) - Number(nuncaTentada(a)))

  const lote = faltam.slice(0, 30) // teto por chamada (rate-limit Nominatim + timeout)

  // Municípios do IBGE: é o que decide a UF pelo NOME e conserta typo de cadastro.
  const { data: mun } = await db.from('municipios_tom_ibge').select('municipio, UF').not('UF', 'is', null)
  const idx = indexar((mun ?? []) as { municipio: string | null; UF: string | null }[])

  let atualizados = 0
  let aproximados = 0
  const falhas: string[] = []
  const corrigidas: string[] = []

  for (const row of lote) {
    const cidade = (row.cidade || '').trim()
    const uf = (row.uf || '').trim().toUpperCase()
    let coord: Achado | null = null

    if (cidade) {
      const r = resolverMunicipio(cidade, uf, idx)
      if (!r.ambiguo) {
        const q = r.uf ? `${r.nome}, ${UF_NOME[r.uf] || r.uf}, Brasil` : `${r.nome}, Brasil`
        coord = escolherHit(await buscarNominatim(q, UA), r.uf)
        await sleep(1100)
        if (coord && (r.corrigiuUf || r.nome.toLowerCase() !== cidade.toLowerCase())) {
          corrigidas.push(`${cidade}/${uf || '?'} -> ${r.nome}/${coord.uf}`)
        }
      }
    }

    const fallback = UF_CENTRO[uf]
    if (!coord && fallback) { coord = { ...fallback, uf }; aproximados++ }
    if (!coord) { falhas.push(`${cidade || '(s/cidade)'}/${uf || '?'}`); continue }

    const { error } = await db.from('cidade_geocache')
      .upsert({ cidade, uf, lat: coord.lat, lng: coord.lng }, { onConflict: 'cidade,uf' })
    if (!error) atualizados++
  }

  return res.status(200).json({
    atualizados: atualizados - aproximados, aproximados, corrigidas,
    pendentes: Math.max(0, faltam.length - lote.length), falhas,
  })
}
