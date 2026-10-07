import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correspondeBuscaCatalogo, resumirCatalogo } from './catalogo-admin-apresentacao'

const caixa = { id: 813, nome_curto: 'Caixa de Ração 2 Ton', nome_completo: null, categoria: 'CAIXA', subcategoria: null }

test('busca encontra palavras fora de ordem e sem exigir acentos', () => {
  assert.equal(correspondeBuscaCatalogo(caixa, '  2 RACAO caixa  '), true)
  assert.equal(correspondeBuscaCatalogo(caixa, 'caixa 5'), false)
})

test('busca aceita o código do produto e campos comerciais ausentes', () => {
  assert.equal(correspondeBuscaCatalogo(caixa, '#813'), true)
  assert.equal(correspondeBuscaCatalogo(caixa, '814'), false)
  assert.equal(correspondeBuscaCatalogo(caixa, '   '), true)
  assert.equal(correspondeBuscaCatalogo({ ...caixa, nome_curto: null, categoria: null }, 'moinho'), false)
})

test('busca reconhece os nomes de categorias exibidos na tela', () => {
  assert.equal(correspondeBuscaCatalogo(caixa, 'caixas'), true)
  assert.equal(correspondeBuscaCatalogo({ ...caixa, categoria: 'SUPORTE_BAG' }, 'big bag'), true)
})

test('resumo conta produtos e fotos sem classificação de aprovação', () => {
  assert.deepEqual(resumirCatalogo([
    { ativo: true, is_oficial: true, foto_url: 'caixa.jpg' },
    { ativo: true, is_oficial: true, foto_url: null },
    { ativo: true, is_oficial: false, foto_url: 'pendente.jpg' },
    { ativo: false, is_oficial: true, foto_url: null },
  ]), { todos: 3, 'sem-foto': 1, inativos: 1, comFoto: 2 })
})

test('catálogo vazio tem resumo vazio', () => {
  assert.deepEqual(resumirCatalogo([]), { todos: 0, 'sem-foto': 0, inativos: 0, comFoto: 0 })
})
