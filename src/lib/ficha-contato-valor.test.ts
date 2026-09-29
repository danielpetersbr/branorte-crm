import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerValorBR } from './financeiro-valor'

// (29/09/2026) O "Valor Estimado" da ficha do contato (ContactDetail) fazia
// parseFloat(texto.replace(/[^\d.,]/g, '').replace(',', '.')). Passou a usar lerValorBR.

/** O parser antigo da ficha, só pra provar o bug. */
const parserAntigo = (s: string) => parseFloat(s.replace(/[^\d.,]/g, '').replace(',', '.'))

test('ficha do contato: o parser antigo gravava 1000× menos', () => {
  assert.equal(parserAntigo('R$ 45.000,00'), 45)
  assert.equal(parserAntigo('1.500,00'), 1.5)
  assert.equal(parserAntigo('15.000'), 15)
})

test('ficha do contato: lerValorBR lê o jeito brasileiro', () => {
  assert.equal(lerValorBR('R$ 45.000,00'), 45000)
  assert.equal(lerValorBR('1.500,00'), 1500)
  assert.equal(lerValorBR('15.000'), 15000)
  assert.equal(lerValorBR('45000'), 45000)
})

test('ficha do contato: o campo reabre com String(meta.valor) e salvar de novo não muda o número', () => {
  for (const v of [45000, 1500.5, 1500, 0.5, 1234567]) {
    assert.equal(lerValorBR(String(v)), v, `String(${v}) = "${String(v)}"`)
  }
})
