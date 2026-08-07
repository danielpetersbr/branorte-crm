import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passaPeriodo, diasDesde, rotuloPeriodo, faixaIdade, idadeLabel, PERIODO_DIAS } from './periodo'

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

// ── régua de idade do pino (verde ≤1 mês / vermelho 1–3 meses / cinza >3 meses) ──
// É a régua que o filtro de período existe para proteger; sem teste ela era a peça
// solta do conjunto.

test('faixaIdade: fronteiras 30 e 90 dias', () => {
  assert.equal(faixaIdade(diasAtras(0), HOJE), 'recente')
  assert.equal(faixaIdade(diasAtras(30), HOJE), 'recente')   // <= 30
  assert.equal(faixaIdade(diasAtras(31), HOJE), 'medio')
  assert.equal(faixaIdade(diasAtras(90), HOJE), 'medio')     // <= 90
  assert.equal(faixaIdade(diasAtras(91), HOJE), 'antigo')
  assert.equal(faixaIdade(diasAtras(5000), HOJE), 'antigo')
})

test('faixaIdade: SEM DATA é faixa própria, não "antigo"', () => {
  // Os dois pintam cinza, mas o motivo é diferente: um é idade, o outro é ausência
  // de dado. Confundir os dois é o que faria alguém "limpar" 718 pinos reais.
  assert.equal(faixaIdade(null, HOJE), 'sem-data')
  assert.equal(faixaIdade('', HOJE), 'sem-data')
  assert.equal(faixaIdade('data podre', HOJE), 'sem-data')
  assert.notEqual(faixaIdade(null, HOJE), faixaIdade(diasAtras(5000), HOJE))
})

test('faixaIdade: data no futuro conta como recente, não quebra', () => {
  const futuro = new Date(HOJE + 10 * 86400000).toISOString().slice(0, 10)
  assert.equal(faixaIdade(futuro, HOJE), 'recente')
})

test('a régua de cor e o filtro concordam: o que é "recente" cabe em qualquer janela', () => {
  for (const d of [0, 15, 30]) {
    const dt = diasAtras(d)
    assert.equal(faixaIdade(dt, HOJE), 'recente')
    assert.equal(passaPeriodo(dt, '12m', HOJE), true)
  }
})

test('idadeLabel: dias até 30, meses depois, travessão sem data', () => {
  assert.equal(idadeLabel(diasAtras(0), HOJE), 'há 0 dias')
  assert.equal(idadeLabel(diasAtras(1), HOJE), 'há 1 dia')
  assert.equal(idadeLabel(diasAtras(30), HOJE), 'há 30 dias')
  assert.equal(idadeLabel(diasAtras(31), HOJE), 'há 1 mês')
  assert.equal(idadeLabel(diasAtras(60), HOJE), 'há 2 meses')
  assert.equal(idadeLabel(null, HOJE), '—')
})
