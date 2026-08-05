// O codigo de rastreio do link e escrito em TypeScript (api/_lib/link-invisivel)
// e lido em SQL (public.link_rota_decode). Duas implementacoes do mesmo formato
// = risco de divergirem em silencio e a atribuicao parar de casar sem ninguem
// perceber. Estes testes travam o formato dos dois lados.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CODIGO_MAX,
  codigoLegivel,
  lerInvisivel,
  novoCodigoNum,
  selarInvisivel,
  semInvisivel,
} from '../../api/_lib/link-invisivel'

const DELIM = 0x2060
const DIGITO_BASE = 0x2061

/** Mesma formula do SQL: digito_i = (n / 4^(14-i)) % 4, simbolo = 0x2061 + digito.
 *  Se o TS divergir disso, o gatilho para de casar clique com conversa. */
function selarComoOSqlLe(num: number): string {
  let out = String.fromCodePoint(DELIM)
  for (let i = 0; i <= 14; i++) {
    const d = Math.floor(num / 4 ** (14 - i)) % 4
    out += String.fromCodePoint(DIGITO_BASE + d)
  }
  return out + String.fromCodePoint(DELIM)
}

test('selo tem 17 caracteres e todos sao invisiveis', () => {
  const selo = selarInvisivel(123456789)
  assert.equal([...selo].length, 17)
  for (const ch of selo) {
    const cp = ch.codePointAt(0)!
    assert.ok(cp >= 0x2060 && cp <= 0x2064, `caractere visivel vazou no selo: U+${cp.toString(16)}`)
  }
})

test('o que o TS escreve e exatamente o que o SQL espera ler', () => {
  for (const n of [0, 1, 3, 4, 255, 123456789, CODIGO_MAX - 1]) {
    assert.equal(selarInvisivel(n), selarComoOSqlLe(n), `divergiu no numero ${n}`)
  }
})

test('ida e volta em todo o intervalo', () => {
  for (const n of [0, 1, 42, 999999, CODIGO_MAX - 1]) {
    assert.equal(lerInvisivel(`Olá! Vi o site.${selarInvisivel(n)}`), n)
  }
})

test('texto sem selo devolve null em vez de inventar codigo', () => {
  assert.equal(lerInvisivel('Olá, quero um orçamento'), null)
  assert.equal(lerInvisivel(''), null)
})

test('selo truncado devolve null — melhor sem atribuicao do que com a errada', () => {
  const selo = selarInvisivel(123456789)
  assert.equal(lerInvisivel('oi' + selo.slice(0, 8)), null)
})

test('novoCodigoNum fica dentro do intervalo que o formato aguenta', () => {
  for (let i = 0; i < 500; i++) {
    const n = novoCodigoNum()
    assert.ok(Number.isInteger(n) && n >= 0 && n < CODIGO_MAX)
    assert.equal(lerInvisivel(selarInvisivel(n)), n)
  }
})

test('codigo legivel tem 6 chars sem caractere ambiguo', () => {
  for (const n of [0, 123456789, CODIGO_MAX - 1]) {
    const c = codigoLegivel(n)
    assert.equal(c.length, 6)
    assert.match(c, /^[23456789A-HJ-NP-Z]{6}$/)
  }
})

test('semInvisivel devolve o texto que o cliente enxerga', () => {
  const visivel = 'Olá! Vi o site da Branorte.'
  assert.equal(semInvisivel(visivel + selarInvisivel(7)), visivel)
})
