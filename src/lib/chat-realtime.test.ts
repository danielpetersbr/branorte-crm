import test from 'node:test'
import assert from 'node:assert/strict'
import { chatChange, chatRefresh } from './chat-realtime'

const id='11111111-1111-4111-8111-111111111111'
test('broadcasts invalidate only authorized data fetched by RPC',()=>{
  assert.equal(chatChange({id,kind:'messages',body:'private'}),null)
  assert.equal(chatChange({id:'bad',kind:'messages'}),null)
  assert.deepEqual(chatChange({id,kind:'messages'}),{id,kind:'messages'})
  assert.deepEqual(chatRefresh({id,kind:'messages'},id),['list','summary','detail','messages'])
  assert.deepEqual(chatRefresh({id,kind:'messages'},'other'),['list','summary'])
  assert.deepEqual(chatRefresh({id,kind:'notes'},id),['detail'])
  assert.deepEqual(chatRefresh({kind:'tags'},null),['list','quick-replies'])
  assert.deepEqual(chatRefresh({id,kind:'outbox'},id),['summary','detail'])
})
