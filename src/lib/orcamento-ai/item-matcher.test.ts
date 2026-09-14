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
