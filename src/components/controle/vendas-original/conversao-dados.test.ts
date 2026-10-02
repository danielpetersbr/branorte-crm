import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diasEntreContatoEVenda, conversaoNoMesmoMes } from './conversao-dados'

for (const ausente of [null, undefined, '']) {
  test(`data ausente ${String(ausente)} não vira tempo zero ou conversão rápida`, () => {
    for (const [contato, venda] of [[ausente, '2026-09-10'], ['2026-09-01', ausente]]) {
      assert.equal(diasEntreContatoEVenda(contato, venda), null)
      assert.equal(conversaoNoMesmoMes(contato, venda), false)
    }
  })
}

for (const invalida of ['não-é-data', '2026-1-01', '2026-00-10', '2026-13-01', '2026-01-00', '2026-02-29', '2026-04-31', '1900-02-29']) {
  test(`data civil inválida ${invalida} não é normalizada para outro dia`, () => {
    assert.equal(diasEntreContatoEVenda(invalida, '2026-12-31'), null)
    assert.equal(diasEntreContatoEVenda('1900-01-01', invalida), null)
    assert.equal(conversaoNoMesmoMes(invalida, invalida), false)
  })
}

test('contato posterior à venda no mesmo mês não entra na média nem nas conversões rápidas', () => {
  assert.equal(diasEntreContatoEVenda('2026-09-15', '2026-09-10'), null)
  assert.equal(conversaoNoMesmoMes('2026-09-15', '2026-09-10'), false)
})

test('contato posterior à venda em outro ano continua inválido', () => {
  assert.equal(diasEntreContatoEVenda('2027-01-01', '2026-12-31'), null)
  assert.equal(conversaoNoMesmoMes('2027-01-01', '2026-12-31'), false)
})

test('contato e venda no mesmo dia civil produzem zero dias e conversão rápida', () => {
  assert.equal(diasEntreContatoEVenda('2026-09-10', '2026-09-10'), 0)
  assert.equal(conversaoNoMesmoMes('2026-09-10', '2026-09-10'), true)
})

test('timestamps usam somente o prefixo civil e ignoram hora e fuso', () => {
  const contato = '2026-03-08T23:45:00-12:00'
  const venda = '2026-03-08T00:15:00+14:00'
  assert.equal(diasEntreContatoEVenda(contato, venda), 0)
  assert.equal(conversaoNoMesmoMes(contato, venda), true)
})

test('ano bissexto real e século divisível por400 preservam29 de fevereiro', () => {
  assert.equal(diasEntreContatoEVenda('2024-02-28', '2024-03-01'), 2)
  assert.equal(diasEntreContatoEVenda('2000-02-28', '2000-03-01'), 2)
  assert.equal(diasEntreContatoEVenda('2024-02-29', '2024-02-29'), 0)
  assert.equal(conversaoNoMesmoMes('2024-02-29', '2024-02-29'), true)
})

test('diferença em dias fica inteira nas transições de horário de verão', () => {
  assert.equal(diasEntreContatoEVenda('2026-03-07', '2026-03-09'), 2)
  assert.equal(diasEntreContatoEVenda('2026-10-31', '2026-11-02'), 2)
})

test('conversão rápida exige mesmo mês e ano depois de validar a ordem cronológica', () => {
  assert.equal(diasEntreContatoEVenda('2026-09-01', '2026-09-10'), 9)
  assert.equal(conversaoNoMesmoMes('2026-09-01', '2026-09-10'), true)
  assert.equal(conversaoNoMesmoMes('2026-09-30', '2026-10-01'), false)
  assert.equal(conversaoNoMesmoMes('2025-09-01', '2026-09-10'), false)
})
