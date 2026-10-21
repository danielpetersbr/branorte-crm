import test from 'node:test'
import assert from 'node:assert/strict'
import { voltouEm } from './atendimento-voltou'

// Datas montadas no horário local: a regra compara dia do calendário de quem está olhando a tela.
const local = (mes: number, dia: number, h: number, min: number) => new Date(2026, mes - 1, dia, h, min).toISOString()

test('lead que chegou em outro dia e falou hoje volta com o momento da volta (caso Renato, 08/05 → 21/10)', () => {
  const volta = voltouEm(local(5, 8, 21, 16), local(10, 21, 16, 30))
  assert.ok(volta)
  assert.equal(volta.getDate(), 21)
  assert.equal(volta.getHours(), 16)
  assert.equal(volta.getMinutes(), 30)
})

test('conversa no mesmo dia em que chegou não é volta', () => {
  assert.equal(voltouEm(local(10, 21, 8, 0), local(10, 21, 23, 59)), null)
})

test('passar da meia-noite já é outro dia', () => {
  assert.ok(voltouEm(local(10, 20, 23, 50), local(10, 21, 0, 10)))
})

test('atividade anterior à chegada nunca vira volta', () => {
  assert.equal(voltouEm(local(10, 21, 10, 0), local(10, 20, 10, 0)), null)
})

test('sem data ou com data inválida não marca nada', () => {
  assert.equal(voltouEm(null, local(10, 21, 10, 0)), null)
  assert.equal(voltouEm(local(10, 21, 10, 0), undefined), null)
  assert.equal(voltouEm('não é data', local(10, 21, 10, 0)), null)
})
