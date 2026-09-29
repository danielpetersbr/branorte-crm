import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoPorSnapshot } from './memo-por-snapshot'

test('mesma (snapshot, chave) = mesma conta e o MESMO objeto para todos os observers', () => {
  let chamadas = 0
  const agrega = memoPorSnapshot((s: { rows: number[] }, preset: string) => {
    chamadas++
    return { preset, total: s.rows.length }
  })
  const bruto = { rows: [1, 2, 3] }
  const a = agrega(bruto, '30d')
  const b = agrega(bruto, '30d')
  assert.equal(a, b)
  assert.equal(chamadas, 1)
})

test('trocar o preset recalcula sobre o MESMO bruto e volta ao anterior sem recalcular', () => {
  let chamadas = 0
  const agrega = memoPorSnapshot((s: { rows: number[] }, preset: string) => {
    chamadas++
    return `${preset}:${s.rows.length}`
  })
  const bruto = { rows: [1, 2] }
  assert.equal(agrega(bruto, '30d'), '30d:2')
  assert.equal(agrega(bruto, 'hoje'), 'hoje:2')
  assert.equal(agrega(bruto, '30d'), '30d:2')
  assert.equal(chamadas, 2)
})

test('refetch (bruto novo) recalcula — nunca serve agregação do snapshot velho', () => {
  const agrega = memoPorSnapshot((s: { rows: number[] }, _preset: string) => s.rows.length)
  assert.equal(agrega({ rows: [1] }, 'hoje'), 1)
  assert.equal(agrega({ rows: [1, 2, 3] }, 'hoje'), 3)
})

test('preset "Tudo" (string vazia) é chave válida, não "sem cache"', () => {
  let chamadas = 0
  const agrega = memoPorSnapshot((_s: object, preset: string) => { chamadas++; return preset })
  const bruto = {}
  agrega(bruto, '')
  agrega(bruto, '')
  assert.equal(chamadas, 1)
})
