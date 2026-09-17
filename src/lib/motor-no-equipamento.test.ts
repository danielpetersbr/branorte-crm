import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  valorCobradoDoMotor,
  linhasDoMotor,
  embutirMotorNoItem,
  devolverMotorDoItem,
  ajustarEmbutidoPorRedutor,
  totalEmbutidoNoItem,
  type LinhaMotorEmbutivel,
  type ItemEmbutivel,
} from './motor-no-equipamento.js'

const item = (over: Partial<ItemEmbutivel> = {}): ItemEmbutivel => ({
  qtd: 1, valor: 30000, valor_original: 30000, ...over,
})

describe('valorCobradoDoMotor', () => {
  test('soma as linhas do motor único do item', () => {
    const linhas: LinhaMotorEmbutivel[] = [
      { item_uid: 'A', valor_total: 1732 },
      { item_uid: 'B', valor_total: 999 },
    ]
    assert.equal(valorCobradoDoMotor(linhas, 'A'), 1732)
  })

  test('item com qtd 3 tem 3 linhas — soma as três', () => {
    const linhas: LinhaMotorEmbutivel[] = [
      { item_uid: 'A', valor_total: 1000 },
      { item_uid: 'A', valor_total: 1000 },
      { item_uid: 'A', valor_total: 1000 },
    ]
    assert.equal(valorCobradoDoMotor(linhas, 'A'), 3000)
  })

  test('multi-motor: pega SÓ o motorIndex pedido', () => {
    const linhas: LinhaMotorEmbutivel[] = [
      { item_uid: 'A', motorIndex: 0, valor_total: 5000 },
      { item_uid: 'A', motorIndex: 1, valor_total: 800 },
    ]
    assert.equal(valorCobradoDoMotor(linhas, 'A', 0), 5000)
    assert.equal(valorCobradoDoMotor(linhas, 'A', 1), 800)
  })

  test('motor ÚNICO não casa com linha que tem motorIndex', () => {
    const linhas: LinhaMotorEmbutivel[] = [{ item_uid: 'A', motorIndex: 0, valor_total: 5000 }]
    assert.equal(valorCobradoDoMotor(linhas, 'A'), 0)
  })

  test('removido e por conta do cliente ficam de fora (nada a realocar)', () => {
    const linhas: LinhaMotorEmbutivel[] = [
      { item_uid: 'A', valor_total: 1000, removido: true },
      { item_uid: 'A', valor_total: 1000, por_conta_cliente: true },
      { item_uid: 'A', valor_total: 1500 },
    ]
    assert.equal(valorCobradoDoMotor(linhas, 'A'), 1500)
  })
})

describe('embutir e devolver', () => {
  test('o total do orçamento NÃO muda: o que sai do motor entra no equipamento', () => {
    const it = item({ valor: 30000, qtd: 1 })
    const motor = 1732
    const totalAntes = it.valor * it.qtd + motor          // equipamento + linha do motor
    const depois = embutirMotorNoItem(it, 'main', motor)
    const totalDepois = depois.valor * depois.qtd + 0     // motor vira incluso: linha zera
    assert.equal(totalDepois, totalAntes)
    assert.equal(depois.valor, 31732)
    assert.equal(depois.motor_incluso_manual, true)
  })

  test('qtd > 1: entra o valor POR UNIDADE (valor do item é unitário)', () => {
    const it = item({ valor: 30000, valor_original: 30000, qtd: 3 })
    const motorTotal = 3000                               // 3 motores de 1000
    const depois = embutirMotorNoItem(it, 'main', motorTotal)
    assert.equal(depois.valor, 31000)                     // +1000 por unidade
    assert.equal(depois.valor * depois.qtd, 93000)        // 90000 + 3000 do motor
  })

  test('valor_original acompanha (inox/tungstênio recalculam a partir dele)', () => {
    const depois = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000 }), 'main', 1732)
    assert.equal(depois.valor_original, 31732)
  })

  test('reverter devolve EXATAMENTE o que foi somado', () => {
    const antes = item({ valor: 27450, valor_original: 27450, qtd: 2 })
    const depois = embutirMotorNoItem(antes, 'main', 3465)
    const revertido = devolverMotorDoItem(depois, 'main')
    assert.equal(revertido.valor, antes.valor)
    assert.equal(revertido.valor_original, antes.valor_original)
    assert.equal(revertido.motor_incluso_manual, false)
    assert.equal(revertido.motores_embutidos, undefined)
  })

  test('clicar duas vezes não soma duas vezes', () => {
    const uma = embutirMotorNoItem(item(), 'main', 1732)
    const duas = embutirMotorNoItem(uma, 'main', 1732)
    assert.equal(duas.valor, uma.valor)
    assert.equal(duas, uma)                               // no-op devolve o mesmo objeto
  })

  test('motor sem valor cobrado não altera nada', () => {
    const it = item()
    assert.equal(embutirMotorNoItem(it, 'main', 0), it)
    assert.equal(embutirMotorNoItem(it, 'main', -5), it)
  })

  test('reverter motor que não foi embutido não mexe no preço', () => {
    const it = item()
    assert.equal(devolverMotorDoItem(it, 'main'), it)
  })

  test('multi-motor: embutir o índice 1 não marca o 0 como incluso', () => {
    const depois = embutirMotorNoItem(item(), '1', 800, 1)
    assert.deepEqual(depois.motores_incluso_idx, [1])
    assert.equal(depois.motor_incluso_manual, undefined)
    assert.deepEqual(depois.motores_embutidos, { '1': 800 })
  })

  test('multi-motor: reverter um mantém o outro embutido e incluso', () => {
    let it = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000 }), '0', 5000, 0)
    it = embutirMotorNoItem(it, '1', 800, 1)
    assert.equal(it.valor, 35800)
    const so0 = devolverMotorDoItem(it, '1', 1)
    assert.equal(so0.valor, 35000)
    assert.deepEqual(so0.motores_embutidos, { '0': 5000 })
    assert.deepEqual(so0.motores_incluso_idx, [0])
  })

  test('totalEmbutidoNoItem soma todos os motores embutidos do item', () => {
    assert.equal(totalEmbutidoNoItem({ motores_embutidos: { '0': 5000, '1': 800 } }), 5800)
    assert.equal(totalEmbutidoNoItem({}), 0)
  })

  test('valor quebrado: arredonda pra centavo inteiro e devolve o mesmo na volta', () => {
    const antes = item({ valor: 12345, valor_original: 12345, qtd: 3 })
    const depois = embutirMotorNoItem(antes, 'main', 1000)   // 333,33 por unidade
    assert.equal(depois.valor, 12678)                        // 12345 + 333
    assert.equal(devolverMotorDoItem(depois, 'main').valor, 12345)
  })
})

describe('redutor num motor já somado no equipamento', () => {
  // Caso real do Daniel (17/09): Misturador Vertical 2000 kg com o motor de 10 CV já
  // somado no equipamento. Aplicou o redutor Q130 (R$ 4.924,00) e ele voltou a aparecer
  // cobrado na tabela MOTORES, em vez de ir pro preço do equipamento junto com o motor.
  test('aplicar redutor leva o valor pro equipamento', () => {
    const embutido = embutirMotorNoItem(item({ valor: 39458, valor_original: 39458 }), 'main', 4924)
    const comRedutor = ajustarEmbutidoPorRedutor(embutido, 'main', 0, 4924, 1)
    assert.equal(comRedutor.valor, embutido.valor + 4924)
    assert.deepEqual(comRedutor.motores_embutidos, { main: 4924 + 4924 })
  })

  test('tirar o redutor devolve o valor', () => {
    let it = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000 }), 'main', 1732)
    const soMotor = it.valor
    it = ajustarEmbutidoPorRedutor(it, 'main', 0, 4924, 1)
    it = ajustarEmbutidoPorRedutor(it, 'main', 4924, 0, 1)
    assert.equal(it.valor, soMotor)
    assert.deepEqual(it.motores_embutidos, { main: 1732 })
  })

  test('trocar Q75 por Q130 move só a diferença', () => {
    let it = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000 }), 'main', 1732)
    it = ajustarEmbutidoPorRedutor(it, 'main', 0, 1686, 1)      // Q75
    const comQ75 = it.valor
    it = ajustarEmbutidoPorRedutor(it, 'main', 1686, 4924, 1)   // Q130
    assert.equal(it.valor, comQ75 + (4924 - 1686))
  })

  test('reverter o motor devolve motor E redutor de uma vez', () => {
    const antes = item({ valor: 30000, valor_original: 30000 })
    let it = embutirMotorNoItem(antes, 'main', 1732)
    it = ajustarEmbutidoPorRedutor(it, 'main', 0, 4924, 1)
    assert.equal(it.valor, 36656)
    const revertido = devolverMotorDoItem(it, 'main')
    assert.equal(revertido.valor, antes.valor)
    assert.equal(revertido.valor_original, antes.valor_original)
  })

  test('motor NÃO embutido não é tocado — o redutor segue cobrado na linha', () => {
    const it = item()
    assert.equal(ajustarEmbutidoPorRedutor(it, 'main', 0, 4924, 1), it)
  })

  test('o redutor custa por motor: 2 linhas cobram 2 redutores', () => {
    const it = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000, qtd: 2 }), 'main', 4000)
    const comRed = ajustarEmbutidoPorRedutor(it, 'main', 0, 1000, 2)   // 2 linhas
    assert.equal(comRed.valor, it.valor + 1000)                        // +1000 por unidade
    assert.equal(comRed.valor * comRed.qtd, (it.valor * 2) + 2000)     // 2 redutores no total
  })

  test('multi-motor: o redutor do índice 1 não mexe no embutido do 0', () => {
    let it = embutirMotorNoItem(item({ valor: 30000, valor_original: 30000 }), '0', 5000, 0)
    it = embutirMotorNoItem(it, '1', 800, 1)
    it = ajustarEmbutidoPorRedutor(it, '1', 0, 1306, 1)
    assert.deepEqual(it.motores_embutidos, { '0': 5000, '1': 800 + 1306 })
  })

  test('motor sem linha na tabela não move valor nenhum', () => {
    const it = embutirMotorNoItem(item(), 'main', 1732)
    assert.equal(ajustarEmbutidoPorRedutor(it, 'main', 0, 4924, 0), it)
  })
})

describe('linhasDoMotor', () => {
  test('conta as linhas do motor sem filtrar flag (o redutor custa por motor)', () => {
    const linhas: LinhaMotorEmbutivel[] = [
      { item_uid: 'A', valor_total: 0, removido: true },
      { item_uid: 'A', valor_total: 0 },
      { item_uid: 'B', valor_total: 500 },
    ]
    assert.equal(linhasDoMotor(linhas, 'A').length, 2)
    assert.equal(valorCobradoDoMotor(linhas, 'A'), 0)
  })
})
