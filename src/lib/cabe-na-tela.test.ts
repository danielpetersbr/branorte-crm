import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deslocamentoParaCaber } from './cabe-na-tela'

// Números do caso real (29/09/2026, celular 390px, /disparos): o card do funil
// tem 208px (w-52) e a mesa da borda direita o centrava em 314 → ia até 418.
const CARD = 208

test('mesa da borda DIREITA: puxa o card pra esquerda até ficar a 8px da borda', () => {
  const centro = 314
  const dx = deslocamentoParaCaber(centro - CARD / 2, centro + CARD / 2, 390)
  assert.equal(dx, -36)
  assert.equal(centro + CARD / 2 + dx, 382) // direita = 390 - 8
  assert.ok(centro - CARD / 2 + dx >= 8)
})

test('mesa da borda ESQUERDA: empurra o card pra direita até ficar a 8px da borda', () => {
  const centro = 62 // mesa-04 (cx 58) numa planta de 324px que começa em 33
  const dx = deslocamentoParaCaber(centro - CARD / 2, centro + CARD / 2, 390)
  assert.equal(dx, 50)
  assert.equal(centro - CARD / 2 + dx, 8)
  assert.ok(centro + CARD / 2 + dx <= 382)
})

test('cabendo (mesa do meio, ou qualquer mesa no desktop): não mexe', () => {
  assert.equal(deslocamentoParaCaber(91, 299, 390), 0)
  assert.equal(deslocamentoParaCaber(8, 216, 390), 0) // encostado na margem ainda cabe
  assert.equal(deslocamentoParaCaber(174, 382, 390), 0)
  assert.equal(deslocamentoParaCaber(1000, 1208, 1366), 0)
})

test('mais largo que a área útil: prende o início (onde fica o nome)', () => {
  assert.equal(deslocamentoParaCaber(-20, 300, 300), 28) // passa a começar em 8
  assert.equal(deslocamentoParaCaber(50, 350, 300), -42)
})

test('sem caixa (display:none / não montado) ou tela sem medida: 0, nunca NaN', () => {
  assert.equal(deslocamentoParaCaber(0, 0, 390), 0)
  assert.equal(deslocamentoParaCaber(10, 5, 390), 0)
  assert.equal(deslocamentoParaCaber(NaN, 100, 390), 0)
  assert.equal(deslocamentoParaCaber(10, 100, 0), 0)
})

test('arredonda pra px inteiro e nunca devolve -0', () => {
  assert.equal(deslocamentoParaCaber(180.4, 388.4, 390), -6)
  assert.ok(Object.is(deslocamentoParaCaber(174.3, 382.3, 390), 0))
})

test('idempotente: medir de novo a posição SEM o deslocamento dá o mesmo valor', () => {
  const esq = 210, dir = 418
  const dx = deslocamentoParaCaber(esq, dir, 390)
  // o chamador desconta o dx já aplicado antes de medir de novo
  assert.equal(deslocamentoParaCaber((esq + dx) - dx, (dir + dx) - dx, 390), dx)
})
