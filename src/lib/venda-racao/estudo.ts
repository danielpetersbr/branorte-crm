/**
 * Montagem do ESTUDO que vai pro cliente.
 *
 * Diferente da antiga proposta comercial, aqui o cliente pode (e deve) ver os
 * números do cálculo — é disso que o estudo vive. O que NÃO sai daqui é o que é
 * interno da Branorte: observações do vendedor e o status comercial do estudo.
 * `dadosEstudo` é a única fonte que a apresentação e o texto do WhatsApp
 * consomem — se um campo não está neste objeto, não tem como vazar.
 */
import { nomeCategoria, nomeEspecie } from './catalogo'
import { anos, brl, brlKg, dataBR, kgHora, meses, numero, pct } from './formato'
import type { EstudoInput, ResultadoEstudo } from './tipos'

export interface LinhaPremissa {
  rotulo: string
  valor: string
  nota?: string
}

export interface DadosEstudo {
  codigo: string
  data: string
  validade: string

  clienteNome: string
  clienteEmpresa: string
  clienteCidade: string
  clienteUf: string
  clienteTelefone: string
  vendedorNome: string

  produto: string
  categoria: string

  // --- necessidade
  consumoDiarioKg: number
  consumoMensalKg: number
  consumoAnualKg: number
  toneladasMes: number

  // --- cenário atual
  compraRacaoPronta: boolean
  custoAtualPorKg: number
  custoAtualPorTonelada: number
  custoAtualMensal: number
  custoAtualAnual: number

  // --- produção própria
  custoIngredientesPorKg: number
  custoOperacionalPorKg: number
  custoProprioPorKg: number
  custoProprioPorTonelada: number
  custoProprioMensal: number
  custoProprioAnual: number

  // --- resultado
  economiaPorKg: number
  economiaPorTonelada: number
  economiaMensal: number
  economiaAnual: number
  reducaoPct: number
  vantajoso: boolean

  // --- dimensionamento
  capacidadeMinimaKgHora: number
  capacidadeRecomendadaKgHora: number
  capacidadeSugeridaKgHora: number
  horasPorDia: number
  utilizacaoPct: number
  rotinaSugerida: string
  acimaDaLinha: boolean

  // --- investimento
  investimentoTotal: number
  custoFinanceiro: number
  investimentoConsiderado: number
  paybackAplicavel: boolean
  paybackMeses: number
  paybackAnos: number
  acumulado: Array<{ ano: number; economia: number; liquido: number }>

  cenarios: ResultadoEstudo['cenarios']
  premissas: LinhaPremissa[]

  textoApresentacao: string
  avisoNutricional: string
  avisoEstimativa: string
}

export function dadosEstudo(
  input: EstudoInput,
  r: ResultadoEstudo,
  extras: { codigo: string; textoApresentacao: string; avisoNutricional: string; avisoEstimativa: string },
): DadosEstudo {
  const { identificacao: id, produto, necessidade } = input
  const sug = r.dimensionamento.sugerido

  return {
    codigo: extras.codigo,
    data: id.data,
    validade: id.validade,

    clienteNome: id.clienteNome,
    clienteEmpresa: id.clienteEmpresa,
    clienteCidade: id.clienteCidade,
    clienteUf: id.clienteUf,
    clienteTelefone: id.clienteTelefone,
    vendedorNome: id.vendedorNome,

    produto: nomeEspecie(produto.especie),
    categoria: nomeCategoria(produto.especie, produto.categoria, produto.categoriaLivre),

    consumoDiarioKg: r.demanda.diariaKg,
    consumoMensalKg: r.demanda.mensalKg,
    consumoAnualKg: r.demanda.anualKg,
    toneladasMes: r.demanda.toneladasMes,

    compraRacaoPronta: input.atual.modo === 'compra',
    custoAtualPorKg: r.atual.custoPorKg,
    custoAtualPorTonelada: r.atual.custoPorTonelada,
    custoAtualMensal: r.atual.custoMensal,
    custoAtualAnual: r.atual.custoAnual,

    custoIngredientesPorKg: r.producao.grupos.materiaPrima,
    custoOperacionalPorKg: r.producao.operacionaisPorKg,
    custoProprioPorKg: r.producao.custoTotalPorKg,
    custoProprioPorTonelada: r.producao.custoPorTonelada,
    custoProprioMensal: r.producao.custoMensal,
    custoProprioAnual: r.producao.custoAnual,

    economiaPorKg: r.comparacao.economiaPorKg,
    economiaPorTonelada: r.comparacao.economiaPorTonelada,
    economiaMensal: r.comparacao.economiaMensal,
    economiaAnual: r.comparacao.economiaAnual,
    reducaoPct: r.comparacao.reducaoPct,
    vantajoso: r.comparacao.vantajoso,

    capacidadeMinimaKgHora: r.dimensionamento.capacidadeMinimaKgHora,
    capacidadeRecomendadaKgHora: r.dimensionamento.capacidadeRecomendadaKgHora,
    capacidadeSugeridaKgHora: sug?.capacidade ?? 0,
    horasPorDia: sug?.horasPorDia ?? 0,
    utilizacaoPct: sug?.utilizacaoPct ?? 0,
    rotinaSugerida: r.dimensionamento.rotinaSugerida,
    acimaDaLinha: sug?.acimaDaLinha ?? false,

    investimentoTotal: r.retorno.investimentoTotal,
    custoFinanceiro: r.retorno.custoFinanceiro,
    investimentoConsiderado: r.retorno.investimentoConsiderado,
    paybackAplicavel: r.retorno.aplicavel,
    paybackMeses: r.retorno.paybackMeses,
    paybackAnos: r.retorno.paybackAnos,
    acumulado: r.retorno.acumulado,

    cenarios: r.cenarios,
    premissas: montarPremissas(input, r),

    textoApresentacao: extras.textoApresentacao,
    avisoNutricional: extras.avisoNutricional,
    avisoEstimativa: extras.avisoEstimativa,
  }
}

/** As contas por trás dos números — o cliente tem que poder conferir. */
export function montarPremissas(input: EstudoInput, r: ResultadoEstudo): LinhaPremissa[] {
  const p: LinhaPremissa[] = []
  const q = input.necessidade

  if (q.modo === 'animais') {
    p.push({
      rotulo: 'Plantel considerado',
      valor: `${numero(q.numeroAnimais)} ${nomeEspecie(input.produto.especie).toLowerCase().includes('aves') ? 'aves' : 'animais'}`,
    })
    p.push({
      rotulo: 'Consumo por animal',
      valor: `${numero(q.consumoPorAnimal, 3)} kg por ${q.baseConsumo === 'dia' ? 'dia' : q.baseConsumo === 'ciclo' ? 'ciclo' : 'mês'}`,
      nota: q.consumoConfirmado ? 'Confirmado com o cliente.' : 'Valor de referência — não confirmado com o cliente.',
    })
  } else {
    p.push({
      rotulo: 'Necessidade informada',
      valor: `${numero(q.quantidadeInformada, 2)} ${q.unidadeQuantidade} por ${q.periodoQuantidade === 'dia' ? 'dia' : q.periodoQuantidade === 'ano' ? 'ano' : 'mês'}`,
    })
  }
  if (q.margemSegurancaPct > 0) {
    p.push({ rotulo: 'Margem de segurança', valor: pct(q.margemSegurancaPct, 1) })
  }

  p.push({
    rotulo: input.atual.modo === 'compra' ? 'Custo atual da ração comprada' : 'Custo atual da operação',
    valor: brlKg(r.atual.custoPorKg, 4),
    nota: input.atual.modo === 'compra'
      ? 'Informado pelo cliente, já com frete, descarga e perdas quando declarados.'
      : 'Informado pelo cliente.',
  })

  if (input.produto.especie === 'milho') {
    p.push({ rotulo: 'Preço do milho', valor: brlKg(r.formula.custoIngredientesPorKg, 4) })
  } else {
    p.push({
      rotulo: 'Fórmula considerada',
      valor: `${r.formula.linhas.length} ingredientes · ${numero(r.formula.totalParticipacaoPct, 1)}%`,
      nota: r.formula.linhas.map(l => `${l.nome} ${numero(l.participacaoPct, 1)}%`).join(' · '),
    })
    p.push({ rotulo: 'Custo dos ingredientes', valor: brlKg(r.formula.custoIngredientesPorKg, 4) })
  }

  p.push({ rotulo: 'Perda de produção', valor: pct(input.custos.perdaPct, 2) })
  p.push({ rotulo: 'Custos operacionais', valor: brlKg(r.producao.operacionaisPorKg, 4) })
  p.push({
    rotulo: 'Regime de produção',
    valor: `${numero(input.dimensionamento.diasPorMes)} dias/mês · ${numero(input.dimensionamento.horasPorDia, 1)} h/dia`,
  })
  p.push({ rotulo: 'Margem operacional no dimensionamento', valor: pct(input.dimensionamento.margemOperacionalPct, 0) })

  if (r.retorno.investimentoTotal > 0) {
    p.push({ rotulo: 'Investimento estimado', valor: brl(r.retorno.investimentoTotal) })
    if (r.retorno.custoFinanceiro > 0) {
      p.push({ rotulo: 'Custo financeiro informado', valor: brl(r.retorno.custoFinanceiro) })
    }
  }

  return p
}

// ---------------------------------------------------------------------------
// Frases de resultado
// ---------------------------------------------------------------------------

export function frasePrincipal(d: DadosEstudo): string {
  if (!d.vantajoso) {
    return 'Com os dados atuais, a produção própria não apresenta economia. '
      + 'Revise os preços, a fórmula e os custos operacionais.'
  }
  return `Com base nos dados informados, a produção própria poderá reduzir o custo estimado de `
    + `${brl(d.custoAtualPorKg, 2)} para ${brl(d.custoProprioPorKg, 2)} por kg, representando uma `
    + `economia aproximada de ${brl(d.economiaMensal)} por mês e ${brl(d.economiaAnual)} por ano.`
}

export function fraseInvestimento(d: DadosEstudo): string {
  if (d.investimentoConsiderado <= 0) return ''
  if (!d.paybackAplicavel) {
    return `Com um investimento estimado de ${brl(d.investimentoConsiderado)} e sem economia projetada, `
      + 'não é possível calcular prazo de retorno com os dados atuais.'
  }
  return `Considerando um investimento estimado de ${brl(d.investimentoConsiderado)}, o retorno projetado `
    + `é de aproximadamente ${meses(d.paybackMeses, 0)} (${anos(d.paybackAnos)}).`
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/** Texto pronto pro WhatsApp — editável antes do envio, nunca enviado sozinho. */
export function textoWhatsApp(d: DadosEstudo): string {
  const primeiroNome = (d.clienteNome || '').trim().split(/\s+/)[0] || 'tudo bem'

  const itens = [
    `• Demanda estimada: ${numero(d.toneladasMes, 1)} toneladas por mês`,
    `• Custo atual informado: ${brl(d.custoAtualPorKg, 2)}/kg`,
    `• Custo estimado de produção própria: ${brl(d.custoProprioPorKg, 2)}/kg`,
    d.vantajoso
      ? `• Economia mensal estimada: ${brl(d.economiaMensal)}`
      : '• Economia mensal estimada: sem economia com os dados atuais',
    d.vantajoso ? `• Economia anual estimada: ${brl(d.economiaAnual)}` : '',
    d.capacidadeSugeridaKgHora > 0 ? `• Capacidade sugerida para análise: ${kgHora(d.capacidadeSugeridaKgHora)}` : '',
    d.paybackAplicavel ? `• Retorno estimado do investimento: ${meses(d.paybackMeses, 0)}` : '',
  ].filter(Boolean)

  const paragrafos = [
    `Olá, ${primeiroNome}! Preparei um estudo preliminar sobre a produção própria de ração na sua propriedade.`,
    'Com base nas informações analisadas:',
    itens.join('\n'),
    'Os valores são estimativas e podem variar conforme os preços dos ingredientes, formulação, '
      + 'consumo, operação e estrutura da propriedade.',
    'Se quiser, posso apresentar os detalhes utilizados no cálculo.',
    [d.vendedorNome, 'Branorte'].filter(Boolean).join('\n'),
    `Estudo ${d.codigo}`,
  ]

  return paragrafos.join('\n\n')
}

/** Só os dígitos do telefone, com 55 na frente — pro wa.me. */
export function telefoneWhatsApp(telefone: string): string {
  const d = (telefone || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55')) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

/**
 * Link do WhatsApp. Sem telefone cai no seletor de contato do próprio app. Nada
 * é enviado automaticamente: o vendedor abre a conversa e confere o texto.
 */
export function linkWhatsApp(d: DadosEstudo, texto?: string): string {
  const msg = encodeURIComponent(texto ?? textoWhatsApp(d))
  const fone = telefoneWhatsApp(d.clienteTelefone)
  return fone ? `https://wa.me/${fone}?text=${msg}` : `https://wa.me/?text=${msg}`
}

/** Resumo em texto puro pro botão "Copiar resumo". */
export function resumoTexto(d: DadosEstudo): string {
  return [
    `ESTUDO DE VIABILIDADE ${d.codigo} — BRANORTE`,
    `Cliente: ${d.clienteNome}${d.clienteEmpresa ? ` (${d.clienteEmpresa})` : ''}`,
    d.clienteCidade || d.clienteUf ? `Local: ${[d.clienteCidade, d.clienteUf].filter(Boolean).join('/')}` : '',
    `Produto: ${d.produto}${d.categoria ? ` — ${d.categoria}` : ''}`,
    `Necessidade: ${numero(d.consumoMensalKg)} kg/mês (${numero(d.toneladasMes, 1)} t)`,
    `Custo atual: ${brlKg(d.custoAtualPorKg, 2)} · ${brl(d.custoAtualMensal)}/mês`,
    `Produção própria: ${brlKg(d.custoProprioPorKg, 2)} · ${brl(d.custoProprioMensal)}/mês`,
    d.vantajoso
      ? `Economia: ${brlKg(d.economiaPorKg, 2)} · ${brl(d.economiaMensal)}/mês · ${brl(d.economiaAnual)}/ano (${pct(d.reducaoPct, 1)})`
      : 'Economia: sem economia com os dados atuais',
    d.capacidadeSugeridaKgHora > 0 ? `Capacidade sugerida: ${kgHora(d.capacidadeSugeridaKgHora)}` : '',
    d.investimentoConsiderado > 0 ? `Investimento estimado: ${brl(d.investimentoConsiderado)}` : '',
    d.paybackAplicavel ? `Retorno estimado: ${meses(d.paybackMeses, 0)}` : '',
    `Vendedor: ${d.vendedorNome || '—'}`,
    `Estudo de ${dataBR(d.data)} · preços válidos até ${dataBR(d.validade)}`,
    'Valores estimados.',
  ].filter(Boolean).join('\n')
}
