import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMoeda } from './moeda.js'

test('parseMoeda: o jeito brasileiro de escrever o frete', () => {
  assert.equal(parseMoeda('16.500'), 16500)      // era gravado como R$ 16,50
  assert.equal(parseMoeda('16.500,00'), 16500)   // era NaN ("valor obrigatório")
  assert.equal(parseMoeda('1.234,56'), 1234.56)  // era NaN
  assert.equal(parseMoeda('16,5'), 16.5)
  assert.equal(parseMoeda('0,00'), 0)
  assert.equal(parseMoeda('R$ 1.500.000,00'), 1500000)
  assert.equal(parseMoeda(' 2.500 '), 2500)
})

test('parseMoeda: o valor que o formulário pré-preenche do banco (String(numero)) volta igual', () => {
  assert.equal(parseMoeda(String(16500)), 16500)
  assert.equal(parseMoeda(String(1500.5)), 1500.5)
  assert.equal(parseMoeda(String(1234.56)), 1234.56)
  assert.equal(parseMoeda(16500), 16500)
  assert.equal(parseMoeda(1234.56), 1234.56)
})

test('parseMoeda: lixo vira NaN — melhor recusar do que gravar um número inventado', () => {
  for (const lixo of ['', '   ', 'abc', 'dezesseis mil', '16.500 reais', '-500', '12.34,56', '1,2,3', '1.234.56']) {
    assert.ok(Number.isNaN(parseMoeda(lixo)), `"${lixo}" devia dar NaN`)
  }
  assert.ok(Number.isNaN(parseMoeda(null)))
  assert.ok(Number.isNaN(parseMoeda(undefined)))
  assert.ok(Number.isNaN(parseMoeda(Number.NaN)))
  assert.ok(Number.isNaN(parseMoeda(Infinity)))
})
