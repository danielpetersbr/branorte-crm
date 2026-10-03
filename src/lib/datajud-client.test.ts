import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buscarProcessos, TRIBUNAIS_PRIORIDADE } from '../../api/_lib/datajud-client'

const opts = { documento: '00000000000191', tipo: 'J' as const }

test('falha em todos os tribunais é indisponibilidade, não consulta judicial concluída', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  const result = await buscarProcessos(opts)
  assert.equal(result.ok, false)
  assert.equal(result.erros.length, TRIBUNAIS_PRIORIDADE.length)
  assert.equal(result.totalEncontrado, 0)
})

test('um tribunal disponível preserva resultado parcial e erros das demais fontes', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ hits: { total: { value: 3 }, hits: [] } })
    : new Response('', { status: 503 }))
  const result = await buscarProcessos(opts)
  assert.equal(result.ok, true)
  assert.equal(result.totalEncontrado, 3)
  assert.equal(result.erros.length, TRIBUNAIS_PRIORIDADE.length - 1)
})

test('consulta bem-sucedida sem processos continua sendo resultado vazio válido', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ hits: { total: { value: 0 }, hits: [] } }))
  const result = await buscarProcessos(opts)
  assert.equal(result.ok, true)
  assert.equal(result.erros.length, 0)
  assert.equal(result.totalEncontrado, 0)
})
