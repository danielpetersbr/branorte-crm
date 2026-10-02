import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatCloseContext, chatCloseReason } from './chat-close'

test('motivo exige ID exato e único do catálogo fornecido, sem deduzir pelo nome',()=>{
  const reasons=[{id:'reason-a',name:'RESOLVIDOS'},{id:'reason-b',name:'NÃO FABRICAMOS'}]
  assert.equal(chatCloseReason(reasons,'reason-b'),reasons[1])
  for(const id of ['', 'RESOLVIDOS','reason-c',' reason-a '])assert.equal(chatCloseReason(reasons,id),null)
  assert.equal(chatCloseReason([...reasons,{id:'reason-a',name:'Outro'}],'reason-a'),null)
  assert.equal(chatCloseReason(undefined,'reason-a'),null)
})

test('resposta assíncrona de outra conversa ou usuário não altera diálogo atual',async()=>{
  for(const next of [{id:'chat-b',user:'seller-a'},{id:'chat-a',user:'seller-b'}]){
    const context=new ChatCloseContext(),token=context.update('chat-a','seller-a',true)
    let finish!:(value:boolean)=>void,closed=false
    const confirmation=new Promise<boolean>(resolve=>{finish=resolve})
    const completion=confirmation.then(ok=>{if(ok&&context.isCurrent(token))closed=true})
    context.update(next.id,next.user,true);finish(true);await completion
    assert.equal(closed,false);assert.equal(context.isCurrent(token),false)
  }
})

test('fechar e reabrir a mesma conversa invalida confirmação antiga',()=>{
  const context=new ChatCloseContext(),old=context.update('chat-a','seller-a',true)
  assert.equal(context.update('chat-a','seller-a',true),old)
  context.update('chat-a','seller-a',false)
  assert.equal(context.isCurrent(old),false)
  const reopened=context.update('chat-a','seller-a',true)
  assert.notEqual(reopened,old);assert.equal(context.isCurrent(old),false);assert.equal(context.isCurrent(reopened),true)
})
