import test from 'node:test'
import assert from 'node:assert/strict'
import { chatQueueCursor, orderChatQueue, waitingTime, followUpState, localDateTime, followUpIso, messageCitation, mergeHistoryPages, selectChatQueue, selectChatStatus } from './chat-productivity'

const rows = [
  { id: 'b', last_message_at: '2026-10-02T11:00:00Z', waiting_since: '2026-10-02T09:00:00Z', follow_up_at: '2026-10-02T08:00:00Z' },
  { id: 'a', last_message_at: '2026-10-02T12:00:00Z', waiting_since: '2026-10-02T10:00:00Z', follow_up_at: '2026-10-02T07:00:00Z' },
]

test('selecionar retornos vencidos inclui finalizadas e permite refiná-las sem sair da fila',()=>{
  const overdue=selectChatQueue('overdue','open')
  assert.deepEqual(overdue,{queue:'overdue',status:''})
  const resolved=selectChatStatus('resolved',overdue.queue)
  assert.deepEqual(resolved,{queue:'overdue',status:'resolved'})
  const waiting=selectChatQueue('waiting',resolved.status)
  assert.deepEqual(waiting,{queue:'waiting',status:'open'})
  assert.deepEqual(selectChatStatus('resolved',waiting.queue),{queue:'all',status:'resolved'})
  assert.deepEqual(selectChatQueue('all','resolved'),{queue:'all',status:'resolved'})
})
test('fila mantém ordem e cursor do campo correto, com desempate estável', () => {
  for (const [queue, ids, before] of [['all', ['a', 'b'], rows[0].last_message_at], ['waiting', ['b', 'a'], rows[1].waiting_since], ['overdue', ['a', 'b'], rows[0].follow_up_at]] as const) {
    const ordered = orderChatQueue(rows, queue)
    assert.deepEqual(ordered.map(r => r.id), ids)
    assert.deepEqual(chatQueueCursor(ordered, queue, 2), { before, before_id: ordered[1].id })
    assert.equal(chatQueueCursor(ordered.slice(0, 1), queue, 2), undefined)
  }
  assert.deepEqual(orderChatQueue([rows[0], { ...rows[0], id: 'a' }], 'waiting').map(r => r.id), ['a', 'b'])
})
test('espera e retorno usam o relógio atual, sem depender de leitura', () => {
  const now = Date.parse('2026-10-02T12:00:00Z')
  assert.equal(waitingTime('2026-10-02T10:55:00Z', now), '1h 5min')
  assert.equal(waitingTime('2026-10-02T12:00:10Z', now), 'agora')
  assert.equal(followUpState('2026-10-02T12:00:00Z', now), 'overdue')
  assert.equal(followUpState('2026-10-02T12:01:00Z', now), 'scheduled')
  assert.equal(followUpState(null, now), null)
})
test('data/hora local preserva instante e rejeita datas inválidas ou passadas', () => {
  const due = new Date(2026, 9, 3, 14, 30)
  assert.equal(followUpIso(localDateTime(due.toISOString()), due.getTime() - 1000), due.toISOString())
  assert.equal(followUpIso('2026-02-31T10:00', 0), null)
  assert.equal(followUpIso('invalid', 0), null)
  assert.equal(followUpIso(localDateTime(due.toISOString()), due.getTime()), null)
})
test('citação mantém ID exato e não inventa o autor de mensagem enviada', () => {
  assert.deepEqual(messageCitation({ msg_id: 'EXACT', from_me: true, body: 'Olá', tipo: 'chat', sender_name: null }, 'Cliente'), { reply_msg_id: 'EXACT', reply_preview: 'Olá', reply_sender_name: null })
  assert.equal(messageCitation({ msg_id: 'PHOTO', from_me: false, body: null, tipo: 'image' }, 'Cliente').reply_preview, 'Foto')
  assert.equal(messageCitation({ msg_id: 'PHOTO', from_me: false, body: null, tipo: 'image' }, 'Cliente').reply_sender_name, 'Cliente')
})
test('busca mescla páginas separadas por ID sem alterar histórico normal', () => {
  const older = { msg_id: 'OLD', id: 1, data_msg: '2026-10-01T12:00:00Z' }, newer = { msg_id: 'NEW', id: 2, data_msg: '2026-10-02T12:00:00Z' }
  const pages = [[newer], [older, newer]]
  assert.deepEqual(mergeHistoryPages(pages, true).map(m => m.msg_id), ['NEW', 'OLD'])
  assert.deepEqual(mergeHistoryPages(pages).map(m => m.msg_id), ['OLD', 'NEW'])
  assert.equal(pages[0][0], newer)
})
