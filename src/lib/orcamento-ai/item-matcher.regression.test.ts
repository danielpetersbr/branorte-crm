import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  matchCatalogItem,
  priceForVoltage,
  type CatalogItemCandidate,
} from './item-matcher'

test('trata chupim como alias de transportador helicoidal', () => {
  const candidates: CatalogItemCandidate[] = [
    {
      id: 1,
      categoria: 'TRANSPORTADOR',
      descricao: 'TRANSPORTADOR HELICOIDAL 160 X 6,5 M',
      valorEquipamento: 10_000,
    },
  ]

  const result = matchCatalogItem(
    {
      textoOriginal: 'chupim de 160 por 6,5 metros',
      categoria: 'chupim',
      quantidade: 1,
      diametroMm: 160,
      comprimentoM: 6.5,
    },
    candidates,
  )

  assert.equal(result.status, 'exato')
  if (result.status === 'exato') assert.equal(result.match.id, 1)
})

test('trata martelo como alias de moinho ao buscar no catalogo', () => {
  const candidates: CatalogItemCandidate[] = [
    {
      id: 1,
      categoria: 'MOINHO',
      descricao: 'MOINHO MARTELO 15 CV',
      valorEquipamento: 12_000,
      motorCv: 15,
    },
  ]

  const result = matchCatalogItem(
    {
      textoOriginal: 'martelo de 15 CV',
      categoria: 'martelo',
      quantidade: 1,
      motorCv: 15,
    },
    candidates,
  )

  assert.equal(result.status, 'exato')
  if (result.status === 'exato') assert.equal(result.match.id, 1)
})

test('nao aceita candidato unico sem relacao com o item pedido', () => {
  const candidates: CatalogItemCandidate[] = [
    {
      id: 1,
      categoria: 'MISTURADOR',
      descricao: 'MISTURADOR VERTICAL 1000 KG',
      valorEquipamento: 20_000,
      capacidadeKg: 1_000,
    },
  ]

  const result = matchCatalogItem(
    {
      textoOriginal: 'jogo de peneira 2 mm para moinho de 10 CV',
      categoria: 'PENEIRA',
      quantidade: 1,
      motorCv: 10,
    },
    candidates,
  )

  assert.equal(result.status, 'nao_encontrado')
})

test('nao escolhe preco mono ou trifasico quando a voltagem esta ausente', () => {
  const candidate: CatalogItemCandidate = {
    id: 1,
    categoria: 'MOINHO',
    descricao: 'MOINHO MARTELO 15 CV',
    valorEquipamento: null,
    valorComMotorMono: 18_000,
    valorComMotorTrif: 17_000,
    motorCv: 15,
  }

  assert.equal(priceForVoltage(candidate, undefined), 0)
})
