/**
 * Testes do motor do Estudo de Viabilidade da Produção Própria.
 *
 * Roda com `npm test` (tsx --test). Nenhum teste toca React ou Supabase — o
 * motor é puro de propósito.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  calcularCustoAtual, calcularCustosProducao, calcularDemanda, calcularDimensionamento,
  calcularEstudo, calcularFormula, calcularRetorno, compararEconomia, dec, dividir,
  MSG_FORMULA_ABERTA, n, participacaoParaKgPorTonelada, precoPorKg, quantidadeParaKg,
  ehDoNucleo, somarInvestimento, sugerirEquipamento, totalAnimais, validar,
} from './calculo'
import { CAPACIDADES_BRANORTE, fasesDoProduto, formulaPadrao, normalizarStatus } from './catalogo'
import { aplicarFases, novoEstudo, normalizarInput, trocarEspecie, usarFaseUnica } from './estado'
import {
  dadosEstudo, frasePrincipal, montarPremissas, resumirComposicao, resumoTexto,
  telefoneWhatsApp, textoWhatsApp,
} from './estudo'
import { brl, num } from './formato'
import type { EstudoInput, IngredienteFormula, Necessidade } from './tipos'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Estudo mínimo que fecha a conta: aves, 10.000 kg/mês, fórmula 100%. */
function base(): EstudoInput {
  const e = novoEstudo(null, 'aves', 'Vendedor Teste')
  e.identificacao.clienteNome = 'João da Silva'
  e.necessidade = {
    ...e.necessidade,
    modo: 'direto',
    quantidadeInformada: 10_000,
    unidadeQuantidade: 'kg',
    periodoQuantidade: 'mes',
    consumoConfirmado: true,
  }
  e.atual = { ...e.atual, preco: 2.5, unidadePreco: 'kg' }
  // a fórmula de partida das aves já soma 100%
  return e
}

/** Zera todos os custos operacionais pra isolar a matéria-prima nos testes. */
function semOperacionais(e: EstudoInput): EstudoInput {
  const off = { ativo: false, valor: 0 }
  e.custos = {
    ...e.custos,
    perdaPct: 0,
    energia: off, maoDeObra: off, moagem: off, mistura: off, manutencao: off,
    depreciacao: off, administrativo: off, carregamento: off, outrosVariaveis: off,
    embalagem: off, etiqueta: off, custosFixosMensais: off,
  }
  return e
}

const APROX = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

// ---------------------------------------------------------------------------

describe('utilitários numéricos', () => {
  it('n() sanitiza lixo', () => {
    assert.equal(n(NaN), 0)
    assert.equal(n(Infinity), 0)
    assert.equal(n(null), 0)
    assert.equal(n('abc'), 0)
    assert.equal(n('12.5'), 12.5)
  })

  it('dividir() nunca estoura', () => {
    assert.equal(dividir(10, 0), 0)
    assert.equal(dividir(0, 0), 0)
    assert.equal(dividir(10, 4), 2.5)
  })

  it('dec() converte inteiro pra decimal', () => {
    assert.equal(dec(20), 0.2)
    assert.equal(dec(0), 0)
  })

  it('zero negativo nunca chega na tela como "-R$ 0,00"', () => {
    // estudo em branco: (0 - custo) x 0 kg = -0
    assert.equal(Object.is(num(-0), 0), true)
    assert.equal(brl(-0), brl(0))
    assert.equal(brl((0 - 1.6) * 0), 'R$'.concat(brl(0).slice(2)))
    assert.equal(brl(-0).includes('-'), false)
  })
})

describe('conversão de unidades', () => {
  it('preço por saco/tonelada vira R$/kg', () => {
    assert.equal(precoPorKg(1.08, 'kg', 60), 1.08)
    assert.equal(precoPorKg(1080, 't', 60), 1.08)
    APROX(precoPorKg(64.8, 'saco', 60), 1.08)
    assert.equal(precoPorKg(64.8, 'saco', 0), 0, 'saco sem peso não divide por zero')
  })

  it('quantidade informada vira kg', () => {
    assert.equal(quantidadeParaKg(10, 'kg', 40), 10)
    assert.equal(quantidadeParaKg(10, 't', 40), 10_000)
    assert.equal(quantidadeParaKg(10, 'sacos', 40), 400)
  })

  it('participação vira kg por tonelada', () => {
    assert.equal(participacaoParaKgPorTonelada(58, 'pct'), 580)
    assert.equal(participacaoParaKgPorTonelada(580, 'kg_t'), 580)
    assert.equal(participacaoParaKgPorTonelada(500, 'g_t'), 0.5)
  })
})

describe('demanda', () => {
  const nec = (p: Partial<Necessidade>): Necessidade => ({
    ...novoEstudo(null, 'aves').necessidade, ...p,
  })

  it('por nº de animais com consumo mensal', () => {
    const d = calcularDemanda(nec({ modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 3, baseConsumo: 'mes' }))
    assert.equal(d.mensalKg, 3000)
    assert.equal(d.anualKg, 36_000)
    APROX(d.diariaKg, 100)
  })

  it('por consumo diário × nº de dias', () => {
    const d = calcularDemanda(nec({ modo: 'animais', numeroAnimais: 100, consumoPorAnimal: 0.12, baseConsumo: 'dia', dias: 30 }))
    APROX(d.mensalKg, 360)
  })

  it('por ciclo dilui o total na duração do ciclo', () => {
    // 1.000 aves × 5,4 kg num ciclo de 45 dias → 1,5 mês → 3.600 kg/mês
    const d = calcularDemanda(nec({ modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 5.4, baseConsumo: 'ciclo', dias: 45 }))
    APROX(d.mensalKg, 3600)
  })

  it('margem de segurança acresce a demanda', () => {
    const d = calcularDemanda(nec({ modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 3, baseConsumo: 'mes', margemSegurancaPct: 10 }))
    APROX(d.mensalKg, 3300)
  })

  it('quantidade direta respeita o período informado', () => {
    APROX(calcularDemanda(nec({ modo: 'direto', quantidadeInformada: 500, unidadeQuantidade: 'kg', periodoQuantidade: 'dia' })).mensalKg, 15_000)
    APROX(calcularDemanda(nec({ modo: 'direto', quantidadeInformada: 120, unidadeQuantidade: 't', periodoQuantidade: 'ano' })).mensalKg, 10_000)
    APROX(calcularDemanda(nec({ modo: 'direto', quantidadeInformada: 10, unidadeQuantidade: 't', periodoQuantidade: 'mes' })).toneladasMes, 10)
  })

  it('campos vazios não geram NaN', () => {
    const d = calcularDemanda(nec({ modo: 'animais', numeroAnimais: 0, consumoPorAnimal: 0, pesoSaco: 0 }))
    assert.equal(d.mensalKg, 0)
    assert.equal(d.sacosMes, 0)
    assert.ok(Number.isFinite(d.anualKg))
  })

  it('número muito grande continua finito', () => {
    const d = calcularDemanda(nec({ modo: 'direto', quantidadeInformada: 1e9, unidadeQuantidade: 't', periodoQuantidade: 'mes' }))
    assert.ok(Number.isFinite(d.mensalKg))
    assert.equal(d.mensalKg, 1e12)
  })

  it('valor negativo é tratado como zero', () => {
    const d = calcularDemanda(nec({ modo: 'direto', quantidadeInformada: -500, unidadeQuantidade: 'kg', periodoQuantidade: 'mes' }))
    assert.equal(d.mensalKg, 0)
  })
})

describe('fórmula', () => {
  it('as fórmulas de partida fecham exatamente 100%', () => {
    for (const especie of ['aves', 'suinos', 'bovinos'] as const) {
      const f = calcularFormula({ ...base().formula, itens: formulaPadrao(especie) }, especie)
      assert.equal(f.fechada, true, `${especie} deveria fechar`)
      APROX(f.totalKgPorTonelada, 1000, 1e-9)
    }
  })

  it('nenhuma fórmula de partida traz silagem, volumoso ou líquido', () => {
    for (const especie of ['aves', 'suinos', 'bovinos'] as const) {
      for (const item of formulaPadrao(especie)) {
        const nome = item.nome.toLowerCase()
        assert.ok(!nome.includes('silagem'), `${especie} não pode trazer silagem`)
        assert.ok(!nome.includes('volumoso'), `${especie} não pode trazer volumoso`)
        assert.ok(!nome.includes('óleo'), `${especie} não pode trazer óleo`)
      }
    }
  })

  it('abaixo de 100% é detectado e a sobra é informada', () => {
    const e = base()
    // Antes daqui o teste cravava "58 + 33 = 91", que era a soma dos dois
    // primeiros itens do padrão ANTIGO de aves. Quando o padrão passou a vir do
    // catálogo de referência (com fonte), a soma virou 95 e o teste quebrou —
    // apontando uma mudança legítima, não um defeito. Agora ele afere a REGRA:
    // sobrou %, a fórmula não fecha e a diferença em kg/t bate com a sobra.
    e.formula.itens = e.formula.itens.slice(0, 2)
    const somaEsperada = e.formula.itens.reduce((a, i) => a + i.participacao, 0)
    assert.ok(somaEsperada < 100, 'o recorte tem que deixar a fórmula aberta')

    const f = calcularFormula(e.formula, 'aves')
    assert.equal(f.fechada, false)
    APROX(f.totalParticipacaoPct, somaEsperada)
    APROX(f.diferencaKgPorTonelada, (100 - somaEsperada) * 10)
  })

  it('acima de 100% também bloqueia', () => {
    const e = base()
    e.formula.itens = [{ ...e.formula.itens[0], participacao: 120 }]
    const f = calcularFormula(e.formula, 'aves')
    assert.equal(f.fechada, false)
    assert.ok(f.diferencaKgPorTonelada < 0)
  })

  it('mistura de unidades (%, kg/t, g/t) soma certo', () => {
    const it = (nome: string, participacao: number, unidadeParticipacao: 'pct' | 'kg_t' | 'g_t') => ({
      id: nome, nome, participacao, unidadeParticipacao,
      preco: 1, unidadePreco: 'kg' as const, pesoSacoIngrediente: 60,
    })
    const f = calcularFormula(
      { ...base().formula, itens: [it('A', 50, 'pct'), it('B', 499_500, 'g_t'), it('C', 0.5, 'kg_t')] },
      'aves',
    )
    APROX(f.totalKgPorTonelada, 1000, 1e-9)
    assert.equal(f.fechada, true)
  })

  it('preço em R$/kg, R$/saco e R$/t dá o mesmo custo', () => {
    const mk = (preco: number, unidadePreco: 'kg' | 'saco' | 't') => calcularFormula(
      {
        ...base().formula,
        itens: [{ id: 'x', nome: 'Milho', participacao: 100, unidadeParticipacao: 'pct', preco, unidadePreco, pesoSacoIngrediente: 60 }],
      },
      'aves',
    ).custoIngredientesPorKg
    APROX(mk(1.08, 'kg'), 1.08)
    APROX(mk(64.8, 'saco'), 1.08)
    APROX(mk(1080, 't'), 1.08)
  })

  it('milho triturado dispensa composição', () => {
    const f = calcularFormula({ ...base().formula, milhoPreco: 64.8, milhoUnidadePreco: 'saco', milhoPesoSaca: 60 }, 'milho')
    assert.equal(f.fechada, true)
    APROX(f.custoIngredientesPorKg, 1.08)
  })
})

describe('custo atual (o que ele paga hoje)', () => {
  const demanda = calcularDemanda(base().necessidade)

  it('preço por saco vira R$/kg e projeta mês e ano', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 100, unidadePreco: 'saco', pesoSacoCompra: 40 }
    const a = calcularCustoAtual(e.atual, demanda)
    APROX(a.custoPorKg, 2.5)
    APROX(a.custoPorTonelada, 2500)
    APROX(a.custoMensal, 25_000)
    APROX(a.custoAnual, 300_000)
  })

  it('frete, descarga e outros somam ao custo', () => {
    const e = base()
    e.atual = {
      ...e.atual, preco: 2, unidadePreco: 'kg',
      frete: { ativo: true, valor: 0.1 },
      descarga: { ativo: true, valor: 0.05 },
      outros: { ativo: true, valor: 0.02 },
    }
    APROX(calcularCustoAtual(e.atual, demanda).custoPorKg, 2.17)
  })

  it('custo desligado não entra na conta', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 2, unidadePreco: 'kg', frete: { ativo: false, valor: 999 } }
    APROX(calcularCustoAtual(e.atual, demanda).custoPorKg, 2)
  })

  it('perda encarece o kg efetivamente aproveitado', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 2, unidadePreco: 'kg', perdasPct: 10 }
    APROX(calcularCustoAtual(e.atual, demanda).custoPorKg, 2 / 0.9)
  })

  it('quem já produz informa o custo direto', () => {
    const e = base()
    e.atual = { ...e.atual, modo: 'proprio', custoManualPorKg: 1.9, preco: 999 }
    const a = calcularCustoAtual(e.atual, demanda)
    APROX(a.custoPorKg, 1.9)
    assert.equal(a.informado, true)
  })

  it('sem preço informado, não está informado', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 0 }
    assert.equal(calcularCustoAtual(e.atual, demanda).informado, false)
  })
})

describe('custo de produzir', () => {
  it('perda de produção encarece a matéria-prima', () => {
    const e = semOperacionais(base())
    e.custos.perdaPct = 5
    const c = calcularCustosProducao(1, e.custos, 10_000, 40)
    APROX(c.custoIngredientesAjustadoPorKg, 1 / 0.95)
    APROX(c.perdaPorKg, 1 / 0.95 - 1)
  })

  it('operacionais ligados somam por kg', () => {
    const e = semOperacionais(base())
    e.custos.energia = { ativo: true, valor: 0.03 }
    e.custos.maoDeObra = { ativo: true, valor: 0.1 }
    const c = calcularCustosProducao(1, e.custos, 10_000, 40)
    APROX(c.custoTotalPorKg, 1.13)
    APROX(c.operacionaisPorKg, 0.13)
  })

  it('embalagem é por saco e vira R$/kg', () => {
    const e = semOperacionais(base())
    e.custos.embalagem = { ativo: true, valor: 1.2 }
    const c = calcularCustosProducao(0, e.custos, 10_000, 40)
    APROX(c.embalagemPorKg, 0.03)
  })

  it('custo fixo mensal é diluído no volume real do mês', () => {
    const e = semOperacionais(base())
    e.custos.custosFixosMensais = { ativo: true, valor: 1000 }
    APROX(calcularCustosProducao(0, e.custos, 10_000, 40).fixosPorKg, 0.1)
    // volume zero não pode virar Infinity
    assert.equal(calcularCustosProducao(0, e.custos, 0, 40).fixosPorKg, 0)
  })

  it('não sobra margem, imposto nem comissão no resultado', () => {
    const c = calcularCustosProducao(1, base().custos, 10_000, 40) as unknown as Record<string, unknown>
    for (const proibido of ['margemRealPct', 'precoSugeridoPorKg', 'impostosPorKg', 'comissaoPorKg', 'lucroPorKg']) {
      assert.equal(proibido in c, false, `${proibido} não pode existir no estudo`)
    }
  })
})

describe('comparação e economia', () => {
  const demanda = calcularDemanda(base().necessidade) // 10.000 kg/mês

  it('economia positiva bate por kg, mês e ano', () => {
    const c = compararEconomia(2.5, 2.0, demanda)
    APROX(c.economiaPorKg, 0.5)
    APROX(c.economiaPorTonelada, 500)
    APROX(c.economiaMensal, 5000)
    APROX(c.economiaAnual, 60_000)
    APROX(c.reducaoPct, 20)
    assert.equal(c.vantajoso, true)
  })

  it('economia negativa NÃO é escondida', () => {
    const c = compararEconomia(2.0, 2.5, demanda)
    APROX(c.economiaPorKg, -0.5)
    APROX(c.economiaMensal, -5000)
    assert.equal(c.vantajoso, false)
    assert.ok(c.reducaoPct < 0)
  })

  it('economia exatamente zero não é vantajosa', () => {
    const c = compararEconomia(2.0, 2.0, demanda)
    assert.equal(c.economiaPorKg, 0)
    assert.equal(c.vantajoso, false)
    assert.equal(c.reducaoPct, 0)
  })

  it('custo atual zero não gera divisão por zero na redução', () => {
    assert.equal(compararEconomia(0, 2, demanda).reducaoPct, 0)
  })

  it('economia por animal só existe quando há plantel', () => {
    APROX(compararEconomia(2.5, 2, demanda, 1000).economiaPorAnimalMes, 5)
    assert.equal(compararEconomia(2.5, 2, demanda, 0).economiaPorAnimalMes, 0)
  })
})

describe('dimensionamento', () => {
  const demanda = calcularDemanda({ ...base().necessidade, quantidadeInformada: 60_750 })

  it('capacidade mínima = produção do dia ÷ horas disponíveis', () => {
    const d = calcularDimensionamento(
      { diasPorMes: 26, horasPorDia: 4, lotesPorDia: 0, frequencia: 'diaria', margemOperacionalPct: 20 },
      demanda, CAPACIDADES_BRANORTE,
    )
    assert.equal(d.aplicavel, true)
    APROX(d.producaoPorDiaKg, 60_750 / 26)
    APROX(d.capacidadeMinimaKgHora, 60_750 / 26 / 4)
    APROX(d.capacidadeRecomendadaKgHora, (60_750 / 26 / 4) * 1.2)
    assert.equal(d.sugerido?.capacidade, 1000, 'recomendada ~701 kg/h → sobe pra 1.000')
  })

  it('sugere a menor capacidade que atende', () => {
    assert.equal(sugerirEquipamento(250, CAPACIDADES_BRANORTE, 1000, 4)?.capacidade, 300)
    assert.equal(sugerirEquipamento(300, CAPACIDADES_BRANORTE, 1000, 4)?.capacidade, 300)
    assert.equal(sugerirEquipamento(301, CAPACIDADES_BRANORTE, 1000, 4)?.capacidade, 600)
  })

  it('acima da linha devolve a maior e sinaliza', () => {
    const s = sugerirEquipamento(9000, CAPACIDADES_BRANORTE, 40_000, 8)
    assert.equal(s?.capacidade, 5000)
    assert.equal(s?.acimaDaLinha, true)
  })

  it('utilização é a fração do tempo disponível', () => {
    const s = sugerirEquipamento(500, [600], 1200, 4)
    APROX(s!.horasPorDia, 2)
    APROX(s!.utilizacaoPct, 50)
  })

  it('sem dias ou horas o bloco não se aplica', () => {
    const vazio = calcularDimensionamento(
      { diasPorMes: 0, horasPorDia: 4, lotesPorDia: 0, frequencia: 'diaria', margemOperacionalPct: 20 },
      demanda, CAPACIDADES_BRANORTE,
    )
    assert.equal(vazio.aplicavel, false)
    assert.equal(vazio.capacidadeMinimaKgHora, 0)
  })

  it('kg por lote sai da produção do dia', () => {
    const d = calcularDimensionamento(
      { diasPorMes: 30, horasPorDia: 4, lotesPorDia: 2, frequencia: 'diaria', margemOperacionalPct: 0 },
      calcularDemanda({ ...base().necessidade, quantidadeInformada: 30_000 }), CAPACIDADES_BRANORTE,
    )
    APROX(d.kgPorLote, 500)
  })
})

describe('investimento e retorno', () => {
  const inv = {
    equipamentos: 70_000, frete: 5000, montagem: 4000,
    instalacaoEletrica: 6000, obraCivil: 10_000, outros: 5000,
    modoFinanciamento: 'sem' as const, custoFinanceiroInformado: 0,
  }

  it('soma todos os componentes', () => {
    assert.equal(somarInvestimento(inv), 100_000)
  })

  it('payback = investimento ÷ economia mensal', () => {
    const r = calcularRetorno(inv, 10_000, 120_000)
    assert.equal(r.aplicavel, true)
    APROX(r.paybackMeses, 10)
    APROX(r.paybackAnos, 10 / 12)
  })

  it('sem economia NÃO calcula payback', () => {
    for (const economia of [0, -5000]) {
      const r = calcularRetorno(inv, economia, economia * 12)
      assert.equal(r.aplicavel, false)
      assert.equal(r.paybackMeses, 0)
    }
  })

  it('custo financeiro informado entra na base do payback', () => {
    const r = calcularRetorno({ ...inv, modoFinanciamento: 'informado', custoFinanceiroInformado: 20_000 }, 10_000, 120_000)
    assert.equal(r.investimentoConsiderado, 120_000)
    APROX(r.paybackMeses, 12)
  })

  it('acumulado de 1 a 5 anos desconta o investimento', () => {
    const r = calcularRetorno(inv, 10_000, 120_000)
    assert.equal(r.acumulado.length, 5)
    assert.equal(r.acumulado[0].economia, 120_000)
    assert.equal(r.acumulado[0].liquido, 20_000)
    assert.equal(r.acumulado[4].economia, 600_000)
    assert.equal(r.acumulado[4].liquido, 500_000)
  })

  it('investimento zerado não gera payback', () => {
    const zero = { ...inv, equipamentos: 0, frete: 0, montagem: 0, instalacaoEletrica: 0, obraCivil: 0, outros: 0 }
    assert.equal(calcularRetorno(zero, 10_000, 120_000).aplicavel, false)
  })
})

describe('validação', () => {
  const validarDe = (e: EstudoInput) => {
    const d = calcularDemanda(e.necessidade)
    const f = calcularFormula(e.formula, e.produto.especie)
    return validar(e, d, f, calcularCustoAtual(e.atual, d))
  }

  it('estudo completo não tem bloqueio', () => {
    const p = validarDe(base())
    assert.equal(p.filter(x => x.nivel === 'bloqueio').length, 0, JSON.stringify(p))
  })

  it('fórmula aberta bloqueia com a mensagem combinada', () => {
    const e = base()
    e.formula.itens = e.formula.itens.slice(0, 2)
    const p = validarDe(e)
    const bloqueio = p.find(x => x.campo === 'formula' && x.nivel === 'bloqueio')
    assert.ok(bloqueio, 'deveria bloquear')
    assert.ok(bloqueio!.mensagem.startsWith(MSG_FORMULA_ABERTA))
  })

  it('sem custo atual bloqueia', () => {
    const e = base()
    e.atual.preco = 0
    assert.ok(validarDe(e).some(x => x.campo === 'atual' && x.nivel === 'bloqueio'))
  })

  it('sem volume bloqueia', () => {
    const e = base()
    e.necessidade.quantidadeInformada = 0
    assert.ok(validarDe(e).some(x => x.campo === 'necessidade' && x.nivel === 'bloqueio'))
  })

  it('percentual acima de 100 bloqueia', () => {
    const e = base()
    e.custos.perdaPct = 120
    assert.ok(validarDe(e).some(x => x.campo === 'perdaPct' && x.nivel === 'bloqueio'))
  })

  it('consumo de referência não confirmado é aviso, não bloqueio', () => {
    const e = novoEstudo(null, 'aves', 'V')
    e.identificacao.clienteNome = 'X'
    e.necessidade = { ...e.necessidade, modo: 'animais', numeroAnimais: 1000, consumoPorAnimal: 3 }
    e.atual = { ...e.atual, preco: 2.5, unidadePreco: 'kg' }
    const aviso = validarDe(e).find(x => x.campo === 'consumoPorAnimal')
    assert.ok(aviso)
    assert.equal(aviso!.nivel, 'aviso')
  })

  it('dias/horas impossíveis bloqueiam', () => {
    const e = base()
    e.dimensionamento = { ...e.dimensionamento, diasPorMes: 40, horasPorDia: 30 }
    const p = validarDe(e)
    assert.ok(p.some(x => x.campo === 'diasPorMes' && x.nivel === 'bloqueio'))
    assert.ok(p.some(x => x.campo === 'horasPorDia' && x.nivel === 'bloqueio'))
  })

  it('milho sem preço bloqueia', () => {
    const e = trocarEspecie(base(), 'milho', null)
    e.formula.milhoPreco = 0
    assert.ok(validarDe(e).some(x => x.campo === 'milhoPreco' && x.nivel === 'bloqueio'))
  })
})

describe('estudo completo', () => {
  it('encadeia demanda → custos → economia → payback', () => {
    const e = semOperacionais(base())
    e.custos.energia = { ativo: true, valor: 0.05 }
    e.atual = { ...e.atual, preco: 2.5, unidadePreco: 'kg' }
    e.investimento = { ...e.investimento, equipamentos: 50_000 }

    const r = calcularEstudo(e)
    assert.equal(r.bloqueado, false)
    APROX(r.demanda.mensalKg, 10_000)
    APROX(r.producao.custoTotalPorKg, r.formula.custoIngredientesPorKg + 0.05)
    APROX(r.comparacao.economiaPorKg, 2.5 - r.producao.custoTotalPorKg)
    APROX(r.comparacao.economiaMensal, r.comparacao.economiaPorKg * 10_000)
    assert.equal(r.retorno.aplicavel, true)
    APROX(r.retorno.paybackMeses, 50_000 / r.comparacao.economiaMensal)
  })

  it('investimento sem economia não gera payback', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 0.5, unidadePreco: 'kg' } // ração pronta baratíssima
    e.investimento = { ...e.investimento, equipamentos: 80_000 }
    const r = calcularEstudo(e)
    assert.equal(r.comparacao.vantajoso, false)
    assert.equal(r.retorno.aplicavel, false)
  })

  it('cenários variam na ordem esperada', () => {
    const r = calcularEstudo(base())
    const [cons, prov, otim] = r.cenarios
    assert.ok(cons.custoProprioPorKg > prov.custoProprioPorKg, 'conservador custa mais')
    assert.ok(otim.custoProprioPorKg < prov.custoProprioPorKg, 'otimista custa menos')
    assert.ok(cons.economiaMensal < prov.economiaMensal)
    assert.ok(otim.economiaMensal > prov.economiaMensal)
  })

  it('capacidade da configuração é respeitada', () => {
    const r = calcularEstudo(base(), [500, 5000])
    assert.ok([500, 5000].includes(r.dimensionamento.sugerido!.capacidade))
  })

  it('memória de cálculo termina na economia por kg', () => {
    const r = calcularEstudo(base())
    const ultima = r.memoria[r.memoria.length - 1]
    assert.equal(ultima.rotulo, 'Economia por kg')
    APROX(ultima.valor, r.comparacao.economiaPorKg)
  })

  it('bovinos, suínos, aves e milho calculam sem quebrar', () => {
    for (const especie of ['bovinos', 'suinos', 'aves', 'milho'] as const) {
      const e = trocarEspecie(base(), especie, null)
      e.atual = { ...e.atual, preco: 2.5, unidadePreco: 'kg' }
      const r = calcularEstudo(e)
      assert.ok(Number.isFinite(r.producao.custoTotalPorKg), especie)
      assert.ok(Number.isFinite(r.comparacao.economiaMensal), especie)
    }
  })
})

describe('compatibilidade com o que já estava salvo', () => {
  it('status antigos viram os novos', () => {
    assert.equal(normalizarStatus('enviada'), 'apresentado')
    assert.equal(normalizarStatus('vendida'), 'vendido')
    assert.equal(normalizarStatus('perdida'), 'nao_avancou')
    assert.equal(normalizarStatus('cancelada'), 'cancelado')
    assert.equal(normalizarStatus('aprovado'), 'aprovado')
    assert.equal(normalizarStatus('lixo'), 'rascunho')
  })

  it('simulação do módulo antigo reabre como estudo', () => {
    const legado = {
      identificacao: { clienteNome: 'Antigo', clienteEmpresa: 'Fazenda', vendedorNome: 'V' },
      produto: { especie: 'suinos', categoria: 'terminacao', categoriaLivre: '' },
      quantidade: {
        modo: 'direto', quantidadeInformada: 2000, unidadeQuantidade: 'kg',
        pedidosPorMes: 4, pesoSaco: 40, sobraPct: 5,
      },
      venda: { precoAtualClientePorKg: 2.2, margemDesejadaPct: 20 },
      custos: { perdaPct: 2, custosFixosMensais: 1500 },
      cenarios: { conservador: { materiaPrimaPct: 30 } },
      status: 'negociacao',
    }
    const e = normalizarInput(legado, null)

    assert.equal(e.identificacao.clienteNome, 'Antigo')
    assert.equal(e.necessidade.quantidadeInformada, 8000, 'pedido × pedidos/mês vira o mensal')
    assert.equal(e.necessidade.periodoQuantidade, 'mes')
    assert.equal(e.necessidade.margemSegurancaPct, 5)
    assert.equal(e.atual.preco, 2.2)
    assert.equal(e.atual.unidadePreco, 'kg')
    assert.deepEqual(e.custos.custosFixosMensais, { ativo: true, valor: 1500 })
    assert.equal(e.cenarios.conservador.ingredientesPct, 30, 'materiaPrimaPct vira ingredientesPct')
    assert.equal(e.status, 'negociacao')
    assert.ok(Number.isFinite(calcularEstudo(e).comparacao.economiaMensal))
  })

  it('lixo no JSONB não derruba a tela', () => {
    for (const lixo of [null, undefined, 'texto', 42, {}]) {
      const e = normalizarInput(lixo, null)
      assert.ok(Number.isFinite(calcularEstudo(e).producao.custoTotalPorKg))
    }
  })
})

describe('apresentação e WhatsApp', () => {
  const montar = () => {
    const e = base()
    e.investimento = { ...e.investimento, equipamentos: 60_000 }
    const r = calcularEstudo(e)
    return dadosEstudo(e, r, {
      codigo: 'VR-ABC123',
      textoApresentacao: 'texto', avisoNutricional: 'aviso nutri', avisoEstimativa: 'aviso estimativa',
    })
  }

  it('a mensagem apresenta o estudo, não uma oferta de ração', () => {
    const t = textoWhatsApp(montar())
    assert.ok(t.includes('estudo preliminar sobre a produção própria'))
    assert.ok(t.includes('Custo atual informado'))
    assert.ok(t.includes('Custo estimado de produção própria'))
    assert.ok(t.includes('Os valores são estimativas'))
    for (const proibido of ['saco de', 'Valor total', 'Boleto', 'CIF', 'Validade da proposta', 'fornecimento']) {
      assert.ok(!t.includes(proibido), `"${proibido}" não pode aparecer`)
    }
  })

  it('a frase principal usa custo, economia mensal e anual', () => {
    const f = frasePrincipal(montar())
    assert.ok(f.includes('poderá reduzir o custo estimado'))
    assert.ok(f.includes('por mês'))
    assert.ok(f.includes('por ano'))
  })

  it('sem economia a frase muda e não promete nada', () => {
    const e = base()
    e.atual = { ...e.atual, preco: 0.5, unidadePreco: 'kg' }
    const d = dadosEstudo(e, calcularEstudo(e), {
      codigo: 'X', textoApresentacao: '', avisoNutricional: '', avisoEstimativa: '',
    })
    assert.equal(
      frasePrincipal(d),
      'Com os dados atuais, a produção própria não apresenta economia. '
      + 'Revise os preços, a fórmula e os custos operacionais.',
    )
  })

  it('o estudo do cliente não carrega dado interno do vendedor', () => {
    const e = base()
    e.identificacao.observacoesInternas = 'cliente pechincha demais'
    const d = dadosEstudo(e, calcularEstudo(e), {
      codigo: 'X', textoApresentacao: '', avisoNutricional: '', avisoEstimativa: '',
    })
    assert.equal(JSON.stringify(d).includes('pechincha'), false)
    assert.equal(resumoTexto(d).includes('pechincha'), false)
  })

  it('telefone vira formato wa.me', () => {
    assert.equal(telefoneWhatsApp('(66) 99999-8888'), '5566999998888')
    assert.equal(telefoneWhatsApp('5566999998888'), '5566999998888')
    assert.equal(telefoneWhatsApp(''), '')
  })

  it('formatação brasileira nos valores', () => {
    const t = resumoTexto(montar())
    assert.ok(/R\$\s?\d{1,3}(\.\d{3})*,\d{2}/.test(t), `sem número pt-BR em:\n${t}`)
  })
})

// ---------------------------------------------------------------------------
// Ciclo completo / mais de uma fase
// ---------------------------------------------------------------------------

describe('fases múltiplas (ciclo completo)', () => {
  const suinos = () => {
    const e = novoEstudo(null, 'suinos', 'V')
    e.identificacao.clienteNome = 'Granja'
    e.necessidade = { ...e.necessidade, modo: 'animais', baseConsumo: 'mes', margemSegurancaPct: 0 }
    return e
  }

  it('uma fase só não muda nada: fases fica vazio e a conta é a de sempre', () => {
    const e = suinos()
    e.necessidade.numeroAnimais = 200
    e.necessidade.consumoPorAnimal = 90
    const antes = calcularDemanda(e.necessidade).mensalKg

    const depois = aplicarFases(e, ['terminacao'])
    assert.deepEqual(depois.necessidade.fases, [], 'uma fase não cria linhas de plantel')
    assert.equal(depois.produto.categoria, 'terminacao')
    assert.equal(calcularDemanda(depois.necessidade).mensalKg, antes)
  })

  it('a demanda é a SOMA das fases, não a média', () => {
    let e = suinos()
    e.necessidade.numeroAnimais = 0
    e = aplicarFases(e, ['crescimento', 'terminacao', 'gestacao'])
    assert.equal(e.necessidade.fases?.length, 3)

    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 120, consumoPorAnimal: 57 },
      { categoria: 'terminacao', numeroAnimais: 80, consumoPorAnimal: 90 },
      { categoria: 'gestacao', numeroAnimais: 30, consumoPorAnimal: 75 },
    ]
    // 6.840 + 7.200 + 2.250
    assert.equal(calcularDemanda(e.necessidade).mensalKg, 16_290)
    assert.equal(totalAnimais(e.necessidade), 230)
  })

  it('base dia e ciclo continuam valendo pra todas as linhas', () => {
    let e = suinos()
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 100, consumoPorAnimal: 2 },
      { categoria: 'terminacao', numeroAnimais: 100, consumoPorAnimal: 3 },
    ]
    e.necessidade.baseConsumo = 'dia'
    e.necessidade.dias = 30
    assert.equal(calcularDemanda(e.necessidade).mensalKg, 500 * 30)

    e.necessidade.baseConsumo = 'ciclo'
    e.necessidade.dias = 60
    // 500 kg no ciclo de 60 dias = 250 kg/mês
    assert.equal(calcularDemanda(e.necessidade).mensalKg, 250)
  })

  it('abrir a segunda fase não joga fora o plantel já digitado', () => {
    let e = suinos()
    e.produto.categoria = 'terminacao'
    e.necessidade.numeroAnimais = 350
    e.necessidade.consumoPorAnimal = 88

    e = aplicarFases(e, ['terminacao', 'crescimento'])
    const term = e.necessidade.fases?.find(f => f.categoria === 'terminacao')
    assert.equal(term?.numeroAnimais, 350, 'o plantel digitado vira a linha da fase de origem')
    assert.equal(term?.consumoPorAnimal, 88)
    const cresc = e.necessidade.fases?.find(f => f.categoria === 'crescimento')
    assert.equal(cresc?.numeroAnimais, 0, 'fase nova entra sem plantel')
    assert.equal(cresc?.consumoPorAnimal, 57, 'fase nova entra com o consumo de catálogo')
    assert.equal(e.necessidade.consumoConfirmado, false, 'fase nova exige reconfirmar')
  })

  it('voltar pra uma fase traz o plantel da fase que sobrou', () => {
    let e = suinos()
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 111, consumoPorAnimal: 50 },
      { categoria: 'terminacao', numeroAnimais: 222, consumoPorAnimal: 95 },
    ]
    e.produto.categoria = 'terminacao'

    const so = aplicarFases(e, ['terminacao'])
    assert.deepEqual(so.necessidade.fases, [])
    assert.equal(so.necessidade.numeroAnimais, 222)
    assert.equal(calcularDemanda(so.necessidade).mensalKg, 222 * 95)
  })

  it('usarFaseUnica apaga a marca de seleção múltipla', () => {
    let e = suinos()
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    assert.equal(e.produto.categorias?.length, 2)
    const uma = usarFaseUnica(e)
    assert.equal(uma.produto.categorias, undefined, 'sem categorias = tela mostra o seletor simples')
    assert.deepEqual(uma.necessidade.fases, [])
  })

  it('desmarcar a última fase não deixa o estudo sem fase', () => {
    let e = suinos()
    e = aplicarFases(e, ['terminacao'])
    const igual = aplicarFases(e, [])
    assert.equal(igual.produto.categoria, 'terminacao')
  })

  it('a fase principal continua sendo uma só, e é ela que a fórmula atende', () => {
    let e = suinos()
    e.produto.categoria = 'terminacao'
    e = aplicarFases(e, ['crescimento', 'terminacao', 'gestacao'])
    assert.equal(e.produto.categoria, 'terminacao', 'principal marcada não muda sozinha')
    assert.deepEqual(fasesDoProduto(e.produto), ['crescimento', 'terminacao', 'gestacao'])

    // principal desmarcada: cai na primeira que sobrou, na ordem do catálogo
    const semTerm = aplicarFases(e, ['crescimento', 'gestacao'])
    assert.equal(semTerm.produto.categoria, 'crescimento')
  })

  it('trocar de espécie mata o plantel por fase (fase de suíno não existe em aves)', () => {
    let e = suinos()
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    const aves = trocarEspecie(e, 'aves', null)
    assert.deepEqual(aves.necessidade.fases, [])
    assert.equal(aves.produto.categorias, undefined)
  })

  it('estudo antigo (sem categorias) reabre como uma fase só', () => {
    const antigo = normalizarInput({
      produto: { especie: 'suinos', categoria: 'terminacao', categoriaLivre: '' },
      necessidade: { modo: 'animais', numeroAnimais: 100, consumoPorAnimal: 90, baseConsumo: 'mes' },
    }, null)
    assert.equal(antigo.produto.categorias, undefined)
    assert.deepEqual(fasesDoProduto(antigo.produto), ['terminacao'])
    assert.equal(calcularDemanda(antigo.necessidade).mensalKg, 9_000)
  })

  it('multi-fase salvo sem as linhas de plantel se reconstrói ao abrir', () => {
    const salvo = normalizarInput({
      produto: {
        especie: 'suinos', categoria: 'terminacao', categoriaLivre: '',
        categorias: ['crescimento', 'terminacao'],
      },
      necessidade: { modo: 'animais', numeroAnimais: 50, consumoPorAnimal: 90, baseConsumo: 'mes' },
    }, null)
    assert.equal(salvo.necessidade.fases?.length, 2, 'reabriria calculando com uma fase só')
  })

  it('o cabeçalho do estudo mostra TODAS as fases', () => {
    let e = base()
    e.produto = { especie: 'suinos', categoria: 'terminacao', categoriaLivre: '' }
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    const d = dadosEstudo(e, calcularEstudo(e), {
      codigo: 'VR-1', textoApresentacao: '', avisoNutricional: '', avisoEstimativa: '',
    })
    assert.equal(d.categoria, 'Crescimento, Terminação')
  })

  it('as premissas do PDF abrem o plantel fase a fase', () => {
    let e = base()
    e.produto = { especie: 'suinos', categoria: 'terminacao', categoriaLivre: '' }
    e.necessidade = { ...e.necessidade, modo: 'animais', baseConsumo: 'mes', numeroAnimais: 0 }
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 120, consumoPorAnimal: 57 },
      { categoria: 'terminacao', numeroAnimais: 80, consumoPorAnimal: 90 },
    ]
    const linha = montarPremissas(e, calcularEstudo(e)).find(x => x.rotulo === 'Plantel considerado')
    assert.ok(linha?.valor.includes('200'), `total de animais fora: ${linha?.valor}`)
    assert.ok(linha?.nota?.includes('Crescimento: 120'), `sem detalhe por fase: ${linha?.nota}`)
    assert.ok(linha?.nota?.includes('Terminação: 80'), `sem detalhe por fase: ${linha?.nota}`)
  })
})

// ---------------------------------------------------------------------------
// Uma fórmula POR FASE, custo ponderado, e o núcleo
// ---------------------------------------------------------------------------

describe('fórmula por fase e custo ponderado', () => {
  /** Suínos com duas fases, plantel 3:1, e fórmulas de preço bem diferente. */
  const doisPrecos = () => {
    let e = base()
    e.produto = { especie: 'suinos', categoria: 'crescimento', categoriaLivre: '' }
    e.necessidade = { ...e.necessidade, modo: 'animais', baseConsumo: 'mes', margemSegurancaPct: 0 }
    e = aplicarFases(e, ['crescimento', 'terminacao'])
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 300, consumoPorAnimal: 10 }, // 3.000 kg → 75%
      { categoria: 'terminacao', numeroAnimais: 100, consumoPorAnimal: 10 },  // 1.000 kg → 25%
    ]
    e.formula.porFase = {
      crescimento: [
        { id: 'a', nome: 'Cara', participacao: 100, unidadeParticipacao: 'pct', preco: 4, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
      ],
      terminacao: [
        { id: 'b', nome: 'Barata', participacao: 100, unidadeParticipacao: 'pct', preco: 1, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
      ],
    }
    return e
  }

  it('cada fase tem a sua fórmula e o peso dela é a fatia do volume', () => {
    const r = calcularEstudo(doisPrecos())
    const cres = r.formulasPorFase.find(f => f.categoria === 'crescimento')!
    const term = r.formulasPorFase.find(f => f.categoria === 'terminacao')!
    assert.equal(cres.peso, 0.75)
    assert.equal(term.peso, 0.25)
    assert.equal(cres.calc.custoIngredientesPorKg, 4)
    assert.equal(term.calc.custoIngredientesPorKg, 1)
  })

  it('o custo dos ingredientes é a MÉDIA PONDERADA, não a da fase principal', () => {
    const r = calcularEstudo(doisPrecos())
    // 0,75 × 4 + 0,25 × 1 = 3,25 — e NÃO 4 (a principal) nem 2,5 (média simples)
    assert.equal(r.custoIngredientesPonderadoPorKg, 3.25)
    assert.equal(r.producao.custoIngredientesPorKg, 3.25)
    assert.notEqual(r.custoIngredientesPonderadoPorKg, r.formula.custoIngredientesPorKg)
  })

  it('mudar o plantel muda o peso e portanto o custo', () => {
    const e = doisPrecos()
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 100, consumoPorAnimal: 10 },
      { categoria: 'terminacao', numeroAnimais: 300, consumoPorAnimal: 10 },
    ]
    // agora é 25% da cara e 75% da barata
    assert.equal(calcularEstudo(e).custoIngredientesPonderadoPorKg, 1.75)
  })

  it('plantel ainda zerado divide igual em vez de inventar custo', () => {
    const e = doisPrecos()
    e.necessidade.fases = [
      { categoria: 'crescimento', numeroAnimais: 0, consumoPorAnimal: 0 },
      { categoria: 'terminacao', numeroAnimais: 0, consumoPorAnimal: 0 },
    ]
    assert.equal(calcularEstudo(e).custoIngredientesPonderadoPorKg, 2.5)
  })

  it('uma fase só: o custo é o de sempre, sem ponderação nenhuma', () => {
    const e = base()
    const r = calcularEstudo(e)
    assert.equal(r.formulasPorFase.length, 1)
    assert.equal(r.formulasPorFase[0].peso, 1)
    assert.equal(r.custoIngredientesPonderadoPorKg, r.formula.custoIngredientesPorKg)
  })

  it('fase nova entra com a fórmula de referência e já fecha 100%', () => {
    let e = base()
    e.produto = { especie: 'suinos', categoria: 'crescimento', categoriaLivre: '' }
    e = aplicarFases(e, ['crescimento', 'terminacao', 'lactacao'])
    const r = calcularEstudo(e)
    assert.equal(r.formulasFechadas, true, 'ninguém deveria travar esperando 3 fórmulas')
    for (const f of r.formulasPorFase) {
      assert.ok(f.calc.linhas.length > 0, `fase ${f.categoria} entrou vazia`)
    }
  })

  it('fase aberta bloqueia o estudo E diz QUAL fase é', () => {
    const e = doisPrecos()
    e.formula.porFase!.terminacao = [
      { id: 'b', nome: 'Barata', participacao: 80, unidadeParticipacao: 'pct', preco: 1, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
    ]
    const r = calcularEstudo(e)
    assert.equal(r.formulasFechadas, false)
    const erro = r.problemas.find(x => x.campo === 'formula')
    assert.ok(erro, 'fórmula aberta tem que bloquear')
    assert.ok(erro!.mensagem.includes('Terminação'), `sem o nome da fase: ${erro!.mensagem}`)
  })

  it('colapsar pra uma fase traz a fórmula DELA e apaga o porFase', () => {
    const e = doisPrecos()
    const so = aplicarFases(e, ['terminacao'])
    assert.equal(so.formula.porFase, undefined)
    assert.equal(so.formula.itens[0].nome, 'Barata')
    assert.equal(calcularEstudo(so).custoIngredientesPonderadoPorKg, 1)
  })

  it('trocar de espécie não deixa fórmula de suíno em ave', () => {
    const aves = trocarEspecie(doisPrecos(), 'aves', null)
    assert.equal(aves.formula.porFase, undefined)
  })

  it('preço da ração comprada por fase é ponderado pelo volume', () => {
    const e = doisPrecos()
    e.atual = {
      ...e.atual, modo: 'compra', unidadePreco: 'kg', preco: 2,
      precoPorFase: { crescimento: 6, terminacao: 2 },
      perdasPct: 0,
      frete: { ativo: false, valor: 0 },
      descarga: { ativo: false, valor: 0 },
      outros: { ativo: false, valor: 0 },
    }
    // 0,75 × 6 + 0,25 × 2 = 5,00
    assert.equal(calcularEstudo(e).atual.precoBasePorKg, 5)
  })

  it('fase sem preço próprio cai no preço geral', () => {
    const e = doisPrecos()
    e.atual = {
      ...e.atual, modo: 'compra', unidadePreco: 'kg', preco: 2,
      precoPorFase: { crescimento: 6 },
      perdasPct: 0,
      frete: { ativo: false, valor: 0 },
      descarga: { ativo: false, valor: 0 },
      outros: { ativo: false, valor: 0 },
    }
    // 0,75 × 6 + 0,25 × 2 (geral) = 5,00
    assert.equal(calcularEstudo(e).atual.precoBasePorKg, 5)
  })

  it('sem preço por fase nada muda: continua o preço único', () => {
    const e = doisPrecos()
    e.atual = {
      ...e.atual, modo: 'compra', unidadePreco: 'kg', preco: 2, perdasPct: 0,
      frete: { ativo: false, valor: 0 },
      descarga: { ativo: false, valor: 0 },
      outros: { ativo: false, valor: 0 },
    }
    assert.equal(calcularEstudo(e).atual.precoBasePorKg, 2)
  })
})

describe('núcleo (agrupamento dos micro)', () => {
  const ing = (nome: string, participacao: number, extra: Partial<IngredienteFormula> = {}): IngredienteFormula => ({
    id: nome, nome, participacao, unidadeParticipacao: 'pct',
    preco: 1, unidadePreco: 'kg', pesoSacoIngrediente: 60, ...extra,
  })

  it('abaixo de 1% é núcleo; de 1% pra cima não é', () => {
    assert.equal(ehDoNucleo(ing('Sal', 0.4)), true)
    assert.equal(ehDoNucleo(ing('Calcário', 1.2)), false)
    assert.equal(ehDoNucleo(ing('Milho', 60)), false)
  })

  it('ingrediente zerado fica de fora (acabou de ser adicionado)', () => {
    assert.equal(ehDoNucleo(ing('Novo', 0)), false)
  })

  it('a marcação do vendedor manda sobre o corte de 1%', () => {
    assert.equal(ehDoNucleo(ing('Calcário', 1.2, { noNucleo: true })), true)
    assert.equal(ehDoNucleo(ing('Premix', 0.1, { noNucleo: false })), false)
  })

  it('a unidade digitada não muda a decisão (kg/t e g/t viram %)', () => {
    assert.equal(ehDoNucleo(ing('Premix', 5, { unidadeParticipacao: 'kg_t' })), true)   // 0,5%
    assert.equal(ehDoNucleo(ing('Milho', 600, { unidadeParticipacao: 'kg_t' })), false) // 60%
    assert.equal(ehDoNucleo(ing('Aditivo', 200, { unidadeParticipacao: 'g_t' })), true) // 0,02%
  })

  it('o resumo do PDF agrupa os micro em vez de abrir premix de 0,1%', () => {
    const calc = calcularFormula({
      formulaId: null, nome: '', milhoPreco: 0, milhoUnidadePreco: 'kg', milhoPesoSaca: 60,
      itens: [
        ing('Milho', 75), ing('Farelo de soja', 21.4), ing('Fosfato', 1.85),
        ing('Sal', 0.4), ing('Premix mineral', 0.25), ing('Premix vitamínico', 0.1),
      ],
    }, 'suinos')
    const t = resumirComposicao(calc.linhas)
    assert.ok(t.includes('Milho 75,0%'), t)
    assert.ok(t.includes('Núcleo 0,75%'), `micro não agrupados: ${t}`)
    assert.ok(t.includes('Premix vitamínico'), 'os nomes têm que continuar visíveis')
    assert.ok(!/Premix mineral 0,3%/.test(t), 'micro não pode ter linha própria')
  })
})
