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

test('keeps master undefined when seller did not say master or standard', () => {
  const intent = normalizeIntent({ texto: 'compacta 3 150500-4000-4000 monofásica' })
  assert.equal(intent.modeloPedido?.master, undefined)
  assert.equal(intent.modeloPedido?.voltagem, 'monofasico')
})

test('recognizes compact model tokens used by real Branorte requests', () => {
  assert.equal(normalizeIntent({ texto: 'Compacta 02 150500 monofásica' }).modeloPedido?.basenameToken, '150500')
  assert.equal(normalizeIntent({ texto: 'Mini fábrica 30150 tri' }).modeloPedido?.basenameToken, '30150')
  assert.equal(normalizeIntent({ texto: 'Compacta 01 1001000 tri' }).modeloPedido?.basenameToken, '1001000')
})

test('does not use a phone or document number as the model token', () => {
  const intent = normalizeIntent({ texto: 'Compacta 02 trifásica para João, telefone 9192514886, CPF 01058112201' })
  assert.equal(intent.modeloPedido?.basenameToken, undefined)
})

test('latest correction wins for line, voltage and master variant', () => {
  const intent = normalizeIntent({ texto: 'Compacta 03 Master 150500 mono. Correção: Compacta 02 padrão 150500 trifásica.' })
  assert.equal(intent.modeloPedido?.linha, 'COMPACTA_02')
  assert.equal(intent.modeloPedido?.basenameToken, '150500')
  assert.equal(intent.modeloPedido?.master, false)
  assert.equal(intent.modeloPedido?.voltagem, 'trifasico')
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
