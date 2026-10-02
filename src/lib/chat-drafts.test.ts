import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readChatDraft, saveChatDraft, clearChatDraft} from './chat-drafts'
import type {PendingStorage} from './chat-pending-send'

test('rascunhos de clientes sobrevivem à troca de chat sem aparecer para outro vendedor',()=>{
  const values = new Map<string,string>()
  const storage:PendingStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)},removeItem:k=>{values.delete(k)}}
  saveChatDraft(storage,'vendedor-a','cliente-a','Olá, segue a proposta\nPodemos conversar?')
  saveChatDraft(storage,'vendedor-a','cliente-b','Vou verificar o frete.')
  assert.equal(readChatDraft(storage,'vendedor-a','cliente-a'),'Olá, segue a proposta\nPodemos conversar?')
  assert.equal(readChatDraft(storage,'vendedor-a','cliente-b'),'Vou verificar o frete.')
  assert.equal(readChatDraft(storage,'vendedor-b','cliente-a'),'')
  clearChatDraft(storage,'vendedor-a','cliente-a')
  assert.equal(readChatDraft(storage,'vendedor-a','cliente-a'),'')
  assert.equal(readChatDraft(storage,'vendedor-a','cliente-b'),'Vou verificar o frete.')
  saveChatDraft(storage,'vendedor-a','cliente-b','')
  assert.equal(readChatDraft(storage,'vendedor-a','cliente-b'),'')
})
test('armazenamento indisponível não impede digitar e enviar',()=>{
  const blocked:PendingStorage={getItem(){throw new Error('disabled')},setItem(){throw new Error('quota')},removeItem(){throw new Error('disabled')}}
  assert.equal(readChatDraft(blocked,'a','b'),'')
  assert.doesNotThrow(()=>saveChatDraft(blocked,'a','b','Olá'))
  assert.doesNotThrow(()=>clearChatDraft(blocked,'a','b'))
})
