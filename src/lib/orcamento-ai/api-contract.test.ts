import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compacta03Master150500Mono, emptyQuoteSnapshot } from './__fixtures__/compacta-03-master-150500-mono'
import { createOrcamentoAIService } from '../../../api/_lib/orcamento-ai-service'
import type { IntencaoOrcamento } from './types'

const intent: IntencaoOrcamento = {
  operacao: 'novo', cliente: { nome: 'Ronaldo Biazi' },
  modeloPedido: { linha: 'COMPACTA_03', master: true, voltagem: 'monofasico', basenameToken: '150500-4000-4000' },
  itensPedidos: [], instrucoesExplicitas: { preservarAcessoriosDoModelo: true }, ambiguidades: [],
}

function service(overrides: Partial<Parameters<typeof createOrcamentoAIService>[0]> = {}) {
  return createOrcamentoAIService({
    authenticate: async () => ({ ok: true, seller: { userId: 'u1', email: 'seller@example.com', sellerId: 7, isAdmin: false } }),
    interpret: async () => intent,
    findModels: async () => [compacta03Master150500Mono],
    ...overrides,
  })
}

test('rejects missing and invalid sessions', async () => {
  assert.equal((await service().execute({ token: '', body: {} })).status, 401)
  const invalid = service({ authenticate: async () => ({ ok: false, status: 401, error: 'invalid_jwt' }) })
  assert.equal((await invalid.execute({ token: 'bad', body: { message: 'oi', snapshot: emptyQuoteSnapshot } })).status, 401)
})

test('returns a complete validated proposal for an authenticated seller', async () => {
  const result = await service().execute({ token: 'valid', body: { message: 'Compacta 03 Master 150500-4000-4000 mono', snapshot: emptyQuoteSnapshot } })
  assert.equal(result.status, 200)
  assert.equal(result.body.proposal?.modelo?.basename, compacta03Master150500Mono.basename)
  assert.equal(result.body.proposal?.totais.proposta, 222934.2)
  assert.equal(result.body.questions.length, 0)
})

test('returns questions and no proposal for ambiguous models', async () => {
  const other = { ...compacta03Master150500Mono, id: 2608, basename: `${compacta03Master150500Mono.basename} alternativa` }
  const result = await service({ findModels: async () => [compacta03Master150500Mono, other] })
    .execute({ token: 'valid', body: { message: 'Compacta 03 Master mono', snapshot: emptyQuoteSnapshot } })
  assert.equal(result.status, 200)
  assert.equal(result.body.proposal, null)
  assert.ok(result.body.questions.length > 0)
})

test('keeps the explicitly selected model on the next seller message', async () => {
  let selectedSeen: string | undefined
  const result = await service({
    findModels: async (_intent, _seller, selectedModelId) => {
      selectedSeen = selectedModelId
      return [compacta03Master150500Mono]
    },
  }).execute({
    token: 'valid',
    body: {
      message: 'Acrescente uma ensacadeira',
      snapshot: emptyQuoteSnapshot,
      selected_model_id: String(compacta03Master150500Mono.id),
    },
  })
  assert.equal(selectedSeen, String(compacta03Master150500Mono.id))
  assert.equal(result.body.proposal?.modelo?.id, compacta03Master150500Mono.id)
  assert.equal(result.body.questions.length, 0)
})

test('adds requested equipment to a selected factory model without changing its accessories', async () => {
  const withExtra: IntencaoOrcamento = {
    ...intent,
    itensPedidos: [{ textoOriginal: 'uma ensacadeira de saco aberto', categoria: 'ENSACADEIRA', quantidade: 1 }],
  }
  const result = await service({
    interpret: async () => withExtra,
    resolveItems: async () => ({
      itens: [{ catalogoId: 999, nome: 'ENSACADEIRA SACO ABERTO', quantidade: 1, valorUnitario: 26400, categoria: 'ENSACADEIRA' }],
      motores: [],
      perguntas: [],
    }),
  }).execute({ token: 'valid', body: { message: 'Compacta e mais uma ensacadeira', snapshot: emptyQuoteSnapshot, selected_model_id: String(compacta03Master150500Mono.id) } })
  assert.equal(result.body.proposal?.itens.length, compacta03Master150500Mono.itens.length + 1)
  assert.deepEqual(result.body.proposal?.acessorios, compacta03Master150500Mono.acessorios)
})

test('never exposes server secrets in responses or errors', async () => {
  const result = await service({ interpret: async () => { throw new Error('OPENAI_API_KEY=secret SUPABASE_SERVICE_ROLE_KEY=secret') } })
    .execute({ token: 'valid', body: { message: 'teste', snapshot: emptyQuoteSnapshot } })
  assert.equal(result.status, 500)
  assert.doesNotMatch(JSON.stringify(result.body), /secret|OPENAI_API_KEY|SERVICE_ROLE/i)
})

test('orçamentista usa GPT-5.6 Luna como modelo padrão econômico', async () => {
  const source = await readFile(new URL('../../../api/_lib/orcamento-ai-openai.ts', import.meta.url), 'utf8')

  assert.match(source, /OPENAI_ORCAMENTO_MODEL\s*\|\|\s*'gpt-5\.6-luna'/)
})

test('builds an ad-hoc equipment proposal with explicit 10 percent accessories', async () => {
  const customIntent: IntencaoOrcamento = {
    operacao: 'novo', cliente: { nome: 'Breno' }, itensPedidos: [{ textoOriginal: 'chupim 160 x 3,5', quantidade: 1 }],
    instrucoesExplicitas: { percentualAcessorios: 10 }, ambiguidades: [],
  }
  const result = await service({
    interpret: async () => customIntent,
    findModels: async () => [],
    resolveItems: async () => ({
      itens: [{ catalogoId: 10, nome: 'CHUPIM 160 X 3,5 M', quantidade: 1, valorUnitario: 5795 }],
      motores: [{ itemCatalogoId: 10, descricao: 'Motor 1,5 CV 4 polos', cv: 1.5, polos: 4, valor: 2536, incluso: false }],
      perguntas: [],
    }),
  }).execute({ token: 'valid', body: { message: 'Breno, chupim 160 x 3,5 e acessórios 10%', snapshot: emptyQuoteSnapshot } })
  assert.equal(result.status, 200)
  assert.equal(result.body.proposal?.acessorios?.percentual, 10)
  assert.equal(result.body.proposal?.totais.acessorios, 579.5)
  assert.equal(result.body.proposal?.totais.proposta, 8910.5)
})
