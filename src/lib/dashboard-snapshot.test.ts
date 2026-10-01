import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DASHBOARD_COLUMNS, decodeDashboardSnapshot } from './dashboard-snapshot'

test('compact snapshot restores every field, including nulls, zero and false', () => {
  const source = Object.fromEntries(DASHBOARD_COLUMNS.map(k => [k, null]))
  Object.assign(source, { id: 'lead-1', nome: 'José', telefone: '5548999999999', is_internal: false, orcamento_valor: 0, orcamento_enviado: true })
  const result = decodeDashboardSnapshot({ columns: DASHBOARD_COLUMNS, rows: [DASHBOARD_COLUMNS.map(k => source[k])] })
  assert.deepEqual(result, [source])
})

test('snapshot accepts empty results, but refuses incompatible or truncated rows', () => {
  assert.deepEqual(decodeDashboardSnapshot({ columns: DASHBOARD_COLUMNS, rows: [] }), [])
  assert.throws(() => decodeDashboardSnapshot({ columns: [...DASHBOARD_COLUMNS].reverse(), rows: [] }))
  assert.throws(() => decodeDashboardSnapshot({ columns: DASHBOARD_COLUMNS, rows: [[1, 2]] }))
  assert.throws(() => decodeDashboardSnapshot(null))
})

test('snapshot preserves row order without retaining compact row arrays', () => {
  const row = DASHBOARD_COLUMNS.map(k => k === 'id' ? 'first' : null)
  const second = [...row]; second[0] = 'second'
  const decoded = decodeDashboardSnapshot({ columns: DASHBOARD_COLUMNS, rows: [row, second] })
  row[0] = 'changed'
  assert.deepEqual(decoded.map(r => r.id), ['first', 'second'])
})
