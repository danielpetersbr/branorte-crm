import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepararSomVenda, tocarSomVenda, marcarVendaAnunciada, reivindicarVenda, vendaJaAnunciada, vendaLancadaAqui,
} from './somVenda'

// localStorage de mentira, compartilhado — como as abas de um mesmo navegador.
function armazemFalso() {
  const dados = new Map<string, string>()
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v) },
    removeItem: (k: string) => { dados.delete(k) },
    clear: () => dados.clear(),
    key: () => null,
    get length() { return dados.size },
  } as Storage
}

// Sem `window` (nem AudioContext) o som some em silêncio: nunca pode derrubar o pedido.
test('som de venda não lança erro quando não há áudio', () => {
  assert.doesNotThrow(() => prepararSomVenda())
  assert.doesNotThrow(() => tocarSomVenda())
})

test('duas abas que veem a mesma venda: só uma toca', async () => {
  ;(globalThis as { localStorage?: Storage }).localStorage = armazemFalso()
  const [a, b] = await Promise.all([reivindicarVenda('pedido-1', 20), reivindicarVenda('pedido-1', 20)])
  assert.equal(Number(a) + Number(b), 1)
  // a aba que chega depois não toca de novo
  assert.equal(await reivindicarVenda('pedido-1', 5), false)
  assert.equal(vendaJaAnunciada('pedido-1'), true)
})

test('quem lançou o pedido não recebe o aviso de novo', async () => {
  ;(globalThis as { localStorage?: Storage }).localStorage = armazemFalso()
  marcarVendaAnunciada('pedido-2')
  assert.equal(vendaLancadaAqui('pedido-2'), true)
  assert.equal(await reivindicarVenda('pedido-2', 5), false)
  // venda de outro vendedor continua sendo anunciada
  assert.equal(vendaLancadaAqui('pedido-3'), false)
  assert.equal(await reivindicarVenda('pedido-3', 5), true)
  assert.equal(vendaLancadaAqui('pedido-3'), false)
})
