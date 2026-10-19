import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mascararTexto, MASCARA as M } from './ocultarNumeros'

test('valor em R$ vira uma máscara só, sem entregar a ordem de grandeza', () => {
  assert.equal(mascararTexto('R$ 734.510'), `R$ ${M}`)
  assert.equal(mascararTexto('R$ 1,77M'), `R$ ${M}`)
  assert.equal(mascararTexto('R$ 147,1 mil'), `R$ ${M}`)
  assert.equal(mascararTexto('hoje o ritmo é R$ 38,7 mil/dia'), `hoje o ritmo é R$ ${M}/dia`)
})

test('contagens e percentuais somem', () => {
  assert.equal(mascararTexto('1.017'), M)
  assert.equal(mascararTexto('26% dos leads · 11 pela etiqueta'), `${M}% dos leads · ${M} pela etiqueta`)
  assert.equal(mascararTexto('dia 19 de 31 · 27 pedidos'), `dia ${M} de ${M} · ${M} pedidos`)
  assert.equal(mascararTexto('2d 4h'), `${M}d ${M}h`)
})

test('palavra que começa com "mi" não é engolida como sufixo', () => {
  assert.equal(mascararTexto('3 milhões'), `${M} milhões`)
})

test('data e hora ficam: são eixo de gráfico, não dado', () => {
  assert.equal(mascararTexto('18/08'), '18/08')
  assert.equal(mascararTexto('19:29'), '19:29')
  assert.equal(mascararTexto('18/08/2026'), '18/08/2026')
})

test('texto sem número não muda', () => {
  assert.equal(mascararTexto('Funil do período'), 'Funil do período')
})
