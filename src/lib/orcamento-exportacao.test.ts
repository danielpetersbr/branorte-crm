import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fatorExportacao, inflarItemExportacao, desinflarItemExportacao } from './orcamento-exportacao.ts'

type Item = { uid: string; valor: number; valor_original: number; motor_valor_unit: number; qtd: number }

// Save grava a camada de exibição (inflada); reabrir desinfla. Mesma ordem do
// OrcamentoMontar: carrinhoExib → FinalizarMontarModal → hidratação do ?id=N.
const salvarEReabrir = (base: Item, pct: number): Item => {
  const f = fatorExportacao(pct)
  const gravado = JSON.parse(JSON.stringify(inflarItemExportacao(base, f))) as Item
  return desinflarItemExportacao(gravado, f)
}

test('fator: 0/10/20 e lixo vira sem acréscimo', () => {
  assert.equal(fatorExportacao(0), 1)
  assert.equal(fatorExportacao(10), 1.1)
  assert.equal(fatorExportacao(20), 1.2)
  assert.equal(fatorExportacao(NaN), 1)
})

test('+20%: item de R$ 10.000 grava 12.000 com valor_original 10.000 na base', () => {
  const base: Item = { uid: 'a', valor: 10_000, valor_original: 10_000, motor_valor_unit: 1_500, qtd: 1 }
  const gravado = inflarItemExportacao(base, fatorExportacao(20))
  assert.equal(gravado.valor, 12_000)
  assert.equal(gravado.motor_valor_unit, 1_800)
  assert.equal(gravado.valor_original, 10_000) // base, não inflado
})

test('reabrir +20% volta valor E valor_original a 10.000 (antes o valor_original virava 8.333)', () => {
  const base: Item = { uid: 'a', valor: 10_000, valor_original: 10_000, motor_valor_unit: 1_500, qtd: 1 }
  const reaberto = salvarEReabrir(base, 20)
  assert.deepEqual(reaberto, base)
  // "Desligar Inox/Tungstênio" faz valor = valor_original: não pode derrubar o item.
  assert.equal(reaberto.valor_original, reaberto.valor)
})

test('caso medido no banco (+10%): valor_original 49.789 não encolhe em 4 reaberturas', () => {
  // 1804 → 1805 → 1824 → 1826: antes 49.789 → 45.263 → 41.148 → 37.407.
  let item: Item = { uid: 'x', valor: 49_789, valor_original: 49_789, motor_valor_unit: 0, qtd: 1 }
  const gravadoPrimeiro = inflarItemExportacao(item, fatorExportacao(10)).valor
  assert.equal(gravadoPrimeiro, 54_768)
  for (let i = 0; i < 4; i++) item = salvarEReabrir(item, 10)
  assert.equal(item.valor, 49_789)
  assert.equal(item.valor_original, 49_789)
  assert.equal(inflarItemExportacao(item, fatorExportacao(10)).valor, 54_768) // PDF igual ao 1º
})

test('valor editado em modo exportação continua marcado como editado ao reabrir', () => {
  // Vendedor digitou 11.000 na tela (+10%) num item de catálogo 11.000: base = 10.000.
  const editado: Item = { uid: 'e', valor: 10_000, valor_original: 11_000, motor_valor_unit: 0, qtd: 2 }
  const reaberto = salvarEReabrir(editado, 10)
  assert.equal(reaberto.valor, 10_000)
  assert.equal(reaberto.valor_original, 11_000)
  assert.notEqual(reaberto.valor, reaberto.valor_original)
})

test('base inteira faz a ida e volta exata em +10% e +20% (total do PDF igual)', () => {
  for (const pct of [10, 20]) {
    const f = fatorExportacao(pct)
    for (let b = 1; b <= 60_000; b += 37) {
      const base: Item = { uid: 'b', valor: b, valor_original: b, motor_valor_unit: b % 7_000, qtd: 1 }
      const volta = salvarEReabrir(base, pct)
      assert.equal(volta.valor, b)
      assert.equal(volta.motor_valor_unit, base.motor_valor_unit)
      assert.equal(inflarItemExportacao(volta, f).valor, inflarItemExportacao(base, f).valor)
    }
  }
})

test('base com centavos (modelo pronto) anda no máximo R$ 1 e depois estabiliza', () => {
  const f = fatorExportacao(10)
  const base: Item = { uid: 'c', valor: 12_124.2, valor_original: 12_124.2, motor_valor_unit: 0, qtd: 1 }
  const pdf1 = inflarItemExportacao(base, f).valor
  const reab1 = salvarEReabrir(base, 10)
  const pdf2 = inflarItemExportacao(reab1, f).valor
  assert.ok(Math.abs(pdf2 - pdf1) <= 1)
  const reab2 = salvarEReabrir(reab1, 10)
  assert.equal(reab2.valor, reab1.valor)
  assert.equal(reab2.valor_original, 12_124.2) // valor_original intacto
})

test('motor sem valor (0/null) e fator 1 não mexem em nada além de arredondar', () => {
  const semMotor = { valor: 500.4, motor_valor_unit: null as number | null }
  assert.deepEqual(inflarItemExportacao(semMotor, 1), { valor: 500, motor_valor_unit: null })
  assert.deepEqual(desinflarItemExportacao({ valor: 1_100, motor_valor_unit: 0 }, 1.1), { valor: 1_000, motor_valor_unit: 0 })
})
