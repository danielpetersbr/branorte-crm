import assert from 'node:assert/strict'
import test from 'node:test'
import { compactChatMessage } from './chat-display'

test('keeps a normal seller message intact', () => {
  assert.equal(compactChatMessage('Compacta 02 Master com ensacadeira'), 'Compacta 02 Master com ensacadeira')
})

test('collapses a pasted registration dump to a readable preview', () => {
  const long = `CLIENTE TESTE\n${'SITUAÇÃO CADASTRAL ATIVA '.repeat(40)}\ncompacta 02 master 200500 + uma ensacadeira`
  const displayed = compactChatMessage(long)
  assert.ok(displayed.length <= 360)
  assert.match(displayed, /compacta 02 master 200500/i)
  assert.match(displayed, /conteúdo extenso ocultado/i)
})
