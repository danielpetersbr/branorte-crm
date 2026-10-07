import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatContactPhone as phone, chatContactName as name } from './atendimento-chat'
import { formatPhone } from './utils'

test('LID identifiers are never displayed as phone numbers',()=>{
  for(const lid of ['247557754245325','86084163788870','1890574184587']){
    assert.equal(phone({phone:lid,wa_chat_id:lid+'@lid'}),null)
    assert.equal(phone({phone:lid+'@lid',wa_chat_id:lid+'@lid'}),null)
  }
})
test('a real phone resolved for a LID chat remains visible',()=>{
  assert.equal(phone({phone:'5563999341718',wa_chat_id:'247557754245325@lid'}),'5563999341718')
  assert.equal(phone({phone:'+55 (63) 99934-1718',wa_chat_id:'247557754245325@lid'}),'5563999341718')
})
test('Brazilian phones with and without the ninth digit use the existing formatting',()=>{
  assert.equal(formatPhone(phone({phone:'5563999341718',wa_chat_id:'247557754245325@lid'})!),'+55 (63) 99934-1718')
  assert.equal(formatPhone(phone({phone:'556399341718',wa_chat_id:'247557754245325@lid'})!),'+55 (63) 9934-1718')
})
test('missing and malformed phones have no invented fallback',()=>{
  assert.equal(phone(null),null)
  assert.equal(phone({phone:'',wa_chat_id:'5563999341718@c.us'}),null)
  assert.equal(phone({phone:'ramal 12345',wa_chat_id:'abc@lid'}),null)
  assert.equal(phone({phone:'1234567890123456',wa_chat_id:'abc@lid'}),null)
})
test('a real contact name is preserved while raw LID names have a readable fallback',()=>{
  assert.equal(name({phone:'',wa_chat_id:'247557754245325@lid',name:'247557754245325@lid'}),'Contato WhatsApp')
  assert.equal(name({phone:'247557754245325',wa_chat_id:'247557754245325@lid',name:'247557754245325'}),'Contato WhatsApp')
  assert.equal(name({phone:'5563999341718',wa_chat_id:'247557754245325@lid',name:'247557754245325@lid'}),'5563999341718')
  assert.equal(name({phone:'5563999341718',wa_chat_id:'247557754245325@lid',name:'Doglas'}),'Doglas')
})
