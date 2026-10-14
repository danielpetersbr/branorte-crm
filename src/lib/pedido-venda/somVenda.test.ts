import assert from 'node:assert/strict'
import test from 'node:test'
import { prepararSomVenda, tocarSomVenda } from './somVenda'

// Sem `window` (nem AudioContext) o som some em silêncio: nunca pode derrubar o pedido.
test('som de venda não lança erro quando não há áudio', () => {
  assert.doesNotThrow(() => prepararSomVenda())
  assert.doesNotThrow(() => tocarSomVenda())
})
