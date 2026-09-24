import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerValorBR, hojeSP } from './financeiro-valor.js'

test('lerValorBR: o jeito brasileiro de digitar dinheiro', () => {
  assert.equal(lerValorBR('15000'), 15000)
  assert.equal(lerValorBR('15000,50'), 15000.5)
  assert.equal(lerValorBR('15.000'), 15000)
  assert.equal(lerValorBR('15.000,50'), 15000.5)
  assert.equal(lerValorBR('1.500.000,00'), 1500000)
  assert.equal(lerValorBR('R$ 1.234,56'), 1234.56)
  assert.equal(lerValorBR(' 2.500 '), 2500)
  assert.equal(lerValorBR('0,5'), 0.5)
})

test('lerValorBR: o valor que o próprio campo sugere (saldo.toFixed(2)) continua valendo', () => {
  assert.equal(lerValorBR('15000.50'), 15000.5)
  assert.equal(lerValorBR('15000.00'), 15000)
  assert.equal(lerValorBR('999.9'), 999.9)
})

test('lerValorBR: o bug antigo — "15.000" NÃO pode virar 15 reais', () => {
  assert.notEqual(lerValorBR('15.000'), 15)
  assert.notEqual(lerValorBR('150.000'), 150)
})

test('lerValorBR: na dúvida trava em vez de inventar número', () => {
  for (const ruim of ['', 'abc', '15,000,00', '1.50,00', '15.0000', '15,123', '1.5.0', '-100', '12a']) {
    assert.ok(Number.isNaN(lerValorBR(ruim)), `"${ruim}" deveria ser NaN`)
  }
})

test('hojeSP: 22h em Brasília ainda é hoje, não amanhã (o bug do toISOString)', () => {
  // 2026-09-24 22:30 em Brasília = 2026-09-25 01:30 UTC
  const noite = new Date('2026-09-25T01:30:00Z')
  assert.equal(noite.toISOString().slice(0, 10), '2026-09-25') // o que a tela usava
  assert.equal(hojeSP(noite), '2026-09-24')
})
