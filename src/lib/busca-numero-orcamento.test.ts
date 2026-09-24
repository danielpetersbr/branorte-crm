import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerNumeroOrcamento, semSeparadores } from './busca-numero-orcamento'

test('número com ano, em todos os jeitos que o pessoal digita', () => {
  for (const t of ['2026-0241', '2026 - 0241', '2026 – 0241', '2026/0241', '2026.0241', '20260241', ' 2026-241 ']) {
    const r = lerNumeroOrcamento(t)
    assert.ok(r, t)
    assert.equal(r.ano, 2026, t)
    assert.ok(r.variantes.includes('0241'), t)
    assert.ok(r.variantes.includes('241'), t)
  }
})

test('só o número: sem ano, com e sem zero à esquerda (a pasta até 2020 grava "241")', () => {
  assert.deepEqual(lerNumeroOrcamento('0241'), { ano: null, variantes: ['0241', '241'] })
  assert.deepEqual(lerNumeroOrcamento('241'), { ano: null, variantes: ['241', '0241'] })
})

test('texto não é número: segue a busca por cliente/equipamento', () => {
  assert.equal(lerNumeroOrcamento('Maria do Carmo'), null)
  assert.equal(lerNumeroOrcamento('misturador 1000'), null)
  assert.equal(lerNumeroOrcamento(''), null)
})

test('semSeparadores casa o digitado com o gravado', () => {
  assert.ok(semSeparadores('2026 - 0241 maria do carmo').includes(semSeparadores('2026-0241')))
  assert.ok(semSeparadores('2026 – 0241').includes(semSeparadores('2026/0241')))
})
