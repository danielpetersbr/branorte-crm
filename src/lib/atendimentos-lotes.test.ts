import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emLotes, paginaPorUltimaMsg, type ChaveAtendimento } from './atendimentos-lotes'

test('emLotes: 3.621 telefones em lotes de 500 = 8 lotes, nenhum perdido', () => {
  const tels = Array.from({ length: 3621 }, (_, i) => `5548${String(i).padStart(9, '0')}`)
  const lotes = emLotes(tels, 500)
  assert.equal(lotes.length, 8)
  assert.ok(lotes.every(l => l.length <= 500))
  assert.equal(lotes[7].length, 121)
  assert.deepEqual(lotes.flat(), tels)
})

test('emLotes: lista vazia e lista menor que o lote', () => {
  assert.deepEqual(emLotes([], 500), [])
  assert.deepEqual(emLotes(['a', 'b'], 500), [['a', 'b']])
})

test('emLotes: tamanho inválido explode em vez de entrar em laço infinito', () => {
  assert.throws(() => emLotes(['a'], 0))
  assert.throws(() => emLotes(['a'], -1))
  assert.throws(() => emLotes(['a'], 1.5))
})

test('paginaPorUltimaMsg: ordena como a listagem (ultima_msg desc, sem data por último)', () => {
  const linhas: ChaveAtendimento[] = [
    { telefone_norm: 'A', ultima_msg: '2026-09-01T10:00:00Z' },
    { telefone_norm: 'B', ultima_msg: null },
    { telefone_norm: 'C', ultima_msg: '2026-09-28T10:00:00Z' },
    { telefone_norm: 'D', ultima_msg: '2026-09-15T10:00:00+00:00' },
  ]
  assert.deepEqual(paginaPorUltimaMsg(linhas, 0, 10), { total: 4, telefones: ['C', 'D', 'A', 'B'] })
})

test('paginaPorUltimaMsg: juntando lotes, a página 2 continua de onde a 1 parou', () => {
  // lotes chegam fora de ordem — a ordenação é global, não por lote
  const lote1: ChaveAtendimento[] = [
    { telefone_norm: 'T1', ultima_msg: '2026-09-10T00:00:00Z' },
    { telefone_norm: 'T3', ultima_msg: '2026-09-30T00:00:00Z' },
  ]
  const lote2: ChaveAtendimento[] = [
    { telefone_norm: 'T2', ultima_msg: '2026-09-20T00:00:00Z' },
    { telefone_norm: 'T4', ultima_msg: '2026-09-05T00:00:00Z' },
    { telefone_norm: 'T5', ultima_msg: '2026-09-25T00:00:00Z' },
  ]
  const todas = [...lote1, ...lote2]
  assert.deepEqual(paginaPorUltimaMsg(todas, 0, 2), { total: 5, telefones: ['T3', 'T5'] })
  assert.deepEqual(paginaPorUltimaMsg(todas, 1, 2), { total: 5, telefones: ['T2', 'T1'] })
  assert.deepEqual(paginaPorUltimaMsg(todas, 2, 2), { total: 5, telefones: ['T4'] })
  assert.deepEqual(paginaPorUltimaMsg(todas, 3, 2), { total: 5, telefones: [] })
})

test('paginaPorUltimaMsg: empate desempata pelo telefone (a mesma linha não cai em duas páginas)', () => {
  const mesmo = '2026-09-29T12:00:00Z'
  const linhas: ChaveAtendimento[] = ['Z', 'M', 'A', 'Q'].map(t => ({ telefone_norm: t, ultima_msg: mesmo }))
  const p0 = paginaPorUltimaMsg(linhas, 0, 2).telefones
  const p1 = paginaPorUltimaMsg([...linhas].reverse(), 1, 2).telefones
  assert.deepEqual(p0, ['A', 'M'])
  assert.deepEqual(p1, ['Q', 'Z'])
})

test('paginaPorUltimaMsg: telefone repetido conta uma vez; vazio/nulo é ignorado', () => {
  const linhas: ChaveAtendimento[] = [
    { telefone_norm: 'X', ultima_msg: '2026-09-01T00:00:00Z' },
    { telefone_norm: 'X', ultima_msg: '2026-09-20T00:00:00Z' },
    { telefone_norm: null, ultima_msg: '2026-09-29T00:00:00Z' },
    { telefone_norm: '', ultima_msg: '2026-09-29T00:00:00Z' },
    { telefone_norm: 'Y', ultima_msg: '2026-09-10T00:00:00Z' },
  ]
  assert.deepEqual(paginaPorUltimaMsg(linhas, 0, 50), { total: 2, telefones: ['X', 'Y'] })
})

test('modo análise: páginas de 100 atravessam lotes sem perder ou repetir clientes', () => {
  const linhas: ChaveAtendimento[] = Array.from({ length: 251 }, (_, i) => ({
    telefone_norm: String(i).padStart(4, '0'),
    ultima_msg: '2026-10-07T10:00:00Z',
  }))
  const todas = emLotes(linhas, 50).reverse().flat()
  const paginas = [0, 1, 2].map(p => paginaPorUltimaMsg(todas, p, 100))
  assert.deepEqual(paginas.map(p => p.telefones.length), [100, 100, 51])
  assert.ok(paginas.every(p => p.total === 251))
  assert.deepEqual(paginas.flatMap(p => p.telefones), linhas.map(l => l.telefone_norm))
  assert.deepEqual(paginaPorUltimaMsg(todas, 0, 50).telefones, paginas[0].telefones.slice(0, 50))
})
