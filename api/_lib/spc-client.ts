// SPC Brasil — cliente REST minimalista.
//
// Documentacao: Manuais_WebService_Integração_SPCBRASIL_v4.3
// Endpoint:  https://{ambiente}/spcconsulta/recurso/consulta/padrao
// Auth:      Basic Authentication (base64 de "usuario:senha")
//
// IMPORTANTE: a "senha de WebService" do SPC eh diferente da senha WEB.
// Voce precisa criar uma especifica e abrir chamado na CDL pra operador
// de homologacao/producao. Veja Informações importantes.txt do manual.

import { Buffer } from 'node:buffer'

const HOMOLOG_URL = 'https://treinamento.spcbrasil.com.br/spcconsulta/recurso/consulta/padrao'
const PROD_URL = 'https://api.spcbrasil.com.br/spcconsulta/recurso/consulta/padrao'

export type AmbienteSpc = 'homolog' | 'producao'

export interface SpcConsultaParams {
  /** Codigo do produto na tabela FCDL (ex: 480=CNPJ, 479=CPF, 141=Score) */
  codigoProduto: string
  /** F=Fisica, J=Juridica */
  tipoConsumidor: 'F' | 'J'
  /** CPF ou CNPJ, so digitos */
  documentoConsumidor: string
  /** Codigos de insumos opcionais (linkam custo adicional) */
  codigoInsumoOpcional?: number[]
  /** CEP para confirmacao adicional (opcional) */
  cepConsumidor?: string
}

export interface SpcConsultaResultado {
  ok: boolean
  status: number
  /** Payload bruto retornado pelo SPC (jsonb pra salvar e re-renderizar) */
  data: Record<string, unknown> | null
  /** Mensagem de erro humanamente legivel */
  erro?: string
}

/**
 * Faz uma consulta no SPC Brasil REST.
 * Retorna o JSON completo do SPC sem alteracoes — o consumidor processa.
 */
export async function consultarSpc(
  params: SpcConsultaParams,
  opts: {
    ambiente?: AmbienteSpc
    usuario: string
    senha: string
    timeoutMs?: number
  },
): Promise<SpcConsultaResultado> {
  const url = (opts.ambiente ?? 'homolog') === 'producao' ? PROD_URL : HOMOLOG_URL
  const auth = Buffer.from(`${opts.usuario}:${opts.senha}`).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        codigoProduto: params.codigoProduto,
        tipoConsumidor: params.tipoConsumidor,
        documentoConsumidor: params.documentoConsumidor.replace(/\D/g, ''),
        ...(params.codigoInsumoOpcional?.length
          ? { codigoInsumoOpcional: params.codigoInsumoOpcional }
          : {}),
        ...(params.cepConsumidor
          ? { cepConsumidor: params.cepConsumidor.replace(/\D/g, '') }
          : {}),
      }),
      signal: controller.signal,
    })

    const text = await resp.text()
    let data: Record<string, unknown> | null = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // Resposta nao-JSON (HTML de erro, etc) — preserva texto
      data = { _raw: text.slice(0, 4000) }
    }

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        data,
        erro: `SPC HTTP ${resp.status}: ${resp.statusText}`,
      }
    }

    return { ok: true, status: resp.status, data }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort = msg.includes('aborted')
    return {
      ok: false,
      status: 0,
      data: null,
      erro: isAbort ? 'SPC timeout' : `SPC fetch error: ${msg}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================================
// Codigos da tabela FCDL/SC (jan/2026) — produtos mais usados pelo CRM
// ============================================================================
export const PRODUTOS_SPC = {
  // PRODUTO PADRAO do pacote economico (PF e PJ): "Novo SPC Maxi" — completo e barato
  NOVO_SPC_MAXI: { codigo: '325', label: 'Novo SPC Maxi', valor: 5.62 },
  // Alternativas mais simples
  CNPJ_SPC: { codigo: '480', label: 'Consulta CNPJ SPC', valor: 7.85 },
  CPF_SPC: { codigo: '479', label: 'Consulta CPF SPC', valor: 7.85 },
  SPC_SCORE: { codigo: '141', label: 'SPC Score', valor: 2.98 },
  // Alternativas mais completas/caras
  SPC_TOP_PJ: { codigo: '8', label: 'SPC Top Juridico', valor: 34.68 },
  SPC_TOP_PF: { codigo: '7', label: 'SPC Top Fisica', valor: 6.83 },
  RELATORIO_COMPLETO_PJ: { codigo: '337', label: 'SPC Relatorio Completo PJ', valor: 19.53 },
} as const

// Insumos opcionais (links que acompanham o produto principal).
// IMPORTANTE: codigo = código INTERNO da API REST (ver "Todos produtos
// detalhado - Produção.txt" do manual). NÃO é o código da tabela de preços
// FCDL/SC — a API usa códigos internos diferentes. Testado em produção
// (29/05/2026) pra produto 325 (Novo SPC Maxi), todos retornaram 200 OK.
// O campo "valor" usa preço estimado da tabela FCDL/SC quando há match.
export const INSUMOS_OPCIONAIS = {
  // Pacote economico
  SCORE_12_MESES: { codigo: 78, label: 'Score 12 Meses', valor: 1.13 },
  SCORE_3_MESES: { codigo: 77, label: 'Score 3 Meses', valor: 1.13 },
  PARTICIPACAO_EMPRESAS: { codigo: 24, label: 'Participacao em Empresas', valor: 2.72 },
  PEP: { codigo: 5255, label: 'Pessoa Exposta Politicamente', valor: 1.02 },
  // Cadastrais
  SOCIO: { codigo: 23, label: 'Socio', valor: 0 },
  ADMINISTRADOR: { codigo: 49, label: 'Administrador', valor: 0 },
  STATUS_RECEITA_FEDERAL: { codigo: 5183, label: 'Status Receita Federal Online', valor: 0.33 },
  INSCRICAO_ESTADUAL: { codigo: 5263, label: 'Inscricao Estadual', valor: 1.20 },
  // Completo
  FATURAMENTO_PRESUMIDO_PJ: { codigo: 5178, label: 'Faturamento Presumido PJ', valor: 17.09 },
  QUADRO_SOCIAL_COMPLETO: { codigo: 5186, label: 'Quadro Social Mais Completo PJ', valor: 16.21 },
  GRUPO_ECONOMICO: { codigo: 5241, label: 'Grupo Economico', valor: 6.49 },
  RISCO_CREDITO_PJ: { codigo: 5184, label: 'Risco de Credito PJ', valor: 16.21 },
  LIMITE_CREDITO_SUGERIDO: { codigo: 5142, label: 'Limite de Credito Sugerido', valor: 1.96 },
  SCORE_PJ: { codigo: 5229, label: 'Score PJ', valor: 4.91 },
  // Antifraude
  ALERTA_CPF_SUSPEITO: { codigo: 5264, label: 'Alerta CPF Suspeito', valor: 1.72 },
  ALERTA_IDENTIDADE_FRAUDE: { codigo: 5262, label: 'Alerta Identidade Fraude', valor: 0.78 },
  ANALISE_DOCUMENTOS: { codigo: 5266, label: 'Analise Documentos SPC', valor: 5.69 },
  VALIDA_CELULAR: { codigo: 5268, label: 'Valida Celular', valor: 1.07 },
  // Outros
  ACAO: { codigo: 18, label: 'Acao', valor: 4.59 },
  RENDA_PRESUMIDA_PF: { codigo: 5097, label: 'Renda Presumida PF', valor: 1.46 },
  COMPROMETIMENTO_RENDA: { codigo: 5194, label: 'Comprometimento Renda Mensal PF', valor: 13.56 },
  SPC_OBITO: { codigo: 3082, label: 'SPC Obito', valor: 0.57 },
} as const

export function calcularCustoPacote(opts: {
  produto: string
  insumos?: number[]
}): number {
  const produtoValor =
    Object.values(PRODUTOS_SPC).find(p => p.codigo === opts.produto)?.valor ?? 0
  const insumosValor = (opts.insumos ?? []).reduce((acc, cod) => {
    const found = Object.values(INSUMOS_OPCIONAIS).find(i => i.codigo === cod)
    return acc + (found?.valor ?? 0)
  }, 0)
  return Number((produtoValor + insumosValor).toFixed(2))
}
