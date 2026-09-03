// Geocodifica registros de cliente_dados_visita que ainda não têm lat/lng.
//
// ⚠️ A UF digitada NÃO é confiável — e confiar nela plantava cliente no estado
// errado. Medido em 03/09/2026 sobre os 167 pinos de visita: "Brasília/SC" caiu em
// Criciúma (-28,67), "Fortaleza/SC" no vale do Itajaí, "Lagarto/SC" (Lagarto é SE)
// no planalto catarinense. A busca era `cidade, UF, Brasil` e aceitava o primeiro
// resultado sem conferir nada: pedindo Fortaleza dentro de SC, o Nominatim acha
// *alguma* Fortaleza em SC e devolve com cara de acerto.
//
// Agora quem manda é o NOME da cidade, conferido no IBGE (municipios_tom_ibge):
//  1. cidade existe na UF digitada  -> busca nessa UF e exige `address.state` igual
//  2. existe em exatamente 1 outra UF -> busca lá e CORRIGE o estado do registro
//     (vendedor errar a UF é muito mais comum que existir homônimo no estado dele)
//  3. existe em várias outras UFs     -> ambíguo, fica no centro do estado digitado
//  4. não existe no IBGE (distrito, typo) -> busca "cidade, Brasil" e aceita o que
//     vier, alinhando o estado ao resultado ("Espigão do Oeste" -> RO)
//  5. nada disso -> centro do estado, como antes (pino aproximado é melhor que sumir)
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

/** Nome do estado como o Nominatim devolve em `address.state`. */
const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
  PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
}
const NOME_UF: Record<string, string> = Object.fromEntries(
  Object.entries(UF_NOME).map(([uf, nome]) => [norm(nome), uf]))

function norm(s: string): string {
  return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Distância de edição, com teto: quem passa de `max` não interessa e sai cedo.
 * Existe pra pegar o typo do vendedor — "Rolin de Moura", "Bruritis", "Brasilai",
 * "Luiz Eduardo Magalhães" (o município é "Luís", com S) — antes de o Nominatim
 * devolver um homônimo qualquer. O caso do "Luiz" custou 700 km: o pino foi parar
 * no litoral sul da Bahia, e o município fica no oeste.
 */
function distancia(a: string, b: string, max: number): number {
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

interface Hit { lat: string; lon: string; address?: { state?: string } }

async function buscar(q: string): Promise<Hit[]> {
  const url = 'https://nominatim.openstreetmap.org/search?'
    + new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'br', addressdetails: '1' })
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } })
  if (!r.ok) return []
  return (await r.json()) as Hit[]
}

interface Achado { lat: number; lng: number; uf: string }

/** Primeiro hit dentro da UF pedida (ou, se `ufPedida` for null, o primeiro em qualquer UF conhecida). */
function escolher(hits: Hit[], ufPedida: string | null): Achado | null {
  for (const h of hits) {
    const uf = NOME_UF[norm(h.address?.state || '')]
    if (!uf) continue
    if (ufPedida && uf !== ufPedida) continue
    return { lat: parseFloat(h.lat), lng: parseFloat(h.lon), uf }
  }
  return null
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

  // Municípios do IBGE (5.571) pra decidir a UF pelo NOME da cidade. 11 mil linhas
  // cabem no corte do PostgREST; metade não tem UF e é descartada aqui.
  const { data: mun } = await db.from('municipios_tom_ibge').select('municipio, UF').not('UF', 'is', null)
  const ufsDoNome = new Map<string, Set<string>>()
  for (const m of (mun ?? []) as { municipio: string | null; UF: string | null }[]) {
    const nome = norm(m.municipio || '')
    const uf = (m.UF || '').toUpperCase()
    if (!nome || !uf) continue
    if (!ufsDoNome.has(nome)) ufsDoNome.set(nome, new Set())
    ufsDoNome.get(nome)!.add(uf)
  }

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
      const chave = `${norm(cidade)}|${uf}`
      const emCache = cache.get(chave)
      if (emCache !== undefined) {
        achado = emCache
      } else {
        let nome = cidade
        let ufsIbge = ufsDoNome.get(norm(cidade))

        // Não bateu exato? Tenta o município mais parecido antes de sair perguntando
        // ao Nominatim — na UF digitada primeiro, que é onde o typo costuma estar.
        if (!ufsIbge) {
          const alvo = norm(cidade)
          const max = alvo.length <= 6 ? 1 : 2
          let melhor: { nome: string; uf: string; d: number } | null = null
          let empate = false
          for (const [n, ufs] of ufsDoNome) {
            const d = distancia(alvo, n, max)
            if (d > max) continue
            for (const u of ufs) {
              const cand = { nome: n, uf: u, d }
              const ganha = !melhor || d < melhor.d || (d === melhor.d && u === uf && melhor.uf !== uf)
              if (ganha) { empate = false; melhor = cand }
              // Só é empate de verdade quando NENHUM dos candidatos está na UF que o
              // vendedor digitou. "Bruritis"/RO casa com Buritis, que existe em MG e
              // RO: o RO desempata sozinho, e sem isto o registro caía no centro do
              // estado por "ambiguidade" que o próprio cadastro já resolvia.
              else if (melhor && d === melhor.d && u !== melhor.uf && melhor.uf !== uf) empate = true
            }
          }
          if (melhor && !empate) {
            nome = melhor.nome
            ufsIbge = new Set([melhor.uf])
          }
        }

        const outras = ufsIbge ? [...ufsIbge].filter(u => u !== uf) : []

        if (ufsIbge?.has(uf)) {
          // 1. cidade existe na UF digitada: exige que o resultado seja dessa UF
          achado = escolher(await buscar(`${nome}, ${UF_NOME[uf] || uf}, Brasil`), uf)
          await sleep(1100)
        } else if (outras.length === 1) {
          // 2. existe em exatamente uma outra UF: a UF digitada é que está errada
          const certa = outras[0]
          achado = escolher(await buscar(`${nome}, ${UF_NOME[certa]}, Brasil`), certa)
          await sleep(1100)
        } else if (outras.length === 0 || !uf) {
          // 4. não é município do IBGE (distrito, "entorno de Brasília"), OU é
          //    ambíguo mas o vendedor não disse a UF: aí não há o que contrariar —
          //    o ranking do Nominatim decide ("Campo Grande" -> MS) e o estado do
          //    registro passa a ser o de onde o pino caiu.
          achado = escolher(await buscar(`${nome}, Brasil`), null)
          await sleep(1100)
        }
        // 3. (existe em várias outras UFs e o vendedor digitou uma delas errada)
        //    fica sem achado -> centro do estado digitado
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
