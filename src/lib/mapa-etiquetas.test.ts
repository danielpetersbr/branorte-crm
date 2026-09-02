import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEM_ETIQUETA, SEM_WHATSAPP, etiquetasDoCliente, passaEtiqueta, opcoesEtiqueta,
  nomeCanonicoEtiqueta, corPorEtiqueta, corDaOpcaoEtiqueta, type MapaEtiquetas,
} from './mapa-etiquetas'

const mapa: MapaEtiquetas = new Map([
  ['4899990001', { principal: 'VENDIDO', todas: ['VENDIDO', 'ORCAMENTO ENVIADO'] }],
  ['1199990002', { principal: null, todas: [] }],
])

test('etiquetasDoCliente: casa pelo canônico — com/sem 55 e com/sem o 9', () => {
  assert.equal(etiquetasDoCliente(mapa, ['+55 (48) 99999-0001'])?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, ['48 9999-0001'])?.principal, 'VENDIDO')
  assert.equal(etiquetasDoCliente(mapa, [null, '5511999990002'])?.todas.length, 0)
  assert.equal(etiquetasDoCliente(mapa, ['48 8888-0000']), null, 'sem conversa = null')
  assert.equal(etiquetasDoCliente(mapa, [null, undefined, '']), null)
})

test('etiquetasDoCliente: o primeiro telefone que casa manda', () => {
  assert.equal(etiquetasDoCliente(mapa, ['48 8888-0000', '11 99999-0002'])?.todas.length, 0)
})

test('passaEtiqueta: seleção vazia deixa tudo passar', () => {
  const nada = new Set<string>()
  assert.equal(passaEtiqueta(nada, null), true)
  assert.equal(passaEtiqueta(nada, { principal: null, todas: [] }), true)
})

test('passaEtiqueta: marcar várias SOMA (qualquer uma serve)', () => {
  const sel = new Set(['ORCAMENTO ENVIADO', 'INTERESSE FUTURO'])
  assert.equal(passaEtiqueta(sel, { principal: 'VENDIDO', todas: ['VENDIDO', 'ORCAMENTO ENVIADO'] }), true)
  assert.equal(passaEtiqueta(sel, { principal: 'VENDIDO', todas: ['VENDIDO'] }), false)
})

test('passaEtiqueta: os dois "sem" são coisas diferentes', () => {
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), { principal: null, todas: [] }), true)
  assert.equal(passaEtiqueta(new Set([SEM_ETIQUETA]), null), false, 'sem conversa NÃO é "sem etiqueta"')
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), null), true)
  assert.equal(passaEtiqueta(new Set([SEM_WHATSAPP]), { principal: null, todas: [] }), false)
  assert.equal(passaEtiqueta(new Set(['VENDIDO']), null), false)
})

test('opcoesEtiqueta: funil na ordem oficial, internas no fim, "sem" por último, contagem por cliente', () => {
  const ops = opcoesEtiqueta([
    { principal: 'VENDIDO', todas: ['VENDIDO', 'ORCAMENTO ENVIADO'] },
    { principal: 'ORCAMENTO ENVIADO', todas: ['ORCAMENTO ENVIADO'] },
    { principal: 'BRANORTE', todas: ['BRANORTE'] },
    { principal: 'FEIRA', todas: ['FEIRA'] },
    { principal: 'FEIRA', todas: ['FEIRA'] },
    { principal: 'PROSPECCAO', todas: ['PROSPECCAO'] },
    { principal: null, todas: [] },
    null, null,
  ])
  assert.deepEqual(ops.map(o => `${o.valor}:${o.n}`), [
    'PROSPECCAO:1', 'ORCAMENTO ENVIADO:2', 'VENDIDO:1',   // ordem do funil
    'FEIRA:2',                                            // fora do funil: por volume
    'BRANORTE:1',                                         // interna
    `${SEM_ETIQUETA}:1`, `${SEM_WHATSAPP}:2`,
  ])
  assert.equal(ops.find(o => o.valor === 'BRANORTE')?.interna, true)
  assert.equal(ops.find(o => o.valor === 'FEIRA')?.interna, false)
})

test('opcoesEtiqueta: lista vazia não inventa "sem"', () => {
  assert.deepEqual(opcoesEtiqueta([]), [])
})

test('nomeCanonicoEtiqueta: caixa e alias iguais aos do funil', () => {
  assert.equal(nomeCanonicoEtiqueta(' fallow up '), 'FOLLOW UP')
  assert.equal(nomeCanonicoEtiqueta('Vendidos'), 'VENDIDO')
})

test('cores: sem WhatsApp, sem etiqueta e etiqueta são três cores distintas nos dois temas', () => {
  for (const escuro of [false, true]) {
    const a = corPorEtiqueta(null, escuro)
    const b = corPorEtiqueta({ principal: null, todas: [] }, escuro)
    const c = corPorEtiqueta({ principal: 'VENDIDO', todas: ['VENDIDO'] }, escuro)
    assert.equal(new Set([a, b, c]).size, 3, `tema ${escuro ? 'escuro' : 'claro'}`)
    assert.equal(corDaOpcaoEtiqueta(SEM_WHATSAPP, escuro), a)
    assert.equal(corDaOpcaoEtiqueta(SEM_ETIQUETA, escuro), b)
    assert.equal(corDaOpcaoEtiqueta('VENDIDO', escuro), c)
  }
})

test('cores: no tema escuro a etiqueta clareia (não some no fundo)', () => {
  const claro = corPorEtiqueta({ principal: 'VENDIDO', todas: ['VENDIDO'] }, false)
  const escuro = corPorEtiqueta({ principal: 'VENDIDO', todas: ['VENDIDO'] }, true)
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
  assert.ok(lum(escuro) > lum(claro))
})
