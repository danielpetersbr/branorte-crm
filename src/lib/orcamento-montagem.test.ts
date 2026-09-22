import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularMontagem, normalizarMontagem, MONTAGEM_PADRAO, type MontagemCfg } from './orcamento-montagem.ts'

const cfg = (over: Partial<MontagemCfg> = {}): MontagemCfg => ({ ...MONTAGEM_PADRAO, ...over })

test('caso do Daniel: 2 pessoas, 5 dias, 1 carro, base 224 mil', () => {
  const r = calcularMontagem(cfg({ pessoas: 2, dias: 5, carros: 1 }), 224_000)
  const v = Object.fromEntries(r.linhas.map(l => [l.chave, l.valor]))
  assert.equal(v.mao_obra, 22_400)      // 10% de 224.000
  assert.equal(v.estadia, 5_000)        // 500 × 2 × 5
  assert.equal(v.alimentacao, 1_000)    // 100 × 2 × 5
  assert.equal(v.passagem, 10_000)      // 5.000 × 2
  assert.equal(v.deslocamento, 1_500)   // 300 × 1 × 5
  assert.equal(r.total, 39_900)
})

test('bloco desligado nao soma nada', () => {
  assert.equal(calcularMontagem(cfg({ ativo: false, pessoas: 4, dias: 10 }), 500_000).total, 0)
  assert.equal(calcularMontagem(null, 500_000).total, 0)
})

test('base zero: mao de obra some, o resto da viagem continua', () => {
  const r = calcularMontagem(cfg({ pessoas: 1, dias: 2, carros: 1 }), 0)
  assert.equal(r.linhas.find(l => l.chave === 'mao_obra'), undefined)
  assert.equal(r.total, 500 * 2 + 100 * 2 + 5_000 + 300 * 2)
})

test('passagem editada na hora entra no lugar da media', () => {
  const r = calcularMontagem(cfg({ pessoas: 3, dias: 1, carros: 0, passagemPessoa: 1_850 }), 0)
  assert.equal(r.linhas.find(l => l.chave === 'passagem')?.valor, 5_550)
  assert.equal(r.linhas.find(l => l.chave === 'deslocamento'), undefined) // 0 carro = sem linha
})

test('campo vazio/NaN/negativo nao vira valor negativo nem NaN', () => {
  const r = calcularMontagem(cfg({ pessoas: NaN as unknown as number, dias: -3, carros: 1 }), -100)
  assert.equal(r.total, 0)
  assert.ok(Number.isFinite(r.total))
})

test('percentual diferente de 10 respeitado', () => {
  const r = calcularMontagem(cfg({ pessoas: 0, dias: 0, carros: 0, percentualMaoObra: 7.5 }), 200_000)
  assert.equal(r.total, 15_000)
})

test('detalhe mostra a conta pro vendedor conferir', () => {
  const r = calcularMontagem(cfg({ pessoas: 2, dias: 5, carros: 1 }), 100_000)
  const estadia = r.linhas.find(l => l.chave === 'estadia')!
  assert.match(estadia.detalhe, /2 pessoas/)
  assert.match(estadia.detalhe, /5 dias/)
  const passagem = r.linhas.find(l => l.chave === 'passagem')!
  assert.doesNotMatch(passagem.detalhe, /dias/) // passagem nao multiplica por dia
})

test('normalizar preenche campo que faltou no JSONB antigo', () => {
  const n = normalizarMontagem({ pessoas: 3, dias: 4 })!
  assert.equal(n.pessoas, 3)
  assert.equal(n.dias, 4)
  assert.equal(n.carros, MONTAGEM_PADRAO.carros)
  assert.equal(n.passagemPessoa, 5_000)
  assert.equal(n.ativo, true)
  assert.equal(normalizarMontagem(null), null)
})
