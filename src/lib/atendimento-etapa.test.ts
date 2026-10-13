import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etapaAtendimento } from './atendimento-etapa'

test('Ana ainda atendendo fica em aberto, mesmo com chegou_no_vendedor true', () => {
  assert.equal(etapaAtendimento({ responsavel: 'ANA', chegou_no_vendedor: true, status_atendimento: 'Pendente-IA' }), 'em-atendimento')
})

test('responsável humano tem prioridade sobre o encerramento', () => {
  assert.equal(etapaAtendimento({ responsavel: 'Pedro Della Giustina', finished_at: '2026-10-13T12:00:00Z', status_atendimento: 'Resolvido' }), 'com-vendedor')
})

test('repasse confirmado da Ana vale mesmo antes de atualizar responsável', () => {
  assert.equal(etapaAtendimento({ responsavel: 'ANA', dispatch_origem: 'WhatsApp ANA', dispatch_status: 'sent', dispatch_vendedor_nome: 'Pedro' }), 'com-vendedor')
})

for (const status of ['pending', 'failed', null]) {
  test(`repasse ${status} não confirma chegada ao vendedor`, () => {
    assert.equal(etapaAtendimento({ responsavel: 'ANA', dispatch_origem: 'WhatsApp ANA', dispatch_status: status, dispatch_vendedor_nome: 'Pedro' }, { name: 'Pedro', source: 'repasse' }), 'em-atendimento')
  })
}

test('disparo de outra origem não transforma Ana em vendedor', () => {
  assert.equal(etapaAtendimento({ responsavel: ' ANA ', dispatch_origem: 'Reply', dispatch_status: 'sent', dispatch_vendedor_nome: 'Pedro' }), 'em-atendimento')
})

test('vendedor humano identificado no WhatsApp confirma atendimento humano', () => {
  assert.equal(etapaAtendimento({}, { name: 'Igor', source: 'wa' }), 'com-vendedor')
  assert.equal(etapaAtendimento({}, { name: 'Ana', source: 'wa' }), 'em-atendimento')
})

for (const status of ['Resolvido']) {
  test(`Ana ${status} sem vendedor fica encerrada`, () => {
    assert.equal(etapaAtendimento({ responsavel: 'ANA', status_atendimento: status }), 'encerrado-sem-vendedor')
  })
}

test('tentativa sem resposta ainda não é um encerramento', () => {
  assert.equal(etapaAtendimento({ responsavel: 'ANA', status_atendimento: 'Sem-Resposta', tentativa_n: 2 }), 'em-atendimento')
  assert.equal(etapaAtendimento({ responsavel: 'ANA', status_atendimento: 'Sem-Resposta', como_finalizou: 'Sem-resposta' }), 'encerrado-sem-vendedor')
})

test('responsável Ana não oculta vendedor humano confirmado no WhatsApp', () => {
  assert.equal(etapaAtendimento({ responsavel: 'ANA' }, { name: 'Ana', source: 'crm' }, ['Ana', 'Pedro']), 'com-vendedor')
  assert.equal(etapaAtendimento({ responsavel: 'ANA' }, null, ['ANA', null]), 'em-atendimento')
})

test('encerramento explícito sem responsável fica vermelho', () => {
  assert.equal(etapaAtendimento({ finished_at: '2026-10-13T12:00:00Z' }), 'encerrado-sem-vendedor')
  assert.equal(etapaAtendimento({ como_finalizou: 'Perdido' }), 'encerrado-sem-vendedor')
  assert.equal(etapaAtendimento({ como_finalizou: 'Sem-resposta' }), 'encerrado-sem-vendedor')
})

test('ausência de repasse ou conversa antiga não significa encerramento', () => {
  assert.equal(etapaAtendimento({}), 'em-atendimento')
  assert.equal(etapaAtendimento({ como_finalizou: 'Em-andamento', status_real: 'Abandonado' }), 'em-atendimento')
})
