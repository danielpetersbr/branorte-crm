// Cliente do Apify Instagram Profile Scraper.
//
// ⚠️ LGPD — ATENÇÃO:
//   Perfis pessoais de sócios/diretores carregam dado pessoal (nome, foto,
//   localização, hábitos) e exigem base legal documentada (legítimo interesse
//   com LIA + transparência ao titular). MVP foca SÓ no perfil EMPRESARIAL
//   inferido pela razão social / nome fantasia, que é considerado dado de
//   pessoa jurídica (fora do escopo LGPD na maior parte das interpretações).
//   Perfil de sócio = Fase C (back-office, com aprovação jurídica antes).
//
// ENDPOINTS APIFY:
//   POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items
//        ?token={APIFY_TOKEN}
//   actorId recomendado: apify~instagram-profile-scraper
//     (URL encoded: o "/" do "apify/instagram-profile-scraper" vira "~")
//   Body: { "usernames": ["nomedoperfil"] }  ou  { "directUrls": [...] }
//   Custo: ~$0.003 por perfil (free tier $5/mês ≈ 1600 consultas)
//
// ESTRATÉGIA:
//   1) Tenta inferir handle pela razão social / nome fantasia (slugify).
//   2) Roda Apify com o(s) candidato(s) — se vier dado, ótimo.
//   3) Se não veio nada, faz busca Google "site:instagram.com {razao}" e
//      pega o 1º handle do resultado, depois chama Apify de novo.
//   4) Se ainda nada → { ok: true, perfil_encontrado: false }.
//
//   Custo é incrementado a cada CHAMADA ao actor (não por candidato dentro
//   do mesmo run), pra refletir o billing real do Apify.
//
// CONFIG:
//   env APIFY_TOKEN (lido de process.env). Ausente → graceful error.
//   timeout default 25s (Apify sync pode demorar 5–15s).

export interface InstagramRedFlag {
  id: string
  descricao: string
  severidade: 'baixa' | 'media' | 'alta'
}

export interface InstagramPerfilResultado {
  ok: boolean
  perfil_encontrado: boolean
  handle?: string | null // "@nomeperfil" sem @
  url?: string | null // https://instagram.com/perfil
  nome_exibicao?: string | null // nome do perfil
  bio?: string | null
  categoria?: string | null // ex: "Empresa local", "Marca"
  seguidores?: number
  seguindo?: number
  total_posts?: number
  data_ultimo_post?: string | null // ISO date
  privado?: boolean
  verificado?: boolean
  email_bio?: string | null // se na bio
  telefone_bio?: string | null
  site_bio?: string | null
  fotos_perfil_url?: string | null
  red_flags?: InstagramRedFlag[]
  custo_estimado_usd?: number // pra accounting
  erro?: string | null
  fonte?:
    | 'apify-direct'
    | 'apify-via-google'
    | 'inferido_http'
    | 'inferido_slug_sem_validacao'
    | 'nao_localizado'
    | null
}

const APIFY_ACTOR_ID = 'apify~instagram-profile-scraper'
const APIFY_BASE = 'https://api.apify.com/v2'
const TIMEOUT_DEFAULT_MS = 25_000
const CUSTO_POR_RUN_USD = 0.003

// Faturamento declarado que dispara red flag de mismatch (R$ 1M/ano).
const FATURAMENTO_MISMATCH_THRESHOLD_BRL = 1_000_000

// ---------- helpers básicos ----------

function so(v: unknown): string | null {
  const s = (v == null ? '' : String(v)).trim()
  return s || null
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function slugifyHandle(s: string): string {
  // IG handle: lowercase, [a-z0-9._], sem espaço, max 30.
  return stripDiacritics(s.toLowerCase())
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9._]+/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 30)
}

function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let h = String(raw).trim()
  // Aceita @nome, https://instagram.com/nome, https://www.instagram.com/nome/
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
  h = h.replace(/^@/, '')
  h = h.replace(/\/.*$/, '') // remove path depois do handle
  h = h.replace(/\?.*$/, '') // remove query
  h = h.toLowerCase().trim()
  if (!/^[a-z0-9._]{1,30}$/.test(h)) return null
  // Filtra paths que não são handle.
  const blacklist = new Set([
    'p',
    'reel',
    'reels',
    'tv',
    'explore',
    'accounts',
    'directory',
    'stories',
    'about',
    'developer',
    'developers',
    'legal',
    'privacy',
    'terms',
    'help',
  ])
  if (blacklist.has(h)) return null
  return h
}

async function fetchComTimeout(
  url: string,
  init?: RequestInit,
  ms = TIMEOUT_DEFAULT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...(init || {}), signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// ---------- extração de bio (email / fone / site) ----------

function extrairEmailDaBio(bio: string | null | undefined): string | null {
  if (!bio) return null
  const m = bio.match(/[\w.+\-]+@[\w\-]+\.[\w\-.]+/)
  return m ? m[0].toLowerCase() : null
}

function extrairTelefoneDaBio(bio: string | null | undefined): string | null {
  if (!bio) return null
  // Captura formatos BR: (XX) XXXXX-XXXX, XX XXXXXXXXX, +55..., etc.
  const cleaned = bio.replace(/[^\d+()\-\s]/g, ' ')
  const m = cleaned.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/)
  if (!m) return null
  const onlyDigits = m[0].replace(/\D/g, '')
  if (onlyDigits.length < 10 || onlyDigits.length > 13) return null
  return m[0].trim()
}

function extrairSiteDaBio(
  bio: string | null | undefined,
  externalUrl: string | null | undefined,
): string | null {
  const direct = so(externalUrl)
  if (direct) return direct
  if (!bio) return null
  const m = bio.match(/https?:\/\/[^\s]+/i)
  return m ? m[0] : null
}

// ---------- red flags ----------

function calcularRedFlags(opts: {
  perfilEncontrado: boolean
  privado: boolean
  totalPosts: number | null
  seguidores: number | null
  dataUltimoPost: string | null
  faturamentoDeclaradoBrl?: number | null
}): InstagramRedFlag[] {
  const flags: InstagramRedFlag[] = []
  if (!opts.perfilEncontrado) return flags // sem perfil ≠ red flag

  // 0 posts ou perfil completamente vazio → alta
  if (opts.totalPosts !== null && opts.totalPosts === 0) {
    flags.push({
      id: 'ig_zero_posts',
      descricao: 'Perfil sem nenhum post publicado',
      severidade: 'alta',
    })
  }

  // Conta nova/baixa atividade: total_posts < 5 + sem post recente → media
  // (proxy pra "perfil criado há pouco" — Apify não retorna data de criação)
  if (
    opts.totalPosts !== null &&
    opts.totalPosts > 0 &&
    opts.totalPosts < 5 &&
    opts.dataUltimoPost
  ) {
    const dias = diasDesde(opts.dataUltimoPost)
    if (dias !== null && dias > 90) {
      flags.push({
        id: 'ig_perfil_quase_vazio',
        descricao:
          'Perfil com menos de 5 posts e sem atividade recente (proxy de conta nova)',
        severidade: 'media',
      })
    }
  }

  // Sem post há 6+ meses → media
  if (opts.dataUltimoPost) {
    const dias = diasDesde(opts.dataUltimoPost)
    if (dias !== null && dias >= 180) {
      flags.push({
        id: 'ig_sem_post_recente',
        descricao: `Sem novo post há ${dias} dias (>= 6 meses)`,
        severidade: 'media',
      })
    }
  }

  // Faturamento declarado >R$ 1M mas < 50 seguidores → media
  if (
    opts.faturamentoDeclaradoBrl != null &&
    opts.faturamentoDeclaradoBrl >= FATURAMENTO_MISMATCH_THRESHOLD_BRL &&
    opts.seguidores !== null &&
    opts.seguidores < 50
  ) {
    flags.push({
      id: 'ig_seguidores_vs_faturamento',
      descricao:
        'Empresa declara faturar > R$ 1 mi mas tem menos de 50 seguidores no Instagram',
      severidade: 'media',
    })
  }

  // Perfil privado → baixa (marca pra revisão manual)
  if (opts.privado) {
    flags.push({
      id: 'ig_perfil_privado',
      descricao: 'Perfil privado — revisar manualmente',
      severidade: 'baixa',
    })
  }

  return flags
}

function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
}

// ---------- candidatos de handle (inferência) ----------

// Palavras-chave de setor → sufixos que costumam aparecer em handles BR
// (descoberta empírica: @branorte_metalurgica, @padaria_oficial, etc).
const SETORES_SUFIXOS: Array<{ regex: RegExp; sufixos: string[] }> = [
  {
    regex: /metalurg|metal[óo]rgic|usinag|caldeir|solda|sider/i,
    sufixos: ['metalurgica', 'metal', 'industria', 'ind', 'fabrica'],
  },
  {
    regex: /ra[çc][ãa]o|nutri[çc][ãa]o animal|alimenta[çc][ãa]o animal|pet food|av[ií]col|su[ií]nocult|bovinocult/i,
    sufixos: ['racao', 'nutricao', 'fabrica', 'industria', 'ind'],
  },
  {
    regex: /pl[áa]stic|polim|injecao plastica|inje[çc][ãa]o pl[áa]stic/i,
    sufixos: ['plasticos', 'polimeros', 'industria', 'ind', 'fabrica'],
  },
  {
    regex: /m[áa]quin|equipament|industrial|fabrica/i,
    sufixos: ['maquinas', 'industria', 'ind', 'fabrica', 'oficial'],
  },
  {
    regex: /aliment|padari|confeitari|panifica/i,
    sufixos: ['alimentos', 'oficial', 'fabrica'],
  },
  {
    regex: /constru[çc][ãa]o|engenhari|construtor/i,
    sufixos: ['construcoes', 'engenharia', 'oficial'],
  },
  {
    regex: /com[ée]rcio|varej|atacad/i,
    sufixos: ['oficial', 'loja', 'store'],
  },
]

// Sufixos genéricos sempre testados (não dependem de setor).
const SUFIXOS_GENERICOS = [
  'metalurgica',
  'oficial',
  'industria',
  'maquinas',
  'fabrica',
  'ind',
]

function detectarSufixosSetoriais(setorHint: string | null | undefined): string[] {
  const s = so(setorHint)
  if (!s) return []
  const norm = stripDiacritics(s.toLowerCase())
  const out = new Set<string>()
  for (const { regex, sufixos } of SETORES_SUFIXOS) {
    if (regex.test(norm)) {
      for (const sf of sufixos) out.add(sf)
    }
  }
  return Array.from(out)
}

function gerarCandidatosHandle(
  razaoSocial: string,
  nomeFantasia: string | null | undefined,
  setorHint?: string | null,
): string[] {
  const candidatos = new Set<string>()
  const fontes: string[] = []

  if (nomeFantasia) fontes.push(nomeFantasia)
  fontes.push(razaoSocial)

  // Sufixos a combinar com a primeira palavra: setor (se reconhecido)
  // + genéricos (sempre testados, baixo custo já que HEAD filtra).
  const sufixosSetor = detectarSufixosSetoriais(setorHint)
  const sufixosCombinados = Array.from(new Set([...sufixosSetor, ...SUFIXOS_GENERICOS]))

  for (const fonte of fontes) {
    const limpo = stripDiacritics(fonte.toLowerCase())
      // Remove sufixos societários comuns.
      .replace(
        /\b(ltda|me|epp|eireli|s\/?a|sa|s\.a\.|comercio|com\.|industria|ind\.|servicos|do brasil)\b\.?/g,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim()

    // Variação 1: tudo junto (espaços removidos).
    const v1 = slugifyHandle(limpo)
    if (v1.length >= 3) candidatos.add(v1)

    // Variação 1b (NOVA): tudo junto + sufixo setorial/genérico.
    // Crucial pra nome fantasia composto: "BRA NORTE" → "branorte" → "branorte_metalurgica".
    if (v1.length >= 3) {
      for (const sf of sufixosCombinados) {
        const comUnderscore = `${v1}_${sf}`.slice(0, 30)
        const comPonto = `${v1}.${sf}`.slice(0, 30)
        if (comUnderscore.length >= 3 && /^[a-z0-9._]+$/.test(comUnderscore)) {
          candidatos.add(comUnderscore)
        }
        if (comPonto.length >= 3 && /^[a-z0-9._]+$/.test(comPonto)) {
          candidatos.add(comPonto)
        }
      }
    }

    // Variação 2: primeira palavra significativa.
    const primeira = limpo.split(/\s+/)[0]
    const primeiraSlug = primeira ? slugifyHandle(primeira) : ''
    if (primeiraSlug.length >= 3 && primeiraSlug !== v1) {
      candidatos.add(primeiraSlug)

      // Variação 2b: primeira_palavra + sufixo setorial/genérico.
      for (const sf of sufixosCombinados) {
        const comUnderscore = `${primeiraSlug}_${sf}`.slice(0, 30)
        const comPonto = `${primeiraSlug}.${sf}`.slice(0, 30)
        if (comUnderscore.length >= 3 && /^[a-z0-9._]+$/.test(comUnderscore)) {
          candidatos.add(comUnderscore)
        }
        if (comPonto.length >= 3 && /^[a-z0-9._]+$/.test(comPonto)) {
          candidatos.add(comPonto)
        }
      }
    }

    // Variação 3: palavras separadas por "_" ou ".".
    const palavras = limpo
      .split(/\s+/)
      .filter((p) => p.length > 1)
      .map(slugifyHandle)
      .filter((p) => p.length > 0)
    if (palavras.length >= 2) {
      candidatos.add(palavras.join('_').slice(0, 30))
      candidatos.add(palavras.join('.').slice(0, 30))
    }
  }

  // Tira candidatos genéricos demais.
  const blacklist = new Set(['', 'a', 'o', 'de', 'da', 'do', 'e'])
  return Array.from(candidatos).filter((c) => c.length >= 3 && !blacklist.has(c))
}

// ---------- candidato adicional via domínio do site (descoberta na pegada) ----------

/**
 * Gera candidatos de handle baseado no domínio do site oficial da empresa.
 *
 * Exemplos:
 *   "branorte.com" / "https://branorte.com.br" -> ["branorte",
 *      "branorte_metalurgica", "branorte_oficial", ...
 *      "branorte.metalurgica", "branorte.oficial", ...]
 *
 * Provedores genéricos (gmail.com etc) NÃO se aplicam aqui — é domínio de SITE,
 * não de email. Mas faz sentido filtrar TLDs/subdomínios populares como "www".
 */
function gerarCandidatosDeDominio(
  dominioSite: string | null | undefined,
  setorHint?: string | null,
): string[] {
  const raw = so(dominioSite)
  if (!raw) return []

  // Normaliza: tira protocolo, www, path, query.
  let host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/\?.*$/, '')
    .toLowerCase()
    .trim()
  if (!host) return []

  const partes = host.split('.').filter(Boolean)
  if (partes.length === 0) return []

  // Tira sufixos comuns (.com, .br, .net etc) pra pegar o "core" do domínio.
  const sufixos = new Set(['com', 'br', 'net', 'org', 'co', 'io', 'app', 'biz'])
  let core: string | null = null
  for (const p of partes) {
    if (p === 'www') continue
    if (sufixos.has(p)) continue
    core = p
    break
  }
  if (!core) return []

  const coreSlug = slugifyHandle(core)
  if (coreSlug.length < 3) return []

  const candidatos = new Set<string>()
  candidatos.add(coreSlug)

  // Sufixos: setor (se reconhecido) + genéricos
  const sufixosSetor = detectarSufixosSetoriais(setorHint)
  const sufixosCombinados = Array.from(new Set([...sufixosSetor, ...SUFIXOS_GENERICOS]))

  for (const sf of sufixosCombinados) {
    const comUnderscore = `${coreSlug}_${sf}`.slice(0, 30)
    const comPonto = `${coreSlug}.${sf}`.slice(0, 30)
    if (comUnderscore.length >= 3 && /^[a-z0-9._]+$/.test(comUnderscore)) {
      candidatos.add(comUnderscore)
    }
    if (comPonto.length >= 3 && /^[a-z0-9._]+$/.test(comPonto)) {
      candidatos.add(comPonto)
    }
  }

  return Array.from(candidatos)
}

// ---------- candidato adicional via email cadastral ----------

/**
 * Tenta extrair um handle plausível a partir do email cadastral.
 *
 * Exemplos:
 *   "contato@mbranorte.com.br" -> "mbranorte"
 *   "vendas@padariaJoao.com"   -> "padariajoao"
 *   "joao@gmail.com"           -> null  (provedor genérico, ignora)
 *   "atendimento@sub.foo.com"  -> "foo" (pega só o segundo nível)
 */
function gerarCandidatoDeEmail(email: string | null | undefined): string | null {
  const e = so(email)
  if (!e) return null
  const m = e.match(/@([\w\-.]+)\.[\w\-.]+$/i)
  if (!m) return null
  const dominioCompleto = e.split('@')[1]?.toLowerCase() ?? ''
  if (!dominioCompleto) return null

  // Provedores genéricos: descarta (não é o handle da empresa).
  const provedoresGenericos = new Set([
    'gmail.com',
    'hotmail.com',
    'hotmail.com.br',
    'outlook.com',
    'outlook.com.br',
    'yahoo.com',
    'yahoo.com.br',
    'live.com',
    'live.com.br',
    'uol.com.br',
    'bol.com.br',
    'ig.com.br',
    'terra.com.br',
    'globo.com',
    'icloud.com',
    'me.com',
    'msn.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
    'zoho.com',
  ])
  if (provedoresGenericos.has(dominioCompleto)) return null

  // Pega o "core" do domínio: tira sufixos comuns ".com.br", ".com", ".net.br" etc.
  // Estratégia simples: split por "." e pega o segmento mais relevante (1º se SLD único, ou penúltimo se SLD composto).
  const partes = dominioCompleto.split('.').filter(Boolean)
  if (partes.length === 0) return null
  // Heurística: se for tipo ["mbranorte","com","br"] pega "mbranorte".
  // Se for tipo ["sub","mbranorte","com","br"] pega "mbranorte" (penúltimo antes do TLD/SLD).
  // Pega o primeiro segmento que NÃO seja "www" ou sufixo conhecido.
  const sufixos = new Set(['com', 'br', 'net', 'org', 'co', 'io', 'app', 'biz'])
  let core: string | null = null
  for (const p of partes) {
    if (p === 'www') continue
    if (sufixos.has(p)) continue
    core = p
    break
  }
  if (!core) return null
  const h = slugifyHandle(core)
  return h.length >= 3 ? h : null
}

// ---------- HTTP HEAD heurístico (pré-Apify, grátis) ----------

/**
 * Faz HEAD em https://www.instagram.com/<handle>/ pra verificar existência.
 *
 * Comportamento esperado do IG:
 *   - 200 OK            → handle existe (login wall, mas página existe)
 *   - 302 redirect      → existe (provavelmente redirect pra login)
 *   - 404 Not Found     → não existe
 *   - 429 / 403 / 401   → rate-limit ou bloqueio (servidor existe, INCONCLUSIVO)
 *
 * Importante: User-Agent realista é necessário ou IG retorna 4xx genérico.
 * IPs de cloud (Vercel/AWS) são fortemente bloqueados pelo IG → 429/403 frequente.
 * Timeout curto (6s) — se IG demorar, não vale a pena bloquear o run.
 *
 * Retorna:
 *   - ok: true se 200/302 (handle confirmado)
 *   - inconclusivo: true se 401/403/429 (IG bloqueou nossa requisição mas
 *     handle PODE existir — caller deve tentar Apify mesmo assim)
 */
async function tentarHttpHead(
  handle: string,
  timeoutMs = 6000,
): Promise<{ ok: boolean; status?: number; inconclusivo?: boolean }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const resp = await fetch(`https://www.instagram.com/${handle}/`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)
    const status = resp.status
    // Considera "existe" se 200 ou 302 (redirect pra login wall).
    const ok = status === 200 || status === 302
    // Status que indicam bloqueio do IG (não conclusivo sobre existência do handle)
    const inconclusivo = status === 401 || status === 403 || status === 429 || status === 503
    return { ok, status, inconclusivo }
  } catch {
    // Erro de rede: inconclusivo (não sabemos se existe ou não)
    return { ok: false, inconclusivo: true }
  }
}

// ---------- busca via Google (fallback) ----------

async function buscarHandleViaGoogle(razaoSocial: string): Promise<string | null> {
  // Usa Google News? Não — usa busca via DuckDuckGo HTML, que costuma deixar
  // raspar resultados sem auth. Se falhar, retorna null e segue a vida.
  const query = `site:instagram.com ${razaoSocial}`
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  try {
    const res = await fetchComTimeout(
      url,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent':
            'Mozilla/5.0 (compatible; BranorteCRM-DueDiligence/1.0; +https://branorte-crm.vercel.app)',
        },
      },
      10_000,
    )
    if (!res.ok) return null
    const html = await res.text().catch(() => '')
    if (!html) return null

    // DuckDuckGo HTML usa /l/?uddg=ENCODED_URL nos links. Vamos extrair tudo
    // que aponta pra instagram.com e pegar o primeiro handle válido.
    const candidatos: string[] = []
    const re = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const h = normalizeHandle(m[1])
      if (h) candidatos.push(h)
    }
    // Pega o mais frequente.
    if (candidatos.length === 0) return null
    const freq = new Map<string, number>()
    for (const c of candidatos) freq.set(c, (freq.get(c) ?? 0) + 1)
    let best: string | null = null
    let bestN = 0
    for (const [h, n] of freq) {
      if (n > bestN) {
        best = h
        bestN = n
      }
    }
    return best
  } catch {
    return null
  }
}

// ---------- chamada ao actor Apify ----------

interface ApifyProfileRaw {
  username?: string | null
  fullName?: string | null
  biography?: string | null
  businessCategoryName?: string | null
  categoryName?: string | null
  followersCount?: number | null
  followsCount?: number | null
  postsCount?: number | null
  private?: boolean | null
  verified?: boolean | null
  profilePicUrl?: string | null
  profilePicUrlHD?: string | null
  externalUrl?: string | null
  publicEmail?: string | null
  publicPhoneNumber?: string | null
  businessEmail?: string | null
  businessPhoneNumber?: string | null
  latestPosts?: Array<{ timestamp?: string | null; takenAtTimestamp?: number | null }> | null
  latestIgtvVideos?: unknown
  url?: string | null
  inputUrl?: string | null
}

async function rodarApifyActor(
  usernames: string[],
  token: string,
  timeoutMs: number,
): Promise<ApifyProfileRaw[]> {
  if (usernames.length === 0) return []
  const url = `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  const body = JSON.stringify({ usernames })
  const res = await fetchComTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    },
    timeoutMs,
  )
  if (!res.ok) {
    // Apify retorna 400 quando username não existe; trata como vazio.
    if (res.status === 400 || res.status === 404) return []
    throw new Error(`apify_http_${res.status}`)
  }
  const data = await res.json().catch(() => null)
  if (!Array.isArray(data)) return []
  return data as ApifyProfileRaw[]
}

function escolherMelhorPerfil(perfis: ApifyProfileRaw[]): ApifyProfileRaw | null {
  if (perfis.length === 0) return null
  // Apify às vezes retorna placeholders quando username não existe — filtra.
  // Aceita perfil com APENAS username + (followersCount OU postsCount OU fullName OU biography).
  // Antes exigia (followersCount OU postsCount), o que descartava perfis recém-criados
  // ou perfis privados com dados parciais.
  const validos = perfis.filter(
    (p) =>
      p &&
      so(p.username) &&
      (p.followersCount != null ||
        p.postsCount != null ||
        so(p.fullName) ||
        so(p.biography) ||
        p.private === true ||
        p.verified === true),
  )
  if (validos.length === 0) return null
  // Pega o com mais seguidores (proxy de "perfil real / certo").
  validos.sort((a, b) => (b.followersCount ?? 0) - (a.followersCount ?? 0))
  return validos[0]
}

function mapearPerfil(
  raw: ApifyProfileRaw,
  fonte: 'apify-direct' | 'apify-via-google' | 'inferido_http',
  custoUsd: number,
  faturamentoDeclaradoBrl: number | null | undefined,
): InstagramPerfilResultado {
  const handle = normalizeHandle(raw.username)
  const bio = so(raw.biography)
  const totalPosts = typeof raw.postsCount === 'number' ? raw.postsCount : null
  const seguidores = typeof raw.followersCount === 'number' ? raw.followersCount : null
  const dataUltimoPost = extrairDataUltimoPost(raw)
  const privado = raw.private === true
  const verificado = raw.verified === true

  const red_flags = calcularRedFlags({
    perfilEncontrado: true,
    privado,
    totalPosts,
    seguidores,
    dataUltimoPost,
    faturamentoDeclaradoBrl: faturamentoDeclaradoBrl ?? null,
  })

  return {
    ok: true,
    perfil_encontrado: true,
    handle: handle ?? null,
    url: handle ? `https://instagram.com/${handle}` : (so(raw.url) ?? null),
    nome_exibicao: so(raw.fullName),
    bio,
    categoria: so(raw.businessCategoryName) ?? so(raw.categoryName),
    seguidores: seguidores ?? undefined,
    seguindo: typeof raw.followsCount === 'number' ? raw.followsCount : undefined,
    total_posts: totalPosts ?? undefined,
    data_ultimo_post: dataUltimoPost,
    privado,
    verificado,
    email_bio:
      so(raw.publicEmail) ?? so(raw.businessEmail) ?? extrairEmailDaBio(bio),
    telefone_bio:
      so(raw.publicPhoneNumber) ??
      so(raw.businessPhoneNumber) ??
      extrairTelefoneDaBio(bio),
    site_bio: extrairSiteDaBio(bio, raw.externalUrl),
    fotos_perfil_url: so(raw.profilePicUrlHD) ?? so(raw.profilePicUrl),
    red_flags,
    custo_estimado_usd: custoUsd,
    erro: null,
    fonte,
  }
}

function extrairDataUltimoPost(raw: ApifyProfileRaw): string | null {
  const posts = raw.latestPosts
  if (!Array.isArray(posts) || posts.length === 0) return null
  let melhor: number | null = null
  for (const p of posts) {
    if (!p) continue
    if (typeof p.timestamp === 'string') {
      const t = Date.parse(p.timestamp)
      if (!Number.isNaN(t) && (melhor === null || t > melhor)) melhor = t
    }
    if (typeof p.takenAtTimestamp === 'number') {
      // takenAtTimestamp vem em segundos (Unix).
      const t = p.takenAtTimestamp * 1000
      if (melhor === null || t > melhor) melhor = t
    }
  }
  return melhor === null ? null : new Date(melhor).toISOString()
}

// ---------- API pública ----------

export async function buscarInstagramEmpresa(opts: {
  razaoSocial: string
  nomeFantasia?: string | null
  cnpj?: string // só pra log
  timeoutMs?: number
  /** Faturamento declarado pra detectar mismatch de seguidores (em BRL). */
  faturamentoDeclaradoBrl?: number | null
  /**
   * Email cadastral da empresa (ex: do OpenCNPJ). Usado pra inferir handle
   * adicional via domínio (ex: contato@mbranorte.com.br -> "mbranorte").
   * Provedores genéricos (gmail/hotmail/etc) são ignorados.
   */
  emailCadastral?: string | null
  /**
   * Domínio do site oficial da empresa (descoberto na pegada digital). Gera
   * candidatos adicionais: o "core" do domínio + variantes com sufixo setorial
   * ("metalurgica", "oficial", "fabrica" etc) tanto com "_" quanto com ".".
   * Descoberta empírica: @branorte_metalurgica é o handle real, mas só
   * "branorte" puro não encontra. Ex: "branorte.com.br" -> ["branorte",
   * "branorte_metalurgica", "branorte_oficial", "branorte.metalurgica", ...].
   */
  dominioSite?: string | null
  /**
   * Hint setorial pra refinar sufixos (CNAE descrição, atividade principal etc).
   * Ex: "Fabricação de máquinas e equipamentos" → sufixos "maquinas",
   * "industria", "fabrica" priorizados. Se ausente, usa sufixos genéricos.
   */
  setorHint?: string | null
}): Promise<InstagramPerfilResultado> {
  const razao = so(opts.razaoSocial)
  if (!razao) {
    return {
      ok: false,
      perfil_encontrado: false,
      red_flags: [],
      custo_estimado_usd: 0,
      erro: 'razaoSocial obrigatória',
      fonte: null,
    }
  }

  const token = so(process.env.APIFY_TOKEN)
  const apifyConfigured = !!token
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_DEFAULT_MS
  const fantasia = so(opts.nomeFantasia)
  let custoTotalUsd = 0

  // ===== Gera candidatos (slug + email cadastral + domínio do site) =====
  const candidatosSlug = gerarCandidatosHandle(razao, fantasia, opts.setorHint)
  const candidatoDeEmail = gerarCandidatoDeEmail(opts.emailCadastral)
  const candidatosDominio = gerarCandidatosDeDominio(opts.dominioSite, opts.setorHint)

  // Ordem de prioridade:
  //   1) Email cadastral (sinal forte da empresa)
  //   2) Core do domínio do site (sinal MUITO forte — site oficial é a marca)
  //   3) Variantes do domínio com sufixo setorial (branorte_metalurgica etc)
  //   4) Slugs da razão/fantasia
  const candidatosOrdenados: string[] = []
  if (candidatoDeEmail) candidatosOrdenados.push(candidatoDeEmail)
  for (const c of candidatosDominio) {
    if (!candidatosOrdenados.includes(c)) candidatosOrdenados.push(c)
  }
  for (const c of candidatosSlug) {
    if (!candidatosOrdenados.includes(c)) candidatosOrdenados.push(c)
  }

  if (candidatosOrdenados.length === 0) {
    // Sem nenhum candidato — sem como tentar. Retorna gracefully.
    if (!apifyConfigured) {
      return {
        ok: false,
        perfil_encontrado: false,
        red_flags: [],
        custo_estimado_usd: 0,
        erro: 'token_nao_configurado',
        fonte: null,
      }
    }
    return {
      ok: true,
      perfil_encontrado: false,
      red_flags: [],
      custo_estimado_usd: 0,
      erro: null,
      fonte: 'nao_localizado',
    }
  }

  // ===== ETAPA 0 (NOVA): HTTP HEAD pra cada candidato ANTES de queimar Apify =====
  // Custa zero. Filtra candidatos que claramente não existem (404) e identifica
  // ao menos um que responde 200/302 (existe — login wall conta como existe).
  //
  // Limite expandido de 6 → 10 porque com sufixos setoriais (metalurgica,
  // oficial, fabrica etc) a lista de candidatos cresceu, e os candidatos REAIS
  // ficam no meio (ex: branorte_metalurgica é o 3º/4º na ordem).
  const candidatosConfirmados: string[] = []
  for (const c of candidatosOrdenados.slice(0, 10)) {
    const head = await tentarHttpHead(c)
    if (head.ok) {
      candidatosConfirmados.push(c)
    }
    // Se NÃO ok, pode ser 404 (inválido) ou rate-limit (inconclusivo).
    // De qualquer jeito, não adiciona — economiza Apify.
  }

  // ===== ETAPA 1: Apify direto, priorizando handles confirmados via HEAD =====
  if (apifyConfigured && token) {
    // Se algum HEAD confirmou, usa SÓ esses (máximo 3) — economia direta.
    // Se NENHUM confirmou (provavelmente IG rate-limit), prioriza candidatos COM
    // sufixo setorial (_metalurgica, _oficial) — empiricamente são os corretos.
    // Handles "puros" (branorte) tendem a ser squatted ou perfis pessoais.
    const candidatosComSufixo = candidatosOrdenados.filter((c) => /[._]/.test(c))
    const candidatosPuros = candidatosOrdenados.filter((c) => !/[._]/.test(c))
    const paraApify =
      candidatosConfirmados.length > 0
        ? candidatosConfirmados.slice(0, 3)
        : [...candidatosComSufixo.slice(0, 4), ...candidatosPuros.slice(0, 1)].slice(0, 5)

    try {
      custoTotalUsd += CUSTO_POR_RUN_USD * Math.min(paraApify.length, 3)
      const perfis = await rodarApifyActor(paraApify, token, timeoutMs)
      const melhor = escolherMelhorPerfil(perfis)
      if (melhor) {
        return mapearPerfil(
          melhor,
          'apify-direct',
          custoTotalUsd,
          opts.faturamentoDeclaradoBrl,
        )
      }
    } catch (e) {
      // Erro no Apify direto não é fatal — tentamos fallbacks.
      const _err = e instanceof Error ? e.message : String(e)
      // segue
    }
  } else if (candidatosConfirmados.length > 0) {
    // ===== Sem Apify configurado, mas HEAD confirmou: retorna inferido_http =====
    const handle = candidatosConfirmados[0]
    return {
      ok: true,
      perfil_encontrado: true,
      handle,
      url: `https://instagram.com/${handle}`,
      // Sem dados ricos — só temos a URL confirmada via HEAD.
      nome_exibicao: null,
      bio: null,
      categoria: null,
      privado: false,
      verificado: false,
      email_bio: null,
      telefone_bio: null,
      site_bio: null,
      fotos_perfil_url: null,
      red_flags: [], // sem dados pra calcular flags
      custo_estimado_usd: 0,
      erro: null,
      fonte: 'inferido_http',
    }
  }

  // ===== ETAPA 2: handle via Google/DuckDuckGo (só se Apify estiver disponível) =====
  if (apifyConfigured && token) {
    const handleViaGoogle = await buscarHandleViaGoogle(razao)
    if (handleViaGoogle) {
      try {
        custoTotalUsd += CUSTO_POR_RUN_USD
        const perfis = await rodarApifyActor([handleViaGoogle], token, timeoutMs)
        const melhor = escolherMelhorPerfil(perfis)
        if (melhor) {
          return mapearPerfil(
            melhor,
            'apify-via-google',
            custoTotalUsd,
            opts.faturamentoDeclaradoBrl,
          )
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        return {
          ok: false,
          perfil_encontrado: false,
          red_flags: [],
          custo_estimado_usd: custoTotalUsd,
          erro: `apify_falhou: ${err}`,
          fonte: null,
        }
      }
    }
  }

  // ===== Sem Apify configurado: retorna token_nao_configurado =====
  if (!apifyConfigured) {
    return {
      ok: false,
      perfil_encontrado: false,
      red_flags: [],
      custo_estimado_usd: 0,
      erro: 'token_nao_configurado',
      fonte: null,
    }
  }

  // ===== FALLBACK FINAL: Apify rodou mas não achou perfil =====
  //
  // MUDANÇA (Fix #3): NÃO inventa mais handle com base em chute (`primeira_palavra`,
  // `primeira.palavra`, etc). Descoberta empírica: muitas PMEs BR usam handles
  // com sufixo setorial (ex: @branorte_metalurgica), então o slug puro
  // ("branorte") leva a perfil errado/inexistente. Se Apify rodou com todos os
  // candidatos plausíveis (incluindo variantes com underscore/ponto + setor) e
  // não achou perfil válido, é melhor declarar "não localizado" do que devolver
  // um handle especulativo que o vendedor vai abrir e ver perfil errado.
  //
  // FALLBACK PRAGMÁTICO: se há candidato com sufixo setorial conhecido
  // (_metalurgica, _oficial, _industria, etc.), apresenta como INFERIDO.
  // Empiricamente, esses formatos são quase sempre válidos em pt-BR pra PMEs
  // industriais. Vendedor confere visualmente. Se o handle estiver errado,
  // o usuario clica e descobre — perda baixa.
  const sufixosSetoriaisConhecidos = /(_|\.)(metalurgica|oficial|industria|maquinas|fabrica|ind|racao|nutricao|alimentos|construcoes|engenharia)$/
  const candidatoInferido = candidatosOrdenados.find((c) => sufixosSetoriaisConhecidos.test(c))
  if (candidatoInferido) {
    return {
      ok: true,
      perfil_encontrado: true,
      handle: candidatoInferido,
      url: `https://www.instagram.com/${candidatoInferido}/`,
      red_flags: [],
      custo_estimado_usd: custoTotalUsd,
      erro: null,
      fonte: 'inferido_slug_sem_validacao',
    }
  }
  return {
    ok: true,
    perfil_encontrado: false,
    red_flags: [],
    custo_estimado_usd: custoTotalUsd,
    erro: null,
    fonte: 'nao_localizado',
  }
}
