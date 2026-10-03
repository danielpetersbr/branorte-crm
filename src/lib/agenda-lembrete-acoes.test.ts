import test from 'node:test'
import assert from 'node:assert/strict'
import { persistirAcaoLembrete } from './agenda-lembrete-acoes'

test('mantém o lembrete na tela enquanto a persistência não termina', async () => {
  let finish!: (value: { error: null }) => void
  const pending = new Promise<{ error: null }>(resolve => { finish = resolve })
  let removed = false
  const action = persistirAcaoLembrete(() => pending, () => { removed = true })
  assert.equal(removed, false)
  finish({ error: null })
  await action
  assert.equal(removed, true)
})

test('erro devolvido pelo banco não remove nem rearma o lembrete', async () => {
  let successCount = 0
  const error = { message: 'conexão indisponível' }
  await assert.rejects(persistirAcaoLembrete(async () => ({ error }), () => { successCount++ }), value => value === error)
  assert.equal(successCount, 0)
})

test('rejeição de rede mantém o card e uma nova tentativa pode concluir', async () => {
  let successCount = 0
  await assert.rejects(persistirAcaoLembrete(async () => { throw new Error('offline') }, () => { successCount++ }), /offline/)
  assert.equal(successCount, 0)
  await persistirAcaoLembrete(async () => ({ error: null }), () => { successCount++ })
  assert.equal(successCount, 1)
})
