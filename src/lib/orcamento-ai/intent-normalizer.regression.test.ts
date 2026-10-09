import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeIntent } from './intent-normalizer'

test('preserva o codigo curto 150500 da Compacta 01', () => {
  const intent = normalizeIntent({
    texto: 'Compacta 01 Master 150500 trifásica',
  })

  assert.equal(intent.modeloPedido?.basenameToken, '150500')
  assert.equal(intent.modeloPedido?.linha, 'COMPACTA_01')
  assert.equal(intent.modeloPedido?.voltagem, 'trifasico')
})

test('preserva o codigo curto 30150 da Mini Fabrica', () => {
  const intent = normalizeIntent({
    texto: 'Mini Fábrica 30150 trifásica',
  })

  assert.equal(intent.modeloPedido?.basenameToken, '30150')
  assert.equal(intent.modeloPedido?.linha, 'MINI')
  assert.equal(intent.modeloPedido?.voltagem, 'trifasico')
})

test('preserva o codigo curto 1001000 da Compacta 01', () => {
  const intent = normalizeIntent({
    texto: 'Compacta 01 Master 1001000 trifásica',
  })

  assert.equal(intent.modeloPedido?.basenameToken, '1001000')
  assert.equal(intent.modeloPedido?.linha, 'COMPACTA_01')
  assert.equal(intent.modeloPedido?.voltagem, 'trifasico')
})

test('a correcao mais recente vence para linha e voltagem', () => {
  const intent = normalizeIntent({
    texto:
      'Quero a Compacta 03 150500 monofásica. Corrigindo: é Compacta 02 150500 trifásica.',
  })

  assert.equal(intent.modeloPedido?.basenameToken, '150500')
  assert.equal(intent.modeloPedido?.linha, 'COMPACTA_02')
  assert.equal(intent.modeloPedido?.voltagem, 'trifasico')
})
