import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readPendingSend,savePendingSend,clearPendingSend,type PendingStorage} from './chat-pending-send'
test('envio incerto preserva a chave ao trocar chat, recarregar e voltar, isolado por usuário',()=>{
  const values=new Map<string,string>();const storage:PendingStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>{values.set(k,v)},removeItem:k=>{values.delete(k)}}
  const req={id:'original-uuid',chat:'chat-a',body:'Olá',path:'chat-a/arquivo.pdf',mime:'application/pdf',filename:'proposta.pdf',reply_msg_id:'EXACT-WA-ID',reply_preview:'Mensagem citada',reply_sender_name:'Cliente'}
  savePendingSend(storage,'vendedor-a',req)
  assert.equal(readPendingSend(storage,'vendedor-a','chat-b'),null)
  assert.equal(readPendingSend(storage,'vendedor-b','chat-a'),null)
  assert.deepEqual(readPendingSend(storage,'vendedor-a','chat-a'),req)
  clearPendingSend(storage,'vendedor-a','chat-a')
  assert.equal(readPendingSend(storage,'vendedor-a','chat-a'),null)
})
test('citação inválida não vira envio sem vínculo',()=>{
  const storage:PendingStorage={getItem:()=>JSON.stringify({id:'same',chat:'a',body:'texto',reply_msg_id:123}),setItem(){},removeItem(){}}
  assert.equal(readPendingSend(storage,'user','a'),null)
})
test('pendência antiga sem citação continua preservando a chave original',()=>{
  const original={id:'same',chat:'a',body:'texto'}
  const storage:PendingStorage={getItem:()=>JSON.stringify(original),setItem(){},removeItem(){}}
  assert.deepEqual(readPendingSend(storage,'user','a'),original)
})
