import test from 'node:test'
import assert from 'node:assert/strict'
import { chaveRascunhoConta, lerRascunhoConta, restaurarRascunhoConta } from './rascunho-conta'

test('cada conta tem uma chave distinta e renomear vendedor não muda identidade', () => {
  assert.notEqual(chaveRascunhoConta('estudo', 'a'), chaveRascunhoConta('estudo', 'b'))
  assert.equal(chaveRascunhoConta('estudo', 'a'), 'estudo:a')
})

test('restaura input e ID apenas do rascunho pertencente à conta atual', () => {
  const raw = JSON.stringify({ userId: 'a', id: 'estudo-1', codigo: 'VR-1', input: { cliente: 'A' } })
  assert.deepEqual(lerRascunhoConta(raw, 'a'), { userId: 'a', id: 'estudo-1', codigo: 'VR-1', input: { cliente: 'A' } })
  assert.equal(lerRascunhoConta(raw, 'b'), null)
})

test('legado sem dono não é herdado pelo nome do vendedor nem por conta admin', () => {
  const raw = JSON.stringify({ id: 'estudo-1', input: { identificacao: { vendedorNome: 'Daniel' } } })
  assert.equal(lerRascunhoConta(raw, 'a'), null)
  assert.equal(lerRascunhoConta(raw, 'a', 'b'), null)
  assert.equal(lerRascunhoConta(raw, 'a', 'a')?.id, 'estudo-1')
})

test('legado sem ID salvo exige propriedade explícita; confirmação externa não valida outro userId', () => {
  assert.equal(lerRascunhoConta(JSON.stringify({ id: null, input: {} }), 'a', 'a'), null)
  assert.equal(lerRascunhoConta(JSON.stringify({ userId: 'b', id: 'x', input: {} }), 'a', 'a'), null)
})

test('rascunho corrompido ou ID inválido não vira documento editável', () => {
  for (const raw of ['{', 'null', '[]', JSON.stringify({ userId: 'a', id: {}, input: {} }), JSON.stringify({ userId: 'a', id: 'x' })]) {
    assert.equal(lerRascunhoConta(raw, 'a'), null)
  }
})

test('migração consulta o autor do ID legado e não usa ID de outra conta', async () => {
  const raw = JSON.stringify({ id: 'x', input: {} })
  assert.equal((await restaurarRascunhoConta(null, raw, 'a', async id => { assert.equal(id, 'x'); return 'a' }))?.id, 'x')
  assert.equal(await restaurarRascunhoConta(null, raw, 'a', async () => 'b'), null)
  assert.equal(await restaurarRascunhoConta(null, raw, 'a', async () => { throw new Error('offline') }), null)
})

test('rascunho da conta atual tem prioridade sem consultar o legado', async () => {
  const raw = JSON.stringify({ userId: 'a', id: null, input: { novo: true } })
  const restored = await restaurarRascunhoConta(raw, JSON.stringify({ id: 'x', input: {} }), 'a', async () => { throw new Error('não deveria consultar') })
  assert.deepEqual(restored?.input, { novo: true })
})

test('consulta de autor que não responde não deixa o módulo preso na inicialização', async () => {
  const raw = JSON.stringify({ id: 'x', input: {} })
  assert.equal(await restaurarRascunhoConta(null, raw, 'a', () => new Promise(() => {}), 5), null)
})
