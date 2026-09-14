import assert from 'node:assert/strict'
import test from 'node:test'

import { settleWithin } from '../../api/_lib/orcamento-confirm-timeout'

test('encerra uma confirmação externa que não responde dentro do limite', async () => {
  const startedAt = Date.now()
  const result = await settleWithin(new Promise<never>(() => {}), 20)

  assert.deepEqual(result, { status: 'timeout' })
  assert.ok(Date.now() - startedAt < 250)
})

test('preserva a resposta quando a confirmação termina antes do limite', async () => {
  const result = await settleWithin(Promise.resolve({ ok: true }), 100)

  assert.deepEqual(result, { status: 'fulfilled', value: { ok: true } })
})
