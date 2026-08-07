import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passaPeriodo, diasDesde, rotuloPeriodo, PERIODO_DIAS } from './periodo'

// Data fixa para os testes não dependerem do dia em que rodam.
const HOJE = new Date('2026-08-07T12:00:00Z').getTime()
const diasAtras = (n: number) =>
  new Date(HOJE - n * 86400000).toISOString().slice(0, 10)

test('passaPeriodo: "tudo" nunca esconde nada', () => {
  assert.equal(passaPeriodo(diasAtras(5000), 'tudo', HOJE), true)
  assert.equal(passaPeriodo(null, 'tudo', HOJE), true)
  assert.equal(passaPeriodo('', 'tudo', HOJE), true)
})

test('passaPeriodo: SEM DATA passa em qualquer janela (vendas_mapa sem data_venda)', () => {
  for (const p of ['12m', '24m', '5a', 'tudo'] as const) {
    assert.equal(passaPeriodo(null, p, HOJE), true, `null deveria passar em ${p}`)
    assert.equal(passaPeriodo(undefined, p, HOJE), true, `undefined deveria passar em ${p}`)
    assert.equal(passaPeriodo('', p, HOJE), true, `string vazia deveria passar em ${p}`)
  }
})

test('passaPeriodo: data ilegível é tratada como sem data (não some)', () => {
  assert.equal(passaPeriodo('não é data', '12m', HOJE), true)
  assert.equal(passaPeriodo('0000-00-00', '12m', HOJE), true)
})

test('passaPeriodo: fronteira exata de cada janela', () => {
  for (const [p, limite] of Object.entries(PERIODO_DIAS)) {
    if (limite == null) continue
    const per = p as '12m' | '24m' | '5a'
    assert.equal(passaPeriodo(diasAtras(limite - 1), per, HOJE), true, `${p}: ${limite - 1} dias entra`)
    assert.equal(passaPeriodo(diasAtras(limite), per, HOJE), true, `${p}: ${limite} dias entra (<=)`)
    assert.equal(passaPeriodo(diasAtras(limite + 1), per, HOJE), false, `${p}: ${limite + 1} dias sai`)
  }
})

test('passaPeriodo: as janelas são encaixadas — o que entra em 12m entra em 24m e 5a', () => {
  for (const d of [0, 1, 100, 364, 365]) {
    const dt = diasAtras(d)
    assert.equal(passaPeriodo(dt, '12m', HOJE), true)
    assert.equal(passaPeriodo(dt, '24m', HOJE), true)
    assert.equal(passaPeriodo(dt, '5a', HOJE), true)
  }
})

test('passaPeriodo: orçamento de 2012 só aparece em "Tudo"', () => {
  const antigo = '2012-03-15'
  assert.equal(passaPeriodo(antigo, '12m', HOJE), false)
  assert.equal(passaPeriodo(antigo, '24m', HOJE), false)
  assert.equal(passaPeriodo(antigo, '5a', HOJE), false)
  assert.equal(passaPeriodo(antigo, 'tudo', HOJE), true)
})

test('passaPeriodo: data no futuro não é escondida', () => {
  const futuro = new Date(HOJE + 30 * 86400000).toISOString().slice(0, 10)
  assert.equal(passaPeriodo(futuro, '12m', HOJE), true)
})

test('passaPeriodo: aceita timestamp completo, não só YYYY-MM-DD', () => {
  assert.equal(passaPeriodo('2026-08-01T09:30:00Z', '12m', HOJE), true)
  assert.equal(passaPeriodo('2013-08-01T09:30:00Z', '12m', HOJE), false)
})

test('diasDesde: conta em dias inteiros', () => {
  assert.equal(diasDesde(diasAtras(0), HOJE), 0)
  assert.equal(diasDesde(diasAtras(1), HOJE), 1)
  assert.equal(diasDesde(diasAtras(730), HOJE), 730)
  assert.equal(diasDesde(null, HOJE), null)
})

test('rotuloPeriodo devolve o texto que aparece no botão', () => {
  assert.equal(rotuloPeriodo('24m'), '24 meses')
  assert.equal(rotuloPeriodo('tudo'), 'Tudo')
})
