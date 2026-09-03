import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codigosParaFiltro, UFS_BR } from './criativo-codigo'

test('código puro traz o puro E as campanhas regionais dele', () => {
  const r = codigosParaFiltro('&8')
  assert.equal(r[0], '&8', 'o puro tem que vir primeiro')
  assert.ok(r.includes('&8 RO'), 'Rondônia é campanha real e não pode sumir do filtro')
  assert.ok(r.includes('&8 MS'), 'Mato Grosso do Sul idem')
  assert.equal(r.length, 1 + UFS_BR.length)
})

test('aceita sem o & na frente', () => {
  assert.deepEqual(codigosParaFiltro('8'), codigosParaFiltro('&8'))
})

test('código com estado já digitado filtra só aquela campanha', () => {
  assert.deepEqual(codigosParaFiltro('&8 RO'), ['&8 RO'])
  assert.deepEqual(codigosParaFiltro('8 ro'), ['&8 RO'])
  assert.deepEqual(codigosParaFiltro('&54 MG'), ['&54 MG'])
})

test('MTS vira MS, que é como o estado se chama', () => {
  // O anúncio no Meta é "AD - &8 MTS", mas o conjunto aponta pra Mato Grosso do Sul.
  assert.deepEqual(codigosParaFiltro('&8 MTS'), ['&8 MS'])
  assert.deepEqual(codigosParaFiltro('&8 mts'), ['&8 MS'])
})

test('espaço a mais não atrapalha', () => {
  assert.deepEqual(codigosParaFiltro('  &8   RO  '), ['&8 RO'])
})

test('sufixo que não é estado não vira estado', () => {
  // "XX" não existe: mantém o texto como digitado em vez de inventar campanha.
  assert.deepEqual(codigosParaFiltro('&8 XX'), ['&8 XX'])
})

test('landing page e vazio seguem o comportamento antigo', () => {
  assert.deepEqual(codigosParaFiltro('#LPMINI'), ['#LPMINI'])
  assert.deepEqual(codigosParaFiltro('#lpmini'), ['#LPMINI'])
  assert.deepEqual(codigosParaFiltro(''), [])
  assert.deepEqual(codigosParaFiltro('   '), [])
  assert.deepEqual(codigosParaFiltro(null), [])
  assert.deepEqual(codigosParaFiltro(undefined), [])
})

test('não confunde código puro com outro código', () => {
  // "&8" não pode arrastar "&80" nem "&88": a lista é exata, não prefixo.
  const r = codigosParaFiltro('&8')
  assert.ok(!r.includes('&80'))
  assert.ok(!r.includes('&88'))
})
