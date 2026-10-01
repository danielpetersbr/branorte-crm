import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readPendingSend,savePendingSend,clearPendingSend,type PendingStorage} from './chat-pending-send'
test('envio incerto preserva a chave ao trocar chat, recarregar e voltar, isolado por usuário',()=>{
  const values=new Map<string,string>();const storage:PendingStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>{values.set(k,v)},removeItem:k=>{values.delete(k)}}
  const req={id:'original-uuid',chat:'chat-a',body:'Olá',path:'chat-a/arquivo.pdf',mime:'application/pdf',filename:'proposta.pdf'}
  savePendingSend(storage,'vendedor-a',req)
  assert.equal(readPendingSend(storage,'vendedor-a','chat-b'),null)
  assert.equal(readPendingSend(storage,'vendedor-b','chat-a'),null)
  assert.deepEqual(readPendingSend(storage,'vendedor-a','chat-a'),req)
  clearPendingSend(storage,'vendedor-a','chat-a')
  assert.equal(readPendingSend(storage,'vendedor-a','chat-a'),null)
})
