import type { IntencaoOrcamento } from '../../src/lib/orcamento-ai/types.js'
import { normalizeIntent } from '../../src/lib/orcamento-ai/intent-normalizer.js'

const INTENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['operacao', 'cliente', 'modeloPedido', 'itensPedidos', 'instrucoesExplicitas'],
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
    instrucoesExplicitas: {
      type: 'object', additionalProperties: false,
      required: ['preservarAcessoriosDoModelo', 'alterarAcessorios', 'percentualAcessorios', 'enviarWhatsapp'],
      properties: { preservarAcessoriosDoModelo: { type: ['boolean', 'null'] }, alterarAcessorios: { type: ['boolean', 'null'] }, percentualAcessorios: { type: ['number', 'null'], minimum: 0, maximum: 50 }, enviarWhatsapp: { type: ['boolean', 'null'] } },
    },
  },
} as const

export async function interpretQuoteRequest(message: string, apiKey: string, model = process.env.OPENAI_ORCAMENTO_MODEL || 'gpt-5.4-mini'): Promise<IntencaoOrcamento> {
  const deterministic = normalizeIntent({ texto: message })
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: 'Extraia apenas o pedido do vendedor para um orçamento Branorte. Não invente preço, ID, modelo ou acessório. Preserve medidas e nomes exatamente. Quando houver modelo pronto, itensPedidos deve conter somente equipamentos adicionais pedidos fora do modelo, nunca os componentes já pertencentes ao modelo. Considere a confirmação mais recente do vendedor como definitiva. Responda somente no schema.',
      input: message,
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
    modeloPedido: deterministic.modeloPedido ? { ...(parsed.modeloPedido ?? {}), ...deterministic.modeloPedido } : parsed.modeloPedido,
    itensPedidos: parsed.itensPedidos ?? deterministic.itensPedidos,
    instrucoesExplicitas: { ...deterministic.instrucoesExplicitas, ...(parsed.instrucoesExplicitas ?? {}) },
    ambiguidades: [],
  }
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null).map(([key, item]) => [key, removeNulls(item)]))
  return value
}
