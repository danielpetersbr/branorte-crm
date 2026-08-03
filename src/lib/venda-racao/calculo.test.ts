/**
 * Testes do motor de precificação da Venda de Ração.
 *
 * Runner nativo do Node (sem dependência nova):
 *   npm test
 *   npx tsx --test src/lib/venda-racao/calculo.test.ts
 *
 * Os 4 cenários obrigatórios (bovinos/suínos/aves/milho) estão no fim, com os
 * valores conferidos na mão — se alguém mexer na fórmula do preço, quebra aqui.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularCustos, calcularDemanda, calcularEquilibrio, calcularFormula,
  calcularNegociado, calcularSimulacao, cargaSemMargem, dec, dividir, lucroPorVolume,
  participacaoParaKgPorTonelada, precificar, precoComMargem, precoComMarkup,
  precoPorKg, quantidadeParaKg, validar,
} from './calculo'
import { novaSimulacao } from './estado'
import { CONFIG_PADRAO } from './catalogo'
import type { CondicoesVenda, Custos, Formula, Quantidade, SimulacaoInput } from './tipos'

const PERTO = 1e-6
const perto = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < PERTO, msg ?? `esperava ${b}, veio ${a}`)

// ---------------------------------------------------------------------------
// Helpers de fixture
// ---------------------------------------------------------------------------

function venda(over: Partial<CondicoesVenda> = {}): CondicoesVenda {
  return {
    modoPreco: 'margem',
    impostosPct: 5, comissaoPct: 3, taxaFinanceiraPct: 0, taxaCartaoPct: 0,
    margemDesejadaPct: 20, margemMinimaPct: 15,
    precoAtualClientePorKg: 0, precoMercadoPorKg: 0,
    prazoPagamento: '', formaPagamento: '', condicaoEntrega: '',
    precoNegociadoPorKg: null,
    ...over,
  }
}

function custosZerados(over: Partial<Custos> = {}): Custos {
  const off = { ativo: false, valor: 0 }
  return {
    perdaPct: 0,
    energia: { ...off }, maoDeObra: { ...off }, moagem: { ...off }, mistura: { ...off },
    manutencao: { ...off }, depreciacao: { ...off }, administrativo: { ...off },
    carregamento: { ...off }, outrosVariaveis: { ...off },
    embalagem: { ...off }, etiqueta: { ...off },
    frete: { ...off }, freteModo: 'total',
    outrosFixosPedido: { ...off },
    custosFixosMensais: 0,
    ...over,
  }
}

function quantidade(over: Partial<Quantidade> = {}): Quantidade {
  return {
    modo: 'direto',
    numeroAnimais: 0, consumoPorAnimal: 0, baseConsumo: 'mes', dias: 30, sobraPct: 0,
    quantidadeInformada: 10000, unidadeQuantidade: 'kg', pedidosPorMes: 1,
    pesoSaco: 40,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Utilitários numéricos
// ---------------------------------------------------------------------------

test('dividir por zero devolve 0 em vez de Infinity', () => {
  assert.equal(dividir(10, 0), 0)
  assert.equal(dividir(0, 0), 0)
  assert.ok(Number.isFinite(dividir(10, 0)))
})

test('dec converte percentual inteiro pra decimal e sanitiza lixo', () => {
  perto(dec(20), 0.2)
  perto(dec(0), 0)
  perto(dec(undefined), 0)
  perto(dec(NaN), 0)
})

// ---------------------------------------------------------------------------
// Conversões de unidade
// ---------------------------------------------------------------------------

test('saca vira kg: 100 sacos de 40 kg = 4.000 kg', () => {
  assert.equal(quantidadeParaKg(100, 'sacos', 40), 4000)
})

test('tonelada vira kg: 8,5 t = 8.500 kg', () => {
  assert.equal(quantidadeParaKg(8.5, 't', 40), 8500)
})

test('kg continua kg e negativo é tratado como zero', () => {
  assert.equal(quantidadeParaKg(1234, 'kg', 40), 1234)
  assert.equal(quantidadeParaKg(-500, 'kg', 40), 0)
})

test('preço por saca vira R$/kg (saca de 60 kg a R$ 64,62 = R$ 1,077/kg)', () => {
  perto(precoPorKg(64.62, 'saco', 60), 1.077)
})

test('preço por tonelada vira R$/kg', () => {
  perto(precoPorKg(1500, 't', 60), 1.5)
})

test('preço por saca com peso zero não estoura', () => {
  assert.equal(precoPorKg(64.62, 'saco', 0), 0)
})

test('participação em % / kg por t / g por t convergem pra kg por tonelada', () => {
  assert.equal(participacaoParaKgPorTonelada(58, 'pct'), 580)
  assert.equal(participacaoParaKgPorTonelada(580, 'kg_t'), 580)
  assert.equal(participacaoParaKgPorTonelada(580_000, 'g_t'), 580)
})

// ---------------------------------------------------------------------------
// Demanda
// ---------------------------------------------------------------------------

test('demanda por animais com consumo mensal: 5.000 frangos × 3 kg = 15.000 kg', () => {
  const d = calcularDemanda(quantidade({
    modo: 'animais', numeroAnimais: 5000, consumoPorAnimal: 3, baseConsumo: 'mes',
  }))
  assert.equal(d.quantidadeKg, 15000)
  assert.equal(d.quantidadeMensalKg, 15000)
  assert.equal(d.toneladas, 15)
  assert.equal(d.sacos, 375)
})

test('demanda por consumo diário multiplica pelos dias informados', () => {
  const d = calcularDemanda(quantidade({
    modo: 'animais', numeroAnimais: 100, consumoPorAnimal: 2, baseConsumo: 'dia', dias: 30,
  }))
  assert.equal(d.quantidadeKg, 6000)
})

test('consumo por ciclo: pedido é o ciclo, mensal é proporcional aos dias', () => {
  const d = calcularDemanda(quantidade({
    modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 120, baseConsumo: 'ciclo', dias: 90,
  }))
  assert.equal(d.quantidadeKg, 120000)
  perto(d.quantidadeMensalKg, 40000) // 90 dias = 3 meses comerciais
})

test('sobra de segurança de 10% aumenta a demanda', () => {
  const d = calcularDemanda(quantidade({
    modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 10, baseConsumo: 'mes', sobraPct: 10,
  }))
  perto(d.quantidadeKg, 11000)
})

test('modo direto com pedidos recorrentes projeta o mensal', () => {
  const d = calcularDemanda(quantidade({
    modo: 'direto', quantidadeInformada: 5, unidadeQuantidade: 't', pedidosPorMes: 4,
  }))
  assert.equal(d.quantidadeKg, 5000)
  assert.equal(d.quantidadeMensalKg, 20000)
})

test('quantidade vazia não gera NaN', () => {
  const d = calcularDemanda(quantidade({ quantidadeInformada: 0, pesoSaco: 0 }))
  assert.equal(d.quantidadeKg, 0)
  assert.equal(d.sacos, 0)
  assert.ok(Number.isFinite(d.sacos))
})

// ---------------------------------------------------------------------------
// Fórmula
// ---------------------------------------------------------------------------

function formula(itens: Array<[string, number, number]>): Formula {
  return {
    formulaId: null, nome: '',
    itens: itens.map(([nome, pct, preco], i) => ({
      id: `i${i}`, nome, participacao: pct, unidadeParticipacao: 'pct' as const,
      preco, unidadePreco: 'kg' as const, pesoSacoIngrediente: 60,
    })),
    milhoPreco: 0, milhoUnidadePreco: 'kg', milhoPesoSaca: 60,
  }
}

test('custo dos ingredientes: 58% milho 1,08 + 33% farelo 1,60 + 2% óleo 6,00 + 7% núcleo 6,80', () => {
  const f = calcularFormula(formula([
    ['Milho', 58, 1.08], ['Farelo de soja', 33, 1.60],
    ['Óleo', 2, 6.00], ['Núcleo', 7, 6.80],
  ]), 'aves')
  perto(f.custoIngredientesPorKg, 1.7504)
  perto(f.custoIngredientesPorTonelada, 1750.4)
  assert.equal(f.totalKgPorTonelada, 1000)
  assert.equal(f.fechada, true)
  assert.equal(f.diferencaKgPorTonelada, 0)
})

test('fórmula que soma 100% é aceita; a que não soma é bloqueada com a diferença', () => {
  const ok = calcularFormula(formula([['Milho', 70, 1], ['Farelo', 30, 2]]), 'suinos')
  assert.equal(ok.fechada, true)

  const falta = calcularFormula(formula([['Milho', 70, 1], ['Farelo', 26.5, 2]]), 'suinos')
  assert.equal(falta.fechada, false)
  perto(falta.diferencaKgPorTonelada, 35) // faltam 35 kg pra fechar a tonelada
})

test('fórmula que passou de 100% acusa diferença negativa', () => {
  const passou = calcularFormula(formula([['Milho', 70, 1], ['Farelo', 40, 2]]), 'bovinos')
  assert.equal(passou.fechada, false)
  perto(passou.diferencaKgPorTonelada, -100)
})

test('milho triturado dispensa composição: custo vem do preço da saca', () => {
  const f = calcularFormula(
    { formulaId: null, nome: '', itens: [], milhoPreco: 72, milhoUnidadePreco: 'saco', milhoPesoSaca: 60 },
    'milho',
  )
  perto(f.custoIngredientesPorKg, 1.2)
  assert.equal(f.fechada, true)
})

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

test('perda de 10% eleva o custo dos ingredientes de 1,80 para 2,00 (÷ 0,9)', () => {
  const c = calcularCustos(1.80, custosZerados({ perdaPct: 10 }), 10000, 40)
  perto(c.custoIngredientesAjustadoPorKg, 2)
  perto(c.perdaPorKg, 0.2)
  perto(c.custoBasePorKg, 2)
})

test('embalagem por saco vira R$/kg dividindo pelo peso do saco', () => {
  const c = calcularCustos(0, custosZerados({
    embalagem: { ativo: true, valor: 1.20 },
    etiqueta: { ativo: true, valor: 0.20 },
  }), 10000, 40)
  perto(c.embalagemPorKg, 0.035) // (1,20 + 0,20) ÷ 40
})

test('custo desligado não entra na conta', () => {
  const c = calcularCustos(1, custosZerados({
    energia: { ativo: false, valor: 99 },
    maoDeObra: { ativo: true, valor: 0.10 },
  }), 10000, 40)
  perto(c.energiaPorKg, 0)
  perto(c.custoBasePorKg, 1.10)
})

test('frete total é rateado pela quantidade do pedido', () => {
  const c = calcularCustos(1, custosZerados({
    frete: { ativo: true, valor: 800 }, freteModo: 'total',
  }), 10000, 40)
  perto(c.fretePorKg, 0.08)
  perto(c.custoBasePorKg, 1.08)
})

test('frete informado direto em R$/kg entra sem rateio', () => {
  const c = calcularCustos(1, custosZerados({
    frete: { ativo: true, valor: 0.12 }, freteModo: 'kg',
  }), 10000, 40)
  perto(c.fretePorKg, 0.12)
})

test('custo fixo do pedido é rateado e fica FORA do custo variável', () => {
  const c = calcularCustos(1, custosZerados({
    outrosFixosPedido: { ativo: true, valor: 500 },
  }), 10000, 40)
  perto(c.fixosPedidoPorKg, 0.05)
  perto(c.custoBasePorKg, 1.05)
  perto(c.custoVariavelPorKg, 1.00)
})

test('grupos de custo somam exatamente o custo-base', () => {
  const c = calcularCustos(1.75, custosZerados({
    perdaPct: 1.5,
    energia: { ativo: true, valor: 0.035 },
    maoDeObra: { ativo: true, valor: 0.10 },
    embalagem: { ativo: true, valor: 1.20 },
    carregamento: { ativo: true, valor: 0.02 },
    frete: { ativo: true, valor: 0.05 }, freteModo: 'kg',
    outrosFixosPedido: { ativo: true, valor: 300 },
  }), 10000, 40)
  const soma = c.grupos.materiaPrima + c.grupos.producao + c.grupos.embalagem
    + c.grupos.logistica + c.grupos.fixos
  perto(soma, c.custoBasePorKg)
})

test('custo por saco e por tonelada derivam do custo por kg', () => {
  const c = calcularCustos(2, custosZerados(), 10000, 40)
  perto(c.custoPorSaco, 80)
  perto(c.custoPorTonelada, 2000)
  perto(c.custoTotalPedido, 20000)
})

test('frete total com quantidade zero não gera Infinity', () => {
  const c = calcularCustos(1, custosZerados({
    frete: { ativo: true, valor: 800 }, freteModo: 'total',
  }), 0, 40)
  assert.equal(c.fretePorKg, 0)
  assert.ok(Number.isFinite(c.custoBasePorKg))
})

// ---------------------------------------------------------------------------
// Preço: margem × markup
// ---------------------------------------------------------------------------

test('margem é sobre o PREÇO: custo 1,50 com 20% e sem taxas dá 1,875 (não 1,80)', () => {
  perto(precoComMargem(1.50, 0.20, 0), 1.875)
  perto(precoComMarkup(1.50, 0.20), 1.80)
})

test('markup de 20% sobre o custo entrega margem real de 16,67% (não 20%)', () => {
  const p = precoComMarkup(1.50, 0.20)
  perto((p - 1.50) / p, 1 / 6)
})

test('cargaSemMargem soma impostos + comissão + taxas', () => {
  perto(cargaSemMargem(venda({
    impostosPct: 5, comissaoPct: 3, taxaFinanceiraPct: 1.5, taxaCartaoPct: 2,
  })), 0.115)
})

test('preço de equilíbrio cobre custo + impostos + comissão, com margem zero', () => {
  const p = precificar(1.50, venda())
  perto(p.precoEquilibrioPorKg, 1.5 / 0.92)
  const eq = p.precoEquilibrioPorKg
  perto(eq - 1.5 - eq * 0.08, 0) // sobra zero
})

test('margem + impostos + comissão + taxas em 100% não gera preço (protege de divisão por zero)', () => {
  const p = precificar(1.50, venda({
    margemDesejadaPct: 60, impostosPct: 20, comissaoPct: 10, taxaFinanceiraPct: 10,
  }))
  assert.equal(p.precoSugeridoPorKg, 0)
  assert.ok(Number.isFinite(p.precoSugeridoPorKg))
})

// ---------------------------------------------------------------------------
// Preço negociado
// ---------------------------------------------------------------------------

test('no preço sugerido a margem real bate exatamente com a desejada', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda({ margemDesejadaPct: 20 })
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade())
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)
  perto(r.margemRealPct, 20)
  assert.equal(r.abaixoDoMinimo, false)
  perto(r.descontoAplicadoPct, 0)
})

test('preço negociado abaixo do mínimo acende o alerta e derruba a margem real', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda({ margemDesejadaPct: 20, margemMinimaPct: 15 })
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade())
  const r = calcularNegociado(1.90, custos, precos, v, d, 40)
  assert.equal(r.abaixoDoMinimo, true)
  assert.ok(r.margemRealPct < 15)
  // 1,90 − 1,50 − 1,90×0,08 = 0,248 → 13,05%
  perto(r.lucroPorKg, 1.90 - 1.50 - 1.90 * 0.08)
})

test('no preço mínimo a margem real bate com a margem mínima (não acende alerta)', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda({ margemDesejadaPct: 20, margemMinimaPct: 15 })
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade())
  const r = calcularNegociado(precos.precoMinimoPorKg, custos, precos, v, d, 40)
  perto(r.margemRealPct, 15)
  assert.equal(r.abaixoDoMinimo, false)
})

test('totais do pedido e do mês saem do lucro por kg', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda()
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade({ quantidadeInformada: 10000, pedidosPorMes: 2 }))
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)
  perto(r.valorTotalPedido, r.precoPorKg * 10000)
  perto(r.lucroTotalPedido, r.lucroPorKg * 10000)
  perto(r.receitaMensal, r.precoPorKg * 20000)
  perto(r.lucroMensal, r.lucroPorKg * 20000)
  perto(r.precoPorSaco, r.precoPorKg * 40)
})

// ---------------------------------------------------------------------------
// Ponto de equilíbrio
// ---------------------------------------------------------------------------

test('ponto de equilíbrio: R$ 10.000 fixos ÷ R$ 0,4167 de margem = 24 t/mês', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda({ margemDesejadaPct: 20 })
  const precos = precificar(custos.custoBasePorKg, v)
  const eq = calcularEquilibrio(
    precos.precoSugeridoPorKg, custos, v, 10000,
    calcularDemanda(quantidade({ quantidadeInformada: 12000 })), 40,
  )
  assert.equal(eq.aplicavel, true)
  perto(eq.margemContribuicaoPorKg, 1 / 2.4)
  perto(eq.kgPorMes, 24000)
  perto(eq.toneladasPorMes, 24)
  assert.equal(eq.clientesDesseTamanho, 2) // 24.000 ÷ 12.000
})

test('sem custo fixo mensal o ponto de equilíbrio não se aplica', () => {
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const v = venda()
  const precos = precificar(custos.custoBasePorKg, v)
  const eq = calcularEquilibrio(precos.precoSugeridoPorKg, custos, v, 0, calcularDemanda(quantidade()), 40)
  assert.equal(eq.aplicavel, false)
  assert.equal(eq.kgPorMes, 0)
})

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function inputBase(over: Partial<SimulacaoInput> = {}): SimulacaoInput {
  const base = novaSimulacao(CONFIG_PADRAO, 'aves', 'Teste')
  return {
    ...base,
    identificacao: { ...base.identificacao, clienteNome: 'Cliente Teste' },
    quantidade: { ...base.quantidade, modo: 'direto', quantidadeInformada: 15000, unidadeQuantidade: 'kg' },
    ...over,
  }
}

test('bloqueia quando a soma de margem + impostos + comissão + taxas chega a 100%', () => {
  const input = inputBase()
  input.venda = venda({ margemDesejadaPct: 70, impostosPct: 20, comissaoPct: 10 })
  const r = calcularSimulacao(input)
  assert.equal(r.bloqueado, true)
  assert.ok(r.problemas.some(p => p.campo === 'margemDesejadaPct' && p.nivel === 'bloqueio'))
})

test('bloqueia percentual negativo e margem acima de 100%', () => {
  const input = inputBase()
  input.venda = venda({ margemDesejadaPct: 120, comissaoPct: -5 })
  const r = calcularSimulacao(input)
  assert.ok(r.problemas.some(p => p.campo === 'margemDesejadaPct'))
  assert.ok(r.problemas.some(p => p.campo === 'comissaoPct'))
})

test('bloqueia quantidade zerada e peso de saco zero', () => {
  const input = inputBase()
  input.quantidade = { ...input.quantidade, quantidadeInformada: 0, pesoSaco: 0 }
  const r = calcularSimulacao(input)
  assert.ok(r.problemas.some(p => p.campo === 'quantidade' && p.nivel === 'bloqueio'))
  assert.ok(r.problemas.some(p => p.campo === 'pesoSaco' && p.nivel === 'bloqueio'))
})

test('bloqueia fórmula incompleta', () => {
  const input = inputBase()
  input.formula = { ...input.formula, itens: input.formula.itens.slice(0, 2) }
  const r = calcularSimulacao(input)
  assert.equal(r.bloqueado, true)
  assert.ok(r.problemas.some(p => p.campo === 'formula'))
})

test('avisa quando falta o nome do cliente, mas não bloqueia o cálculo', () => {
  const input = inputBase()
  input.identificacao = { ...input.identificacao, clienteNome: '' }
  const r = calcularSimulacao(input)
  const p = r.problemas.find(x => x.campo === 'clienteNome')
  assert.ok(p)
  assert.equal(p!.nivel, 'aviso')
  assert.equal(r.bloqueado, false)
})

test('avisa quando a margem mínima passa da desejada', () => {
  const input = inputBase()
  input.venda = venda({ margemDesejadaPct: 10, margemMinimaPct: 15 })
  const problemas = validar(input, calcularDemanda(input.quantidade), calcularFormula(input.formula, 'aves'))
  assert.ok(problemas.some(p => p.campo === 'margemMinimaPct' && p.nivel === 'aviso'))
})

test('nenhum resultado da simulação sai NaN ou Infinity com o formulário vazio', () => {
  const vazio = novaSimulacao(CONFIG_PADRAO, 'bovinos')
  const r = calcularSimulacao(vazio)
  const numeros = [
    r.demanda.quantidadeKg, r.demanda.sacos, r.custos.custoBasePorKg,
    r.precos.precoSugeridoPorKg, r.precos.descontoMaximoPct,
    r.negociado.margemRealPct, r.negociado.lucroTotalPedido, r.negociado.lucroMensal,
    r.equilibrio.kgPorMes,
  ]
  for (const x of numeros) assert.ok(Number.isFinite(x), `valor não finito: ${x}`)
})

// ---------------------------------------------------------------------------
// Comparação com mercado
// ---------------------------------------------------------------------------

test('comparação com o preço atual do cliente: mais barato por kg, mês e ano', () => {
  const input = inputBase()
  input.venda = venda({ margemDesejadaPct: 15, margemMinimaPct: 10, precoAtualClientePorKg: 3.00 })
  input.venda.precoNegociadoPorKg = 2.80
  const r = calcularSimulacao(input)
  assert.equal(r.comparacao.informado, true)
  assert.equal(r.comparacao.maisBarato, true)
  perto(r.comparacao.diferencaPorKg, -0.20)
  perto(r.comparacao.diferencaMensal, -0.20 * 15000)
  perto(r.comparacao.diferencaAnual, -0.20 * 15000 * 12)
})

test('sem preço atual informado a comparação fica desligada e zerada', () => {
  const r = calcularSimulacao(inputBase())
  assert.equal(r.comparacao.informado, false)
  assert.equal(r.comparacao.diferencaPorKg, 0)
})

// ---------------------------------------------------------------------------
// Cenários e gráfico
// ---------------------------------------------------------------------------

test('cenário conservador custa mais e o otimista custa menos que o provável', () => {
  const r = calcularSimulacao(inputBase())
  const [cons, prov, otim] = r.cenarios
  assert.ok(cons.custoBasePorKg > prov.custoBasePorKg)
  assert.ok(otim.custoBasePorKg < prov.custoBasePorKg)
})

test('lucro por volume escala linearmente com as toneladas', () => {
  const linhas = lucroPorVolume(0.4, [1, 5, 10, 20])
  perto(linhas[0].lucro, 400)
  perto(linhas[3].lucro, 8000)
  assert.equal(linhas[2].kg, 10000)
})

// ===========================================================================
// CENÁRIOS OBRIGATÓRIOS — valores conferidos na mão
// ===========================================================================

test('TESTE 1 — BOVINOS: 10.000 kg, custo 1,50, imp 5%, com 3%, margem 20%, mín 15%', () => {
  const v = venda({ impostosPct: 5, comissaoPct: 3, margemDesejadaPct: 20, margemMinimaPct: 15 })
  const custos = calcularCustos(1.50, custosZerados(), 10000, 40)
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade({ quantidadeInformada: 10000 }))
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)

  perto(precos.precoSugeridoPorKg, 1.50 / 0.72)       // 2,083333
  perto(precos.precoMinimoPorKg, 1.50 / 0.77)         // 1,948052
  perto(precos.precoEquilibrioPorKg, 1.50 / 0.92)     // 1,630435
  perto(precos.descontoMaximoReaisPorKg, 1.50 / 0.72 - 1.50 / 0.77)
  perto(precos.descontoMaximoPct, 6.4935064935, )
  perto(r.margemRealPct, 20)
  perto(r.lucroPorKg, (1.50 / 0.72) * 0.20)
  perto(r.valorTotalPedido, (1.50 / 0.72) * 10000)    // 20.833,33
  perto(r.lucroTotalPedido, (1.50 / 0.72) * 0.20 * 10000) // 4.166,67
})

test('TESTE 2 — SUÍNOS: 20.000 kg, custo 1,80, imp 5%, com 3%, margem 18%, mín 12%', () => {
  const v = venda({ impostosPct: 5, comissaoPct: 3, margemDesejadaPct: 18, margemMinimaPct: 12 })
  const custos = calcularCustos(1.80, custosZerados(), 20000, 40)
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade({ quantidadeInformada: 20000 }))
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)

  perto(precos.precoSugeridoPorKg, 1.80 / 0.74)  // 2,432432
  perto(precos.precoMinimoPorKg, 2.25)           // 1,80 ÷ 0,80
  perto(precos.descontoMaximoPct, 7.5)
  perto(r.margemRealPct, 18)
  perto(r.valorTotalPedido, (1.80 / 0.74) * 20000)
  perto(r.lucroTotalPedido, (1.80 / 0.74) * 0.18 * 20000)
})

test('TESTE 3 — AVES: 15.000 kg, custo 2,06, imp 5%, com 3%, margem 15%, mín 10%', () => {
  const v = venda({ impostosPct: 5, comissaoPct: 3, margemDesejadaPct: 15, margemMinimaPct: 10 })
  const custos = calcularCustos(2.06, custosZerados(), 15000, 40)
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade({ quantidadeInformada: 15000 }))
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)

  perto(precos.precoSugeridoPorKg, 2.06 / 0.77)  // 2,675325
  perto(precos.precoMinimoPorKg, 2.06 / 0.82)    // 2,512195
  perto(precos.descontoMaximoPct, 6.0975609756)
  perto(r.margemRealPct, 15)
  perto(r.precoPorSaco, (2.06 / 0.77) * 40)
  perto(r.valorTotalPedido, (2.06 / 0.77) * 15000)
  perto(r.lucroTotalPedido, (2.06 / 0.77) * 0.15 * 15000)
})

test('TESTE 4 — MILHO TRITURADO: 8.000 kg, custo 1,20, imp 4%, com 2%, margem 15%, mín 10%', () => {
  const v = venda({ impostosPct: 4, comissaoPct: 2, margemDesejadaPct: 15, margemMinimaPct: 10 })
  const custos = calcularCustos(1.20, custosZerados(), 8000, 40)
  const precos = precificar(custos.custoBasePorKg, v)
  const d = calcularDemanda(quantidade({ quantidadeInformada: 8000 }))
  const r = calcularNegociado(precos.precoSugeridoPorKg, custos, precos, v, d, 40)

  perto(precos.precoSugeridoPorKg, 1.20 / 0.79)  // 1,518987
  perto(precos.precoMinimoPorKg, 1.20 / 0.84)    // 1,428571
  perto(precos.descontoMaximoPct, 5.9523809524)
  perto(r.margemRealPct, 15)
  perto(r.valorTotalPedido, (1.20 / 0.79) * 8000)
  perto(r.lucroTotalPedido, (1.20 / 0.79) * 0.15 * 8000)
})
