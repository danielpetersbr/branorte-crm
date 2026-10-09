import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrecoComMotor } from '../motor-do-preco.js'
import { catalogItemRequiresVoltage } from '../../../api/_lib/orcamento-ai-catalog.js'

function price(overrides: Partial<PrecoComMotor>): PrecoComMotor {
  return {
    categoria: 'CAIXA',
    subcategoria: null,
    descricao: 'Caixa de material picado',
    capacidade: null,
    motor_cv: null,
    motor_polos: null,
    valor_equipamento: 10_000,
    valor_com_motor_trif: null,
    valor_com_motor_mono: null,
    ...overrides,
  }
}

describe('catalogItemRequiresVoltage', () => {
  test('não bloqueia item que oficialmente não tem motor', () => {
    assert.equal(catalogItemRequiresVoltage(price({ categoria: 'CAIXA' })), false)
  })

  test('exige voltagem para motor avulso mesmo sem colunas de preço mono/tri', () => {
    assert.equal(catalogItemRequiresVoltage(price({
      categoria: 'MOINHO',
      subcategoria: 'MARTELO',
      motor_cv: 15,
      motor_polos: 2,
    })), true)
  })

  test('exige voltagem quando o preço muda por mono/trifásico', () => {
    assert.equal(catalogItemRequiresVoltage(price({
      categoria: 'ELEVADOR',
      subcategoria: 'COMPLETO',
      valor_com_motor_trif: 7_404,
      valor_com_motor_mono: 8_651,
    })), true)
  })

  test('não inventa configuração para pacote multi-motor', () => {
    assert.equal(catalogItemRequiresVoltage(price({ categoria: 'COMPACTA', subcategoria: '01' })), true)
  })
})
