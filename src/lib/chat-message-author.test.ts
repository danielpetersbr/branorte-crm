import test from 'node:test'
import assert from 'node:assert/strict'
import { chatMessageSenderName } from './atendimento-chat'

test('mensagem enviada mostra somente o autor confirmado pelo histórico', () => {
  assert.equal(chatMessageSenderName({ from_me: true, sender_name: '  Maria Silva  ' }), 'Maria Silva')
  assert.equal(chatMessageSenderName({ from_me: false, sender_name: 'Maria Silva' }), null)
})

test('mensagem sem autoria individual identifica a conta WhatsApp, sem inventar vendedor', () => {
  for (const sender_name of [undefined, null, '', '  \n  ']) {
    assert.equal(chatMessageSenderName({ from_me: true, sender_name }), 'Ana · WhatsApp')
    assert.equal(chatMessageSenderName({ from_me: false, sender_name }), null)
  }
  assert.equal(chatMessageSenderName({ from_me: true }), 'Ana · WhatsApp')
  assert.equal(chatMessageSenderName({ from_me: true, sender_id: 'usuario-confirmado', sender_name: ' ' }), 'Vendedor · CRM')
  assert.equal(chatMessageSenderName({ from_me: true, sender_id: 'usuario-confirmado', sender_name: 'Daniel Peters' }), 'Daniel Peters')
})
