// Cliente de consulta cadastral pública de CNPJ via APIs gratuitas do governo / open data.
//
// Dois provedores, ambos via fetch (sem dependência nova, sem auth):
//   - BrasilAPI       (mais estável, agregador)   GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}
//   - publica.cnpj.ws (fallback, Receita Federal) GET https://publica.cnpj.ws/cnpj/{cnpj}
//
// Rate limit: ~3 req/min em publica.cnpj.ws. BrasilAPI é mais permissivo mas também
// tem throttling. Use só pra triagem, não pra batch grande.
//
// Reverso de sócios (CPF -> empresas): a Receita NÃO expõe esse índice publicamente.
// BrasilAPI / publica.cnpj.ws só consultam por CNPJ. Mantemos a função pra contrato
// estável, mas hoje retorna { tem_dados: false } com motivo. Quando integrar fonte
// paga (CNPJá, Infosimples, Casa dos Dados), atualizar a implementação.

export interface OpenCnpjResultado {
  ok: boolean
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  situacao: string | null
  data_abertura: string | null // ISO date (YYYY-MM-DD)
  capital_social: number | null
  natureza_juridica: string | null
  porte: string | null // ME, EPP, GRANDE, DEMAIS etc
  mei: boolean
  simples_nacional: boolean | null
  cnae_principal: { codigo: string; descricao: string } | null
  cnae_secundarios: Array<{ codigo: string; descricao: string }>
  endereco: {
    logradouro: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    cep: string | null
    municipio: string | null
    uf: string | null
  } | null
  telefone: string | null
  email: string | null
  socios: Array<{
    nome: string
    cpf_cnpj_mascara: string | null // vem mascarado da Receita (***123456**)
    qualificacao: string | null // ex: "Sócio-Administrador"
    data_entrada: string | null // ISO date
    participacao_percent: number | null
  }>
  erro: string | null
  fonte: 'brasilapi' | 'publica.cnpj.ws' | null
}

export interface EmpresasDoSocio {
  tem_dados: boolean
  cpf_mascara: string | null
  empresas: Array<{
    cnpj: string
    razao_social: string | null
    qualificacao: string | null
    data_entrada: string | null
  }>
  motivo: string | null // quando tem_dados=false explica por quê
}

// ---------- helpers ----------

function so(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function toIsoDate(v: unknown): string | null {
  const s = so(v)
  if (!s) return null
  // Já é ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD/MM/YYYY?
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

function emptyResult(cnpj: string, erro: string): OpenCnpjResultado {
  return {
    ok: false,
    cnpj,
    razao_social: null,
    nome_fantasia: null,
    situacao: null,
    data_abertura: null,
    capital_social: null,
    natureza_juridica: null,
    porte: null,
    mei: false,
    simples_nacional: null,
    cnae_principal: null,
    cnae_secundarios: [],
    endereco: null,
    telefone: null,
    email: null,
    socios: [],
    erro,
    fonte: null,
  }
}

async function fetchWithTimeout(url: string, ms = 10_000): Promise<Response | null> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'branorte-crm/1.0 (+contato@branorte.com)' },
    })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(id)
  }
}

// ---------- BrasilAPI ----------
// Doc: https://brasilapi.com.br/docs#tag/CNPJ
// Resposta: objeto plano com campos snake_case (cnpj, razao_social, nome_fantasia,
// descricao_situacao_cadastral, data_inicio_atividade, capital_social, porte,
// cnae_fiscal, cnae_fiscal_descricao, cnaes_secundarios[], qsa[], etc.)
async function tentarBrasilApi(cnpj: string): Promise<OpenCnpjResultado | { rateLimited: true } | null> {
  const res = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`)
  if (!res) return null
  if (res.status === 429) return { rateLimited: true }
  if (!res.ok) return null

  const d = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!d || !d.cnpj) return null

  const cnaes_sec: Array<{ codigo: string; descricao: string }> = Array.isArray(d.cnaes_secundarios)
    ? d.cnaes_secundarios
        .map((c: any) => ({
          codigo: so(c?.codigo) || '',
          descricao: so(c?.descricao) || '',
        }))
        .filter((c: { codigo: string }) => c.codigo)
    : []

  const socios: OpenCnpjResultado['socios'] = Array.isArray(d.qsa)
    ? d.qsa.map((s: any) => ({
        nome: so(s?.nome_socio) || '',
        cpf_cnpj_mascara: so(s?.cnpj_cpf_do_socio),
        qualificacao: so(s?.qualificacao_socio) || so(s?.codigo_qualificacao_socio),
        data_entrada: toIsoDate(s?.data_entrada_sociedade),
        participacao_percent: toNum(s?.percentual_capital_social),
      })).filter((s: { nome: string }) => s.nome)
    : []

  const cnae_principal_codigo = so(d.cnae_fiscal)
  const cnae_principal_desc = so(d.cnae_fiscal_descricao)
  const cnae_principal = cnae_principal_codigo
    ? { codigo: cnae_principal_codigo, descricao: cnae_principal_desc || '' }
    : null

  const porte = so(d.porte) // BrasilAPI já vem em texto: "MICRO EMPRESA", "EMPRESA DE PEQUENO PORTE", "DEMAIS"
  const mei = porte != null && /MEI|MICRO EMPRESARIO/i.test(porte)

  // BrasilAPI v1 não retorna Simples Nacional. Deixa null (a UI mostra "—").
  return {
    ok: true,
    cnpj: so(d.cnpj) || cnpj,
    razao_social: so(d.razao_social),
    nome_fantasia: so(d.nome_fantasia),
    situacao: so(d.descricao_situacao_cadastral),
    data_abertura: toIsoDate(d.data_inicio_atividade),
    capital_social: toNum(d.capital_social),
    natureza_juridica: so(d.natureza_juridica),
    porte,
    mei,
    simples_nacional: null,
    cnae_principal,
    cnae_secundarios: cnaes_sec,
    endereco: {
      logradouro: so(d.logradouro),
      numero: so(d.numero),
      complemento: so(d.complemento),
      bairro: so(d.bairro),
      cep: so(d.cep),
      municipio: so(d.municipio),
      uf: so(d.uf),
    },
    telefone: so(d.ddd_telefone_1) || so(d.ddd_telefone_2),
    email: so(d.email),
    socios,
    erro: null,
    fonte: 'brasilapi',
  }
}

// ---------- publica.cnpj.ws ----------
// Doc: https://docs.cnpj.ws/referencia-de-api/api-publica/consultando-cnpj
// Resposta: estrutura aninhada (razao_social, estabelecimento{...}, socios[], simples{...})
async function tentarPublicaCnpjWs(cnpj: string): Promise<OpenCnpjResultado | { rateLimited: true } | null> {
  const res = await fetchWithTimeout(`https://publica.cnpj.ws/cnpj/${cnpj}`)
  if (!res) return null
  if (res.status === 429) return { rateLimited: true }
  if (!res.ok) return null

  const d = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!d) return null

  const est = (d.estabelecimento || {}) as Record<string, any>

  const cnae_principal_obj = (est.atividade_principal || {}) as Record<string, any>
  const cnae_principal_codigo = so(cnae_principal_obj.id) || so(cnae_principal_obj.subclasse)
  const cnae_principal_desc = so(cnae_principal_obj.descricao)
  const cnae_principal = cnae_principal_codigo
    ? { codigo: cnae_principal_codigo, descricao: cnae_principal_desc || '' }
    : null

  const cnaes_sec: Array<{ codigo: string; descricao: string }> = Array.isArray(est.atividades_secundarias)
    ? est.atividades_secundarias
        .map((c: any) => ({
          codigo: so(c?.id) || so(c?.subclasse) || '',
          descricao: so(c?.descricao) || '',
        }))
        .filter((c: { codigo: string }) => c.codigo)
    : []

  const socios: OpenCnpjResultado['socios'] = Array.isArray(d.socios)
    ? d.socios.map((s: any) => ({
        nome: so(s?.nome) || '',
        cpf_cnpj_mascara: so(s?.cpf_cnpj_socio) || so(s?.cpf),
        qualificacao: so(s?.qualificacao_socio?.descricao) || so(s?.qualificacao_socio),
        data_entrada: toIsoDate(s?.data_entrada),
        participacao_percent: toNum(s?.percentual_capital_social),
      })).filter((s: { nome: string }) => s.nome)
    : []

  const portePj = (d.porte || {}) as Record<string, any>
  const porte = so(portePj.descricao) || so(d.porte)
  const mei = d.simples?.mei === 'Sim' || /MEI|MICROEMPRESARIO/i.test(porte || '')
  const simples_nacional = typeof d.simples?.simples === 'string'
    ? /sim/i.test(d.simples.simples)
    : null

  const ddd = so(est.ddd1) || ''
  const tel = so(est.telefone1) || ''
  const telefone = ddd && tel ? `${ddd}${tel}` : tel || null

  return {
    ok: true,
    cnpj: so(est.cnpj) || so(d.cnpj_raiz) || cnpj,
    razao_social: so(d.razao_social),
    nome_fantasia: so(est.nome_fantasia),
    situacao: so(est.situacao_cadastral),
    data_abertura: toIsoDate(est.data_inicio_atividade),
    capital_social: toNum(d.capital_social),
    natureza_juridica: so(d.natureza_juridica?.descricao) || so(d.natureza_juridica),
    porte,
    mei,
    simples_nacional,
    cnae_principal,
    cnae_secundarios: cnaes_sec,
    endereco: {
      logradouro: so(est.logradouro),
      numero: so(est.numero),
      complemento: so(est.complemento),
      bairro: so(est.bairro),
      cep: so(est.cep),
      municipio: so(est.cidade?.nome) || so(est.cidade),
      uf: so(est.estado?.sigla) || so(est.estado),
    },
    telefone,
    email: so(est.email),
    socios,
    erro: null,
    fonte: 'publica.cnpj.ws',
  }
}

// ---------- consulta pública ----------

/**
 * Consulta dados cadastrais públicos de um CNPJ.
 * Tenta BrasilAPI primeiro (mais estável); se falhar, cai pra publica.cnpj.ws.
 * Sem auth, sem chave. Rate limit ~3 req/min em publica.cnpj.ws.
 */
export async function consultarOpenCnpj(cnpj: string): Promise<OpenCnpjResultado> {
  const d = (cnpj || '').replace(/\D/g, '')
  if (d.length !== 14) {
    return emptyResult(cnpj, 'CNPJ inválido (precisa ter 14 dígitos)')
  }

  // 1) BrasilAPI
  const r1 = await tentarBrasilApi(d)
  if (r1 && 'ok' in r1) return r1
  const brasilApiRateLimited = r1 && 'rateLimited' in r1

  // 2) Fallback publica.cnpj.ws
  const r2 = await tentarPublicaCnpjWs(d)
  if (r2 && 'ok' in r2) return r2
  const publicaRateLimited = r2 && 'rateLimited' in r2

  if (brasilApiRateLimited && publicaRateLimited) {
    return emptyResult(
      d,
      'Limite de consultas atingido nas duas fontes públicas (BrasilAPI e publica.cnpj.ws). Tente novamente em ~1 min.',
    )
  }
  if (brasilApiRateLimited || publicaRateLimited) {
    return emptyResult(
      d,
      'Limite de consultas atingido em uma das fontes públicas. Tente novamente em ~1 min.',
    )
  }

  return emptyResult(d, 'CNPJ não encontrado nas fontes públicas (BrasilAPI / publica.cnpj.ws).')
}

// ---------- reverso de sócios (CPF -> empresas) ----------

/**
 * Tenta descobrir em quais empresas um CPF é sócio.
 *
 * A Receita Federal NÃO expõe esse índice publicamente. BrasilAPI e publica.cnpj.ws
 * só consultam por CNPJ (forward), nunca por CPF (reverso). Portanto hoje a função
 * sempre retorna `tem_dados: false` com motivo. Mantida pra contrato estável: quando
 * integrarmos uma fonte paga (CNPJá, Casa dos Dados, Infosimples) que ofereça reverso,
 * basta atualizar a implementação aqui sem mexer nos handlers que já chamam.
 */
export async function consultarSociosReverso(cpf: string): Promise<EmpresasDoSocio> {
  const d = (cpf || '').replace(/\D/g, '')
  if (d.length !== 11) {
    return {
      tem_dados: false,
      cpf_mascara: null,
      empresas: [],
      motivo: 'CPF inválido (precisa ter 11 dígitos).',
    }
  }

  const cpf_mascara = `***${d.slice(3, 9)}**`

  return {
    tem_dados: false,
    cpf_mascara,
    empresas: [],
    motivo:
      'Reverso de sócios (CPF → empresas) não está disponível em fontes públicas gratuitas. Requer integração paga (ex: CNPJá, Casa dos Dados, Infosimples).',
  }
}
