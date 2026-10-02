import test from 'node:test'
import assert from 'node:assert/strict'
import { readQuickReplies, saveQuickReplies } from './ChatQuickReplies'

test('respostas rápidas persistem somente no escopo do usuário', () => {
  const values=new Map<string,string>()
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}
  const reply={id:'own',title:'Minha resposta',body:'Texto exclusivo da minha carteira'}
  saveQuickReplies(storage,'vendedor-a',[reply])
  assert.deepEqual(readQuickReplies(storage,'vendedor-a'),[reply])
  assert.equal(readQuickReplies(storage,'vendedor-b').some(item=>item.id==='own'),false)
})

test('respostas rápidas descartam registros inválidos sem inserir objetos no texto', () => {
  const storage={getItem:()=>JSON.stringify([{id:'bad',title:'Inválida',body:{secret:'not text'}}])}
  assert.deepEqual(readQuickReplies(storage,'vendedor-a'),[])
})
