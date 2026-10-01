import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentType, deliveryLabel, validateAttachment, reconcileOutbox } from './atendimento-chat'

test('mídia: formatos de voz do navegador, fotos e PDF; recusa HTML, vazio e tamanho excessivo', () => {
  assert.equal(attachmentType('audio/webm;codecs=opus'), 'audio')
  assert.equal(attachmentType('image/jpeg'), 'image')
  assert.equal(attachmentType('application/pdf'), 'document')
  assert.equal(validateAttachment({type:'text/html',size:100}), 'Formato não permitido. Envie foto, áudio, vídeo ou PDF.')
  assert.ok(validateAttachment({type:'audio/webm',size:0}))
  assert.ok(validateAttachment({type:'image/png',size:21*1024*1024}))
  assert.equal(validateAttachment({type:'audio/mp4',size:5000}), null)
})
test('envio pendente ou incerto nunca é apresentado como recebido/lido pelo cliente', () => {
  assert.equal(deliveryLabel('pending'), 'Na fila da VPS')
  assert.equal(deliveryLabel('sending'), 'Aguardando confirmação')
  assert.equal(deliveryLabel('sent'), 'Enviada pelo WhatsApp')
  assert.equal(deliveryLabel('failed'), 'Falha no envio')
})
test('reconcilia somente ID real, preservando textos iguais e envios ainda sem ID', () => {
  const outbox = [{id:'a',wa_msg_id:'w1'},{id:'b',wa_msg_id:null},{id:'c',wa_msg_id:'w3'}]
  assert.deepEqual(reconcileOutbox(outbox,[{msg_id:'w1'},{msg_id:'w2'}]).map(x=>x.id), ['b','c'])
})
