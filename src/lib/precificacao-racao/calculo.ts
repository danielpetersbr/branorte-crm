/**
 * Motor de cálculo do módulo Venda de Ração.
 *
 * FUNÇÕES PURAS, sem React e sem Supabase — dá pra testar tudo com `npm test`.
 * O componente só monta o input e lê o resultado.
 *
 * Decisões que valem repetir:
 *
 * 1) MARGEM SOBRE O PREÇO DE VENDA é o padrão (não markup sobre o custo).
 *    preço = custo ÷ (1 − margem − impostos − comissão − taxas)
 *    Somar 20% ao custo NÃO dá 20% de margem: dá 16,7%. E se ainda saem
 *    imposto e comissão de cima do preço, o vendedor acha que ganhou 20% e
 *    ganhou 8%. Por isso o divisor.
 *
 * 2) Percentual entra como inteiro (20 = 20%) e vira decimal UMA vez, em `dec`.
 *
 * 3) Tudo em kg / R$ por kg. Saco e tonelada só na borda.
 *
 * 4) Nada de NaN/Infinity vazando: toda divisão passa por `dividir`, que
 *    devolve 0 quando o denominador é 0.
 */
import type {
  AjusteCenario, CenarioCalculado, ComparacaoMercado, Custos, CustosCalculados,
  DemandaCalculada, Especie, Formula, FormulaCalculada, GruposCusto,
  LinhaIngredienteCalculada, LinhaMemoria, PontoEquilibrio, PrecosCalculados,
  ProblemaValidacao, Quantidade, CondicoesVenda, ResultadoNegociado,
  ResultadoSimulacao, SimulacaoInput, UnidadePreco,
} from './tipos'

// ---------------------------------------------------------------------------
// Utilitários numéricos
// ---------------------------------------------------------------------------

/** Sanitiza: NaN/Infinity/null viram 0. */
export function n(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Divisão que nunca estoura: denominador 0 → 0. */
export function dividir(a: number, b: number): number {
  const bb = n(b)
  if (bb === 0) return 0
  const r = n(a) / bb
  return Number.isFinite(r) ? r : 0
}

/** 20 → 0,20. Também sanitiza. */
export function dec(percentual: unknown): number {
  return n(percentual) / 100
}

/** Só o valor quando o custo está ligado. */
function ligado(c: { ativo: boolean; valor: number } | undefined): number {
  if (!c || !c.ativo) return 0
  return Math.max(0, n(c.valor))
}

/** Mês comercial usado quando o consumo é por dia/ciclo. */
export const DIAS_MES = 30

// ---------------------------------------------------------------------------
// 1) Demanda
// ---------------------------------------------------------------------------

/** Converte preço de matéria-prima pra R$/kg. */
export function precoPorKg(preco: number, unidade: UnidadePreco, pesoSaco: number): number {
  const p = Math.max(0, n(preco))
  if (unidade === 'kg') return p
  if (unidade === 't') return dividir(p, 1000)
  return dividir(p, pesoSaco) // 'saco'
}

/** Converte quantidade informada pra kg. */
export function quantidadeParaKg(valor: number, unidade: Quantidade['unidadeQuantidade'], pesoSaco: number): number {
  const v = Math.max(0, n(valor))
  if (unidade === 'kg') return v
  if (unidade === 't') return v * 1000
  return v * Math.max(0, n(pesoSaco)) // 'sacos'
}

export function calcularDemanda(q: Quantidade): DemandaCalculada {
  const pesoSaco = Math.max(0, n(q.pesoSaco))
  const sobra = 1 + Math.max(0, dec(q.sobraPct))

  let pedidoKg = 0
  let mensalKg = 0

  if (q.modo === 'animais') {
    const animais = Math.max(0, n(q.numeroAnimais))
    const consumo = Math.max(0, n(q.consumoPorAnimal))
    const dias = Math.max(0, n(q.dias))

    if (q.baseConsumo === 'dia') {
      // Spec: demanda mensal = nº animais × consumo/dia × nº de dias.
      pedidoKg = animais * consumo * dias
      mensalKg = pedidoKg
    } else if (q.baseConsumo === 'mes') {
      pedidoKg = animais * consumo
      mensalKg = pedidoKg
    } else {
      // 'ciclo': o pedido é o ciclo inteiro. O equivalente mensal serve só pras
      // métricas "por mês" — se o ciclo não tem duração informada, assume 1 mês.
      pedidoKg = animais * consumo
      mensalKg = dias > 0 ? dividir(pedidoKg, dividir(dias, DIAS_MES)) : pedidoKg
    }
    pedidoKg *= sobra
    mensalKg *= sobra
  } else {
    pedidoKg = quantidadeParaKg(q.quantidadeInformada, q.unidadeQuantidade, pesoSaco) * sobra
    mensalKg = pedidoKg * Math.max(0, n(q.pedidosPorMes))
  }

  return {
    quantidadeKg: pedidoKg,
    quantidadeMensalKg: mensalKg,
    sacos: dividir(pedidoKg, pesoSaco),
    toneladas: dividir(pedidoKg, 1000),
    sacosMes: dividir(mensalKg, pesoSaco),
    toneladasMes: dividir(mensalKg, 1000),
  }
}

// ---------------------------------------------------------------------------
// 2) Fórmula
// ---------------------------------------------------------------------------

/** Participação do ingrediente convertida pra kg em 1 tonelada de ração. */
export function participacaoParaKgPorTonelada(
  valor: number, unidade: Formula['itens'][number]['unidadeParticipacao'],
): number {
  const v = Math.max(0, n(valor))
  if (unidade === 'pct') return (v / 100) * 1000
  if (unidade === 'kg_t') return v
  return dividir(v, 1000) // 'g_t'
}

/** Tolerância pra considerar a fórmula fechada em 1.000 kg/t. */
export const TOLERANCIA_FORMULA_KG = 0.5

export function calcularFormula(formula: Formula, especie: Especie): FormulaCalculada {
  // Milho triturado não tem composição: o custo é o preço do grão convertido.
  if (especie === 'milho') {
    const custoKg = precoPorKg(formula.milhoPreco, formula.milhoUnidadePreco, formula.milhoPesoSaca)
    return {
      linhas: [], totalKgPorTonelada: 1000, totalParticipacaoPct: 100,
      diferencaKgPorTonelada: 0, fechada: true,
      custoIngredientesPorKg: custoKg,
      custoIngredientesPorTonelada: custoKg * 1000,
    }
  }

  const linhas: LinhaIngredienteCalculada[] = formula.itens.map(it => {
    const kgPorTonelada = participacaoParaKgPorTonelada(it.participacao, it.unidadeParticipacao)
    const pKg = precoPorKg(it.preco, it.unidadePreco, it.pesoSacoIngrediente)
    const custoPorToneladaRacao = kgPorTonelada * pKg
    return {
      id: it.id,
      nome: it.nome,
      kgPorTonelada,
      participacaoPct: dividir(kgPorTonelada, 1000) * 100,
      precoPorKg: pKg,
      custoPorToneladaRacao,
      custoPorKgRacao: dividir(custoPorToneladaRacao, 1000),
    }
  })

  const totalKgPorTonelada = linhas.reduce((a, l) => a + l.kgPorTonelada, 0)
  const custoIngredientesPorTonelada = linhas.reduce((a, l) => a + l.custoPorToneladaRacao, 0)

  return {
    linhas,
    totalKgPorTonelada,
    totalParticipacaoPct: dividir(totalKgPorTonelada, 1000) * 100,
    diferencaKgPorTonelada: 1000 - totalKgPorTonelada,
    fechada: Math.abs(1000 - totalKgPorTonelada) <= TOLERANCIA_FORMULA_KG,
    custoIngredientesPorKg: dividir(custoIngredientesPorTonelada, 1000),
    custoIngredientesPorTonelada,
  }
}

// ---------------------------------------------------------------------------
// 3) Custos
// ---------------------------------------------------------------------------

export interface OpcoesCusto {
  /** Multiplicador da matéria-prima (cenários). 1 = sem ajuste. */
  fatorMateriaPrima?: number
  /** Multiplicador do frete (cenários). 1 = sem ajuste. */
  fatorFrete?: number
  /** Multiplicador da perda (cenários). 1 = sem ajuste. */
  fatorPerda?: number
}

export function calcularCustos(
  custoIngredientesPorKg: number,
  custos: Custos,
  quantidadeKg: number,
  pesoSaco: number,
  opcoes: OpcoesCusto = {},
): CustosCalculados {
  const fMp = opcoes.fatorMateriaPrima ?? 1
  const fFrete = opcoes.fatorFrete ?? 1
  const fPerda = opcoes.fatorPerda ?? 1

  const ingredientes = Math.max(0, n(custoIngredientesPorKg)) * fMp

  // Perda: pra ENTREGAR 1 kg com x% de perda é preciso PARTIR de 1/(1−x) kg.
  // Trava em 90% pra não explodir a conta com digitação absurda.
  const perda = Math.min(0.9, Math.max(0, dec(custos.perdaPct) * fPerda))
  const ingredientesAjustado = dividir(ingredientes, 1 - perda)

  const energia        = ligado(custos.energia)
  const maoDeObra      = ligado(custos.maoDeObra)
  const moagem         = ligado(custos.moagem)
  const mistura        = ligado(custos.mistura)
  const manutencao     = ligado(custos.manutencao)
  const depreciacao    = ligado(custos.depreciacao)
  const administrativo = ligado(custos.administrativo)
  const carregamento   = ligado(custos.carregamento)
  const outrosVar      = ligado(custos.outrosVariaveis)

  // Embalagem e etiqueta vêm por SACO → viram R$/kg dividindo pelo peso do saco.
  const porSaco = ligado(custos.embalagem) + ligado(custos.etiqueta)
  const embalagemPorKg = dividir(porSaco, pesoSaco)

  const freteBruto = ligado(custos.frete) * fFrete
  const fretePorKg = custos.freteModo === 'total'
    ? dividir(freteBruto, quantidadeKg)
    : freteBruto

  const fixosPedidoPorKg = dividir(ligado(custos.outrosFixosPedido), quantidadeKg)

  const grupos: GruposCusto = {
    materiaPrima: ingredientesAjustado,
    producao: energia + maoDeObra + moagem + mistura + manutencao + depreciacao + administrativo + outrosVar,
    embalagem: embalagemPorKg,
    logistica: fretePorKg + carregamento,
    fixos: fixosPedidoPorKg,
  }

  const custoBasePorKg =
    grupos.materiaPrima + grupos.producao + grupos.embalagem + grupos.logistica + grupos.fixos

  return {
    custoIngredientesPorKg: ingredientes,
    custoIngredientesAjustadoPorKg: ingredientesAjustado,
    perdaPorKg: ingredientesAjustado - ingredientes,
    energiaPorKg: energia,
    maoDeObraPorKg: maoDeObra,
    moagemPorKg: moagem,
    misturaPorKg: mistura,
    manutencaoPorKg: manutencao,
    depreciacaoPorKg: depreciacao,
    administrativoPorKg: administrativo,
    carregamentoPorKg: carregamento,
    outrosVariaveisPorKg: outrosVar,
    embalagemPorKg,
    fretePorKg,
    fixosPedidoPorKg,
    grupos,
    custoBasePorKg,
    custoVariavelPorKg: custoBasePorKg - fixosPedidoPorKg,
    custoPorSaco: custoBasePorKg * Math.max(0, n(pesoSaco)),
    custoPorTonelada: custoBasePorKg * 1000,
    custoTotalPedido: custoBasePorKg * Math.max(0, n(quantidadeKg)),
  }
}

// ---------------------------------------------------------------------------
// 4) Preço
// ---------------------------------------------------------------------------

/** Impostos + comissão + taxas, em decimal (o que sai de cima do PREÇO). */
export function cargaSemMargem(v: CondicoesVenda): number {
  return dec(v.impostosPct) + dec(v.comissaoPct) + dec(v.taxaFinanceiraPct) + dec(v.taxaCartaoPct)
}

/**
 * Preço que cobre custo + os percentuais que saem de cima da venda, deixando
 * `margem` de sobra. margem=0 devolve o preço de equilíbrio.
 *
 * Quando a soma dos percentuais chega em 100% não existe preço possível
 * (a conta divide por zero) — devolve 0 e a validação bloqueia antes.
 */
export function precoComMargem(custoBasePorKg: number, margemDecimal: number, cargaDecimal: number): number {
  const divisor = 1 - margemDecimal - cargaDecimal
  if (divisor <= 0) return 0
  return dividir(Math.max(0, n(custoBasePorKg)), divisor)
}

/** Markup puro sobre o custo — modo avançado, não cobre impostos/comissão. */
export function precoComMarkup(custoBasePorKg: number, markupDecimal: number): number {
  return Math.max(0, n(custoBasePorKg)) * (1 + Math.max(0, markupDecimal))
}

export function precificar(custoBasePorKg: number, v: CondicoesVenda): PrecosCalculados {
  const carga = cargaSemMargem(v)
  const mDes = Math.max(0, dec(v.margemDesejadaPct))
  const mMin = Math.max(0, dec(v.margemMinimaPct))

  let precoSugerido: number
  let precoMinimo: number
  if (v.modoPreco === 'markup') {
    precoSugerido = precoComMarkup(custoBasePorKg, mDes)
    precoMinimo = precoComMarkup(custoBasePorKg, mMin)
  } else {
    precoSugerido = precoComMargem(custoBasePorKg, mDes, carga)
    precoMinimo = precoComMargem(custoBasePorKg, mMin, carga)
  }

  const precoEquilibrio = precoComMargem(custoBasePorKg, 0, carga)
  const descontoReais = Math.max(0, precoSugerido - precoMinimo)

  return {
    cargaTotal: mDes + carga,
    cargaMinima: mMin + carga,
    cargaSemMargem: carga,
    precoEquilibrioPorKg: precoEquilibrio,
    precoMinimoPorKg: precoMinimo,
    precoSugeridoPorKg: precoSugerido,
    descontoMaximoReaisPorKg: descontoReais,
    descontoMaximoPct: dividir(descontoReais, precoSugerido) * 100,
  }
}

// ---------------------------------------------------------------------------
// 5) Resultado no preço negociado
// ---------------------------------------------------------------------------

export function calcularNegociado(
  precoPorKgNegociado: number,
  custos: CustosCalculados,
  precos: PrecosCalculados,
  v: CondicoesVenda,
  demanda: DemandaCalculada,
  pesoSaco: number,
): ResultadoNegociado {
  const preco = Math.max(0, n(precoPorKgNegociado))

  const impostos = preco * dec(v.impostosPct)
  const comissao = preco * dec(v.comissaoPct)
  const taxas = preco * (dec(v.taxaFinanceiraPct) + dec(v.taxaCartaoPct))
  const lucro = preco - custos.custoBasePorKg - impostos - comissao - taxas

  return {
    precoPorKg: preco,
    precoPorSaco: preco * Math.max(0, n(pesoSaco)),
    precoPorTonelada: preco * 1000,
    impostosPorKg: impostos,
    comissaoPorKg: comissao,
    taxasPorKg: taxas,
    lucroPorKg: lucro,
    lucroPorSaco: lucro * Math.max(0, n(pesoSaco)),
    lucroPorTonelada: lucro * 1000,
    margemRealPct: dividir(lucro, preco) * 100,
    abaixoDoMinimo: preco > 0 && preco < precos.precoMinimoPorKg - 1e-9,
    descontoAplicadoPct: dividir(precos.precoSugeridoPorKg - preco, precos.precoSugeridoPorKg) * 100,
    valorTotalPedido: preco * demanda.quantidadeKg,
    lucroTotalPedido: lucro * demanda.quantidadeKg,
    impostosTotalPedido: impostos * demanda.quantidadeKg,
    comissaoTotalPedido: comissao * demanda.quantidadeKg,
    receitaMensal: preco * demanda.quantidadeMensalKg,
    lucroMensal: lucro * demanda.quantidadeMensalKg,
  }
}

// ---------------------------------------------------------------------------
// 6) Comparação com o que o cliente paga hoje
// ---------------------------------------------------------------------------

export function compararMercado(
  precoNegociadoPorKg: number, v: CondicoesVenda, demanda: DemandaCalculada, pesoSaco: number,
): ComparacaoMercado {
  const atual = Math.max(0, n(v.precoAtualClientePorKg))
  if (atual <= 0) {
    return {
      informado: false, diferencaPorKg: 0, diferencaPorSaco: 0,
      diferencaMensal: 0, diferencaAnual: 0, diferencaPct: 0, maisBarato: false,
    }
  }
  const dif = n(precoNegociadoPorKg) - atual
  return {
    informado: true,
    diferencaPorKg: dif,
    diferencaPorSaco: dif * Math.max(0, n(pesoSaco)),
    diferencaMensal: dif * demanda.quantidadeMensalKg,
    diferencaAnual: dif * demanda.quantidadeMensalKg * 12,
    diferencaPct: dividir(dif, atual) * 100,
    maisBarato: dif < 0,
  }
}

// ---------------------------------------------------------------------------
// 7) Cenários
// ---------------------------------------------------------------------------

const ROTULOS_CENARIO: Record<CenarioCalculado['chave'], string> = {
  conservador: 'Conservador',
  provavel: 'Provável',
  otimista: 'Otimista',
}

function calcularCenario(
  chave: CenarioCalculado['chave'],
  ajuste: AjusteCenario,
  input: SimulacaoInput,
  custoIngredientesPorKg: number,
  demanda: DemandaCalculada,
): CenarioCalculado {
  const custos = calcularCustos(
    custoIngredientesPorKg, input.custos, demanda.quantidadeKg, input.quantidade.pesoSaco,
    {
      fatorMateriaPrima: 1 + dec(ajuste.materiaPrimaPct),
      fatorFrete: 1 + dec(ajuste.fretePct),
      fatorPerda: 1 + dec(ajuste.perdaPct),
    },
  )

  const margem = ajuste.margemPct != null ? ajuste.margemPct : input.venda.margemDesejadaPct
  const venda: CondicoesVenda = { ...input.venda, margemDesejadaPct: margem }
  const precos = precificar(custos.custoBasePorKg, venda)
  const negociado = calcularNegociado(
    precos.precoSugeridoPorKg, custos, precos, venda, demanda, input.quantidade.pesoSaco,
  )

  return {
    chave,
    rotulo: ROTULOS_CENARIO[chave],
    custoBasePorKg: custos.custoBasePorKg,
    precoPorKg: precos.precoSugeridoPorKg,
    margemPct: negociado.margemRealPct,
    lucroMensal: negociado.lucroMensal,
    descontoDisponivelPct: precos.descontoMaximoPct,
  }
}

// ---------------------------------------------------------------------------
// 8) Ponto de equilíbrio
// ---------------------------------------------------------------------------

export function calcularEquilibrio(
  precoNegociadoPorKg: number,
  custos: CustosCalculados,
  v: CondicoesVenda,
  custosFixosMensais: number,
  demanda: DemandaCalculada,
  pesoSaco: number,
): PontoEquilibrio {
  const fixos = Math.max(0, n(custosFixosMensais))
  const preco = Math.max(0, n(precoNegociadoPorKg))
  // Margem de contribuição = preço − custo VARIÁVEL − o que sai de cima da venda.
  const mc = preco - custos.custoVariavelPorKg - preco * cargaSemMargem(v)

  if (fixos <= 0 || mc <= 0) {
    return {
      aplicavel: false, margemContribuicaoPorKg: mc,
      kgPorMes: 0, sacosPorMes: 0, toneladasPorMes: 0, clientesDesseTamanho: 0,
    }
  }
  const kgMes = dividir(fixos, mc)
  return {
    aplicavel: true,
    margemContribuicaoPorKg: mc,
    kgPorMes: kgMes,
    sacosPorMes: dividir(kgMes, pesoSaco),
    toneladasPorMes: dividir(kgMes, 1000),
    // O -1e-9 evita o off-by-one do ponto flutuante: 24.000,000000000004 ÷ 12.000
    // dá 2,0000000000000004 e o Math.ceil cru devolveria 3 clientes em vez de 2.
    clientesDesseTamanho: demanda.quantidadeMensalKg > 0
      ? Math.max(1, Math.ceil(dividir(kgMes, demanda.quantidadeMensalKg) - 1e-9))
      : 0,
  }
}

// ---------------------------------------------------------------------------
// 9) Validação
// ---------------------------------------------------------------------------

export function validar(input: SimulacaoInput, demanda: DemandaCalculada, formula: FormulaCalculada): ProblemaValidacao[] {
  const p: ProblemaValidacao[] = []
  const v = input.venda
  const q = input.quantidade

  if (demanda.quantidadeKg <= 0) {
    p.push({ campo: 'quantidade', mensagem: 'Informe a quantidade — sem volume não dá pra precificar.', nivel: 'bloqueio' })
  }
  if (n(q.pesoSaco) <= 0) {
    p.push({ campo: 'pesoSaco', mensagem: 'O peso do saco tem que ser maior que zero.', nivel: 'bloqueio' })
  }
  if (n(q.numeroAnimais) < 0 || n(q.consumoPorAnimal) < 0 || n(q.quantidadeInformada) < 0) {
    p.push({ campo: 'quantidade', mensagem: 'Quantidade não pode ser negativa.', nivel: 'bloqueio' })
  }

  const percentuais: Array<[string, number, string]> = [
    ['impostosPct', n(v.impostosPct), 'Impostos'],
    ['comissaoPct', n(v.comissaoPct), 'Comissão'],
    ['taxaFinanceiraPct', n(v.taxaFinanceiraPct), 'Taxa financeira'],
    ['taxaCartaoPct', n(v.taxaCartaoPct), 'Taxa de cartão'],
    ['margemDesejadaPct', n(v.margemDesejadaPct), 'Margem desejada'],
    ['margemMinimaPct', n(v.margemMinimaPct), 'Margem mínima'],
    ['perdaPct', n(input.custos.perdaPct), 'Perda'],
    ['sobraPct', n(q.sobraPct), 'Sobra/segurança'],
  ]
  for (const [campo, valor, rotulo] of percentuais) {
    if (valor < 0) p.push({ campo, mensagem: `${rotulo} não pode ser negativa.`, nivel: 'bloqueio' })
    if (valor > 100) p.push({ campo, mensagem: `${rotulo} não pode passar de 100%.`, nivel: 'bloqueio' })
  }

  if (v.modoPreco === 'margem') {
    const soma = dec(v.margemDesejadaPct) + cargaSemMargem(v)
    if (soma >= 1) {
      p.push({
        campo: 'margemDesejadaPct',
        mensagem: 'Margem + impostos + comissão + taxas somam 100% ou mais — não existe preço que feche essa conta. Reduza algum percentual.',
        nivel: 'bloqueio',
      })
    }
    const somaMin = dec(v.margemMinimaPct) + cargaSemMargem(v)
    if (somaMin >= 1) {
      p.push({
        campo: 'margemMinimaPct',
        mensagem: 'Margem mínima + impostos + comissão + taxas somam 100% ou mais.',
        nivel: 'bloqueio',
      })
    }
  }

  if (n(v.margemMinimaPct) > n(v.margemDesejadaPct)) {
    p.push({
      campo: 'margemMinimaPct',
      mensagem: 'A margem mínima está acima da desejada — o desconto máximo fica negativo.',
      nivel: 'aviso',
    })
  }

  if (input.produto.especie !== 'milho') {
    if (formula.linhas.length === 0) {
      p.push({ campo: 'formula', mensagem: 'Monte a fórmula ou selecione uma cadastrada.', nivel: 'bloqueio' })
    } else if (!formula.fechada) {
      const d = formula.diferencaKgPorTonelada
      p.push({
        campo: 'formula',
        mensagem: d > 0
          ? `Faltam ${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg para completar uma tonelada.`
          : `A fórmula passou ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg de uma tonelada.`,
        nivel: 'bloqueio',
      })
    }
  } else if (formula.custoIngredientesPorKg <= 0) {
    p.push({ campo: 'milhoPreco', mensagem: 'Informe o preço do milho.', nivel: 'bloqueio' })
  }

  if (!input.identificacao.clienteNome.trim()) {
    p.push({ campo: 'clienteNome', mensagem: 'Informe o nome do cliente para salvar ou enviar a proposta.', nivel: 'aviso' })
  }

  return p
}

// ---------------------------------------------------------------------------
// 10) Orquestração
// ---------------------------------------------------------------------------

export function calcularSimulacao(input: SimulacaoInput): ResultadoSimulacao {
  const demanda = calcularDemanda(input.quantidade)
  const formula = calcularFormula(input.formula, input.produto.especie)
  const pesoSaco = input.quantidade.pesoSaco

  const custos = calcularCustos(
    formula.custoIngredientesPorKg, input.custos, demanda.quantidadeKg, pesoSaco,
  )
  const precos = precificar(custos.custoBasePorKg, input.venda)

  const precoNegociado = input.venda.precoNegociadoPorKg != null
    ? Math.max(0, n(input.venda.precoNegociadoPorKg))
    : precos.precoSugeridoPorKg

  const negociado = calcularNegociado(precoNegociado, custos, precos, input.venda, demanda, pesoSaco)
  const comparacao = compararMercado(precoNegociado, input.venda, demanda, pesoSaco)

  const cenarios: CenarioCalculado[] = [
    calcularCenario('conservador', {
      ...input.cenarios.conservador,
      margemPct: input.cenarios.conservador.margemPct ?? input.venda.margemMinimaPct,
    }, input, formula.custoIngredientesPorKg, demanda),
    calcularCenario('provavel', input.cenarios.provavel, input, formula.custoIngredientesPorKg, demanda),
    calcularCenario('otimista', input.cenarios.otimista, input, formula.custoIngredientesPorKg, demanda),
  ]

  const equilibrio = calcularEquilibrio(
    precoNegociado, custos, input.venda, input.custos.custosFixosMensais, demanda, pesoSaco,
  )

  const problemas = validar(input, demanda, formula)

  return {
    problemas,
    bloqueado: problemas.some(x => x.nivel === 'bloqueio'),
    demanda, formula, custos, precos, negociado, comparacao, cenarios, equilibrio,
    memoria: montarMemoria(custos, precos, negociado, input),
  }
}

/** Memória de cálculo — o caminho do custo até o preço, linha a linha. */
export function montarMemoria(
  custos: CustosCalculados, precos: PrecosCalculados,
  negociado: ResultadoNegociado, input: SimulacaoInput,
): LinhaMemoria[] {
  const l: LinhaMemoria[] = [
    { rotulo: 'Custo dos ingredientes', valor: custos.custoIngredientesPorKg, formato: 'moeda' },
    { rotulo: `Perdas (${input.custos.perdaPct}%)`, valor: custos.perdaPorKg, formato: 'moeda' },
    { rotulo: 'Custo industrial (energia, mão de obra, moagem, mistura…)', valor: custos.grupos.producao, formato: 'moeda' },
    { rotulo: 'Embalagem', valor: custos.embalagemPorKg, formato: 'moeda' },
    { rotulo: 'Logística (frete + carregamento)', valor: custos.grupos.logistica, formato: 'moeda' },
    { rotulo: 'Custos fixos rateados no pedido', valor: custos.fixosPedidoPorKg, formato: 'moeda' },
    { rotulo: 'Custo total por kg', valor: custos.custoBasePorKg, formato: 'moeda', destaque: true },
    { rotulo: `Impostos (${input.venda.impostosPct}%)`, valor: negociado.impostosPorKg, formato: 'moeda' },
    { rotulo: `Comissão (${input.venda.comissaoPct}%)`, valor: negociado.comissaoPorKg, formato: 'moeda' },
    {
      rotulo: `Taxas (${n(input.venda.taxaFinanceiraPct) + n(input.venda.taxaCartaoPct)}%)`,
      valor: negociado.taxasPorKg, formato: 'moeda',
    },
    { rotulo: 'Margem (o que sobra)', valor: negociado.lucroPorKg, formato: 'moeda' },
    { rotulo: 'Preço final por kg', valor: negociado.precoPorKg, formato: 'moeda', destaque: true },
  ]
  if (input.venda.modoPreco === 'markup') {
    l.splice(7, 0, {
      rotulo: 'Modo markup: preço = custo × (1 + markup)',
      valor: precos.precoSugeridoPorKg, formato: 'moeda',
      nota: 'No markup o percentual é somado ao custo — impostos e comissão saem depois, então a margem real fica abaixo do markup.',
    })
  }
  return l
}

// ---------------------------------------------------------------------------
// 11) Lucro por volume (gráfico)
// ---------------------------------------------------------------------------

export function lucroPorVolume(
  lucroPorKg: number, toneladas: number[],
): Array<{ toneladas: number; kg: number; lucro: number }> {
  return toneladas.map(t => ({
    toneladas: t,
    kg: t * 1000,
    lucro: n(lucroPorKg) * t * 1000,
  }))
}
