import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAreaClientes, syncDesatualizada } from './area-vendedor'
import type { WaChat, WaKanban } from '../hooks/useWaKanban'
import type { SupervisaoAchado } from '../hooks/useSupervisaoVendedor'

const chat = { chat_id: 'cliente', phone: '5511999999999', last_message_at: '2026-09-13T15:00:00Z' } as WaChat
const carteira: WaKanban = { colunas: ['FOLLOW UP', 'LEAD QUENTE'].map(nome => ({ nome, cor: '', oculta: false, chats: [chat] })), semEtiqueta: [], totalChats: 1, ultimaSync: null }
const achado = { id: 'a', chat_id: 'cliente', score: 1, camada: 'heuristica', atualizado_em: '2026-09-12T15:00:00Z', evidencias: [] } as unknown as SupervisaoAchado

test('deduplica cliente multietiqueta e achados sem perder estágios', () => {
  const clientes = montarAreaClientes(carteira, [achado, achado])
  assert.equal(clientes.length, 1)
  assert.equal(clientes[0].etapas.length, 2)
  assert.equal(clientes[0].achados.length, 1)
  assert.equal(clientes[0].temIA, false)
  assert.equal(clientes[0].analiseDesatualizada, true)
})
test('não cruza achado por telefone ou outro chat', () => {
  assert.equal(montarAreaClientes(carteira, [{ ...achado, chat_id: 'outro' }])[0].achados.length, 0)
})
test('frescor usa horário da fonte e rejeita ausente/inválido/futuro', () => {
  const agora = Date.parse('2026-09-13T15:00:00Z')
  assert.equal(syncDesatualizada('2026-09-13T14:59:00Z', agora), false)
  for (const valor of [null, 'inválido', '2026-09-13T14:00:00Z', '2026-09-14T15:00:00Z']) assert.equal(syncDesatualizada(valor, agora), true)
})
test('dados ausentes são lista vazia e IA só corresponde à camada declarada', () => {
  assert.deepEqual(montarAreaClientes(undefined), [])
  assert.equal(montarAreaClientes(carteira, [{ ...achado, camada: 'ia' }])[0].temIA, true)
})
