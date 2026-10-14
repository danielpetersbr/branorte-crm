import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validarExcecoesCota } from './roteamento-cota'

test('distingue cota normal, liberação sem prazo e exceção temporária', () => {
  const dados = [
    { vendedor_nome: 'IGOR', ignorar_parados: false, expira_em: null, temporario: false },
    { vendedor_nome: 'LUCAS', ignorar_parados: true, expira_em: null, temporario: false },
    { vendedor_nome: 'EDER', ignorar_parados: true, expira_em: '2026-10-24T15:12:35Z', temporario: true },
  ]
  assert.deepEqual(validarExcecoesCota(dados), dados)
})

test('leitura incompleta não é interpretada como cota desativada', () => {
  for (const dados of [null, undefined, {}, [{ vendedor_nome: 'IGOR' }],
    [{ vendedor_nome: 'IGOR', ignorar_parados: 'false', expira_em: null, temporario: false }],
    [{ vendedor_nome: '', ignorar_parados: false, expira_em: null, temporario: false }]]) {
    assert.throws(() => validarExcecoesCota(dados))
  }
})

test('recusa prazo ou estado incoerente e vendedor duplicado', () => {
  const normal = { vendedor_nome: 'IGOR', ignorar_parados: false, expira_em: null, temporario: false }
  for (const dados of [
    [{ ...normal, temporario: true }],
    [{ ...normal, ignorar_parados: true, temporario: true, expira_em: 'infinity' }],
    [{ ...normal, expira_em: '2026-10-24T15:12:35Z' }],
    [normal, normal],
  ]) assert.throws(() => validarExcecoesCota(dados))
})
