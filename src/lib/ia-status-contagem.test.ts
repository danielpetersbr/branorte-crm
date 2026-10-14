import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validarContagemIa } from './ia-status-contagem'

test('contador distingue IA ligada de conversa com resposta hoje', () => {
  assert.deepEqual(validarContagemIa({ ligados: 128, conversando: 13 }), { ligados: 128, conversando: 13 })
})

test('zero só é exibido quando foi confirmado pela consulta', () => {
  assert.deepEqual(validarContagemIa({ ligados: 0, conversando: 0 }), { ligados: 0, conversando: 0 })
  for (const valor of [null, undefined, {}, { ligados: 4 }, { ligados: null, conversando: null }]) {
    assert.throws(() => validarContagemIa(valor))
  }
})

test('contagens inválidas não aparecem como atendimento real', () => {
  for (const valor of [
    { ligados: -1, conversando: 0 }, { ligados: 1, conversando: 2 },
    { ligados: 2.5, conversando: 1 }, { ligados: '2', conversando: '1' },
  ]) assert.throws(() => validarContagemIa(valor))
})
