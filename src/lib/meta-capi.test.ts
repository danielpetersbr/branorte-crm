// O fbc e o unico elo entre um clique em /l/<slug> e o anuncio que o pagou.
// Se o formato sair errado, o Meta ACEITA o evento (HTTP 200, aparece no
// Gerenciador) e simplesmente nao atribui a campanha nenhuma -- falha muda, do
// tipo que so aparece semanas depois como "a campanha nao otimiza".
// Estes testes travam o formato e a rejeicao de entrada suja.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarFbc, lerFbp, capiConfigurada } from '../../api/_lib/meta-capi'

test('fbc sai no formato fb.1.<ms>.<fbclid> exigido pelo Meta', () => {
  const fbc = montarFbc('IwAR0abc-DEF_123', 1_754_500_000_000)
  assert.equal(fbc, 'fb.1.1754500000000.IwAR0abc-DEF_123')
  // O contrato do Meta e literal: 4 partes separadas por ponto, prefixo "fb",
  // subdominio numerico e timestamp em MILISSEGUNDOS (nao segundos).
  const partes = fbc!.split('.')
  assert.equal(partes.length, 4)
  assert.equal(partes[0], 'fb')
  assert.match(partes[2], /^\d{13}$/)
})

test('clique organico (sem fbclid) nao inventa fbc', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(montarFbc(v as unknown, 1), null)
  }
})

test('fbclid sujo e recusado em vez de entrar no payload', () => {
  // Vem da URL, ou seja: de qualquer um. Nada fora de base64url passa.
  assert.equal(montarFbc('abc def', 1), null)
  assert.equal(montarFbc('abc"drop', 1), null)
  assert.equal(montarFbc('a/b+c=', 1), null)
  assert.equal(montarFbc('x'.repeat(256), 1), null)
  // 255 e o limite aceito
  assert.notEqual(montarFbc('x'.repeat(255), 1), null)
})

test('timestamp entra inteiro mesmo com Date.now fracionado', () => {
  assert.equal(montarFbc('abc', 1_754_500_000_000.9), 'fb.1.1754500000000.abc')
})

test('_fbp e lido do header Cookie e validado', () => {
  assert.equal(lerFbp('_fbp=fb.1.1754500000000.987654321'), 'fb.1.1754500000000.987654321')
  assert.equal(lerFbp('outro=1; _fbp=fb.1.1.2; x=3'), 'fb.1.1.2')
  // Formato errado nao vai pro Meta -- ele rejeita o evento inteiro por isso.
  assert.equal(lerFbp('_fbp=qualquercoisa'), null)
  assert.equal(lerFbp('_fbpx=fb.1.1.2'), null)
  assert.equal(lerFbp(undefined), null)
})

test('sem env configurada a CAPI fica desligada (nao quebra o clique)', () => {
  const pixel = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN
  delete process.env.META_PIXEL_ID
  delete process.env.META_CAPI_TOKEN
  try {
    assert.equal(capiConfigurada(), false)
  } finally {
    if (pixel !== undefined) process.env.META_PIXEL_ID = pixel
    if (token !== undefined) process.env.META_CAPI_TOKEN = token
  }
})
