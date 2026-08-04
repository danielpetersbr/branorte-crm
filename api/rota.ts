// Rota rodoviária REAL, calculada server-side. Consumida pelo Modo Planejamento
// de Viagem (/mapa-visitas) pra substituir a estimativa de src/lib/viagem.ts
// (haversine × FATOR_ESTRADA 1,3 @ 70 km/h) por km e tempo de estrada de verdade.
//
// Por que server-side e não direto do browser:
//   - o OSRM público não garante CORS e limita por IP; 40 paradas viram 40+
//     requisições saindo da máquina de cada vendedor;
//   - aqui UMA chamada resolve a viagem inteira e o cache do processo absorve os
//     recálculos (o usuário arrasta parada e reordena o tempo todo).
//
// CONTRATO DE FALHA — nunca 500 silencioso:
//   OSRM fora do ar, lento ou respondendo bobagem  ->  HTTP 200 com
//   { erro: 'indisponivel', provedor: 'estimado', trechos: [], geometrias: [] }
//   e a UI segue no haversine de viagem.ts sem quebrar.
//
// PRIVACIDADE (§22): nenhuma coordenada de cliente entra em log. Só contagem,
// status e milissegundos. Os motivos de erro são strings fixas, nunca o texto
// cru do erro (a URL do OSRM carrega as coordenadas dentro).
import type { VercelRequest, VercelResponse } from '@vercel/node'

const OSRM = 'https://router.project-osrm.org'
const UA = 'BranorteCRM/1.0 (planejamento de viagem; contato: daniel.peters.br@gmail.com)'

/** Espelha MAX_PARADAS de src/lib/viagem.ts. Duplicado de propósito: importar
 *  `@/lib/viagem` aqui dependeria do alias de path resolver no bundler da Vercel. */
const MAX_PONTOS = 40
/** Acima disso a matriz N×N não compensa (e o demo server do OSRM recusa). */
const MAX_PONTOS_MATRIZ = 25
/** Teto por chamada ao OSRM. */
const LIMITE_CHAMADA_MS = 8_000
/** Orçamento total do handler. 9s cabe embaixo do maxDuration padrão (10s) da
 *  plataforma — assim a resposta de fallback SAI, em vez de a função ser morta
 *  e virar 504. Se o vercel.json ganhar maxDuration maior, suba via env. */
const ORCAMENTO_TOTAL_MS = Number(process.env.ROTA_ORCAMENTO_MS) || 9_000
const BACKOFF_MS = 400
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX = 60
/** Teto de vértices por perna no desenho. Acima disso a linha é afinada — o
 *  mapa não enxerga diferença e a resposta não incha. */
const MAX_VERTICES_PERNA = 400
/** O OSRM "gruda" (snap) a coordenada recebida na estrada mais próxima, por mais
 *  longe que ela esteja, e responde com cara de sucesso. Coordenada no meio do
 *  Atlântico grudou a 1.829 km numa avenida em Floripa e devolveu "0 km / 0 min"
 *  — número redondamente falso que viraria roteiro de vendedor. Acima deste
 *  limite o ponto não está na malha viária e o trecho é descartado (a UI cai no
 *  haversine, que ao menos se declara estimado). 25 km dá folga de sobra pra
 *  propriedade rural longe de estrada mapeada. */
const MAX_SNAP_METROS = 25_000

// ── contrato ─────────────────────────────────────────────────────────────────

type Perfil = 'driving'

interface PontoReq { lat: number; lng: number }
interface TrechoResp { de: number; para: number; metros: number; segundos: number }
/** Polilinha de uma perna, em [lat, lng] (ordem do Leaflet, já invertida do GeoJSON). */
type Perna = [number, number][]

interface RespostaOk {
  provedor: 'osrm'
  /** Pares de índices de `pontos`. Sempre traz as pernas consecutivas; quando
   *  `matrizCompleta` é true, traz TODOS os pares (i≠j) — serve pro otimizador. */
  trechos: TrechoResp[]
  /** Uma entrada por perna consecutiva (pontos.length - 1). Vazio se só a matriz veio.
   *  Perna de ponto fora da malha vem como [] (nada confiável pra desenhar). */
  geometrias: Perna[]
  matrizCompleta: boolean
  cache: boolean
  /** Pontos que o OSRM não conseguiu localizar na malha viária. Texto pt-BR
   *  pronto pra mostrar. Vazio no caminho feliz. */
  avisos: string[]
}

interface RespostaIndisponivel {
  erro: 'indisponivel'
  provedor: 'estimado'
  trechos: []
  geometrias: []
  motivo: string
  avisos: string[]
}

// ── cache de processo ────────────────────────────────────────────────────────
// Sobrevive entre invocações enquanto o lambda estiver quente. Chaveado pelas
// coordenadas já arredondadas em 5 casas (~1 m), igual ao chaveTrecho() de
// viagem.ts — então reordenar a mesma viagem duas vezes bate no cache.

interface EntradaCache { expira: number; valor: RespostaOk }
const cache = new Map<string, EntradaCache>()

function cacheLer(chave: string): RespostaOk | null {
  const e = cache.get(chave)
  if (!e) return null
  if (e.expira < Date.now()) { cache.delete(chave); return null }
  cache.delete(chave); cache.set(chave, e) // reinsere: vira o mais recente (LRU pobre)
  return e.valor
}

function cacheGravar(chave: string, valor: RespostaOk): void {
  cache.set(chave, { expira: Date.now() + CACHE_TTL_MS, valor })
  while (cache.size > CACHE_MAX) {
    const primeira = cache.keys().next()
    if (primeira.done) break
    cache.delete(primeira.value)
  }
}

// ── validação ────────────────────────────────────────────────────────────────

type Validacao =
  | { ok: true; pontos: PontoReq[]; perfil: Perfil }
  | { ok: false; erro: string }

/** 5 casas = ~1,1 m. Mesma precisão de chaveTrecho() em viagem.ts. */
const arred = (v: number) => Number(v.toFixed(5))

function lerCorpo(req: VercelRequest): unknown {
  const b: unknown = req.body
  if (typeof b === 'string') {
    try { return JSON.parse(b) } catch { return null }
  }
  return b
}

function validar(bruto: unknown): Validacao {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ok: false, erro: 'Corpo inválido. Envie um JSON no formato { "pontos": [{ "lat": -27.1, "lng": -49.2 }] }.' }
  }
  const body = bruto as { pontos?: unknown; perfil?: unknown }

  if (!Array.isArray(body.pontos)) {
    return { ok: false, erro: 'O campo "pontos" é obrigatório e deve ser uma lista.' }
  }
  if (body.pontos.length < 2) {
    return { ok: false, erro: 'Informe pelo menos 2 pontos para calcular uma rota.' }
  }
  if (body.pontos.length > MAX_PONTOS) {
    return { ok: false, erro: `Máximo de ${MAX_PONTOS} pontos por requisição (recebidos ${body.pontos.length}).` }
  }

  if (body.perfil !== undefined && body.perfil !== 'driving') {
    return { ok: false, erro: 'Perfil não suportado. Use "driving".' }
  }

  const pontos: PontoReq[] = []
  for (let i = 0; i < body.pontos.length; i++) {
    const p = body.pontos[i] as { lat?: unknown; lng?: unknown } | null
    if (!p || typeof p !== 'object') {
      return { ok: false, erro: `Ponto ${i + 1} inválido: esperado um objeto { lat, lng }.` }
    }
    const { lat, lng } = p
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, erro: `Ponto ${i + 1} inválido: "lat" e "lng" devem ser números.` }
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, erro: `Ponto ${i + 1} fora de faixa: "lat" entre -90 e 90, "lng" entre -180 e 180.` }
    }
    pontos.push({ lat: arred(lat), lng: arred(lng) })
  }

  return { ok: true, pontos, perfil: 'driving' }
}

// ── busca no OSRM ────────────────────────────────────────────────────────────

interface ErroHttp extends Error { status?: number }

async function buscarJson(url: string, limiteMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), limiteMs)
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) {
      const e: ErroHttp = new Error(`HTTP ${r.status}`)
      e.status = r.status
      throw e
    }
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Uma retentativa, com backoff curto. Só re-tenta o que pode ter sido azar:
 * queda de rede, abort por timeout e 5xx. 4xx do OSRM é determinístico
 * ("NoRoute", coordenada fora do grafo) — insistir só queima o orçamento.
 */
async function buscarComRetentativa(url: string, deadline: number): Promise<unknown> {
  for (let tentativa = 1; ; tentativa++) {
    const restante = deadline - Date.now()
    if (restante <= 0) throw new Error('orcamento_esgotado')
    try {
      return await buscarJson(url, Math.min(LIMITE_CHAMADA_MS, restante))
    } catch (e) {
      const status = (e as ErroHttp).status
      const transitorio = status === undefined || status >= 500
      // sobra tem que cobrir backoff + uma tentativa que valha a pena
      const temFolga = deadline - Date.now() > BACKOFF_MS + 2_000
      if (tentativa > 1 || !transitorio || !temFolga) throw e
      await new Promise(r => setTimeout(r, BACKOFF_MS))
    }
  }
}

// ── parsers (tolerantes: resposta estranha vira null, não exception) ─────────

const numOuNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Valida uma matriz n×n de números anuláveis vinda do /table. */
function matrizNumerica(v: unknown, n: number): (number | null)[][] | null {
  if (!Array.isArray(v) || v.length !== n) return null
  const saida: (number | null)[][] = []
  for (const linha of v) {
    if (!Array.isArray(linha) || linha.length !== n) return null
    saida.push(linha.map(numOuNull))
  }
  return saida
}

function trechosDaMatriz(json: unknown, n: number): TrechoResp[] | null {
  if (!json || typeof json !== 'object') return null
  const o = json as { code?: unknown; durations?: unknown; distances?: unknown }
  if (o.code !== undefined && o.code !== 'Ok') return null
  const segundos = matrizNumerica(o.durations, n)
  const metros = matrizNumerica(o.distances, n)
  // sem `distances` a matriz seria meia-verdade (tempo real, km estimado).
  // Melhor descartar e deixar as pernas do /route responderem.
  if (!segundos || !metros) return null

  const saida: TrechoResp[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const s = segundos[i][j]
      const m = metros[i][j]
      if (s == null || m == null) continue // par inalcançável
      saida.push({ de: i, para: j, metros: Math.round(m), segundos: Math.round(s) })
    }
  }
  return saida.length ? saida : null
}

/** GeoJSON vem em [lng, lat]; o Leaflet quer [lat, lng]. Inverte e descarta lixo. */
function coordsParaPerna(v: unknown): Perna {
  if (!Array.isArray(v)) return []
  const saida: Perna = []
  for (const par of v) {
    if (!Array.isArray(par) || par.length < 2) continue
    const lng = numOuNull(par[0])
    const lat = numOuNull(par[1])
    if (lat == null || lng == null) continue
    const ultimo = saida[saida.length - 1]
    if (ultimo && ultimo[0] === lat && ultimo[1] === lng) continue // steps repetem o vértice de fronteira
    saida.push([lat, lng])
  }
  return saida
}

/** Amostragem uniforme mantendo primeiro e último. */
function afinar(perna: Perna, max: number): Perna {
  if (perna.length <= max) return perna
  const passo = (perna.length - 1) / (max - 1)
  const saida: Perna = []
  for (let i = 0; i < max; i++) saida.push(perna[Math.round(i * passo)])
  return saida
}

function pernasDoRoute(
  json: unknown,
  nPontos: number,
): { trechos: TrechoResp[]; geometrias: Perna[] } | null {
  if (!json || typeof json !== 'object') return null
  const o = json as { code?: unknown; routes?: unknown }
  if (o.code !== undefined && o.code !== 'Ok') return null
  if (!Array.isArray(o.routes) || !o.routes.length) return null

  const rota = o.routes[0] as { legs?: unknown; geometry?: unknown }
  if (!Array.isArray(rota.legs) || rota.legs.length !== nPontos - 1) return null

  const trechos: TrechoResp[] = []
  const geometrias: Perna[] = []

  for (let i = 0; i < rota.legs.length; i++) {
    const leg = rota.legs[i] as { distance?: unknown; duration?: unknown; steps?: unknown }
    const metros = numOuNull(leg.distance)
    const segundos = numOuNull(leg.duration)
    if (metros == null || segundos == null) return null
    trechos.push({ de: i, para: i + 1, metros: Math.round(metros), segundos: Math.round(segundos) })

    // A perna não tem geometry própria no OSRM — monta-se concatenando os steps.
    let perna: Perna = []
    if (Array.isArray(leg.steps)) {
      for (const s of leg.steps) {
        const step = s as { geometry?: { coordinates?: unknown } }
        const pedaco = coordsParaPerna(step.geometry?.coordinates)
        if (!pedaco.length) continue
        const ultimo = perna[perna.length - 1]
        const inicio = ultimo && ultimo[0] === pedaco[0][0] && ultimo[1] === pedaco[0][1] ? 1 : 0
        for (let k = inicio; k < pedaco.length; k++) perna.push(pedaco[k])
      }
    }
    // Fallback do caso simples (2 pontos = 1 perna): o overview=full já É a perna.
    if (!perna.length && rota.legs.length === 1) {
      const geo = rota.geometry as { coordinates?: unknown } | undefined
      perna = coordsParaPerna(geo?.coordinates)
    }
    geometrias.push(afinar(perna, MAX_VERTICES_PERNA))
  }

  return { trechos, geometrias }
}

/**
 * Índice -> metros de snap, só dos pontos que o OSRM grudou longe demais.
 * `waypoints` (do /route) e `sources` (do /table) têm o mesmo formato.
 */
function pontosForaDaMalha(waypoints: unknown): Map<number, number> {
  const ruins = new Map<number, number>()
  if (!Array.isArray(waypoints)) return ruins
  waypoints.forEach((w, i) => {
    const d = numOuNull((w as { distance?: unknown } | null)?.distance)
    if (d != null && d > MAX_SNAP_METROS) ruins.set(i, d)
  })
  return ruins
}

const campo = (v: unknown, nome: string): unknown =>
  v && typeof v === 'object' ? (v as Record<string, unknown>)[nome] : undefined

// ── motivos (strings fixas — nunca ecoa o erro cru, §22) ─────────────────────

function motivoDe(r: PromiseSettledResult<unknown>): string {
  if (r.status === 'fulfilled') return 'resposta do OSRM em formato inesperado'
  const msg = String((r.reason as Error | undefined)?.message ?? '')
  if (/abort/i.test(msg) || msg === 'orcamento_esgotado') return 'tempo esgotado'
  const status = (r.reason as ErroHttp | undefined)?.status
  if (typeof status === 'number') return `OSRM respondeu HTTP ${status}`
  return 'falha de rede'
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Sem CORS de propósito: é consumido pela própria origem do CRM. Sem
  // Access-Control-Allow-Origin, nenhum site de terceiro usa isso como proxy
  // gratuito de roteirização.
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido. Use POST.' })
  }

  const v = validar(lerCorpo(req))
  if (!v.ok) return res.status(400).json({ erro: v.erro })
  const { pontos, perfil } = v

  const coords = pontos.map(p => `${p.lng},${p.lat}`).join(';')
  const chave = `${perfil}|${coords}`

  const emCache = cacheLer(chave)
  if (emCache) {
    return res.status(200).json({ ...emCache, cache: true } satisfies RespostaOk)
  }

  const inicio = Date.now()
  const deadline = inicio + ORCAMENTO_TOTAL_MS
  const querMatriz = pontos.length <= MAX_PONTOS_MATRIZ

  // Em paralelo: o /route dá as pernas + o desenho, o /table dá a matriz cheia
  // que o otimizador de viagem.ts usa. Uma falhando, a outra ainda serve.
  const [resRoute, resTable] = await Promise.allSettled([
    buscarComRetentativa(
      `${OSRM}/route/v1/${perfil}/${coords}?overview=full&geometries=geojson&steps=true`,
      deadline,
    ),
    querMatriz
      ? buscarComRetentativa(`${OSRM}/table/v1/${perfil}/${coords}?annotations=duration,distance`, deadline)
      : Promise.resolve(null),
  ])

  const doRoute = resRoute.status === 'fulfilled' ? pernasDoRoute(resRoute.value, pontos.length) : null
  const daMatriz =
    resTable.status === 'fulfilled' && resTable.value !== null
      ? trechosDaMatriz(resTable.value, pontos.length)
      : null

  // A matriz já contém os pares consecutivos, então ela substitui (não soma)
  // as pernas — evita o mesmo par aparecer duas vezes com valores diferentes.
  let trechos: TrechoResp[] = daMatriz ?? doRoute?.trechos ?? []
  let geometrias: Perna[] = doRoute?.geometrias ?? []

  // Descarta o que foi calculado em cima de ponto fora da malha viária: melhor
  // a UI estimar e se declarar estimada do que exibir um "0 km" convincente.
  const foraDaMalha = new Map<number, number>()
  if (resRoute.status === 'fulfilled') {
    for (const [i, d] of pontosForaDaMalha(campo(resRoute.value, 'waypoints'))) foraDaMalha.set(i, d)
  }
  if (resTable.status === 'fulfilled' && resTable.value !== null) {
    for (const [i, d] of pontosForaDaMalha(campo(resTable.value, 'sources'))) {
      if (!foraDaMalha.has(i)) foraDaMalha.set(i, d)
    }
  }

  const avisos: string[] = []
  if (foraDaMalha.size) {
    trechos = trechos.filter(t => !foraDaMalha.has(t.de) && !foraDaMalha.has(t.para))
    geometrias = geometrias.map((g, i) => (foraDaMalha.has(i) || foraDaMalha.has(i + 1) ? [] : g))
    for (const [i, d] of [...foraDaMalha].sort((a, b) => a[0] - b[0])) {
      avisos.push(
        `Ponto ${i + 1} está a ${Math.round(d / 1000)} km da estrada mais próxima — ` +
        `sem rota real, os trechos dele ficam estimados. Confirme a localização.`,
      )
    }
  }

  const ms = Date.now() - inicio

  if (!trechos.length) {
    const motivo = foraDaMalha.size ? 'pontos fora da malha viária' : motivoDe(resRoute)
    console.warn(`[rota] sem rota real — ${pontos.length} pontos, ${ms}ms, motivo: ${motivo}`)
    const fallback: RespostaIndisponivel = {
      erro: 'indisponivel',
      provedor: 'estimado',
      trechos: [],
      geometrias: [],
      motivo,
      avisos,
    }
    return res.status(200).json(fallback)
  }

  const resposta: RespostaOk = {
    provedor: 'osrm',
    trechos,
    geometrias,
    matrizCompleta: !!daMatriz && !foraDaMalha.size,
    cache: false,
    avisos,
  }
  cacheGravar(chave, resposta)
  console.log(
    `[rota] ok — ${pontos.length} pontos, ${trechos.length} trechos, ` +
    `matriz=${resposta.matrizCompleta}, pernas=${geometrias.length}, ` +
    `foraDaMalha=${foraDaMalha.size}, ${ms}ms`,
  )
  return res.status(200).json(resposta)
}
