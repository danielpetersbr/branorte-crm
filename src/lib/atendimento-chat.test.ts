import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentType, deliveryLabel, validateAttachment, reconcileOutbox, resolveAttachmentMime, attachmentExtension, displayMessageBody, privateChatMediaPath } from './atendimento-chat'

test('mídia: formatos de voz do navegador, fotos e PDF; recusa HTML, vazio e tamanho excessivo', () => {
  assert.equal(attachmentType('audio/webm;codecs=opus'), 'audio')
  assert.equal(attachmentType('image/jpeg'), 'image')
  assert.equal(attachmentType('application/pdf'), 'document')
  assert.ok(validateAttachment({type:'text/html',size:100}))
  assert.ok(validateAttachment({type:'audio/webm',size:0}))
  assert.ok(validateAttachment({type:'image/png',size:21*1024*1024}))
  assert.equal(validateAttachment({type:'audio/mp4',size:5000}), null)
})
test('documentos comerciais sem MIME do navegador mantêm tipo e extensão seguros', () => {
  const mime = resolveAttachmentMime({type:'',name:'Proposta final.DOCX'})
  assert.equal(mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(attachmentType(mime!), 'document')
  assert.equal(attachmentExtension(mime!), 'docx')
  assert.equal(validateAttachment({type:'application/octet-stream',name:'preços.xlsx',size:1024}), null)
  assert.equal(resolveAttachmentMime({type:'text/html',name:'proposta.pdf'}), null)
  assert.equal(resolveAttachmentMime({type:'',name:'arquivo.exe'}), null)
  assert.equal(validateAttachment({type:'',name:'arquivo.exe',size:100}), 'Formato não permitido. Envie foto, áudio, vídeo ou documento compatível.')
})
test('voz com codecs e MIME alternativo do Windows mantém arquivo reproduzível', () => {
  assert.equal(resolveAttachmentMime({type:' audio/webm;codecs=opus ',name:'audio.webm'}), 'audio/webm')
  assert.equal(attachmentExtension('audio/webm;codecs=opus'), 'webm')
  assert.equal(resolveAttachmentMime({type:'audio/x-wav',name:'gravacao.wav'}), 'audio/wav')
  assert.equal(resolveAttachmentMime({type:'application/x-zip-compressed',name:'projeto.zip'}), 'application/zip')
  assert.equal(attachmentExtension('text/html'), null)
})
test('conteúdo binário legado não vira texto enorme na conversa nem oculta legendas', () => {
  assert.equal(displayMessageBody('/9j/4AAQSkZJRg'+ 'A'.repeat(200)), '')
  assert.equal(displayMessageBody('data:image/png;base64,iVBORw0KGgo'+ 'A'.repeat(200)), '')
  assert.equal(displayMessageBody('Segue a foto da fábrica.\nPodemos dimensionar para 500 kg/h.'), 'Segue a foto da fábrica.\nPodemos dimensionar para 500 kg/h.')
  assert.equal(displayMessageBody('https://branorte.com/foto.jpg'), 'https://branorte.com/foto.jpg')
  assert.equal(displayMessageBody(null), '')
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
test('reconcilia ID serializado WPP com hash do mesmo histórico sem comparar texto', () => {
  const outbox=[{id:'a',wa_msg_id:'true_5511999999999@c.us_ABC123'},{id:'b',wa_msg_id:'false_5511999999999@lid_DEF456'},{id:'c',wa_msg_id:'XYZ789'}]
  assert.deepEqual(reconcileOutbox(outbox,[{msg_id:'ABC123'},{msg_id:'false_5511999999999@lid_DEF456'}]).map(x=>x.id),['c'])
  assert.deepEqual(reconcileOutbox(outbox,[{msg_id:'different_ABC123'}]).map(x=>x.id),['a','b','c'])
})
test('registro local do WhatsApp não apaga erro de upload nem confirmação ainda pendente', () => {
  const outbox=[{id:'failed',wa_msg_id:'ABC123',status:'failed'},{id:'waiting',wa_msg_id:'ABC123',status:'sending'},{id:'sent',wa_msg_id:'ABC123',status:'sent'}]
  assert.deepEqual(reconcileOutbox(outbox,[{msg_id:'true_5511999999999@c.us_ABC123'}]).map(x=>x.id),['failed','waiting'])
})
test('mídia privada é assinada só para o bucket e caminho do atendimento',()=>{
  const path='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf'
  assert.equal(privateChatMediaPath('https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/authenticated/crm-chat-media/'+path),path)
  assert.equal(privateChatMediaPath('https://example.test/storage/v1/object/authenticated/crm-chat-media/'+path),null)
  assert.equal(privateChatMediaPath('https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/authenticated/crm-chat-media/../../avatar.jpg'),null)
  assert.equal(privateChatMediaPath('https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/public/wa-midias/foto.jpg'),null)
})
