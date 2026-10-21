import { test } from 'node:test'
import assert from 'node:assert/strict'
import { achatarConversas, contasDoEspelho, etiquetasDaLista, filtrarConversas, finalDoNumero, historicoAtrasado, historicoGravado, nomeEtiqueta, rotuloConta } from './whatsapp-espelho'
import type { WaChat, WaKanban } from '../hooks/useWaKanban'

const chat = (over: Partial<WaChat>): WaChat => ({
  phone: '5548999990000', chat_id: '111@lid', contact_name: 'Cliente', label_ids: ['1'],
  last_message_at: '2026-10-21T10:00:00Z', last_message_from_me: true, last_message_preview: 'oi', foto_url: null,
  ...over,
})

test('contas: Ana fora, equipe em ordem alfabética e o dono por último', () => {
  const contas = contasDoEspelho(['RAMON', 'ANA', 'DANIEL', 'ALVARO', 'RAMON', 'EDILSON JR'], { RAMON: '2745' })
  assert.deepEqual(contas.map(c => c.nome), ['ALVARO', 'EDILSON JR', 'RAMON', 'DANIEL'])
  assert.equal(contas[2].final, '2745')
  assert.equal(contas[0].final, null)
})

test('rótulo e final do número', () => {
  assert.equal(rotuloConta('EDILSON JR'), 'Edilson Jr')
  assert.equal(rotuloConta('ÁLVARO'), 'Álvaro')
  assert.equal(finalDoNumero('554884357022@c.us'), '7022')
  assert.equal(finalDoNumero('+55 (48) 8435-7022'), '7022')
  assert.equal(finalDoNumero('123'), null)
  assert.equal(finalDoNumero(null), null)
})

test('chat em duas colunas vira uma linha com as duas etiquetas, sem grupo, mais recente primeiro', () => {
  const a = chat({ chat_id: 'a@lid', last_message_at: '2026-10-21T09:00:00Z' })
  const b = chat({ chat_id: 'b@lid', last_message_at: '2026-10-21T11:00:00Z', last_message_from_me: false, last_message_preview: 'qual o preço?' })
  const grupo = chat({ chat_id: '1203@g.us', last_message_at: '2026-10-21T12:00:00Z' })
  const kanban: WaKanban = {
    colunas: [
      { nome: 'PROSPECCAO', cor: '', oculta: false, chats: [a, b] },
      { nome: 'LEAD QUENTE', cor: '', oculta: false, chats: [a, grupo] },
    ],
    semEtiqueta: [chat({ chat_id: 'c@lid', label_ids: [], last_message_at: '2026-10-20T08:00:00Z' })],
    totalChats: 4,
    ultimaSync: null,
  }
  const lista = achatarConversas(kanban)
  assert.deepEqual(lista.map(c => c.chat_id), ['b@lid', 'a@lid', 'c@lid'])
  assert.deepEqual(lista[1].etiquetas, ['PROSPECCAO', 'LEAD QUENTE'])
  assert.deepEqual(lista[2].etiquetas, [])
  assert.equal(lista[0].aguardando, true)
  assert.equal(lista[1].aguardando, false)
  assert.deepEqual(achatarConversas(undefined), [])
})

test('cliente que só agradeceu não conta como aguardando', () => {
  const kanban: WaKanban = { colunas: [], semEtiqueta: [chat({ last_message_from_me: false, last_message_preview: 'Obrigado!' })], totalChats: 1, ultimaSync: null }
  assert.equal(achatarConversas(kanban)[0].aguardando, false)
})

test('filtro por nome, telefone, etiqueta, sem etiqueta e aguardando', () => {
  const lista = achatarConversas({
    colunas: [{ nome: 'FOLLOW UP', cor: '', oculta: false, chats: [chat({ chat_id: 'x@lid', contact_name: 'João da Granja', phone: '5566998144699' })] }],
    semEtiqueta: [chat({ chat_id: 'y@lid', contact_name: 'Maria', phone: '5548911112222', label_ids: [], last_message_from_me: false, last_message_preview: 'tem vídeo?' })],
    totalChats: 2, ultimaSync: null,
  })
  assert.deepEqual(filtrarConversas(lista, { busca: 'granja' }).map(c => c.chat_id), ['x@lid'])
  assert.deepEqual(filtrarConversas(lista, { busca: '(48) 9111' }).map(c => c.chat_id), ['y@lid'])
  assert.deepEqual(filtrarConversas(lista, { etiqueta: 'FOLLOW UP' }).map(c => c.chat_id), ['x@lid'])
  assert.deepEqual(filtrarConversas(lista, { etiqueta: '__sem__' }).map(c => c.chat_id), ['y@lid'])
  assert.deepEqual(filtrarConversas(lista, { filtro: 'aguardando' }).map(c => c.chat_id), ['y@lid'])
  assert.equal(filtrarConversas(lista, {}).length, 2)
})

test('etiquetas do filtro seguem a ordem do funil', () => {
  const lista = achatarConversas({
    colunas: [
      { nome: 'VENDIDO', cor: '', oculta: false, chats: [chat({ chat_id: 'v@lid' })] },
      { nome: 'PROSPECCAO', cor: '', oculta: false, chats: [chat({ chat_id: 'p@lid' }), chat({ chat_id: 'q@lid' })] },
    ],
    semEtiqueta: [], totalChats: 3, ultimaSync: null,
  })
  const etiquetas = etiquetasDaLista(lista)
  assert.deepEqual(etiquetas.map(e => e.nome), ['PROSPECCAO', 'VENDIDO'])
  assert.equal(etiquetas[0].total, 2)
})

test('etiqueta exibida com acento, como o vendedor escreve', () => {
  assert.equal(nomeEtiqueta('PROSPECCAO'), 'PROSPECÇÃO')
  assert.equal(nomeEtiqueta('2A TENTATIVA'), '2ª TENTATIVA')
  assert.equal(nomeEtiqueta('NAO RESPONDEU MAIS'), 'NÃO RESPONDEU MAIS')
  assert.equal(nomeEtiqueta('VENDIDO'), 'VENDIDO')
})

test('histórico gravado só no funil ativo ou lead sem etiqueta das últimas 6 h (regra da extensão)', () => {
  const agora = Date.parse('2026-10-21T17:00:00Z')
  const base = { label_ids: ['9'], last_message_at: '2026-10-21T16:59:00Z' }
  assert.equal(historicoGravado({ ...base, etiquetas: ['LEAD QUENTE', 'ORCAMENTO ENVIADO'] }, agora), true)
  assert.equal(historicoGravado({ ...base, etiquetas: ['ORCAMENTO ENVIADO'] }, agora), false)
  assert.equal(historicoGravado({ ...base, etiquetas: ['3A TENTATIVA'] }, agora), false)
  assert.equal(historicoGravado({ ...base, etiquetas: [] }, agora), false) // etiqueta fora do catálogo ainda é etiqueta
  assert.equal(historicoGravado({ etiquetas: [], label_ids: [], last_message_at: '2026-10-21T12:00:00Z' }, agora), true)
  assert.equal(historicoGravado({ etiquetas: [], label_ids: [], last_message_at: '2026-10-21T10:00:00Z' }, agora), false)
  assert.equal(historicoGravado({ etiquetas: [], label_ids: null, last_message_at: null }, agora), false)
})

test('histórico atrasado em relação à lista, com folga de um ciclo', () => {
  assert.equal(historicoAtrasado('2026-10-21T17:00:00Z', '2026-10-21T16:59:30Z'), false)
  assert.equal(historicoAtrasado('2026-10-21T17:00:00Z', '2026-10-21T16:55:00Z'), true)
  assert.equal(historicoAtrasado('2026-10-21T17:00:00Z', null), true)
  assert.equal(historicoAtrasado(null, '2026-10-21T16:55:00Z'), false)
})
