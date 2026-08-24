/**
 * Motor de cálculo do Estudo de Viabilidade da Produção Própria.
 *
 * FUNÇÕES PURAS, sem React e sem Supabase — dá pra testar tudo com `npm test`.
 * O componente só monta o input e lê o resultado. É a ÚNICA fonte de verdade de
 * consumo, economia, dimensionamento, investimento e payback do CRM.
 *
 * Decisões que valem repetir:
 *
 * 1) A conta central é uma SUBTRAÇÃO, não uma precificação:
 *      economia/kg = custo de comprar pronta − custo de produzir na propriedade
 *    Não existe margem, markup, imposto sobre venda nem comissão aqui — a
 *    Branorte não vende ração, vende a fábrica.
 *
 * 2) Percentual entra como inteiro (20 = 20%) e vira decimal UMA vez, em `dec`.
 *
 * 3) Tudo em kg / R$ por kg. Saco e tonelada só na borda. Arredondamento SÓ na
 *    exibição (formato.ts) — aqui a precisão é cheia.
 *
 * 4) Nada de NaN/Infinity vazando: toda divisão passa por `dividir`, que
 *    devolve 0 quando o denominador é 0.
 *
 * 5) Economia negativa NÃO é escondida: o resultado sai com `vantajoso: false`
 *    e o payback fica `aplicavel: false` em vez de virar um número absurdo.
 */
import { fasesDoProduto, formulaPadrao, nomeCategoria } from './catalogo'
import type {
  AjusteCenario, CenarioAtual, CenarioCalculado, ComparacaoEconomia,
  CustoAtualCalculado, CustosProducao, CustosProducaoCalculados, DemandaCalculada,
  Dimensionamento, DimensionamentoCalculado, EquipamentoSugerido, Especie,
  EstudoInput, Formula, FormulaCalculada, FormulaDeFase, GruposCusto,
  IngredienteFormula, Investimento, LinhaIngredienteCalculada, LinhaMemoria,
  Necessidade, ProblemaValidacao, ResultadoEstudo, RetornoCalculado, UnidadePreco,
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

/** Multiplicador de cenário: -10 → 0,90. Nunca negativo. */
function fator(percentual: number): number {
  return Math.max(0, 1 + dec(percentual))
}

/** Mês comercial. */
export const DIAS_MES = 30
/** Semanas num mês comercial (30 ÷ 7). */
export const SEMANAS_MES = 30 / 7

// ---------------------------------------------------------------------------
// 1) Demanda
// ---------------------------------------------------------------------------

/** Converte preço de matéria-prima (ou ração pronta) pra R$/kg. */
export function precoPorKg(preco: number, unidade: UnidadePreco, pesoSaco: number): number {
  const p = Math.max(0, n(preco))
  if (unidade === 'kg') return p
  if (unidade === 't') return dividir(p, 1000)
  return dividir(p, pesoSaco) // 'saco'
}

/** Converte quantidade informada pra kg. */
export function quantidadeParaKg(
  valor: number, unidade: Necessidade['unidadeQuantidade'], pesoSaco: number,
): number {
  const v = Math.max(0, n(valor))
  if (unidade === 'kg') return v
  if (unidade === 't') return v * 1000
  return v * Math.max(0, n(pesoSaco)) // 'sacos'
}

export interface OpcoesDemanda {
  /** Multiplicador do consumo (cenários). 1 = sem ajuste. */
  fatorConsumo?: number
}

/**
 * As linhas de plantel que valem pra este estudo.
 *
 * Com mais de uma fase marcada são as linhas de `fases`; senão é uma linha só,
 * montada dos campos de sempre. Assim a conta é a MESMA nos dois casos e não
 * existe caminho paralelo pra divergir.
 */
export function plantelPorFase(q: Necessidade): Array<{ numeroAnimais: number; consumoPorAnimal: number }> {
  if (q.fases && q.fases.length > 1) return q.fases
  return [{ numeroAnimais: q.numeroAnimais, consumoPorAnimal: q.consumoPorAnimal }]
}

/** Total de animais do estudo, somando as fases quando há mais de uma. */
export function totalAnimais(q: Necessidade): number {
  if (q.modo !== 'animais') return 0
  return plantelPorFase(q).reduce((s, l) => s + Math.max(0, n(l.numeroAnimais)), 0)
}

/**
 * Quanto cada fase pesa no volume mensal (0 a 1, somando 1).
 *
 * Não precisa converter dia/mês/ciclo nem aplicar margem: essas contas são o
 * MESMO multiplicador pra todas as linhas e se cancelam na razão. Basta o bruto
 * `animais × consumo` de cada fase.
 *
 * Fase única, quantidade direta, ou plantel todo zerado devolvem a fase
 * principal com peso 1 — o estudo nunca fica sem base de rateio.
 */
export function pesosPorFase(q: Necessidade, principal: string): Array<{ categoria: string; peso: number }> {
  if (q.modo !== 'animais' || !q.fases || q.fases.length <= 1) {
    return [{ categoria: principal, peso: 1 }]
  }
  const brutos = q.fases.map(f => ({
    categoria: f.categoria,
    bruto: Math.max(0, n(f.numeroAnimais)) * Math.max(0, n(f.consumoPorAnimal)),
  }))
  const total = brutos.reduce((s, b) => s + b.bruto, 0)
  if (total <= 0) {
    // Ainda não digitou plantel nenhum: divide igual, senão o custo do estudo
    // sairia do nada (ou de uma fase só) enquanto ele preenche.
    return brutos.map(b => ({ categoria: b.categoria, peso: dividir(1, brutos.length) }))
  }
  return brutos.map(b => ({ categoria: b.categoria, peso: dividir(b.bruto, total) }))
}

export function calcularDemanda(q: Necessidade, opcoes: OpcoesDemanda = {}): DemandaCalculada {
  const pesoSaco = Math.max(0, n(q.pesoSaco))
  const folga = 1 + Math.max(0, dec(q.margemSegurancaPct))
  const fConsumo = opcoes.fatorConsumo ?? 1

  let mensalKg = 0

  if (q.modo === 'animais') {
    const dias = Math.max(0, n(q.dias))
    // Ciclo completo: cada fase tem plantel e consumo próprios e o bruto é a
    // SOMA delas. Matriz não come como terminação — média de fase seria número
    // torto. Uma fase só continua exatamente no caminho de antes.
    const bruto = plantelPorFase(q)
      .reduce((s, l) => s + Math.max(0, n(l.numeroAnimais)) * Math.max(0, n(l.consumoPorAnimal)), 0)

    if (q.baseConsumo === 'mes') {
      mensalKg = bruto
    } else if (q.baseConsumo === 'dia') {
      // consumo/dia × nº de dias considerados no mês
      mensalKg = bruto * (dias > 0 ? dias : DIAS_MES)
    } else {
      // 'ciclo': o total do ciclo diluído na duração dele.
      mensalKg = dias > 0 ? dividir(bruto, dividir(dias, DIAS_MES)) : bruto
    }
  } else {
    const kgInformado = quantidadeParaKg(q.quantidadeInformada, q.unidadeQuantidade, pesoSaco)
    if (q.periodoQuantidade === 'dia') mensalKg = kgInformado * DIAS_MES
    else if (q.periodoQuantidade === 'ano') mensalKg = dividir(kgInformado, 12)
    else mensalKg = kgInformado
  }

  mensalKg = mensalKg * folga * fConsumo

  return {
    diariaKg: dividir(mensalKg, DIAS_MES),
    mensalKg,
    anualKg: mensalKg * 12,
    toneladasMes: dividir(mensalKg, 1000),
    toneladasAno: dividir(mensalKg * 12, 1000),
    sacosMes: dividir(mensalKg, pesoSaco),
  }
}

// ---------------------------------------------------------------------------
// 2) Fórmula
// ---------------------------------------------------------------------------

/**
 * Abaixo disto o ingrediente é micro — sal, adsorvente, aminoácido, premix. É o
 * que o produtor chama de "núcleo": entra em grama por tonelada e não é ele que
 * o vendedor discute com o cliente.
 */
export const LIMITE_NUCLEO_PCT = 1

/** Participação em % da fórmula, seja qual for a unidade digitada no card. */
export function participacaoPct(i: IngredienteFormula): number {
  return dividir(participacaoParaKgPorTonelada(i.participacao, i.unidadeParticipacao), 10)
}

/**
 * Este ingrediente entra no grupo "Núcleo"?
 *
 * A marcação manual do vendedor MANDA — cada fórmula é uma fórmula, e não existe
 * corte percentual que acerte em todas. Sem marcação vale o automático: abaixo
 * de 1% e acima de zero (zerado é ingrediente recém-adicionado, que não pode
 * sumir dentro de um grupo fechado).
 *
 * Uma regra só, usada pela tela do vendedor E pelo PDF do cliente — senão as
 * duas contam o núcleo de jeitos diferentes.
 */
export function ehDoNucleo(i: IngredienteFormula): boolean {
  if (i.noNucleo === true) return true
  if (i.noNucleo === false) return false
  const p = participacaoPct(i)
  return p > 0 && p < LIMITE_NUCLEO_PCT
}

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
      noNucleo: ehDoNucleo(it),
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

/**
 * Os itens da fórmula de uma fase.
 *
 * Fase única: é `formula.itens`, como sempre foi. Multi-fase: é `porFase`, e
 * quem ainda não foi tocada cai na referência do catálogo — que já fecha 100%,
 * então nenhuma fase nasce "aberta" travando o estudo.
 */
export function itensDaFase(formula: Formula, especie: Especie, categoria: string, multi: boolean): IngredienteFormula[] {
  if (!multi) return formula.itens
  return formula.porFase?.[categoria] ?? formulaPadrao(especie, categoria)
}

/**
 * Uma FormulaCalculada por fase, com o peso de cada uma, mais a média ponderada
 * do custo dos ingredientes — que é o número que a produção própria usa.
 */
export function calcularFormulasPorFase(
  input: EstudoInput,
): { fases: FormulaDeFase[]; custoPonderadoPorKg: number; fechadas: boolean } {
  const { produto, formula } = input
  const fases = fasesDoProduto(produto)
  const multi = fases.length > 1
  const pesos = pesosPorFase(input.necessidade, produto.categoria)

  const lista: FormulaDeFase[] = fases.map(categoria => ({
    categoria,
    peso: pesos.find(p => p.categoria === categoria)?.peso ?? 0,
    calc: calcularFormula(
      { ...formula, itens: itensDaFase(formula, produto.especie, categoria, multi) },
      produto.especie,
    ),
  }))

  return {
    fases: lista,
    custoPonderadoPorKg: lista.reduce((s, f) => s + f.peso * f.calc.custoIngredientesPorKg, 0),
    fechadas: lista.every(f => f.calc.fechada),
  }
}

// ---------------------------------------------------------------------------
// 3) Cenário atual — quanto ele gasta HOJE
// ---------------------------------------------------------------------------

export interface OpcoesCustoAtual {
  /** Multiplicador do preço da ração comprada (cenários). */
  fatorRacaoComprada?: number
  /**
   * Fatia do volume de cada fase. Quando o cliente informa preço por fase, o
   * preço base do estudo é a média ponderada por isto. Ausente = preço único.
   */
  pesos?: Array<{ categoria: string; peso: number }>
}

/**
 * Preço da ração comprada em R$/kg, já ponderado pelas fases quando o vendedor
 * informou preço por fase. Sem pesos ou sem preço por fase é o preço único de
 * sempre — o caminho antigo não muda em nada.
 */
export function precoBasePonderado(
  atual: CenarioAtual, pesos?: Array<{ categoria: string; peso: number }>,
): number {
  const geral = precoPorKg(atual.preco, atual.unidadePreco, atual.pesoSacoCompra)
  const porFase = atual.precoPorFase
  if (!pesos || pesos.length <= 1 || !porFase) return geral

  return pesos.reduce((soma, p) => {
    const informado = Math.max(0, n(porFase[p.categoria]))
    const preco = informado > 0
      ? precoPorKg(informado, atual.unidadePreco, atual.pesoSacoCompra)
      : geral
    return soma + p.peso * preco
  }, 0)
}

export function calcularCustoAtual(
  atual: CenarioAtual, demanda: DemandaCalculada, opcoes: OpcoesCustoAtual = {},
): CustoAtualCalculado {
  const f = opcoes.fatorRacaoComprada ?? 1

  // Já produz de outro jeito: o vendedor informa o custo apurado da operação.
  if (atual.modo === 'proprio') {
    const manual = Math.max(0, n(atual.custoManualPorKg)) * f
    return {
      informado: manual > 0,
      precoBasePorKg: manual,
      fretePorKg: 0, descargaPorKg: 0, outrosPorKg: 0, perdasPorKg: 0,
      custoPorKg: manual,
      custoPorTonelada: manual * 1000,
      custoMensal: manual * demanda.mensalKg,
      custoAnual: manual * demanda.anualKg,
    }
  }

  // Preço por fase quando informado: o produtor não paga o preço da pré-inicial
  // na ração de terminação. Fase sem preço próprio usa o preço geral.
  const base = precoBasePonderado(atual, opcoes.pesos) * f
  const frete = ligado(atual.frete)
  const descarga = ligado(atual.descarga)
  const outros = ligado(atual.outros)
  const soma = base + frete + descarga + outros

  // Perda de armazenagem/manuseio: pra APROVEITAR 1 kg com x% de perda ele
  // precisa COMPRAR 1/(1−x) kg. Trava em 90% pra digitação absurda não explodir.
  const perdas = Math.min(0.9, Math.max(0, dec(atual.perdasPct)))
  const custoPorKg = dividir(soma, 1 - perdas)

  return {
    informado: custoPorKg > 0,
    precoBasePorKg: base,
    fretePorKg: frete,
    descargaPorKg: descarga,
    outrosPorKg: outros,
    perdasPorKg: custoPorKg - soma,
    custoPorKg,
    custoPorTonelada: custoPorKg * 1000,
    custoMensal: custoPorKg * demanda.mensalKg,
    custoAnual: custoPorKg * demanda.anualKg,
  }
}

// ---------------------------------------------------------------------------
// 4) Custo de produzir na propriedade
// ---------------------------------------------------------------------------

export interface OpcoesCustoProducao {
  /** Multiplicador do preço dos ingredientes (cenários). */
  fatorIngredientes?: number
  /** Multiplicador da perda de produção (cenários). */
  fatorPerda?: number
  /** Multiplicador dos custos operacionais (cenários). */
  fatorOperacionais?: number
}

export function calcularCustosProducao(
  custoIngredientesPorKg: number,
  custos: CustosProducao,
  mensalKg: number,
  pesoSaco: number,
  opcoes: OpcoesCustoProducao = {},
): CustosProducaoCalculados {
  const fIng = opcoes.fatorIngredientes ?? 1
  const fPerda = opcoes.fatorPerda ?? 1
  const fOp = opcoes.fatorOperacionais ?? 1

  const ingredientes = Math.max(0, n(custoIngredientesPorKg)) * fIng

  // Perda: pra ENTREGAR 1 kg com x% de perda é preciso PARTIR de 1/(1−x) kg.
  const perda = Math.min(0.9, Math.max(0, dec(custos.perdaPct) * fPerda))
  const ingredientesAjustado = dividir(ingredientes, 1 - perda)

  const energia        = ligado(custos.energia) * fOp
  const maoDeObra      = ligado(custos.maoDeObra) * fOp
  const moagem         = ligado(custos.moagem) * fOp
  const mistura        = ligado(custos.mistura) * fOp
  const manutencao     = ligado(custos.manutencao) * fOp
  const depreciacao    = ligado(custos.depreciacao) * fOp
  const administrativo = ligado(custos.administrativo) * fOp
  const carregamento   = ligado(custos.carregamento) * fOp
  const outrosVar      = ligado(custos.outrosVariaveis) * fOp

  // Embalagem e etiqueta vêm por SACO → viram R$/kg dividindo pelo peso do saco.
  const porSaco = (ligado(custos.embalagem) + ligado(custos.etiqueta)) * fOp
  const embalagemPorKg = dividir(porSaco, pesoSaco)

  // Custo fixo mensal diluído no volume REAL do mês (nunca na capacidade nominal).
  const fixosPorKg = dividir(ligado(custos.custosFixosMensais) * fOp, mensalKg)

  const producao = energia + maoDeObra + moagem + mistura + manutencao
    + depreciacao + administrativo + carregamento + outrosVar

  const grupos: GruposCusto = {
    materiaPrima: ingredientesAjustado,
    producao,
    embalagem: embalagemPorKg,
    fixos: fixosPorKg,
  }

  const custoTotalPorKg = grupos.materiaPrima + grupos.producao + grupos.embalagem + grupos.fixos

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
    fixosPorKg,
    operacionaisPorKg: producao + embalagemPorKg + fixosPorKg,
    grupos,
    custoTotalPorKg,
    custoPorTonelada: custoTotalPorKg * 1000,
    custoMensal: custoTotalPorKg * Math.max(0, n(mensalKg)),
    custoAnual: custoTotalPorKg * Math.max(0, n(mensalKg)) * 12,
  }
}

// ---------------------------------------------------------------------------
// 5) Comparação — a conta que interessa
// ---------------------------------------------------------------------------

export function compararEconomia(
  custoAtualPorKg: number,
  custoProprioPorKg: number,
  demanda: DemandaCalculada,
  numeroAnimais = 0,
): ComparacaoEconomia {
  const atual = n(custoAtualPorKg)
  const proprio = n(custoProprioPorKg)
  const economiaPorKg = atual - proprio
  const economiaMensal = economiaPorKg * demanda.mensalKg

  return {
    economiaPorKg,
    economiaPorTonelada: economiaPorKg * 1000,
    economiaMensal,
    economiaAnual: economiaMensal * 12,
    reducaoPct: dividir(economiaPorKg, atual) * 100,
    vantajoso: economiaPorKg > 0,
    economiaPorAnimalMes: dividir(economiaMensal, numeroAnimais),
  }
}

// ---------------------------------------------------------------------------
// 6) Dimensionamento
// ---------------------------------------------------------------------------

export function rotuloCapacidade(kgHora: number): string {
  return `${n(kgHora).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg/h`
}

/**
 * Escolhe a menor capacidade da linha que atende a recomendada. Quando nem a
 * maior atende, devolve a maior com `acimaDaLinha` — a decisão de somar linhas
 * ou subir de porte é comercial, não do software.
 */
export function sugerirEquipamento(
  capacidadeRecomendada: number,
  capacidades: number[],
  producaoPorDiaKg: number,
  horasDisponiveisPorDia: number,
): EquipamentoSugerido | null {
  const lista = [...capacidades].map(n).filter(c => c > 0).sort((a, b) => a - b)
  if (lista.length === 0) return null

  const escolhida = lista.find(c => c >= capacidadeRecomendada) ?? lista[lista.length - 1]
  const horas = dividir(producaoPorDiaKg, escolhida)

  return {
    capacidade: escolhida,
    rotulo: rotuloCapacidade(escolhida),
    horasPorDia: horas,
    utilizacaoPct: dividir(horas, horasDisponiveisPorDia) * 100,
    acimaDaLinha: capacidadeRecomendada > lista[lista.length - 1],
  }
}

function rotinaSugerida(d: Dimensionamento, horasPorVez: number): string {
  const dias = Math.max(0, n(d.diasPorMes))
  if (dias <= 0) return ''
  const porSemana = dividir(dias, SEMANAS_MES)
  const horas = horasPorVez > 0
    ? `, cerca de ${horasPorVez.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h por vez`
    : ''
  if (porSemana >= 6) return `Produção praticamente diária (${Math.round(dias)} dias no mês)${horas}.`
  if (porSemana >= 1) {
    return `Cerca de ${porSemana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× por semana `
      + `(${Math.round(dias)} dias no mês)${horas}.`
  }
  return `${Math.round(dias)} dia(s) de produção por mês${horas}.`
}

export function calcularDimensionamento(
  d: Dimensionamento, demanda: DemandaCalculada, capacidades: number[],
): DimensionamentoCalculado {
  const dias = Math.max(0, n(d.diasPorMes))
  const horas = Math.max(0, n(d.horasPorDia))
  const vazio: DimensionamentoCalculado = {
    aplicavel: false, producaoPorDiaKg: 0, kgPorLote: 0,
    capacidadeMinimaKgHora: 0, capacidadeRecomendadaKgHora: 0,
    sugerido: null, rotinaSugerida: '',
  }
  if (dias <= 0 || horas <= 0 || demanda.mensalKg <= 0) return vazio

  const producaoPorDiaKg = dividir(demanda.mensalKg, dias)
  const capacidadeMinimaKgHora = dividir(producaoPorDiaKg, horas)
  const capacidadeRecomendadaKgHora = capacidadeMinimaKgHora * (1 + Math.max(0, dec(d.margemOperacionalPct)))
  const sugerido = sugerirEquipamento(capacidadeRecomendadaKgHora, capacidades, producaoPorDiaKg, horas)
  const lotes = Math.max(0, n(d.lotesPorDia))

  return {
    aplicavel: true,
    producaoPorDiaKg,
    kgPorLote: lotes > 0 ? dividir(producaoPorDiaKg, lotes) : 0,
    capacidadeMinimaKgHora,
    capacidadeRecomendadaKgHora,
    sugerido,
    rotinaSugerida: rotinaSugerida(d, sugerido?.horasPorDia ?? 0),
  }
}

// ---------------------------------------------------------------------------
// 7) Investimento e retorno
// ---------------------------------------------------------------------------

export function somarInvestimento(i: Investimento): number {
  return Math.max(0, n(i.equipamentos))
    + Math.max(0, n(i.frete))
    + Math.max(0, n(i.montagem))
    + Math.max(0, n(i.instalacaoEletrica))
    + Math.max(0, n(i.obraCivil))
    + Math.max(0, n(i.outros))
}

export const ANOS_PROJECAO = [1, 2, 3, 4, 5]

export function calcularRetorno(
  investimento: Investimento,
  economiaMensal: number,
  economiaAnual: number,
  fatorInvestimento = 1,
): RetornoCalculado {
  const investimentoTotal = somarInvestimento(investimento) * Math.max(0, fatorInvestimento)
  const custoFinanceiro = investimento.modoFinanciamento === 'informado'
    ? Math.max(0, n(investimento.custoFinanceiroInformado))
    : 0
  const investimentoConsiderado = investimentoTotal + custoFinanceiro

  const mensal = n(economiaMensal)
  // Sem economia não existe payback — devolver um número aqui seria mentira.
  const aplicavel = mensal > 0 && investimentoConsiderado > 0
  const paybackMeses = aplicavel ? dividir(investimentoConsiderado, mensal) : 0

  return {
    investimentoTotal,
    custoFinanceiro,
    investimentoConsiderado,
    aplicavel,
    paybackMeses,
    paybackAnos: aplicavel ? dividir(paybackMeses, 12) : 0,
    acumulado: ANOS_PROJECAO.map(ano => {
      const economia = n(economiaAnual) * ano
      return { ano, economia, liquido: economia - investimentoConsiderado }
    }),
  }
}

// ---------------------------------------------------------------------------
// 8) Cenários
// ---------------------------------------------------------------------------

const ROTULOS_CENARIO: Record<CenarioCalculado['chave'], string> = {
  conservador: 'Conservador',
  provavel: 'Provável',
  otimista: 'Otimista',
}

export function calcularCenario(
  chave: CenarioCalculado['chave'], ajuste: AjusteCenario, input: EstudoInput,
): CenarioCalculado {
  const demanda = calcularDemanda(input.necessidade, { fatorConsumo: fator(ajuste.consumoPct) })
  const porFase = calcularFormulasPorFase(input)

  const producao = calcularCustosProducao(
    porFase.custoPonderadoPorKg, input.custos, demanda.mensalKg, input.necessidade.pesoSaco,
    {
      fatorIngredientes: fator(ajuste.ingredientesPct),
      fatorPerda: fator(ajuste.perdaPct),
      fatorOperacionais: fator(ajuste.operacionaisPct),
    },
  )
  const atual = calcularCustoAtual(input.atual, demanda, {
    fatorRacaoComprada: fator(ajuste.racaoCompradaPct),
    pesos: pesosPorFase(input.necessidade, input.produto.categoria),
  })
  const comparacao = compararEconomia(atual.custoPorKg, producao.custoTotalPorKg, demanda)
  const retorno = calcularRetorno(
    input.investimento, comparacao.economiaMensal, comparacao.economiaAnual,
    fator(ajuste.investimentoPct),
  )

  return {
    chave,
    rotulo: ROTULOS_CENARIO[chave],
    custoProprioPorKg: producao.custoTotalPorKg,
    custoAtualPorKg: atual.custoPorKg,
    economiaPorKg: comparacao.economiaPorKg,
    economiaMensal: comparacao.economiaMensal,
    economiaAnual: comparacao.economiaAnual,
    paybackMeses: retorno.paybackMeses,
    paybackAplicavel: retorno.aplicavel,
  }
}

// ---------------------------------------------------------------------------
// 9) Validação
// ---------------------------------------------------------------------------

export const MSG_FORMULA_ABERTA =
  'A fórmula ainda não totaliza 100%. Revise as participações antes de concluir o estudo.'

export function validar(
  input: EstudoInput,
  demanda: DemandaCalculada,
  /** As fórmulas do estudo — uma por fase. Aceita a de sempre pra não quebrar
      quem chama com uma FormulaCalculada solta. */
  formulas: FormulaCalculada | { fases: FormulaDeFase[] },
  atual: CustoAtualCalculado,
): ProblemaValidacao[] {
  const p: ProblemaValidacao[] = []
  const q = input.necessidade
  const porFase = 'fases' in formulas
    ? formulas
    : { fases: [{ categoria: input.produto.categoria, peso: 1, calc: formulas }] }
  const formula = porFase.fases[0]?.calc ?? formulas as FormulaCalculada

  if (demanda.mensalKg <= 0) {
    p.push({
      campo: 'necessidade',
      mensagem: 'Informe a necessidade de produção — sem volume não dá pra calcular economia.',
      nivel: 'bloqueio',
    })
  }
  const negativoNoPlantel = plantelPorFase(q)
    .some(l => n(l.numeroAnimais) < 0 || n(l.consumoPorAnimal) < 0)
  if (negativoNoPlantel || n(q.quantidadeInformada) < 0) {
    p.push({ campo: 'necessidade', mensagem: 'Quantidade não pode ser negativa.', nivel: 'bloqueio' })
  }
  if (n(q.pesoSaco) <= 0 && (q.unidadeQuantidade === 'sacos' || input.atual.unidadePreco === 'saco')) {
    p.push({ campo: 'pesoSaco', mensagem: 'O peso do saco tem que ser maior que zero.', nivel: 'bloqueio' })
  }

  const percentuais: Array<[string, number, string]> = [
    ['perdaPct', n(input.custos.perdaPct), 'Perda de produção'],
    ['margemSegurancaPct', n(q.margemSegurancaPct), 'Margem de segurança'],
    ['perdasAtuaisPct', n(input.atual.perdasPct), 'Perdas na ração comprada'],
    ['margemOperacionalPct', n(input.dimensionamento.margemOperacionalPct), 'Margem operacional'],
  ]
  for (const [campo, valor, rotulo] of percentuais) {
    if (valor < 0) p.push({ campo, mensagem: `${rotulo} não pode ser negativa.`, nivel: 'bloqueio' })
    if (valor > 100) p.push({ campo, mensagem: `${rotulo} não pode passar de 100%.`, nivel: 'bloqueio' })
  }

  if (input.produto.especie !== 'milho') {
    const vazias = porFase.fases.filter(f => f.calc.linhas.length === 0)
    const abertas = porFase.fases.filter(f => f.calc.linhas.length > 0 && !f.calc.fechada)

    if (vazias.length > 0) {
      p.push({ campo: 'formula', mensagem: 'Monte a fórmula ou selecione uma cadastrada.', nivel: 'bloqueio' })
    }
    // Nome da fase junto: com ciclo completo, "a fórmula não fecha" sem dizer
    // QUAL fase manda o vendedor caçar o erro em seis abas.
    for (const f of abertas) {
      const d = f.calc.diferencaKgPorTonelada
      const qual = porFase.fases.length > 1
        ? ` (${nomeCategoria(input.produto.especie, f.categoria, input.produto.categoriaLivre)})`
        : ''
      const detalhe = d > 0
        ? ` Faltam ${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg para completar uma tonelada${qual}.`
        : ` A fórmula passou ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg de uma tonelada${qual}.`
      p.push({ campo: 'formula', mensagem: MSG_FORMULA_ABERTA + detalhe, nivel: 'bloqueio' })
    }
  } else if (formula.custoIngredientesPorKg <= 0) {
    p.push({ campo: 'milhoPreco', mensagem: 'Informe o preço do milho.', nivel: 'bloqueio' })
  }

  if (!atual.informado) {
    p.push({
      campo: 'atual',
      mensagem: input.atual.modo === 'proprio'
        ? 'Informe o custo atual da operação do cliente — sem ele não há com o que comparar.'
        : 'Informe quanto o cliente paga hoje pela ração pronta — sem isso não há comparação.',
      nivel: 'bloqueio',
    })
  }

  if (q.modo === 'animais' && !q.consumoConfirmado) {
    p.push({
      campo: 'consumoPorAnimal',
      mensagem: 'O consumo por animal ainda está no valor de referência do catálogo. '
        + 'Confirme com o cliente antes de apresentar o estudo.',
      nivel: 'aviso',
    })
  }

  const dim = input.dimensionamento
  if (n(dim.diasPorMes) <= 0 || n(dim.horasPorDia) <= 0) {
    p.push({
      campo: 'dimensionamento',
      mensagem: 'Informe dias por mês e horas por dia para dimensionar a capacidade.',
      nivel: 'aviso',
    })
  }
  if (n(dim.diasPorMes) > 31) {
    p.push({ campo: 'diasPorMes', mensagem: 'Um mês não tem mais de 31 dias.', nivel: 'bloqueio' })
  }
  if (n(dim.horasPorDia) > 24) {
    p.push({ campo: 'horasPorDia', mensagem: 'Um dia não tem mais de 24 horas.', nivel: 'bloqueio' })
  }

  if (!input.identificacao.clienteNome.trim()) {
    p.push({ campo: 'clienteNome', mensagem: 'Informe o nome do cliente para salvar ou apresentar o estudo.', nivel: 'aviso' })
  }

  return p
}

// ---------------------------------------------------------------------------
// 10) Orquestração
// ---------------------------------------------------------------------------

/**
 * Capacidades da linha Branorte usadas quando a tela não passa a lista
 * configurada (testes, cálculo de cenário). Iguais ao default do catálogo.
 */
export const CAPACIDADES_FALLBACK = [300, 600, 1000, 1500, 2000, 3000, 5000]

export function calcularEstudo(input: EstudoInput, capacidades?: number[]): ResultadoEstudo {
  const lista = capacidades && capacidades.length > 0 ? capacidades : CAPACIDADES_FALLBACK
  const demanda = calcularDemanda(input.necessidade)
  const pesos = pesosPorFase(input.necessidade, input.produto.categoria)
  const porFase = calcularFormulasPorFase(input)
  // A `formula` exposta continua sendo a da fase principal — é o que a tela
  // edita. Quem entra na conta da produção é a MÉDIA PONDERADA das fases.
  const formula = porFase.fases.find(f => f.categoria === input.produto.categoria)?.calc
    ?? calcularFormula(input.formula, input.produto.especie)

  const producao = calcularCustosProducao(
    porFase.custoPonderadoPorKg, input.custos, demanda.mensalKg, input.necessidade.pesoSaco,
  )
  const atual = calcularCustoAtual(input.atual, demanda, { pesos })
  const comparacao = compararEconomia(
    atual.custoPorKg, producao.custoTotalPorKg, demanda,
    totalAnimais(input.necessidade),
  )
  const dimensionamento = calcularDimensionamento(input.dimensionamento, demanda, lista)
  const retorno = calcularRetorno(input.investimento, comparacao.economiaMensal, comparacao.economiaAnual)

  const cenarios: CenarioCalculado[] = [
    calcularCenario('conservador', input.cenarios.conservador, input),
    calcularCenario('provavel', input.cenarios.provavel, input),
    calcularCenario('otimista', input.cenarios.otimista, input),
  ]

  const problemas = validar(input, demanda, porFase, atual)

  return {
    problemas,
    bloqueado: problemas.some(x => x.nivel === 'bloqueio'),
    demanda, formula, atual, producao, comparacao, dimensionamento, retorno, cenarios,
    formulasPorFase: porFase.fases,
    custoIngredientesPonderadoPorKg: porFase.custoPonderadoPorKg,
    formulasFechadas: porFase.fechadas,
    memoria: montarMemoria(atual, producao, comparacao, input),
  }
}

/** Memória de cálculo — o caminho do custo até a economia, linha a linha. */
export function montarMemoria(
  atual: CustoAtualCalculado,
  producao: CustosProducaoCalculados,
  comparacao: ComparacaoEconomia,
  input: EstudoInput,
): LinhaMemoria[] {
  const linhas: LinhaMemoria[] = [
    { rotulo: 'Ração comprada — preço informado', valor: atual.precoBasePorKg, formato: 'moeda' },
  ]
  if (atual.fretePorKg > 0) linhas.push({ rotulo: 'Frete da ração comprada', valor: atual.fretePorKg, formato: 'moeda' })
  if (atual.descargaPorKg > 0) linhas.push({ rotulo: 'Descarga', valor: atual.descargaPorKg, formato: 'moeda' })
  if (atual.outrosPorKg > 0) linhas.push({ rotulo: 'Outros custos da compra', valor: atual.outrosPorKg, formato: 'moeda' })
  if (atual.perdasPorKg !== 0) {
    linhas.push({ rotulo: `Perdas na ração comprada (${n(input.atual.perdasPct)}%)`, valor: atual.perdasPorKg, formato: 'moeda' })
  }
  linhas.push({ rotulo: 'Custo atual por kg', valor: atual.custoPorKg, formato: 'moeda', destaque: true })

  linhas.push({ rotulo: 'Ingredientes da fórmula', valor: producao.custoIngredientesPorKg, formato: 'moeda' })
  linhas.push({ rotulo: `Perda de produção (${n(input.custos.perdaPct)}%)`, valor: producao.perdaPorKg, formato: 'moeda' })
  linhas.push({
    rotulo: 'Operação (energia, mão de obra, moagem, mistura, manutenção…)',
    valor: producao.grupos.producao, formato: 'moeda',
  })
  if (producao.embalagemPorKg > 0) {
    linhas.push({ rotulo: 'Embalagem e etiqueta', valor: producao.embalagemPorKg, formato: 'moeda' })
  }
  if (producao.fixosPorKg > 0) {
    linhas.push({
      rotulo: 'Custos fixos mensais rateados', valor: producao.fixosPorKg, formato: 'moeda',
      nota: 'Diluídos no volume real do mês, não na capacidade nominal da fábrica.',
    })
  }
  linhas.push({ rotulo: 'Custo de produção própria por kg', valor: producao.custoTotalPorKg, formato: 'moeda', destaque: true })
  linhas.push({ rotulo: 'Economia por kg', valor: comparacao.economiaPorKg, formato: 'moeda', destaque: true })

  return linhas
}
