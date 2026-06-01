// Cliente de busca de notícias em duas fontes GRÁTIS (sem chave / sem rate limit prático):
//
//   1) GDELT 2.0       GET https://api.gdeltproject.org/api/v2/doc/doc
//                          ?query={QUERY}&mode=artlist&format=json&sort=DateDesc&maxrecords=10
//                          (suporta filtros sourcelang:portuguese sourcecountry:BR)
//
//   2) Google News RSS GET https://news.google.com/rss/search
//                          ?q={QUERY}&hl=pt-BR&gl=BR&ceid=BR:pt-419
//
// Estratégia:
//   - Para cada keyword negativa (fraude, falência, golpe, …) roda uma query separada
//     "{razao_social}" + {keyword} em paralelo nas duas fontes.
//   - Também faz uma query "neutra" só com a razão social + sócios pra ter background.
//   - Agrega, dedup por título normalizado, ordena por data desc, limita em 30.
//   - Filtra notícias com mais de 5 anos.
//   - Detecta `keyword_match` no título ou no resumo.
//   - Timeout 10s por requisição (AbortController).
//   - Parser de RSS feito a mão com regex (sem dep nova).

export interface NoticiaItem {
  fonte: 'gdelt' | 'google-news'
  titulo: string
  link: string
  data: string | null
  origem: string | null // nome do veículo
  resumo?: string | null
  keyword_match?: string // qual keyword negativa bateu
}

export interface NoticiasResultado {
  ok: boolean
  total: number
  tem_alerta: boolean
  noticias: NoticiaItem[]
  keywords_que_bateram: string[]
  erros: string[]
}

const KEYWORDS_NEGATIVAS_DEFAULT = [
  'fraude',
  'falência',
  'golpe',
  'operação polícia',
  'MP investiga',
  'calote',
]

const TIMEOUT_MS = 10_000
const MAX_NOTICIAS = 30
const IDADE_MAXIMA_ANOS = 5

// ---------- helpers ----------

function so(v: unknown): string | null {
  const s = (v == null ? '' : String(v)).trim()
  return s || null
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 10))
      } catch {
        return ''
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16))
      } catch {
        return ''
      }
    })
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[(.*?)\]\]>$/s, '$1').trim()
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

function clean(s: string | null | undefined): string | null {
  if (s == null) return null
  const v = decodeHtmlEntities(stripCdata(stripTags(String(s)))).trim()
  return v || null
}

function normalizarTitulo(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tooOld(dataIso: string | null): boolean {
  if (!dataIso) return false
  const t = Date.parse(dataIso)
  if (Number.isNaN(t)) return false
  const cutoff = Date.now() - IDADE_MAXIMA_ANOS * 365.25 * 24 * 60 * 60 * 1000
  return t < cutoff
}

function detectarKeyword(
  titulo: string,
  resumo: string | null | undefined,
  keywords: string[],
): string | undefined {
  const haystack = `${titulo} ${resumo ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  for (const k of keywords) {
    const needle = k
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    if (needle && haystack.includes(needle)) return k
  }
  return undefined
}

async function fetchComTimeout(
  url: string,
  init?: RequestInit,
  ms = TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...(init || {}), signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// GDELT às vezes vem com "20240115T103000Z" — converte pra ISO.
function parseGdeltDate(s: string | null | undefined): string | null {
  if (!s) return null
  const v = String(s).trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    return `${y}-${mo}-${d}T${h}:${mi}:${se}Z`
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function parseRssDate(s: string | null | undefined): string | null {
  if (!s) return null
  const t = Date.parse(String(s))
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// ---------- GDELT ----------

async function buscarGdelt(query: string): Promise<NoticiaItem[]> {
  // Restringe a português/Brasil pra reduzir ruído.
  const fullQuery = `${query} sourcelang:portuguese sourcecountry:BR`
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc` +
    `?query=${encodeURIComponent(fullQuery)}` +
    `&mode=artlist&format=json&sort=DateDesc&maxrecords=10`

  const res = await fetchComTimeout(url, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []

  // GDELT às vezes retorna text/plain mesmo com format=json.
  const txt = await res.text().catch(() => '')
  if (!txt) return []
  let data: any = null
  try {
    data = JSON.parse(txt)
  } catch {
    return []
  }
  const arts: any[] = Array.isArray(data?.articles) ? data.articles : []

  return arts
    .map((a): NoticiaItem | null => {
      const titulo = clean(a?.title)
      const link = clean(a?.url)
      if (!titulo || !link) return null
      return {
        fonte: 'gdelt',
        titulo,
        link,
        data: parseGdeltDate(a?.seendate || a?.date || a?.pubdate),
        origem: clean(a?.domain || a?.sourcecommonname || a?.source) ?? null,
        resumo: clean(a?.socialimage ? null : a?.excerpt || a?.snippet) ?? null,
      }
    })
    .filter((x): x is NoticiaItem => x !== null)
}

// ---------- Google News RSS ----------

function parseGoogleNewsRss(xml: string): NoticiaItem[] {
  const items: NoticiaItem[] = []
  // Pega cada <item>...</item>
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]

    const titulo = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? '')
    const link = clean(/<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? '')
    const pubDate = clean(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1] ?? '')
    const description = clean(/<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(block)?.[1] ?? '')
    // <source url="...">Veículo</source>
    const sourceMatch = /<source\b[^>]*>([\s\S]*?)<\/source>/i.exec(block)
    const origem = clean(sourceMatch?.[1] ?? '')

    if (!titulo || !link) continue
    items.push({
      fonte: 'google-news',
      titulo,
      link,
      data: parseRssDate(pubDate),
      origem,
      resumo: description,
    })
  }
  return items
}

async function buscarGoogleNews(query: string): Promise<NoticiaItem[]> {
  const url =
    `https://news.google.com/rss/search` +
    `?q=${encodeURIComponent(query)}` +
    `&hl=pt-BR&gl=BR&ceid=BR:pt-419`

  const res = await fetchComTimeout(url, {
    headers: {
      Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (compatible; BranorteCRM-NewsBot/1.0; +https://branorte-crm.vercel.app)',
    },
  })
  if (!res.ok) return []

  const xml = await res.text().catch(() => '')
  if (!xml) return []
  return parseGoogleNewsRss(xml)
}

// ---------- agregação ----------

function dedupNoticias(noticias: NoticiaItem[]): NoticiaItem[] {
  const seen = new Map<string, NoticiaItem>()
  for (const n of noticias) {
    const key = normalizarTitulo(n.titulo).slice(0, 120)
    if (!key) continue
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, n)
      continue
    }
    // Mantém a com data mais recente (ou a que tem data).
    const tPrev = prev.data ? Date.parse(prev.data) : 0
    const tNew = n.data ? Date.parse(n.data) : 0
    if (tNew > tPrev) seen.set(key, n)
  }
  return Array.from(seen.values())
}

function ordenarPorDataDesc(noticias: NoticiaItem[]): NoticiaItem[] {
  return [...noticias].sort((a, b) => {
    const ta = a.data ? Date.parse(a.data) : 0
    const tb = b.data ? Date.parse(b.data) : 0
    return tb - ta
  })
}

// ---------- API pública ----------

export async function buscarNoticias(opts: {
  razaoSocial: string
  cnpj?: string
  nomesSocios?: string[]
  keywordsNegativas?: string[]
}): Promise<NoticiasResultado> {
  const razao = so(opts.razaoSocial)
  const erros: string[] = []
  if (!razao) {
    return {
      ok: false,
      total: 0,
      tem_alerta: false,
      noticias: [],
      keywords_que_bateram: [],
      erros: ['razaoSocial obrigatória'],
    }
  }

  const keywords = (opts.keywordsNegativas?.length
    ? opts.keywordsNegativas
    : KEYWORDS_NEGATIVAS_DEFAULT
  )
    .map((k) => so(k))
    .filter((k): k is string => !!k)

  const razaoQuoted = `"${razao.replace(/"/g, '')}"`

  // Query "background": razão + sócios (sem keyword negativa).
  const socios = (opts.nomesSocios || [])
    .map((s) => so(s))
    .filter((s): s is string => !!s)
    .slice(0, 3) // limita pra não estourar a query

  // Monta lista de queries: 1 background + 1 por keyword negativa.
  const queriesBackground: string[] = [razaoQuoted]
  if (socios.length > 0) {
    queriesBackground.push(`${razaoQuoted} ${socios.map((s) => `"${s}"`).join(' OR ')}`)
  }
  const queriesAlertas = keywords.map((k) => `${razaoQuoted} ${k}`)
  const todasQueries = [...queriesBackground, ...queriesAlertas]

  // Dispara tudo em paralelo (GDELT + Google News pra cada query).
  const jobs: Array<Promise<NoticiaItem[]>> = []
  for (const q of todasQueries) {
    jobs.push(
      buscarGdelt(q).catch((e) => {
        erros.push(`gdelt[${q}]: ${e?.message || e}`)
        return [] as NoticiaItem[]
      }),
    )
    jobs.push(
      buscarGoogleNews(q).catch((e) => {
        erros.push(`google-news[${q}]: ${e?.message || e}`)
        return [] as NoticiaItem[]
      }),
    )
  }

  const resultados = await Promise.all(jobs)
  const todas = resultados.flat()

  // Filtra notícias muito antigas.
  const noVigor = todas.filter((n) => !tooOld(n.data))

  // Dedup + ordena + limita.
  const dedup = dedupNoticias(noVigor)
  const ordenadas = ordenarPorDataDesc(dedup).slice(0, MAX_NOTICIAS)

  // Detecta keyword_match e marca alerta.
  const keywordsBateram = new Set<string>()
  for (const n of ordenadas) {
    const k = detectarKeyword(n.titulo, n.resumo, keywords)
    if (k) {
      n.keyword_match = k
      keywordsBateram.add(k)
    }
  }

  return {
    ok: true,
    total: ordenadas.length,
    tem_alerta: keywordsBateram.size > 0,
    noticias: ordenadas,
    keywords_que_bateram: Array.from(keywordsBateram),
    erros,
  }
}
