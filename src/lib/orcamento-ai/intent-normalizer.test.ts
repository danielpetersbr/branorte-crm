import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeIntent } from './intent-normalizer'

test('preserves exact compacta basename token instead of guessing its decomposition', () => {
  const intent = normalizeIntent({ texto: 'Compacta 03 Master 150500-4000-4000 mono' })
  assert.equal(intent.modeloPedido?.linha, 'COMPACTA_03')
  assert.equal(intent.modeloPedido?.basenameToken, '150500-4000-4000')
  assert.equal(intent.modeloPedido?.master, true)
  assert.equal(intent.modeloPedido?.voltagem, 'monofasico')
})

test('does not infer master when seller did not say master', () => {
  const intent = normalizeIntent({ texto: 'compacta 3 150500-4000-4000 monofásica' })
  assert.equal(intent.modeloPedido?.master, false)
  assert.equal(intent.modeloPedido?.voltagem, 'monofasico')
})

test('recognizes support for bag without funnel as an exact constraint', () => {
  const intent = normalizeIntent({ texto: 'quero um suporte para bag sem funil' })
  assert.equal(intent.itensPedidos[0]?.categoria, 'SUPORTE_BAG')
  assert.equal(intent.itensPedidos[0]?.semFunil, true)
})

test('defaults voltage to undefined instead of silently assuming one', () => {
  const intent = normalizeIntent({ texto: 'Compacta 02 Master 150500-4000-4000' })
  assert.equal(intent.modeloPedido?.voltagem, undefined)
})

test('captures an explicit accessory percentage', () => {
  assert.equal(normalizeIntent({ texto: 'coloca acessórios 10%' }).instrucoesExplicitas.percentualAcessorios, 10)
})
