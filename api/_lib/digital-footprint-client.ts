// Cliente de Pegada Digital — abordagem HÍBRIDA (gratuito por padrão).
//
// Estratégia:
//   1. Tier 1 (sempre ON): DuckDuckGo HTML scraping + HTTP HEAD validation + email cadastral fallback
//   2. Tier 2 (opt-in flag): Bing Search API free tier (1k/mês) — não implementado neste arquivo
//   3. Tier 3 (opt-in flag): SerpAPI (R$0,015/consulta) — não implementado neste arquivo
//
// Performance: 4 buscas em paralelo (site, LinkedIn, ReclameAqui, Facebook),
// timeout 8s/fonte, 25s total via Promise.race.
//
// Custo: zero (apenas Tier 1 ativo neste arquivo).
//
// Cache: implementado em camada superior (pegada_digital_cache Supabase, TTL 30d).

// ============================================================================
// TIPOS (EXPORTS)
// ============================================================================

export interface PegadaDigital {
  site: {
    existe: boolean
    url?: string
    titulo_pagina?: string
    fonte?: 'inferido' | 'duckduckgo' | 'email_cadastral' | 'validado'
  }
  linkedin: {
    existe: boolean
    url?: string
    fonte?: 'inferido' | 'duckduckgo'
  }
  reclame_aqui: {
    existe: boolean
    url?: string
    rating?: number
    total_reclamacoes?: number
    resolucao_pct?: number
  }
  facebook: {
    existe: boolean
    url?: string
  }
  fontes_consultadas: string[]
  custo_estimado_brl: number
  erros: string[]
}

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_TIMEOUT_MS = 8000
const TOTAL_TIMEOUT_MS = 25000
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SUFIXOS_EMPRESA = [
  'ltda',
  'me',
  'epp',
  'sa',
  's/a',
  's.a',
  'eireli',
  'mei',
  'cia',
  'comercio',
  'comercial',
  'industria',
  'industrial',
]

const REDES_SOCIAIS_BLOCKLIST = [
  'instagram.com',
  'linkedin.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'reclameaqui.com.br',
  'wikipedia.org',
  'pinterest.com',
  'glassdoor.com',
  'indeed.com',
  'mercadolivre.com.br',
  'olx.com.br',
]

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normaliza string p/ slug: lowercase, remove acentos, remove sufixos empresariais,
 * replace não-alphanumeric com "-", trim, max 50 chars.
 */
function slugify(s: string): string {
  if (!s) return ''

  let out = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Remove sufixos empresariais
  const tokens = out.split(' ').filter(t => !SUFIXOS_EMPRESA.includes(t))
  out = tokens.join('-')

  // Replace múltiplos hífens por um só
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '')

  return out.slice(0, 50)
}

/**
 * Promise wrapper com timeout via AbortController.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms),
    ),
  ])
}

/**
 * HTTP HEAD com timeout. Retorna { ok, status }.
 * Aceita 200, 301, 302 como "existe".
 */
async function httpHeadValidate(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      headers: { 'User-Agent': REALISTIC_UA },
      redirect: 'follow',
    })
    return { ok: resp.status >= 200 && resp.status < 400, status: resp.status }
  } catch {
    // Alguns servers não aceitam HEAD — tenta GET com Range
    try {
      const resp = await fetch(url, {
        method: 'GET',
        signal: ctrl.signal,
        headers: { 'User-Agent': REALISTIC_UA, Range: 'bytes=0-512' },
        redirect: 'follow',
      })
      return { ok: resp.status >= 200 && resp.status < 400, status: resp.status }
    } catch {
      return { ok: false, status: 0 }
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * DuckDuckGo HTML search.
 * Faz fetch em html.duckduckgo.com/html/, parseia <a class="result__a"> e retorna URLs.
 *
 * DuckDuckGo usa redirects via /l/?uddg=URL_ENCODED — decodificamos pra URL real.
 */
async function duckduckgoSearch(
  query: string,
  opts: { timeoutMs?: number; maxResults?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResults = opts.maxResults ?? 10

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const resp = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': REALISTIC_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    })
    if (!resp.ok) return []
    const html = await resp.text()

    // Parse <a class="result__a" href="...">
    const results: string[] = []
    const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/gi
    let m: RegExpExecArray | null
    while ((m = regex.exec(html)) !== null && results.length < maxResults) {
      let href = m[1]

      // Decode DDG redirect: /l/?uddg=URL_ENCODED&...
      if (href.includes('/l/?uddg=') || href.includes('uddg=')) {
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/)
        if (uddgMatch) {
          try {
            href = decodeURIComponent(uddgMatch[1])
          } catch {
            // ignora se decode falhar
          }
        }
      }

      // Garante protocolo
      if (href.startsWith('//')) href = 'https:' + href
      if (!href.startsWith('http')) continue

      results.push(href)
    }

    return results
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

/**
 * Extrai domínio (sem www/protocolo) de uma URL.
 */
function extractDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Verifica se URL aponta pra rede social conhecida.
 */
function isSocialMediaUrl(url: string): boolean {
  const dom = extractDomain(url)
  return REDES_SOCIAIS_BLOCKLIST.some(blocked => dom.includes(blocked))
}

/**
 * Extrai domínio de email (parte depois do @).
 * Retorna null se for email genérico (gmail, hotmail, etc).
 */
function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const m = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/)
  if (!m) return null
  const dom = m[1]
  const genericos = [
    'gmail.com',
    'hotmail.com',
    'outlook.com',
    'yahoo.com',
    'yahoo.com.br',
    'live.com',
    'icloud.com',
    'uol.com.br',
    'bol.com.br',
    'terra.com.br',
    'ig.com.br',
    'r7.com',
    'msn.com',
  ]
  if (genericos.includes(dom)) return null
  return dom
}

// ============================================================================
// TAREFAS PARALELAS (Tier 1 — DuckDuckGo + HTTP HEAD)
// ============================================================================

interface BuscaCtx {
  razaoSocial: string
  nomeFantasia?: string | null
  cidade?: string
  uf?: string
  emailCadastral?: string | null
  timeoutMs: number
}

/**
 * Tarefa A — Busca site oficial.
 * Estratégia:
 *   1. DuckDuckGo: "RAZAO site oficial -instagram -linkedin -facebook"
 *   2. Pega 1o resultado NÃO-rede-social
 *   3. HTTP HEAD pra validar
 *   4. Fallback: extrai domínio do email cadastral e tenta HEAD direto
 */
async function buscarSiteOficial(
  ctx: BuscaCtx,
): Promise<{
  resultado: PegadaDigital['site']
  fonte: string
  erro?: string
}> {
  const nome = ctx.nomeFantasia || ctx.razaoSocial
  const query = `"${nome}" site oficial -instagram -linkedin -facebook -reclameaqui`

  try {
    // 1. DuckDuckGo
    const results = await duckduckgoSearch(query, { timeoutMs: ctx.timeoutMs, maxResults: 10 })

    for (const url of results) {
      if (isSocialMediaUrl(url)) continue
      const head = await httpHeadValidate(url, ctx.timeoutMs)
      if (head.ok) {
        return {
          resultado: {
            existe: true,
            url,
            fonte: 'duckduckgo',
          },
          fonte: 'duckduckgo',
        }
      }
    }

    // 2. Fallback: email cadastral
    const dominioEmail = extractDomainFromEmail(ctx.emailCadastral)
    if (dominioEmail) {
      const urlHttps = `https://${dominioEmail}`
      const head = await httpHeadValidate(urlHttps, ctx.timeoutMs)
      if (head.ok) {
        return {
          resultado: {
            existe: true,
            url: urlHttps,
            fonte: 'email_cadastral',
          },
          fonte: 'email_cadastral',
        }
      }
    }

    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
      erro: `site: ${(e as Error).message}`,
    }
  }
}

/**
 * Tarefa B — Busca LinkedIn da empresa.
 * Estratégia:
 *   1. DuckDuckGo: "site:linkedin.com/company RAZAO"
 *   2. Fallback: tenta https://linkedin.com/company/SLUG-RAZAO via HEAD
 */
async function buscarLinkedIn(
  ctx: BuscaCtx,
): Promise<{
  resultado: PegadaDigital['linkedin']
  fonte: string
  erro?: string
}> {
  const nome = ctx.nomeFantasia || ctx.razaoSocial
  const query = `site:linkedin.com/company "${nome}"`

  try {
    // 1. DDG
    const results = await duckduckgoSearch(query, { timeoutMs: ctx.timeoutMs, maxResults: 5 })

    for (const url of results) {
      const dom = extractDomain(url)
      if (dom.includes('linkedin.com') && url.includes('/company/')) {
        return {
          resultado: {
            existe: true,
            url,
            fonte: 'duckduckgo',
          },
          fonte: 'duckduckgo',
        }
      }
    }

    // 2. Fallback: tenta slug direto
    const slug = slugify(nome)
    if (slug) {
      const urlSlug = `https://www.linkedin.com/company/${slug}`
      const head = await httpHeadValidate(urlSlug, ctx.timeoutMs)
      if (head.ok) {
        return {
          resultado: {
            existe: true,
            url: urlSlug,
            fonte: 'inferido',
          },
          fonte: 'linkedin_inferido',
        }
      }
    }

    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
      erro: `linkedin: ${(e as Error).message}`,
    }
  }
}

/**
 * Tarefa C — Verifica Reclame Aqui.
 * Estratégia:
 *   1. Tenta https://www.reclameaqui.com.br/empresa/SLUG-RAZAO/ via HEAD
 *   2. Se 200, marca existe=true (rating fica null sem scraping pesado)
 */
async function buscarReclameAqui(
  ctx: BuscaCtx,
): Promise<{
  resultado: PegadaDigital['reclame_aqui']
  fonte: string
  erro?: string
}> {
  const nome = ctx.nomeFantasia || ctx.razaoSocial
  const slug = slugify(nome)

  if (!slug) {
    return {
      resultado: { existe: false },
      fonte: 'reclame_aqui',
    }
  }

  try {
    const url = `https://www.reclameaqui.com.br/empresa/${slug}/`
    const head = await httpHeadValidate(url, ctx.timeoutMs)

    if (head.ok) {
      return {
        resultado: {
          existe: true,
          url,
        },
        fonte: 'reclame_aqui_inferido',
      }
    }

    return {
      resultado: { existe: false },
      fonte: 'reclame_aqui',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'reclame_aqui',
      erro: `reclame_aqui: ${(e as Error).message}`,
    }
  }
}

/**
 * Tarefa D — Busca Facebook da empresa.
 * Estratégia:
 *   1. DuckDuckGo: "site:facebook.com RAZAO"
 *   2. Pega 1o match em facebook.com
 */
async function buscarFacebook(
  ctx: BuscaCtx,
): Promise<{
  resultado: PegadaDigital['facebook']
  fonte: string
  erro?: string
}> {
  const nome = ctx.nomeFantasia || ctx.razaoSocial
  const query = `site:facebook.com "${nome}"`

  try {
    const results = await duckduckgoSearch(query, { timeoutMs: ctx.timeoutMs, maxResults: 5 })

    for (const url of results) {
      const dom = extractDomain(url)
      if (
        dom.includes('facebook.com') &&
        !url.includes('/posts/') &&
        !url.includes('/photos/') &&
        !url.includes('/videos/')
      ) {
        return {
          resultado: {
            existe: true,
            url,
          },
          fonte: 'duckduckgo',
        }
      }
    }

    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'duckduckgo',
      erro: `facebook: ${(e as Error).message}`,
    }
  }
}

// ============================================================================
// ORQUESTRADOR (EXPORT PRINCIPAL)
// ============================================================================

/**
 * Busca pegada digital de uma empresa em 4 fontes em paralelo.
 *
 * Estratégia HÍBRIDA Tier 1 (gratuito):
 *   - Site oficial: DuckDuckGo + HEAD validation + fallback email cadastral
 *   - LinkedIn: DuckDuckGo (site:linkedin.com/company) + fallback slug
 *   - Reclame Aqui: HEAD em slug direto
 *   - Facebook: DuckDuckGo (site:facebook.com)
 *
 * Timeout: 8s/fonte, 25s total. Cada fonte tem try/catch isolado.
 * Custo: 0 (apenas Tier 1).
 *
 * Para Tier 2 (Bing) e Tier 3 (SerpAPI), usar clientes separados em
 * `bing-search-client.ts` e `serpapi-client.ts` (não implementados aqui).
 */
export async function buscarPegadaDigital(opts: {
  razaoSocial: string
  nomeFantasia?: string | null
  cnpj?: string
  cidade?: string
  uf?: string
  emailCadastral?: string | null
  timeoutMs?: number
}): Promise<PegadaDigital> {
  const ctx: BuscaCtx = {
    razaoSocial: opts.razaoSocial,
    nomeFantasia: opts.nomeFantasia,
    cidade: opts.cidade,
    uf: opts.uf,
    emailCadastral: opts.emailCadastral,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }

  const resultado: PegadaDigital = {
    site: { existe: false },
    linkedin: { existe: false },
    reclame_aqui: { existe: false },
    facebook: { existe: false },
    fontes_consultadas: [],
    custo_estimado_brl: 0,
    erros: [],
  }

  // Sem razão social = nada a buscar
  if (!ctx.razaoSocial || ctx.razaoSocial.trim().length < 3) {
    resultado.erros.push('razao_social ausente ou muito curta')
    return resultado
  }

  // 4 buscas em paralelo, com timeout global de 25s.
  try {
    const settled = await withTimeout(
      Promise.allSettled([
        buscarSiteOficial(ctx),
        buscarLinkedIn(ctx),
        buscarReclameAqui(ctx),
        buscarFacebook(ctx),
      ]),
      TOTAL_TIMEOUT_MS,
      'pegada_digital_global',
    )

    // Tarefa A — Site
    const tA = settled[0]
    if (tA.status === 'fulfilled') {
      resultado.site = tA.value.resultado
      if (!resultado.fontes_consultadas.includes(tA.value.fonte)) {
        resultado.fontes_consultadas.push(tA.value.fonte)
      }
      if (tA.value.erro) resultado.erros.push(tA.value.erro)
    } else {
      resultado.erros.push(`site: ${tA.reason?.message || 'rejected'}`)
    }

    // Tarefa B — LinkedIn
    const tB = settled[1]
    if (tB.status === 'fulfilled') {
      resultado.linkedin = tB.value.resultado
      if (!resultado.fontes_consultadas.includes(tB.value.fonte)) {
        resultado.fontes_consultadas.push(tB.value.fonte)
      }
      if (tB.value.erro) resultado.erros.push(tB.value.erro)
    } else {
      resultado.erros.push(`linkedin: ${tB.reason?.message || 'rejected'}`)
    }

    // Tarefa C — Reclame Aqui
    const tC = settled[2]
    if (tC.status === 'fulfilled') {
      resultado.reclame_aqui = tC.value.resultado
      if (!resultado.fontes_consultadas.includes(tC.value.fonte)) {
        resultado.fontes_consultadas.push(tC.value.fonte)
      }
      if (tC.value.erro) resultado.erros.push(tC.value.erro)
    } else {
      resultado.erros.push(`reclame_aqui: ${tC.reason?.message || 'rejected'}`)
    }

    // Tarefa D — Facebook
    const tD = settled[3]
    if (tD.status === 'fulfilled') {
      resultado.facebook = tD.value.resultado
      if (!resultado.fontes_consultadas.includes(tD.value.fonte)) {
        resultado.fontes_consultadas.push(tD.value.fonte)
      }
      if (tD.value.erro) resultado.erros.push(tD.value.erro)
    } else {
      resultado.erros.push(`facebook: ${tD.reason?.message || 'rejected'}`)
    }
  } catch (e) {
    // Timeout global ou erro inesperado — devolve o que tiver montado
    resultado.erros.push(`global: ${(e as Error).message}`)
  }

  return resultado
}
