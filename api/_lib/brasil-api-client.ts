// Cliente da BrasilAPI (https://brasilapi.com.br) — APIs públicas BR via fetch.
//
// Endpoints usados aqui:
//   - CEP v2 :  GET https://brasilapi.com.br/api/cep/v2/{cep}
//   - DDD v1 :  GET https://brasilapi.com.br/api/ddd/v1/{ddd}
//   - CNPJ v1:  GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}   (backup do OpenCNPJ)
//
// Sem token (APIs públicas). Timeout 8s. Cache em memória por lifecycle de request
// (CEP/DDD/CNPJ são estáveis no curto prazo — não persistimos entre invocações).

// ============================================================================
// TIPOS
// ============================================================================

export interface CepInfo {
  ok: boolean
  cep: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  latitude: string | null
  longitude: string | null
  /** Link pronto pra Google Maps (lat,lng quando houver, senão endereço textual). */
  google_maps_url: string | null
  /** Heurística por nome do bairro: "Industrial", "Distrito Industrial" → industrial. */
  zona_inferida: 'industrial' | 'residencial' | 'comercial' | 'rural' | 'desconhecida'
  erro: string | null
}

export interface DddInfo {
  uf: string | null
  cidades: string[]
}

export interface EnderecoCompartilhadoInfo {
  disponivel: boolean
  count?: number
  /** Texto explicando por que a info pode estar indisponível. */
  nota?: string
}

export interface BrasilApiCnpj {
  ok: boolean
  cnpj: string | null
  razao_social: string | null
  nome_fantasia: string | null
  situacao_cadastral: string | null
  data_situacao_cadastral: string | null
  cnae_fiscal: string | null
  cnae_fiscal_descricao: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
  telefone: string | null
  email: string | null
  capital_social: number | null
  porte: string | null
  natureza_juridica: string | null
  erro: string | null
}

// ============================================================================
// UTIL
// ============================================================================

function so(v: unknown): string | null {
  const s = (v == null ? '' : String(v)).trim()
  return s || null
}

function sonum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function fetchJson<T = any>(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; data: T | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    const data = (await res.json().catch(() => null)) as T | null
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  } finally {
    clearTimeout(t)
  }
}

// Cache em memória — vive apenas durante o lifecycle do processo (warm invocations).
// Não é persistente. CEP/DDD/CNPJ raramente mudam, então cache curto é suficiente.
const cepCache = new Map<string, CepInfo>()
const dddCache = new Map<string, DddInfo>()
const cnpjCache = new Map<string, BrasilApiCnpj>()

// ============================================================================
// HEURÍSTICA DE ZONA (por nome do bairro)
// ============================================================================

function inferirZona(bairro: string | null): CepInfo['zona_inferida'] {
  if (!bairro) return 'desconhecida'
  const b = bairro.toLowerCase()

  // Industrial — padrão mais forte
  if (
    /\bdistrito\s+industrial\b/.test(b) ||
    /\bzona\s+industrial\b/.test(b) ||
    /\bp[óo]lo\s+industrial\b/.test(b) ||
    /\bparque\s+industrial\b/.test(b) ||
    /\b(c[íi]a|cidade)\s+industrial\b/.test(b) ||
    /\bindustrial\b/.test(b)
  ) {
    return 'industrial'
  }

  // Rural / colônia / zona rural / sítio / fazenda
  if (
    /\bzona\s+rural\b/.test(b) ||
    /\b[áa]rea\s+rural\b/.test(b) ||
    /\bcol[ôo]nia\b/.test(b) ||
    /\bs[íi]tio\b/.test(b) ||
    /\bfazenda\b/.test(b) ||
    /\bch[áa]cara\b/.test(b)
  ) {
    return 'rural'
  }

  // Comercial — centro, comércio
  if (
    /\bcentro\b/.test(b) ||
    /\bcom[ée]rcio\b/.test(b) ||
    /\bcomercial\b/.test(b)
  ) {
    return 'comercial'
  }

  // Padrão residencial pra bairros nomeados (jardim, vila, residencial, parque, conjunto, bairro)
  if (
    /\bjardim\b/.test(b) ||
    /\bvila\b/.test(b) ||
    /\bresidencial\b/.test(b) ||
    /\bparque\b/.test(b) ||
    /\bconjunto\b/.test(b) ||
    /\bcondom[íi]nio\b/.test(b) ||
    /\bloteamento\b/.test(b)
  ) {
    return 'residencial'
  }

  return 'desconhecida'
}

function montarGoogleMaps(lat: string | null, lng: string | null, fallback: string | null): string | null {
  if (lat && lng) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
  }
  if (fallback) {
    return `https://www.google.com/maps?q=${encodeURIComponent(fallback)}`
  }
  return null
}

// ============================================================================
// 1) CEP
// ============================================================================

export async function enriquecerCEP(cep: string): Promise<CepInfo> {
  const d = (cep || '').replace(/\D/g, '')
  if (d.length !== 8) {
    return {
      ok: false,
      cep: null,
      logradouro: null,
      bairro: null,
      cidade: null,
      uf: null,
      latitude: null,
      longitude: null,
      google_maps_url: null,
      zona_inferida: 'desconhecida',
      erro: 'CEP inválido (deve ter 8 dígitos).',
    }
  }

  const hit = cepCache.get(d)
  if (hit) return hit

  const { ok, status, data } = await fetchJson<any>(`https://brasilapi.com.br/api/cep/v2/${d}`)

  if (!ok || !data) {
    const out: CepInfo = {
      ok: false,
      cep: d,
      logradouro: null,
      bairro: null,
      cidade: null,
      uf: null,
      latitude: null,
      longitude: null,
      google_maps_url: null,
      zona_inferida: 'desconhecida',
      erro: status === 404 ? 'CEP não encontrado na BrasilAPI.' : `Falha na BrasilAPI (HTTP ${status}).`,
    }
    cepCache.set(d, out)
    return out
  }

  // BrasilAPI v2 retorna `location.coordinates.{latitude,longitude}` quando disponível.
  const coords = data?.location?.coordinates ?? {}
  const lat = so(coords.latitude)
  const lng = so(coords.longitude)
  const bairro = so(data.neighborhood ?? data.bairro)
  const cidade = so(data.city ?? data.cidade)
  const uf = so(data.state ?? data.uf)
  const logradouro = so(data.street ?? data.logradouro)

  const enderecoTexto = [logradouro, bairro, cidade, uf].filter(Boolean).join(', ') || null

  const out: CepInfo = {
    ok: true,
    cep: so(data.cep) ?? d,
    logradouro,
    bairro,
    cidade,
    uf,
    latitude: lat,
    longitude: lng,
    google_maps_url: montarGoogleMaps(lat, lng, enderecoTexto),
    zona_inferida: inferirZona(bairro),
    erro: null,
  }
  cepCache.set(d, out)
  return out
}

// ============================================================================
// 2) DDD reverso (validar coerência telefone x endereço)
// ============================================================================

export async function validarDDD(ddd: string): Promise<DddInfo> {
  const d = (ddd || '').replace(/\D/g, '').slice(0, 2)
  if (d.length !== 2) {
    return { uf: null, cidades: [] }
  }

  const hit = dddCache.get(d)
  if (hit) return hit

  const { ok, data } = await fetchJson<any>(`https://brasilapi.com.br/api/ddd/v1/${d}`)
  if (!ok || !data) {
    const out: DddInfo = { uf: null, cidades: [] }
    dddCache.set(d, out)
    return out
  }

  const cidades: string[] = Array.isArray(data.cities)
    ? data.cities.map((c: unknown) => String(c).trim()).filter(Boolean)
    : []

  const out: DddInfo = {
    uf: so(data.state),
    cidades,
  }
  dddCache.set(d, out)
  return out
}

// ============================================================================
// 3) Detecção de endereço compartilhado (quantos CNPJs no mesmo CEP+número)
// ============================================================================

/**
 * Detecta se há outros CNPJs no mesmo endereço (sinal de "caixa postal" /
 * endereço fantasma / coworking / contador).
 *
 * NOTA: BrasilAPI **não** expõe busca reversa por endereço, e o OpenCNPJ
 * também não tem esse endpoint público. Hoje só dá pra fazer via scraping de
 * cnpj.biz / cnpj.io ou via dataset RFB local. Como nenhum desses está
 * disponível aqui sem custo/risco, retornamos `disponivel: false` com uma
 * nota documentando o gap. Fica como TODO de fase futura.
 */
export async function detectarEnderecoCompartilhado(
  cep: string,
  numero?: string,
): Promise<EnderecoCompartilhadoInfo> {
  const d = (cep || '').replace(/\D/g, '')
  if (d.length !== 8) {
    return {
      disponivel: false,
      nota: 'CEP inválido — não foi possível consultar.',
    }
  }
  // Variável intencionalmente não usada ainda (placeholder para a futura busca
  // reversa por CEP+número). Mantida na assinatura porque o caller já passa.
  void numero

  return {
    disponivel: false,
    nota:
      'BrasilAPI e OpenCNPJ não expõem busca reversa por CEP/número. ' +
      'Implementação futura: scraping de cnpj.biz/cnpj.io ou dataset RFB local.',
  }
}

// ============================================================================
// 4) CNPJ via BrasilAPI (backup do OpenCNPJ)
// ============================================================================

export async function consultarCnpjBrasilApi(cnpj: string): Promise<BrasilApiCnpj> {
  const d = (cnpj || '').replace(/\D/g, '')
  if (d.length !== 14) {
    return {
      ok: false,
      cnpj: null,
      razao_social: null,
      nome_fantasia: null,
      situacao_cadastral: null,
      data_situacao_cadastral: null,
      cnae_fiscal: null,
      cnae_fiscal_descricao: null,
      logradouro: null,
      numero: null,
      bairro: null,
      municipio: null,
      uf: null,
      cep: null,
      telefone: null,
      email: null,
      capital_social: null,
      porte: null,
      natureza_juridica: null,
      erro: 'CNPJ inválido (deve ter 14 dígitos).',
    }
  }

  const hit = cnpjCache.get(d)
  if (hit) return hit

  const { ok, status, data } = await fetchJson<any>(`https://brasilapi.com.br/api/cnpj/v1/${d}`)
  if (!ok || !data) {
    const out: BrasilApiCnpj = {
      ok: false,
      cnpj: d,
      razao_social: null,
      nome_fantasia: null,
      situacao_cadastral: null,
      data_situacao_cadastral: null,
      cnae_fiscal: null,
      cnae_fiscal_descricao: null,
      logradouro: null,
      numero: null,
      bairro: null,
      municipio: null,
      uf: null,
      cep: null,
      telefone: null,
      email: null,
      capital_social: null,
      porte: null,
      natureza_juridica: null,
      erro: status === 404 ? 'CNPJ não encontrado na BrasilAPI.' : `Falha na BrasilAPI (HTTP ${status}).`,
    }
    cnpjCache.set(d, out)
    return out
  }

  const out: BrasilApiCnpj = {
    ok: true,
    cnpj: so(data.cnpj) ?? d,
    razao_social: so(data.razao_social),
    nome_fantasia: so(data.nome_fantasia),
    situacao_cadastral: so(data.descricao_situacao_cadastral ?? data.situacao_cadastral),
    data_situacao_cadastral: so(data.data_situacao_cadastral),
    cnae_fiscal: so(data.cnae_fiscal),
    cnae_fiscal_descricao: so(data.cnae_fiscal_descricao),
    logradouro: so(data.logradouro),
    numero: so(data.numero),
    bairro: so(data.bairro),
    municipio: so(data.municipio),
    uf: so(data.uf),
    cep: so(data.cep),
    telefone: so(data.ddd_telefone_1),
    email: so(data.email),
    capital_social: sonum(data.capital_social),
    porte: so(data.porte ?? data.descricao_porte),
    natureza_juridica: so(data.natureza_juridica),
    erro: null,
  }
  cnpjCache.set(d, out)
  return out
}
