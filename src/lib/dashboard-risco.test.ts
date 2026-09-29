import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RISCO_MAX_HORAS, entraEmRisco, horasSemAtividade, responsavelDoRisco,
} from './dashboard-risco'

const AGORA = Date.parse('2026-09-29T12:00:00Z')
const H = 3_600_000
const iso = (horasAtras: number) => new Date(AGORA - horasAtras * H).toISOString()

test('orçamento montado DEPOIS da última mensagem conta como atividade', () => {
  // Caso real do achado: 150 dias sem mensagem no canal da IA, orçamento de 8 dias atrás.
  const h = horasSemAtividade(iso(150 * 24), AGORA - 8 * 24 * H, AGORA)
  assert.equal(h, 8 * 24)
})

test('sem orçamento, vale a última mensagem; mensagem mais nova que o orçamento ganha', () => {
  assert.equal(horasSemAtividade(iso(30), undefined, AGORA), 30)
  assert.equal(horasSemAtividade(iso(30), AGORA - 90 * H, AGORA), 30)
})

test('datas ausentes ou inválidas não viram "parado há 56 anos"', () => {
  assert.equal(horasSemAtividade(null, undefined, AGORA), null)
  assert.equal(horasSemAtividade('lixo', NaN, AGORA), null)
  assert.equal(horasSemAtividade('lixo', AGORA - 48 * H, AGORA), 48)
})

test('janela do risco: > 24h e até 14 dias — o de 124 dias sai do card', () => {
  assert.equal(entraEmRisco('Agora', 0, 24), false)          // 24h exatas ainda não
  assert.equal(entraEmRisco('Agora', 0, 25), true)
  assert.equal(entraEmRisco(null, 801_000, RISCO_MAX_HORAS), true)
  assert.equal(entraEmRisco(null, 801_000, RISCO_MAX_HORAS + 1), false)
  assert.equal(entraEmRisco(null, 801_000, 124 * 24), false)
  assert.equal(entraEmRisco(null, 50_000, null), false)
})

test('só entra quem é quente (quer investir agora) ou tem orçamento', () => {
  assert.equal(entraEmRisco('Pesquisando', 0, 48), false)
  assert.equal(entraEmRisco(null, 0, 48), false)
  assert.equal(entraEmRisco('Pesquisando', 12_000, 48), true)
})

test('responsável do card pula o dono e quem não tem vendedor', () => {
  assert.equal(responsavelDoRisco([{ vendedor: null }, { vendedor: 'DANIEL' }, { vendedor: 'EDER' }]), 'EDER')
  assert.equal(responsavelDoRisco([{ vendedor: 'DANIEL' }]), undefined)
  assert.equal(responsavelDoRisco([]), undefined)
})
