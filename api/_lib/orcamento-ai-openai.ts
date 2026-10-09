import type { IntencaoOrcamento } from '../../src/lib/orcamento-ai/types.js'
import { normalizeIntent } from '../../src/lib/orcamento-ai/intent-normalizer.js'
import { BRANORTE_VOCAB } from './branorte-vocab.js'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Corrige localmente apenas termos que realmente apareceram no pedido.
 * O catálogo/glossário completo nunca é enviado ao provedor de IA. */
export function normalizeKnownTerms(message: string): string {
  return BRANORTE_VOCAB.confusoes_conhecidas.reduce((current, entry) => {
    if (entry.errado === entry.certo) return current
    const term = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(entry.errado)})(?=$|[^\\p{L}\\p{N}])`, 'giu')
    return current.replace(term, (_match, prefix: string) => `${prefix}${entry.certo}`)
  }, message)
}

const INTENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['operacao', 'cliente', 'modeloPedido', 'itensPedidos', 'condicoes', 'instrucoesExplicitas'],
  properties: {
    operacao: { type: 'string', enum: ['novo', 'editar', 'consultar', 'finalizar'] },
    cliente: {
      type: 'object', additionalProperties: false,
      required: ['nome', 'telefone', 'cidade', 'uf', 'endereco', 'bairro', 'cep', 'cpfCnpj', 'ie', 'email', 'contato'],
      properties: Object.fromEntries(['nome', 'telefone', 'cidade', 'uf', 'endereco', 'bairro', 'cep', 'cpfCnpj', 'ie', 'email', 'contato'].map((key) => [key, { type: ['string', 'null'] }])),
    },
    modeloPedido: {
      type: ['object', 'null'], additionalProperties: false,
      required: ['linha', 'master', 'producaoKgH', 'armazenamentoKg', 'dimensoes', 'voltagem', 'basenameToken', 'textoOriginal'],
      properties: {
        linha: { type: ['string', 'null'], enum: ['MINI', 'COMPACTA_01', 'COMPACTA_02', 'COMPACTA_03', null] },
        master: { type: ['boolean', 'null'] }, producaoKgH: { type: ['number', 'null'] }, armazenamentoKg: { type: ['number', 'null'] },
        dimensoes: { type: ['array', 'null'], items: { type: 'number' } },
        voltagem: { type: ['string', 'null'], enum: ['monofasico', 'trifasico', null] },
        basenameToken: { type: ['string', 'null'] }, textoOriginal: { type: ['string', 'null'] },
      },
    },
    itensPedidos: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['textoOriginal', 'categoria', 'quantidade', 'diametroMm', 'comprimentoM', 'capacidade', 'unidadeCapacidade', 'motorCv', 'semFunil'],
        properties: {
          textoOriginal: { type: 'string' }, categoria: { type: ['string', 'null'] }, quantidade: { type: 'number' },
          diametroMm: { type: ['number', 'null'] }, comprimentoM: { type: ['number', 'null'] }, capacidade: { type: ['number', 'null'] },
          unidadeCapacidade: { type: ['string', 'null'], enum: ['kg', 'litros', 'toneladas', null] }, motorCv: { type: ['number', 'null'] }, semFunil: { type: ['boolean', 'null'] },
        },
      },
    },
    condicoes: {
      type: 'object', additionalProperties: false,
      required: ['formaPagamento', 'prazoDias', 'prazoTipo', 'freteTipo', 'freteTexto', 'validadeDias', 'observacoes'],
      properties: {
        formaPagamento: { type: ['string', 'null'] },
        prazoDias: { type: ['number', 'null'], minimum: 0 },
        prazoTipo: { type: ['string', 'null'], enum: ['uteis', 'corridos', 'pronta_entrega', null] },
        freteTipo: { type: ['string', 'null'], enum: ['FOB', 'CIF', null] },
        freteTexto: { type: ['string', 'null'] },
        validadeDias: { type: ['number', 'null'], minimum: 0 },
        observacoes: { type: ['string', 'null'] },
      },
    },
    instrucoesExplicitas: {
      type: 'object', additionalProperties: false,
      required: ['preservarAcessoriosDoModelo', 'alterarAcessorios', 'percentualAcessorios', 'itensAcessorios', 'enviarWhatsapp'],
      properties: {
        preservarAcessoriosDoModelo: { type: ['boolean', 'null'] },
        alterarAcessorios: { type: ['boolean', 'null'] },
        percentualAcessorios: { type: ['number', 'null'], minimum: 0, maximum: 50 },
        itensAcessorios: { type: 'array', items: { type: 'string' } },
        enviarWhatsapp: { type: ['boolean', 'null'] },
      },
    },
  },
} as const

export async function interpretQuoteRequest(message: string, apiKey: string, model = process.env.OPENAI_ORCAMENTO_MODEL || 'gpt-6-luna'): Promise<IntencaoOrcamento> {
  const normalizedMessage = normalizeKnownTerms(message)
  const deterministic = normalizeIntent({ texto: normalizedMessage })
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      instructions: 'Extraia apenas o pedido do vendedor para um orçamento Branorte. Não invente preço, ID, modelo, acessório, condição ou dado do cliente. Preserve medidas, nomes, forma de pagamento, prazo, frete e observações exatamente como informados. Quando houver modelo pronto, itensPedidos deve conter somente equipamentos adicionais pedidos fora do modelo, nunca os componentes já pertencentes ao modelo. Boca de entrada, boca de descarga/saída, torre de fixação e base do moinho citadas como acessórios devem ir em itensAcessorios, não em itensPedidos. A correção mais recente do vendedor sempre vence a informação anterior. Não confunda elevador de sacaria com elevador de canecas ou ensacadeira; nem caixa de material picado com caixa de ração, caçamba de pesagem, silo ou moega. Quando um atributo não foi informado, retorne null; para listas não informadas, retorne []. Responda somente no schema.',
      input: normalizedMessage,
      text: { format: { type: 'json_schema', name: 'intencao_orcamento', strict: true, schema: INTENT_SCHEMA } },
    }),
  })
  if (!response.ok) throw new Error('openai_request_failed')
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
  const raw = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text
  if (!raw) throw new Error('openai_invalid_output')
  const parsed = removeNulls(JSON.parse(raw)) as Partial<IntencaoOrcamento>
  return {
    ...deterministic,
    ...parsed,
    cliente: parsed.cliente ?? deterministic.cliente,
    modeloPedido: deterministic.modeloPedido
      ? mergeDefined(parsed.modeloPedido ?? {}, deterministic.modeloPedido)
      : parsed.modeloPedido,
    itensPedidos: parsed.itensPedidos ?? deterministic.itensPedidos,
    instrucoesExplicitas: { ...deterministic.instrucoesExplicitas, ...(parsed.instrucoesExplicitas ?? {}) },
    ambiguidades: [],
  }
}

function mergeDefined<T extends object>(base: Partial<T>, override: Partial<T>): T {
  return Object.fromEntries([
    ...Object.entries(base),
    ...Object.entries(override).filter(([, value]) => value !== undefined),
  ]) as T
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null).map(([key, item]) => [key, removeNulls(item)]))
  return value
}
