import assert from 'node:assert/strict'
import test from 'node:test'
import { matchCatalogItem } from './item-matcher'
import type { CatalogItemCandidate } from './item-matcher'
import type { ItemPedido } from './types'

const candidates: CatalogItemCandidate[] = [
  { id: 1, categoria: 'TRANSPORTADOR', descricao: 'Chupim 160 x 6,0 m', valorEquipamento: 7470, motorCv: 3, motorPolos: 4 },
  { id: 2, categoria: 'TRANSPORTADOR', descricao: 'Chupim 160 x 6,5 m', valorEquipamento: 7750, motorCv: 3, motorPolos: 4 },
  { id: 3, categoria: 'SUPORTE_BAG', descricao: 'Suporte para Bag com funil', valorEquipamento: 6000 },
  { id: 4, categoria: 'SUPORTE_BAG', descricao: 'Suporte para Bag sem funil', valorEquipamento: 4800 },
  { id: 5, categoria: 'CAIXA', descricao: 'Caixa de material picado 4.000 kg', valorEquipamento: 12000, capacidadeKg: 4000 },
  { id: 6, categoria: 'CAIXA', descricao: 'Caixa de ração pronta 4.000 kg', valorEquipamento: 13000, capacidadeKg: 4000 },
]

test('matches diameter and length exactly instead of choosing the nearest screw', () => {
  const request: ItemPedido = { textoOriginal: 'chupim 160 por 6,5', categoria: 'TRANSPORTADOR', quantidade: 1, diametroMm: 160, comprimentoM: 6.5 }
  assert.equal(matchCatalogItem(request, candidates).match?.id, 2)
})

test('keeps support without funnel distinct from the funnel variant', () => {
  const request: ItemPedido = { textoOriginal: 'suporte para bag sem funil', categoria: 'SUPORTE_BAG', quantidade: 1, semFunil: true }
  assert.equal(matchCatalogItem(request, candidates).match?.id, 4)
})

test('requires a choice instead of guessing when candidates remain tied', () => {
  const request: ItemPedido = { textoOriginal: 'chupim 160', categoria: 'TRANSPORTADOR', quantidade: 1, diametroMm: 160 }
  assert.equal(matchCatalogItem(request, candidates).status, 'requer_escolha')
})

test('maps a spoken material box to the matching catalog subtype', () => {
  const request: ItemPedido = { textoOriginal: 'caixa de material triturado de 4 mil quilos', categoria: 'CAIXA_MATERIAL_TRITURADO', quantidade: 1, capacidade: 4000, unidadeCapacidade: 'kg' }
  assert.equal(matchCatalogItem(request, candidates).match?.id, 5)
})

test('does not cross equipment categories when a category is unknown', () => {
  const request: ItemPedido = { textoOriginal: 'silo especial de 4 mil quilos', categoria: 'SILO_ESPECIAL', quantidade: 1, capacidade: 4000, unidadeCapacidade: 'kg' }
  assert.equal(matchCatalogItem(request, candidates).status, 'nao_encontrado')
})

test('uses official code and model fields to resolve an exact SKU', () => {
  const elevatorCandidates: CatalogItemCandidate[] = [
    { id: 10, categoria: 'ELEVADOR', subcategoria: 'COMPLETO', codigo: 'EC-2310', modelo: 'Elevador de canecas', descricao: 'Elevador completo', valorEquipamento: 20_000 },
    { id: 11, categoria: 'ELEVADOR', subcategoria: 'COMPLETO', codigo: 'EC-4010', modelo: 'Elevador de canecas', descricao: 'Elevador completo', valorEquipamento: 24_000 },
  ]
  const request: ItemPedido = { textoOriginal: 'elevador de canecas EC-2310', categoria: 'ELEVADOR', quantidade: 1 }
  assert.equal(matchCatalogItem(request, elevatorCandidates).match?.id, 10)
})

test('filters capacity expressed in liters using official metadata', () => {
  const bucketCandidates: CatalogItemCandidate[] = [
    { id: 20, categoria: 'CACAMBA_PESAGEM', descricao: 'Caçamba de pesagem', capacidadeLitros: 1_000, valorEquipamento: 10_000 },
    { id: 21, categoria: 'CACAMBA_PESAGEM', descricao: 'Caçamba de pesagem', capacidadeLitros: 1_900, valorEquipamento: 15_000 },
  ]
  const request: ItemPedido = { textoOriginal: 'caçamba de pesagem de 1900 litros', categoria: 'CACAMBA_PESAGEM', quantidade: 1, capacidade: 1900, unidadeCapacidade: 'litros' }
  assert.equal(matchCatalogItem(request, bucketCandidates).match?.id, 21)
})

test('uses official dimensions when the commercial description omits them', () => {
  const transportCandidates: CatalogItemCandidate[] = [
    { id: 30, categoria: 'TRANSPORTADOR', descricao: 'Chupim galvanizado', dimensoes: '160 x 6,0 m', valorEquipamento: 7_000 },
    { id: 31, categoria: 'TRANSPORTADOR', descricao: 'Chupim galvanizado', dimensoes: '160 x 6,5 m', valorEquipamento: 7_500 },
  ]
  const request: ItemPedido = { textoOriginal: 'chupim 160 por 6,5', categoria: 'TRANSPORTADOR', quantidade: 1, diametroMm: 160, comprimentoM: 6.5 }
  assert.equal(matchCatalogItem(request, transportCandidates).match?.id, 31)
})
