import test from 'node:test'
import assert from 'node:assert/strict'
import { idExternoProjeto } from './projeto-3d-identidade'

test('a identidade vem do JSON atualmente aberto, independentemente do header anterior', () => {
  const anterior = { id: 'projeto-a', name: 'Cliente A' }
  const atual = { id: 'projeto-b', name: 'Cliente B' }
  assert.notEqual(idExternoProjeto(anterior), idExternoProjeto(atual))
  assert.equal(idExternoProjeto(atual), 'projeto-b')
})

test('não aceita ID vazio ou payload sem identidade para procurar um vínculo', () => {
  for (const data of [null, undefined, {}, { id: '' }, { id: '   ' }, { id: 123 }]) {
    assert.equal(idExternoProjeto(data), null)
  }
})
