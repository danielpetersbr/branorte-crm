// Cliente de Pegada Digital — abordagem DETERMINÍSTICA (gratuito, sem dependência de scraper).
//
// Estratégia (em ordem de confiança):
//   1. Email cadastral OpenCNPJ -> domínio direto (MAIS CONFIÁVEL)
//   2. Slug razão social -> candidatos .com.br/.com
//   3. Slug nome fantasia -> candidatos .com.br/.com
//   4. Slugs determinísticos pra LinkedIn / Reclame Aqui / Facebook
//
// Validação: HTTP HEAD (com fallback GET Range) e User-Agent realista.
// Se HEAD falhar, ainda APRESENTA URL como "inferido" pro vendedor validar (a UI diferencia).
//
// Performance: tudo em paralelo via Promise.allSettled, timeout 25s global, 6s/HEAD.
// Custo: zero.
//
// Cache: implementado em camada superior (pegada_digital_cache Supabase, TTL 30d).
//
// Debug: campo `debug.tentativas[]` registra todas as URLs candidatas testadas,
// útil pra inspecionar em prod via payload `due_diligence_consultas.resultado_spc.pegada_digital`.

// ============================================================================
// TIPOS (EXPORTS)
// ============================================================================

export type PegadaFonte =
  | 'email_cadastral'
  | 'email_cadastral_inferido'
  | 'slug_razao_validado'
  | 'slug_fantasia_validado'
  | 'slug_inferido'
  | 'inferido'
  | 'validado'

export interface PegadaDigital {
  site: {
    existe: boolean
    url?: string
    titulo_pagina?: string
    fonte?: PegadaFonte | string
  }
  linkedin: {
    existe: boolean
    url?: string
    fonte?: PegadaFonte | string
  }
  reclame_aqui: {
    existe: boolean
    url?: string
    fonte?: PegadaFonte | string
    rating?: number
    total_reclamacoes?: number
    resolucao_pct?: number
  }
  facebook: {
    existe: boolean
    url?: string
    fonte?: PegadaFonte | string
  }
  fontes_consultadas: string[]
  custo_estimado_brl: number
  erros: string[]
  /** Tentativas registradas para debug em prod. */
  debug?: {
    tentativas: Array<{
      alvo: 'site' | 'linkedin' | 'reclame_aqui' | 'facebook'
      fonte: string
      url: string
      ok?: boolean
      status?: number
    }>
  }
}

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_TIMEOUT_MS = 6000
const TOTAL_TIMEOUT_MS = 25000
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const EMAIL_GENERICOS = new Set<string>([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'outlook.com.br',
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
  'me.com',
  'protonmail.com',
  'aol.com',
])

// Tokens que NÃO entram no slug (sufixos societários / palavras genéricas).
const SLUG_STOPWORDS = new Set<string>([
  'ltda',
  'me',
  'epp',
  'sa',
  's/a',
  's.a',
  'eireli',
  'mei',
  'cia',
  'grupo',
  'do',
  'da',
  'de',
  'dos',
  'das',
  'e',
])

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normaliza string -> slug curto e compacto (sem hífens) usado em domínios
 * candidatos e URLs de redes sociais.
 *
 * Exemplos:
 *   "M Branorte Industria LTDA" -> "mbranorte"
 *   "Acme Comércio S.A." -> "acmecomercio"
 */
function slugify(input: string | null | undefined): string {
  if (!input) return ''
  const norm = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  // Remove tudo que não é letra/dígito/espaço
  const clean = norm.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = clean.split(' ').filter(t => t && !SLUG_STOPWORDS.has(t))
  return tokens.join('').slice(0, 30)
}

/**
 * Promise wrapper com timeout via setTimeout (não cancela a promise interna,
 * apenas vence o race com erro).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms),
    ),
  ])
}

interface HttpValidationResult {
  ok: boolean
  status: number
  titulo?: string
  /** Servidor respondeu mas com status que indica existência mesmo sem 2xx/3xx (ex: 401/403/405/503). */
  servidor_existe?: boolean
}

/**
 * Status codes que indicam que o SERVIDOR existe mesmo não retornando 2xx/3xx:
 *   401 = Unauthorized (página existe, requer auth)
 *   403 = Forbidden (servidor recusou HEAD/GET, mas existe)
 *   405 = Method Not Allowed (não aceita HEAD, mas servidor responde — branorte.com retornou isso)
 *   429 = Too Many Requests (rate-limit, servidor existe)
 *   503 = Service Unavailable (servidor existe, temporariamente indisponível)
 */
function statusIndicaServidorExistente(status: number): boolean {
  return status === 401 || status === 403 || status === 405 || status === 429 || status === 503
}

/**
 * HTTP HEAD com timeout. Aceita 2xx/3xx como "existe" (ok=true).
 * Se HEAD falhar (alguns servers não aceitam), tenta GET com Range para
 * pegar uma fatia mínima.
 *
 * Nota: status 999 (LinkedIn antibot) e 401/403/405/429/503 (servidor existe mas
 * não aceita HEAD/anon) NÃO marcam ok=true, mas marcam servidor_existe=true para
 * que o caller possa tratar como "inferido" em vez de descartar.
 */
async function validarHTTP(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<HttpValidationResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      headers: {
        'User-Agent': REALISTIC_UA,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })
    const ok = resp.status >= 200 && resp.status < 400
    const servidor_existe = ok || statusIndicaServidorExistente(resp.status)
    // Se HEAD retornou status que indica servidor existente mas não ok (ex: 405),
    // tenta GET com Range pra confirmar e extrair título.
    if (!ok && statusIndicaServidorExistente(resp.status)) {
      try {
        const ctrl2 = new AbortController()
        const t2 = setTimeout(() => ctrl2.abort(), timeoutMs)
        try {
          const resp2 = await fetch(url, {
            method: 'GET',
            signal: ctrl2.signal,
            headers: {
              'User-Agent': REALISTIC_UA,
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
              Range: 'bytes=0-2047',
            },
            redirect: 'follow',
          })
          const ok2 = resp2.status >= 200 && resp2.status < 400
          let titulo: string | undefined
          if (ok2) {
            try {
              const body = await resp2.text()
              const m = body.match(/<title[^>]*>([^<]{1,160})<\/title>/i)
              if (m) titulo = m[1].trim()
            } catch {
              /* ignore body parse */
            }
          }
          return {
            ok: ok2,
            status: ok2 ? resp2.status : resp.status,
            titulo,
            servidor_existe: ok2 || statusIndicaServidorExistente(resp2.status) || servidor_existe,
          }
        } finally {
          clearTimeout(t2)
        }
      } catch {
        // GET também falhou — mantém o resultado original do HEAD
        return { ok, status: resp.status, servidor_existe }
      }
    }
    return { ok, status: resp.status, servidor_existe }
  } catch {
    // Fallback: GET com Range bytes 0-2047 (tenta extrair <title>)
    try {
      const ctrl2 = new AbortController()
      const t2 = setTimeout(() => ctrl2.abort(), timeoutMs)
      try {
        const resp = await fetch(url, {
          method: 'GET',
          signal: ctrl2.signal,
          headers: {
            'User-Agent': REALISTIC_UA,
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            Range: 'bytes=0-2047',
          },
          redirect: 'follow',
        })
        const ok = resp.status >= 200 && resp.status < 400
        const servidor_existe = ok || statusIndicaServidorExistente(resp.status)
        let titulo: string | undefined
        try {
          const body = await resp.text()
          const m = body.match(/<title[^>]*>([^<]{1,160})<\/title>/i)
          if (m) titulo = m[1].trim()
        } catch {
          /* ignore body parse */
        }
        return { ok, status: resp.status, titulo, servidor_existe }
      } finally {
        clearTimeout(t2)
      }
    } catch {
      return { ok: false, status: 0, servidor_existe: false }
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Extrai domínio (sem www) do email cadastral OpenCNPJ.
 * Retorna null pra emails genéricos (gmail, hotmail, etc).
 */
function extractDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at < 0) return null
  const raw = email.slice(at + 1).trim().toLowerCase()
  if (!raw) return null
  // Remove sufixo de path/query se vier sujo
  const dominio = raw.split(/[/?#\s]/)[0].replace(/^www\./, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) return null
  if (EMAIL_GENERICOS.has(dominio)) return null
  return dominio
}

// ============================================================================
// TIPOS INTERNOS
// ============================================================================

interface BuscaCtx {
  razaoSocial: string
  nomeFantasia?: string | null
  cidade?: string
  uf?: string
  emailCadastral?: string | null
  timeoutMs: number
}

type Tentativa = NonNullable<PegadaDigital['debug']>['tentativas'][number]

// ============================================================================
// BUSCA SITE OFICIAL
// ============================================================================

async function buscarSiteOficial(
  ctx: BuscaCtx,
  registrar: (t: Tentativa) => void,
): Promise<{ resultado: PegadaDigital['site']; fonte: string; erro?: string }> {
  try {
    // PRIORIDADE 1 — domínio do email cadastral OpenCNPJ
    const dominioEmail = extractDomainFromEmail(ctx.emailCadastral)
    if (dominioEmail) {
      const candidato = `https://${dominioEmail}`
      const v = await validarHTTP(candidato, ctx.timeoutMs)
      registrar({
        alvo: 'site',
        fonte: 'email_cadastral',
        url: candidato,
        ok: v.ok,
        status: v.status,
      })
      if (v.ok) {
        return {
          resultado: {
            existe: true,
            url: candidato,
            fonte: 'email_cadastral',
            titulo_pagina: v.titulo,
          },
          fonte: 'email_cadastral',
        }
      }
      // Mesmo se HEAD/GET falhar, mantemos como "inferido" — vendedor valida.
      // OpenCNPJ raramente entrega email errado, então a confiança ainda é alta.
      // PORÉM: só mantém como inferido se for um domínio plausível.
      return {
        resultado: {
          existe: true,
          url: candidato,
          fonte: 'email_cadastral_inferido',
        },
        fonte: 'email_cadastral_inferido',
      }
    }

    // PRIORIDADE 2 — slug razão social
    const slugRazao = slugify(ctx.razaoSocial)
    // Guarda primeiro hit "servidor existe mas não 2xx" pra usar como fallback inferido
    let inferidoFallback: { url: string; status: number } | null = null

    if (slugRazao.length >= 3) {
      const candidatos = [
        `https://www.${slugRazao}.com.br`,
        `https://${slugRazao}.com.br`,
        `https://www.${slugRazao}.com`,
        `https://${slugRazao}.com`,
      ]
      for (const url of candidatos) {
        const v = await validarHTTP(url, ctx.timeoutMs)
        registrar({
          alvo: 'site',
          fonte: 'slug_razao',
          url,
          ok: v.ok,
          status: v.status,
        })
        if (v.ok) {
          return {
            resultado: {
              existe: true,
              url,
              fonte: 'slug_razao_validado',
              titulo_pagina: v.titulo,
            },
            fonte: 'slug_razao_validado',
          }
        }
        // Servidor respondeu mas não com 2xx (ex: 405 do branorte.com) —
        // guarda como candidato a "inferido" se nada melhor aparecer.
        if (v.servidor_existe && !inferidoFallback) {
          inferidoFallback = { url, status: v.status }
        }
      }
    }

    // PRIORIDADE 3 — slug nome fantasia (se diferente do razão)
    const slugFantasia = ctx.nomeFantasia ? slugify(ctx.nomeFantasia) : ''
    if (slugFantasia.length >= 3 && slugFantasia !== slugRazao) {
      const candidatos = [
        `https://www.${slugFantasia}.com.br`,
        `https://${slugFantasia}.com.br`,
        `https://www.${slugFantasia}.com`,
        `https://${slugFantasia}.com`,
      ]
      for (const url of candidatos) {
        const v = await validarHTTP(url, ctx.timeoutMs)
        registrar({
          alvo: 'site',
          fonte: 'slug_fantasia',
          url,
          ok: v.ok,
          status: v.status,
        })
        if (v.ok) {
          return {
            resultado: {
              existe: true,
              url,
              fonte: 'slug_fantasia_validado',
              titulo_pagina: v.titulo,
            },
            fonte: 'slug_fantasia_validado',
          }
        }
        if (v.servidor_existe && !inferidoFallback) {
          inferidoFallback = { url, status: v.status }
        }
      }
    }

    // FALLBACK INFERIDO — algum slug retornou status que indica servidor existente
    // (ex: branorte.com retorna 405 = "não aceito HEAD nessa rota"). Servidor existe,
    // apresenta pro vendedor validar visualmente.
    if (inferidoFallback) {
      return {
        resultado: {
          existe: true,
          url: inferidoFallback.url,
          fonte: 'slug_inferido',
        },
        fonte: 'slug_inferido',
      }
    }

    // Nada encontrado.
    return { resultado: { existe: false }, fonte: 'site_nao_encontrado' }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'site_erro',
      erro: `site: ${(e as Error).message}`,
    }
  }
}

// ============================================================================
// BUSCA LINKEDIN (slug determinístico)
// ============================================================================

async function buscarLinkedIn(
  ctx: BuscaCtx,
  registrar: (t: Tentativa) => void,
): Promise<{ resultado: PegadaDigital['linkedin']; fonte: string; erro?: string }> {
  try {
    const slugRazao = slugify(ctx.razaoSocial)
    const slugFantasia = ctx.nomeFantasia ? slugify(ctx.nomeFantasia) : ''

    const candidatos: string[] = []
    if (slugRazao.length >= 3) {
      candidatos.push(`https://www.linkedin.com/company/${slugRazao}`)
    }
    if (slugFantasia.length >= 3 && slugFantasia !== slugRazao) {
      candidatos.push(`https://www.linkedin.com/company/${slugFantasia}`)
    }

    for (const url of candidatos) {
      const v = await validarHTTP(url, ctx.timeoutMs)
      registrar({
        alvo: 'linkedin',
        fonte: 'linkedin_slug',
        url,
        ok: v.ok,
        status: v.status,
      })
      // LinkedIn retorna 999 quando bloqueia bot — isso indica que a URL
      // existe (LinkedIn responde, só não deixa scrapear). Tratamos como ok.
      if (v.ok || v.status === 999) {
        return {
          resultado: {
            existe: true,
            url,
            fonte: v.ok ? 'slug_razao_validado' : 'slug_inferido',
          },
          fonte: v.ok ? 'slug_razao_validado' : 'slug_inferido',
        }
      }
    }

    // Fallback final: mesmo sem validar, exibe slug como "inferido" pra vendedor checar.
    if (slugRazao.length >= 3) {
      const url = `https://www.linkedin.com/company/${slugRazao}`
      return {
        resultado: {
          existe: true,
          url,
          fonte: 'slug_inferido',
        },
        fonte: 'slug_inferido',
      }
    }

    return { resultado: { existe: false }, fonte: 'linkedin_nao_encontrado' }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'linkedin_erro',
      erro: `linkedin: ${(e as Error).message}`,
    }
  }
}

// ============================================================================
// BUSCA RECLAME AQUI (slug determinístico)
// ============================================================================

async function buscarReclameAqui(
  ctx: BuscaCtx,
  registrar: (t: Tentativa) => void,
): Promise<{ resultado: PegadaDigital['reclame_aqui']; fonte: string; erro?: string }> {
  try {
    const nome = ctx.nomeFantasia || ctx.razaoSocial
    const slug = slugify(nome)
    if (slug.length < 3) {
      return { resultado: { existe: false }, fonte: 'reclame_aqui_sem_slug' }
    }

    const url = `https://www.reclameaqui.com.br/empresa/${slug}/`
    const v = await validarHTTP(url, ctx.timeoutMs)
    registrar({
      alvo: 'reclame_aqui',
      fonte: 'reclame_aqui_slug',
      url,
      ok: v.ok,
      status: v.status,
    })

    if (v.ok) {
      return {
        resultado: { existe: true, url, fonte: 'slug_razao_validado' },
        fonte: 'slug_razao_validado',
      }
    }

    // Apresenta como inferido — usuário valida visualmente.
    return {
      resultado: { existe: true, url, fonte: 'slug_inferido' },
      fonte: 'slug_inferido',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'reclame_aqui_erro',
      erro: `reclame_aqui: ${(e as Error).message}`,
    }
  }
}

// ============================================================================
// BUSCA FACEBOOK (slug determinístico)
// ============================================================================

async function buscarFacebook(
  ctx: BuscaCtx,
  registrar: (t: Tentativa) => void,
): Promise<{ resultado: PegadaDigital['facebook']; fonte: string; erro?: string }> {
  try {
    const nome = ctx.nomeFantasia || ctx.razaoSocial
    const slug = slugify(nome)
    if (slug.length < 3) {
      return { resultado: { existe: false }, fonte: 'facebook_sem_slug' }
    }

    const url = `https://www.facebook.com/${slug}`
    // Facebook bloqueia HEAD agressivamente. Apresentamos sempre como inferido
    // pro vendedor validar visualmente.
    registrar({ alvo: 'facebook', fonte: 'facebook_slug', url, ok: false, status: 0 })

    return {
      resultado: { existe: true, url, fonte: 'slug_inferido' },
      fonte: 'slug_inferido',
    }
  } catch (e) {
    return {
      resultado: { existe: false },
      fonte: 'facebook_erro',
      erro: `facebook: ${(e as Error).message}`,
    }
  }
}

// ============================================================================
// ORQUESTRADOR (EXPORT PRINCIPAL)
// ============================================================================

/**
 * Busca pegada digital usando heurísticas DETERMINÍSTICAS (sem DuckDuckGo,
 * sem scraping de SERP). Sempre retorna algo apresentável — quando não dá
 * pra validar via HEAD, apresenta como "slug_inferido" e a UI mostra a
 * etiqueta de fonte pro vendedor revisar.
 *
 * Estratégia:
 *   - Site: email cadastral OpenCNPJ -> slug razão -> slug fantasia
 *   - LinkedIn: slug razão / fantasia em /company/SLUG (aceita 999 = bloqueio antibot)
 *   - Reclame Aqui: slug -> /empresa/SLUG/ (HEAD; se falhar, inferido)
 *   - Facebook: slug -> /SLUG (sempre inferido, FB bloqueia HEAD)
 *
 * Timeout: 6s/HEAD, 25s total. Tudo paralelo via Promise.allSettled.
 * Custo: 0.
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

  const tentativas: Tentativa[] = []
  const registrar = (t: Tentativa) => {
    tentativas.push(t)
  }

  const resultado: PegadaDigital = {
    site: { existe: false },
    linkedin: { existe: false },
    reclame_aqui: { existe: false },
    facebook: { existe: false },
    fontes_consultadas: [],
    custo_estimado_brl: 0,
    erros: [],
    debug: { tentativas },
  }

  if (!ctx.razaoSocial || ctx.razaoSocial.trim().length < 3) {
    resultado.erros.push('razao_social ausente ou muito curta')
    return resultado
  }

  try {
    const settled = await withTimeout(
      Promise.allSettled([
        buscarSiteOficial(ctx, registrar),
        buscarLinkedIn(ctx, registrar),
        buscarReclameAqui(ctx, registrar),
        buscarFacebook(ctx, registrar),
      ]),
      TOTAL_TIMEOUT_MS,
      'pegada_digital_global',
    )

    // Site
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

    // LinkedIn
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

    // Reclame Aqui
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

    // Facebook
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
    resultado.erros.push(`global: ${(e as Error).message}`)
  }

  return resultado
}
