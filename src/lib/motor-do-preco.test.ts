import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  motorDoPreco, classeDeMotor, valorPorVoltagem, acharMotorCompativel,
  type MotorCatalogoBase, type PrecoComMotor,
} from './motor-do-preco'

// Recorte real de `catalogo_motores` (conferido no banco em 2026-08-18).
// ⚠️ Monofásico só existe até 15 CV — isso não é lacuna do fixture, é o catálogo.
const MOTORES: MotorCatalogoBase[] = [
  { cv: 1.5, polos: 4, voltagem: 'trifasico', valor: 1732 },
  { cv: 1.5, polos: 4, voltagem: 'monofasico', valor: 2100 },
  { cv: 2, polos: 4, voltagem: 'trifasico', valor: 2198 },
  { cv: 3, polos: 4, voltagem: 'trifasico', valor: 2541 },
  { cv: 4, polos: 4, voltagem: 'trifasico', valor: 3080 },
  { cv: 7.5, polos: 4, voltagem: 'trifasico', valor: 4724 },
  { cv: 100, polos: 2, voltagem: 'trifasico', valor: 49826 },
]

// Linha real: precos_branorte id=172 (Moinho Martelo BNMM7100).
const BNMM7100: PrecoComMotor = {
  categoria: 'MOINHO', subcategoria: 'MARTELO',
  descricao: 'BNMM7100 (100,0 CV 2 POLOS - 10000KG/H)',
  capacidade: '10000KG/H',
  motor_cv: 100, motor_polos: 2,
  valor_equipamento: 141499.6,
  valor_com_motor_trif: null, valor_com_motor_mono: null,
}

function base(over: Partial<PrecoComMotor>): PrecoComMotor {
  return {
    categoria: 'OUTROS', subcategoria: null, descricao: 'x', capacidade: null,
    motor_cv: null, motor_polos: null,
    valor_equipamento: 1000, valor_com_motor_trif: null, valor_com_motor_mono: null,
    ...over,
  }
}

describe('classeDeMotor — a regra de domínio, na direção certa', () => {
  test('os três grupos de motor AVULSO', () => {
    assert.equal(classeDeMotor('MOINHO', 'MARTELO'), 'AVULSO')
    assert.equal(classeDeMotor('TRANSPORTADOR', 'CHUPIM'), 'AVULSO')
    assert.equal(classeDeMotor('MISTURADOR', 'VERTICAL'), 'AVULSO')
  })

  test('INCLUSO não é avulso — somar aqui superfaturaria', () => {
    for (const [cat, sub] of [
      ['TRANSPORTADOR', 'TH'], ['ELEVADOR', 'COMPLETO'],
      ['MISTURADOR', 'HORIZONTAL_SPULMAO'], ['MISTURADOR', 'HORIZONTAL_CPULMAO'],
      ['CACAMBA_PESAGEM', 'PESAGEM'], ['PRE_LIMPEZA', null],
      ['ESTEIRA', null], ['MOEGA', null], ['ENSACADEIRA', 'DIVERSOS'],
    ] as [string, string | null][]) {
      assert.equal(classeDeMotor(cat, sub), 'INCLUSO', `${cat}/${sub}`)
    }
  })

  test('SEM_MOTOR vale pra categoria inteira, com ou sem subcategoria', () => {
    assert.equal(classeDeMotor('SILO', 'MILHO'), 'SEM_MOTOR')
    assert.equal(classeDeMotor('CAIXA', 'PICADOS'), 'SEM_MOTOR')
    assert.equal(classeDeMotor('PAINEL_ELETRICO', 'COMPACTA_01'), 'SEM_MOTOR')
    assert.equal(classeDeMotor('BALANCA', 'CELULA'), 'SEM_MOTOR')
    assert.equal(classeDeMotor('HELICOIDE', 'PECA'), 'SEM_MOTOR')
    assert.equal(classeDeMotor('DESCARGA', null), 'SEM_MOTOR')
    assert.equal(classeDeMotor('PASSARELA', null), 'SEM_MOTOR')
    assert.equal(classeDeMotor('SUPORTE_BAG', null), 'SEM_MOTOR')
    assert.equal(classeDeMotor('ACESSORIO', 'PENEIRA'), 'SEM_MOTOR')
  })

  test('COMPACTA é multi-motor: 6 a 8 motores, motor_cv NULL nas 34', () => {
    assert.equal(classeDeMotor('COMPACTA', '01'), 'MULTI_MOTOR')
    assert.equal(classeDeMotor('COMPACTA', '02 MASTER'), 'MULTI_MOTOR')
  })
})

describe('BNMM7100 — o caso que motivou tudo', () => {
  test('141.499,60 + 49.826,00 = 191.325,60', () => {
    const r = motorDoPreco(BNMM7100, MOTORES, 'trifasico')
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.valorEquipamento, 141499.6)
    assert.equal(r.cv, 100)
    assert.equal(r.polos, 2)
    assert.equal(r.estimado, false)
    assert.equal(r.motor?.valor, 49826)
    assert.equal(r.total, 191325.6)
  })

  test('o motor é 35% a mais — é isso que a tela escondia', () => {
    const r = motorDoPreco(BNMM7100, MOTORES, 'trifasico')
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO' || r.total == null) return
    assert.ok(r.total / r.valorEquipamento > 1.35)
  })

  test('monofásico: catálogo não tem 100 CV mono → total NULL, nunca 0', () => {
    const r = motorDoPreco(BNMM7100, MOTORES, 'monofasico')
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.motor, null)
    // A trava do enunciado: NUNCA somar 0 e apresentar como total.
    assert.equal(r.total, null)
    assert.notEqual(r.total, r.valorEquipamento)
  })
})

describe('PostgREST devolve numeric como STRING — somar direto concatenaria', () => {
  test('"141499.60" + "49826.00" não vira "141499.649826"', () => {
    const cru = {
      ...BNMM7100,
      motor_cv: '100.00' as unknown as number,
      valor_equipamento: '141499.60' as unknown as number,
    }
    const motoresCrus = [{ cv: '100.00', polos: 2, voltagem: 'trifasico', valor: '49826.00' }] as unknown as MotorCatalogoBase[]
    const r = motorDoPreco(cru, motoresCrus, 'trifasico')
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(typeof r.total, 'number')
    assert.equal(r.total, 191325.6)
  })
})

describe('as duas travas valem juntas (E, não OU)', () => {
  test('grupo avulso, mas a LINHA tem preço com motor → não soma', () => {
    const r = motorDoPreco(
      { ...BNMM7100, valor_com_motor_trif: 191325.6 }, MOTORES, 'trifasico',
    )
    assert.equal(r.tipo, 'INCLUSO')
    if (r.tipo !== 'INCLUSO') return
    assert.equal(r.valorEquipamento, 191325.6)
  })

  test('valor_com_motor = 0 não conta como incluso (fallback pro base)', () => {
    const r = motorDoPreco({ ...BNMM7100, valor_com_motor_trif: 0 }, MOTORES, 'trifasico')
    assert.equal(r.tipo, 'AVULSO')
  })

  test('item INCLUSO com motor_cv preenchido continua sem somar', () => {
    // TH tem motor_cv em todas as 150 linhas; motorredutor já está no preço.
    const th = base({ categoria: 'TRANSPORTADOR', subcategoria: 'TH', motor_cv: 4, valor_equipamento: 9000 })
    const r = motorDoPreco(th, MOTORES, 'trifasico')
    assert.equal(r.tipo, 'INCLUSO')
  })

  test('SEM_MOTOR e MULTI_MOTOR nunca viram soma', () => {
    assert.equal(motorDoPreco(base({ categoria: 'SILO', subcategoria: 'MILHO' }), MOTORES).tipo, 'SEM_MOTOR')
    assert.equal(motorDoPreco(base({ categoria: 'COMPACTA', subcategoria: '01' }), MOTORES).tipo, 'INDETERMINADO')
  })
})

describe('MISTURADOR VERTICAL — motor_polos é NULL nas 10 linhas', () => {
  test('cai no default 4 polos e acha o motor (id 173, 150 kg)', () => {
    const m150 = base({
      categoria: 'MISTURADOR', subcategoria: 'VERTICAL', descricao: 'Misturador 150 kg',
      motor_cv: 1.5, motor_polos: null, valor_equipamento: 6437.5,
    })
    const r = motorDoPreco(m150, MOTORES, 'trifasico')
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.polos, 4)
    assert.equal(r.motor?.valor, 1732)
    assert.equal(r.total, 8169.5)
  })

  test('sem motor_cv cadastrado → INDETERMINADO, não soma', () => {
    const r = motorDoPreco(
      base({ categoria: 'MISTURADOR', subcategoria: 'VERTICAL', motor_cv: null }), MOTORES,
    )
    assert.equal(r.tipo, 'INDETERMINADO')
  })
})

describe('CHUPIM — o motor_cv do banco é DESCARTADO pela fórmula', () => {
  // Fórmula oficial: POT=(C+(Q×L×K)/200)×b×1,36, defaults MILHO + 45°,
  // arredondado pro próximo motor disponível. Mesmos defaults do orçamento.
  const chupim = (desc: string, cap: string | null, motorCvPlanilha: number, valor: number) =>
    base({
      categoria: 'TRANSPORTADOR', subcategoria: 'CHUPIM',
      descricao: desc, capacidade: cap, motor_cv: motorCvPlanilha, motor_polos: null,
      valor_equipamento: valor,
    })

  test('chupim 160 x 1,0 m (10 t/h) → 1,5 cv pela fórmula', () => {
    // (0,4 + (10×1×2)/200) × 1,85 × 1,36 = 1,258 → próximo motor = 1,5
    const r = motorDoPreco(chupim('chupim 160 x 1,0 m', '10 TON/H', 1.5, 3743.3), MOTORES)
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.cv, 1.5)
    assert.equal(r.estimado, true, 'chupim SEMPRE sai marcado como estimativa')
    assert.equal(r.polos, 4)
    assert.equal(r.total, 3743.3 + 1732)
  })

  test('chupim 160 x 10,0 m → 4 cv pela fórmula', () => {
    // (0,4 + (10×10×2)/200) × 1,85 × 1,36 = 3,522 → próximo motor = 4
    const r = motorDoPreco(chupim('chupim 160 x 10,0 m', '10 TON/H', 4, 10447.8), MOTORES)
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.cv, 4)
  })

  test('ignora motor_cv da planilha: se o banco mentir, a fórmula manda', () => {
    // Mesmo item, mas com motor_cv adulterado pra 100 CV. O resultado NÃO muda —
    // é a prova de que a tela não vai divergir do que o orçamento cobra.
    const r = motorDoPreco(chupim('chupim 160 x 1,0 m', '10 TON/H', 100, 3743.3), MOTORES)
    assert.equal(r.tipo, 'AVULSO')
    if (r.tipo !== 'AVULSO') return
    assert.equal(r.cv, 1.5)
  })

  test('sem comprimento/capacidade legível → INDETERMINADO, não chuta', () => {
    const r = motorDoPreco(chupim('chupim sem medida', null, 4, 5000), MOTORES)
    assert.equal(r.tipo, 'INDETERMINADO')
  })
})

describe('funções canônicas reusadas (não reimplementadas)', () => {
  test('valorPorVoltagem detecta incluso por voltagem', () => {
    const p = { valor_equipamento: 100, valor_com_motor_trif: 150, valor_com_motor_mono: null }
    assert.deepEqual(valorPorVoltagem(p, 'trifasico'), { valor: 150, motorIncluso: true })
    assert.deepEqual(valorPorVoltagem(p, 'monofasico'), { valor: 100, motorIncluso: false })
  })

  test('acharMotorCompativel com strictVoltagem não cruza voltagem', () => {
    assert.equal(acharMotorCompativel(MOTORES, 100, 2, 'monofasico', true), null)
    // sem strict, cai no cv+polos de qualquer voltagem
    assert.equal(acharMotorCompativel(MOTORES, 100, 2, 'monofasico', false)?.valor, 49826)
  })
})
