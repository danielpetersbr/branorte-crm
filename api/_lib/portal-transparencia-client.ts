// Portal da Transparência (CGU) — cliente pra checar sanções e PEP.
//
// Documentação oficial:
//   https://api.portaldatransparencia.gov.br/swagger-ui.html
//   https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
//
// Auth: header `chave-api-dados: <TOKEN>` — token gratuito.
//
// COMO OBTER O TOKEN (rodar 1x, manualmente):
//   1. Acessar https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
//   2. Cadastrar um e-mail (usar daniel.peters.br@gmail.com ou o e-mail
//      operacional da Branorte).
//   3. Confirmar o e-mail → token chega por e-mail (~1 min).
//   4. Setar a env var `PORTAL_TRANSPARENCIA_KEY` no Vercel.
//
// SETAR NO VERCEL:
//   Dashboard → Project (branorte-crm) → Settings → Environment Variables
//   Name:  PORTAL_TRANSPARENCIA_KEY
//   Value: <token recebido por e-mail>
//   Environments: Production, Preview, Development
//   Depois: redeploy (ou `npx vercel deploy --prod --yes --archive=tgz`).
//
// Rate limit: 90 requisições/minuto (06h-24h) e 700/minuto (00h-06h).
// Cada consulta DD usa 4 endpoints em paralelo (PEP/CEIS/CNEP/CEPIM), então
// suporta ~22 consultas/min de pico no horário comercial — suficiente.
//
// MODO GRACIOSO: se a env var não estiver setada, o client retorna
// { ok: false, erro: 'token_nao_configurado', ... } SEM lançar exceção, pra
// não quebrar o fan-out do endpoint dd-consultar. O endpoint segue normalmente
// com SPC + Datajud, e o frontend pode ignorar o bloco se quiser.

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const TIMEOUT_PADRAO_MS = 8_000

// ============================================================================
// Tipos públicos
// ============================================================================

export interface PortalSubResultado<T = Record<string, unknown>> {
  /** Endpoint consultado (debug) */
  endpoint: string
  /** Achou registro? (tem.length > 0 OU equivalente) */
  tem: boolean
  /** Quantidade de registros encontrados */
  quantidade: number
  /** Detalhes brutos do Portal (limitado a 10 entradas) */
  detalhes: T[]
  /** Erro técnico, se houver */
  erro: string | null
}

export interface PortalTransparenciaResultado {
  /**
   * `false` se o client não rodou (token ausente, doc inválido, etc).
   * `true` mesmo se NÃO achou nada — vazio é resposta válida.
   */
  ok: boolean
  /** Documentos consultados (já normalizados sem máscara) */
  cnpj: string | null
  cpf: string | null
  /** Pessoa exposta politicamente (CPF) */
  pep: PortalSubResultado
  /** Cadastro de Empresas Inidôneas e Suspensas (CPF/CNPJ) */
  ceis: PortalSubResultado
  /** Cadastro Nacional de Empresas Punidas (CPF/CNPJ) */
  cnep: PortalSubResultado
  /** Cadastro de Entidades Privadas Sem Fins Lucrativos Impedidas (CNPJ) */
  cepim: PortalSubResultado
  /** Soma de tudo que apareceu como sanção (CEIS+CNEP+CEPIM) */
  total_sancoes: number
  /** É PEP? (atalho pro front renderizar badge vermelho) */
  is_pep: boolean
  /** Lista consolidada de erros (técnicos) */
  erros: string[]
  /** Motivo de não rodar (token ausente, etc) — só preenche se ok=false */
  motivo_nao_rodou?: string
}

// ============================================================================
// Função orquestradora — fan-out paralelo
// ============================================================================

/**
 * Consulta Portal da Transparência (CGU) em 4 endpoints paralelos:
 *   - PEP    (só CPF)
 *   - CEIS   (CPF ou CNPJ)
 *   - CNEP   (CPF ou CNPJ)
 *   - CEPIM  (só CNPJ)
 *
 * Modo gracioso: se token ausente, retorna ok=false com motivo_nao_rodou.
 * Erros individuais por endpoint NÃO quebram o resultado consolidado.
 */
export async function consultarPortalTransparencia(opts: {
  cnpj?: string | null
  cpf?: string | null
  timeoutMs?: number
}): Promise<PortalTransparenciaResultado> {
  const token = process.env.PORTAL_TRANSPARENCIA_KEY || ''
  const cnpj = normalizarDoc(opts.cnpj)
  const cpf = normalizarDoc(opts.cpf)
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_PADRAO_MS

  const baseRet = (): PortalTransparenciaResultado => ({
    ok: false,
    cnpj: cnpj || null,
    cpf: cpf || null,
    pep: vazio('peps'),
    ceis: vazio('ceis'),
    cnep: vazio('cnep'),
    cepim: vazio('cepim'),
    total_sancoes: 0,
    is_pep: false,
    erros: [],
  })

  if (!token) {
    return {
      ...baseRet(),
      motivo_nao_rodou: 'token_nao_configurado',
      erros: ['PORTAL_TRANSPARENCIA_KEY ausente no ambiente — pular Portal Transparência'],
    }
  }
  if (!cnpj && !cpf) {
    return { ...baseRet(), motivo_nao_rodou: 'sem_documento', erros: ['nem cnpj nem cpf informados'] }
  }
  if (cnpj && cnpj.length !== 14) {
    return { ...baseRet(), motivo_nao_rodou: 'cnpj_invalido', erros: ['cnpj precisa ter 14 dígitos'] }
  }
  if (cpf && cpf.length !== 11) {
    return { ...baseRet(), motivo_nao_rodou: 'cpf_invalido', erros: ['cpf precisa ter 11 dígitos'] }
  }

  // Fan-out: dispara em paralelo só os endpoints aplicáveis ao documento.
  const promessas = await Promise.all([
    cpf ? consultarPEP(cpf, token, timeoutMs) : Promise.resolve(vazio('peps')),
    consultarCEIS({ cnpj, cpf }, token, timeoutMs),
    consultarCNEP({ cnpj, cpf }, token, timeoutMs),
    cnpj ? consultarCEPIM(cnpj, token, timeoutMs) : Promise.resolve(vazio('cepim')),
  ])

  const [pep, ceis, cnep, cepim] = promessas
  const erros = [
    pep.erro && `pep: ${pep.erro}`,
    ceis.erro && `ceis: ${ceis.erro}`,
    cnep.erro && `cnep: ${cnep.erro}`,
    cepim.erro && `cepim: ${cepim.erro}`,
  ].filter((e): e is string => !!e)

  return {
    ok: true,
    cnpj: cnpj || null,
    cpf: cpf || null,
    pep,
    ceis,
    cnep,
    cepim,
    total_sancoes: ceis.quantidade + cnep.quantidade + cepim.quantidade,
    is_pep: pep.tem,
    erros,
  }
}

// ============================================================================
// Endpoints individuais — exportados pra testes/uso isolado
// ============================================================================

/**
 * PEPs — Pessoas Expostas Politicamente.
 * GET /api-de-dados/peps?cpf={cpf}&pagina=1
 */
export async function consultarPEP(
  cpf: string,
  token = process.env.PORTAL_TRANSPARENCIA_KEY || '',
  timeoutMs = TIMEOUT_PADRAO_MS,
): Promise<PortalSubResultado> {
  const cpfNum = normalizarDoc(cpf)
  if (!cpfNum) return { ...vazio('peps'), erro: 'cpf_vazio' }
  if (!token) return { ...vazio('peps'), erro: 'token_nao_configurado' }
  const url = `${BASE_URL}/peps?cpf=${encodeURIComponent(cpfNum)}&pagina=1`
  return fetchPortal(url, token, timeoutMs, 'peps')
}

/**
 * CEIS — Cadastro de Empresas Inidôneas e Suspensas.
 * GET /api-de-dados/ceis?cpfSancionado=...  OU  ?cnpjSancionado=...
 */
export async function consultarCEIS(
  opts: { cnpj?: string | null; cpf?: string | null },
  token = process.env.PORTAL_TRANSPARENCIA_KEY || '',
  timeoutMs = TIMEOUT_PADRAO_MS,
): Promise<PortalSubResultado> {
  const cnpj = normalizarDoc(opts.cnpj)
  const cpf = normalizarDoc(opts.cpf)
  if (!cnpj && !cpf) return { ...vazio('ceis'), erro: 'sem_documento' }
  if (!token) return { ...vazio('ceis'), erro: 'token_nao_configurado' }
  // CNPJ tem prioridade (consulta empresa direto). CPF é fallback.
  const qs = cnpj
    ? `cnpjSancionado=${encodeURIComponent(cnpj)}`
    : `cpfSancionado=${encodeURIComponent(cpf)}`
  const url = `${BASE_URL}/ceis?${qs}&pagina=1`
  return fetchPortal(url, token, timeoutMs, 'ceis')
}

/**
 * CNEP — Cadastro Nacional de Empresas Punidas.
 * GET /api-de-dados/cnep?cpfCnpj=...
 *
 * NOTA: A doc oficial fala em `cpfCnpj` (parâmetro único pros dois). Se em algum
 * momento for renomeado, ajustar aqui. CNPJ tem prioridade sobre CPF.
 */
export async function consultarCNEP(
  opts: { cnpj?: string | null; cpf?: string | null },
  token = process.env.PORTAL_TRANSPARENCIA_KEY || '',
  timeoutMs = TIMEOUT_PADRAO_MS,
): Promise<PortalSubResultado> {
  const cnpj = normalizarDoc(opts.cnpj)
  const cpf = normalizarDoc(opts.cpf)
  const doc = cnpj || cpf
  if (!doc) return { ...vazio('cnep'), erro: 'sem_documento' }
  if (!token) return { ...vazio('cnep'), erro: 'token_nao_configurado' }
  const url = `${BASE_URL}/cnep?cpfCnpj=${encodeURIComponent(doc)}&pagina=1`
  return fetchPortal(url, token, timeoutMs, 'cnep')
}

/**
 * CEPIM — Cadastro de Entidades Privadas Sem Fins Lucrativos Impedidas.
 * GET /api-de-dados/cepim?cnpjEntidade={cnpj}&pagina=1
 *
 * CEPIM é exclusivo PJ (não tem CPF — só ONGs/associações com convênio público).
 */
export async function consultarCEPIM(
  cnpj: string,
  token = process.env.PORTAL_TRANSPARENCIA_KEY || '',
  timeoutMs = TIMEOUT_PADRAO_MS,
): Promise<PortalSubResultado> {
  const cnpjNum = normalizarDoc(cnpj)
  if (!cnpjNum) return { ...vazio('cepim'), erro: 'cnpj_vazio' }
  if (!token) return { ...vazio('cepim'), erro: 'token_nao_configurado' }
  const url = `${BASE_URL}/cepim?cnpjEntidade=${encodeURIComponent(cnpjNum)}&pagina=1`
  return fetchPortal(url, token, timeoutMs, 'cepim')
}

// ============================================================================
// Helpers internos
// ============================================================================

async function fetchPortal(
  url: string,
  token: string,
  timeoutMs: number,
  rotulo: string,
): Promise<PortalSubResultado> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'chave-api-dados': token,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (!resp.ok) {
      // 204 = sem conteúdo (resposta válida, vazia)
      if (resp.status === 204) return vazio(rotulo)
      // 400/404 com payload vazio: portal às vezes responde 400 pra "não achou"
      const txt = await resp.text().catch(() => '')
      return { ...vazio(rotulo), erro: `HTTP ${resp.status}${txt ? `: ${txt.slice(0, 200)}` : ''}` }
    }
    const data = await resp.json().catch(() => null)
    if (!data) return vazio(rotulo)
    // Portal retorna ARRAY (mesmo que vazio []) ou objeto único quando achou 1.
    const arr: Record<string, unknown>[] = Array.isArray(data)
      ? data as Record<string, unknown>[]
      : [data as Record<string, unknown>]
    const detalhes = arr.slice(0, 10) // limita pra não estourar jsonb
    return {
      endpoint: rotulo,
      tem: arr.length > 0,
      quantidade: arr.length,
      detalhes,
      erro: null,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const eh_timeout = msg.toLowerCase().includes('abort')
    return { ...vazio(rotulo), erro: eh_timeout ? 'timeout' : msg }
  } finally {
    clearTimeout(timer)
  }
}

function vazio(endpoint: string): PortalSubResultado {
  return { endpoint, tem: false, quantidade: 0, detalhes: [], erro: null }
}

function normalizarDoc(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '')
}
