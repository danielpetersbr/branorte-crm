import test from 'node:test'
import assert from 'node:assert/strict'
import { matchModel } from './model-matcher'
import type { IntencaoOrcamento, ModeloCandidato } from './types'

const baseModel: ModeloCandidato = {
  id: 10,
  basename: 'Compacta 03 Master - 150500 - 4000 - 4000 com ensacadeira',
  linha: 'COMPACTA_03',
  master: true,
  voltagem: 'monofasico',
  itens: [],
  motores: [],
  acessorios: null,
}

const intent: IntencaoOrcamento = {
  operacao: 'novo',
  cliente: {},
  modeloPedido: {
    linha: 'COMPACTA_03',
    master: true,
    voltagem: 'monofasico',
    basenameToken: '150500-4000-4000',
  },
  itensPedidos: [],
  instrucoesExplicitas: {},
  ambiguidades: [],
}

test('matches exact line, master, voltage and basename token', () => {
  const result = matchModel(intent, [baseModel])
  assert.equal(result.status, 'exato')
  assert.equal(result.match?.id, 10)
})

test('requires a choice instead of selecting a different voltage', () => {
  const result = matchModel(intent, [{ ...baseModel, id: 11, voltagem: 'trifasico' }])
  assert.equal(result.status, 'requer_escolha')
  assert.equal(result.match, null)
})

test('never selects master when standard was requested', () => {
  const standardIntent = { ...intent, modeloPedido: { ...intent.modeloPedido!, master: false } }
  const result = matchModel(standardIntent, [baseModel])
  assert.notEqual(result.status, 'exato')
})

test('returns ambiguity when more than one exact candidate remains', () => {
  const result = matchModel(intent, [baseModel, { ...baseModel, id: 12 }])
  assert.equal(result.status, 'requer_escolha')
  assert.equal(result.alternatives.length, 2)
})
