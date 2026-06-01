// Datajud — API pública do CNJ pra processos judiciais.
//
// Documentação oficial: https://datajud-wiki.cnj.jus.br/api-publica
// Endpoint base: https://api-publica.datajud.cnj.jus.br/{alias}/_search
//
// Auth: API key pública e universal (Bearer público — não precisa cadastro).
// Query DSL: Elasticsearch — usamos `query_string` no campo `_all` pra
// buscar pelo número do CPF/CNPJ em qualquer campo do índice.
//
// Estratégia: fanout paralelo nos tribunais mais relevantes (focando em SC
// já que Branorte é de SC, + tribunais nacionais TST, STJ, e federais
// TRF-4 que cobre SC/RS/PR). Limita 5 resultados por tribunal pra ser rápido.

const API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br'

// Tribunais que vamos consultar. Priorizado pra Branorte (SC):
//  • TJSC (estadual SC) — onde mais provável ter processos
//  • TRF4 (federal SC/RS/PR)
//  • TJSP, TJPR, TJRS (estaduais vizinhos)
//  • STJ, TST (superiores nacionais)
export const TRIBUNAIS_PRIORIDADE: Array<{ alias: string; nome: string; grau: string }> = [
  { alias: 'api_publica_tjsc',  nome: 'TJSC',  grau: 'Estadual SC' },
  { alias: 'api_publica_trf4',  nome: 'TRF4',  grau: 'Federal SC/RS/PR' },
  { alias: 'api_publica_tjsp',  nome: 'TJSP',  grau: 'Estadual SP' },
  { alias: 'api_publica_tjpr',  nome: 'TJPR',  grau: 'Estadual PR' },
  { alias: 'api_publica_tjrs',  nome: 'TJRS',  grau: 'Estadual RS' },
  { alias: 'api_publica_tst',   nome: 'TST',   grau: 'Trabalhista Superior' },
  { alias: 'api_publica_stj',   nome: 'STJ',   grau: 'Superior de Justiça' },
]

export interface ProcessoDatajud {
  numeroProcesso: string
  tribunal: string
  grau: string
  classe: string
  classeCodigo?: number
  assunto: string
  dataAjuizamento: string | null
  dataUltimaAtualizacao: string | null
  orgaoJulgador: string
  /** Para indicar se este resultado veio do match exato ou parcial */
  scoreMatch: number
}

export interface DatajudResultado {
  ok: boolean
  documento: string
  tipoDocumento: 'F' | 'J'
  totalEncontrado: number
  processos: ProcessoDatajud[]
  /** Por tribunal: quantidade encontrada x retornada */
  resumoTribunais: Array<{ tribunal: string; total: number; retornados: number; erro?: string }>
  erros: string[]
}

/**
 * Busca processos judiciais por CPF ou CNPJ em múltiplos tribunais em paralelo.
 */
export async function buscarProcessos(opts: {
  documento: string
  tipo: 'F' | 'J'
  porTribunal?: number  // default 5
  timeoutMs?: number    // default 15000
}): Promise<DatajudResultado> {
  const docNumerico = opts.documento.replace(/\D/g, '')
  const porTribunal = opts.porTribunal ?? 5
  const timeoutMs = opts.timeoutMs ?? 15_000

  if (!docNumerico || (docNumerico.length !== 11 && docNumerico.length !== 14)) {
    return {
      ok: false,
      documento: opts.documento,
      tipoDocumento: opts.tipo,
      totalEncontrado: 0,
      processos: [],
      resumoTribunais: [],
      erros: ['documento_invalido'],
    }
  }

  const docFormatado = formatarDoc(docNumerico, opts.tipo)
  // Buscamos pelo numero puro E pelo formatado (alguns tribunais indexam com mascara)
  const queryString = `"${docNumerico}" OR "${docFormatado}"`

  const tarefas = TRIBUNAIS_PRIORIDADE.map(t => buscarUmTribunal(t, queryString, porTribunal, timeoutMs))
  const resultados = await Promise.allSettled(tarefas)

  const processos: ProcessoDatajud[] = []
  const resumoTribunais: DatajudResultado['resumoTribunais'] = []
  const erros: string[] = []

  for (let i = 0; i < resultados.length; i++) {
    const tribunal = TRIBUNAIS_PRIORIDADE[i]
    const r = resultados[i]
    if (r.status === 'rejected' || !r.value.ok) {
      const msg = r.status === 'rejected' ? String(r.reason) : r.value.erro ?? 'erro desconhecido'
      resumoTribunais.push({ tribunal: tribunal.nome, total: 0, retornados: 0, erro: msg })
      erros.push(`${tribunal.nome}: ${msg}`)
      continue
    }
    resumoTribunais.push({
      tribunal: tribunal.nome,
      total: r.value.total,
      retornados: r.value.processos.length,
    })
    processos.push(...r.value.processos)
  }

  // Ordena por data de ajuizamento (mais recente primeiro)
  processos.sort((a, b) => {
    if (!a.dataAjuizamento && !b.dataAjuizamento) return 0
    if (!a.dataAjuizamento) return 1
    if (!b.dataAjuizamento) return -1
    return b.dataAjuizamento.localeCompare(a.dataAjuizamento)
  })

  return {
    ok: true,
    documento: opts.documento,
    tipoDocumento: opts.tipo,
    totalEncontrado: resumoTribunais.reduce((acc, r) => acc + r.total, 0),
    processos,
    resumoTribunais,
    erros,
  }
}

async function buscarUmTribunal(
  tribunal: { alias: string; nome: string; grau: string },
  queryString: string,
  size: number,
  timeoutMs: number,
): Promise<{ ok: true; total: number; processos: ProcessoDatajud[] } | { ok: false; erro: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(`${BASE_URL}/${tribunal.alias}/_search`, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        size,
        query: {
          query_string: { query: queryString },
        },
        sort: [{ '@timestamp': { order: 'desc' } }],
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      return { ok: false, erro: `HTTP ${resp.status}` }
    }
    const data = await resp.json()
    const total = data?.hits?.total?.value ?? 0
    const hits = (data?.hits?.hits ?? []) as Array<{
      _score: number
      _source: Record<string, unknown>
    }>
    const processos = hits.map(h => normalizarProcesso(h._source, tribunal, h._score))
    return { ok: true, total, processos }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, erro: msg }
  } finally {
    clearTimeout(timer)
  }
}

function normalizarProcesso(
  src: Record<string, unknown>,
  tribunal: { nome: string; grau: string },
  score: number,
): ProcessoDatajud {
  const classe = (src.classe as Record<string, unknown> | undefined) ?? {}
  const assuntos = (src.assuntos as Array<Record<string, unknown>> | undefined) ?? []
  const orgao = (src.orgaoJulgador as Record<string, unknown> | undefined) ?? {}
  return {
    numeroProcesso: String(src.numeroProcesso ?? ''),
    tribunal: tribunal.nome,
    grau: String(src.grau ?? tribunal.grau),
    classe: String(classe.nome ?? '—'),
    classeCodigo: typeof classe.codigo === 'number' ? classe.codigo : undefined,
    assunto: assuntos.length > 0 ? String(assuntos[0].nome ?? '—') : '—',
    dataAjuizamento: formatarDataAjuizamento(src.dataAjuizamento as string | undefined),
    dataUltimaAtualizacao: formatarDataIso(src.dataHoraUltimaAtualizacao as string | undefined),
    orgaoJulgador: String(orgao.nome ?? '—'),
    scoreMatch: score,
  }
}

function formatarDoc(doc: string, tipo: 'F' | 'J'): string {
  if (tipo === 'J') {
    return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

function formatarDataAjuizamento(s: string | undefined): string | null {
  // Formato Datajud: "20240513144809" (yyyyMMddHHmmss)
  if (!s) return null
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatarDataIso(s: string | undefined): string | null {
  if (!s) return null
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('pt-BR')
  } catch {
    return null
  }
}
