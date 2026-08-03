/**
 * Tipos do módulo Venda de Ração (/venda-racao).
 *
 * Convenção de unidades: TUDO que é massa vive em **kg** e todo preço em
 * **R$/kg** dentro do motor. Conversão (saco/tonelada) acontece só na borda —
 * entrada do formulário e saída de apresentação. Isso evita o erro clássico de
 * misturar R$/saca com R$/kg no meio da conta.
 *
 * Percentuais entram como NÚMERO INTEIRO na UI (20 = 20%) e são convertidos
 * pra decimal (0,20) uma única vez, dentro do motor (`pct()`).
 */

export type Especie = 'bovinos' | 'suinos' | 'aves' | 'milho'

/** Como o vendedor descreveu a participação do ingrediente na fórmula. */
export type UnidadeParticipacao = 'pct' | 'kg_t' | 'g_t'

/** Como o vendedor comprou a matéria-prima. */
export type UnidadePreco = 'kg' | 'saco' | 't'

/** Base do consumo informado por animal. */
export type BaseConsumo = 'dia' | 'mes' | 'ciclo'

/** Como a quantidade foi informada no modo direto. */
export type UnidadeQuantidade = 'kg' | 't' | 'sacos'

/** Margem sobre o preço de venda (padrão) ou markup sobre o custo. */
export type ModoPreco = 'margem' | 'markup'

export type StatusProposta =
  | 'rascunho' | 'enviada' | 'negociacao'
  | 'aprovada' | 'vendida' | 'perdida' | 'cancelada'

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface Identificacao {
  clienteNome: string
  clienteEmpresa: string
  clienteCidade: string
  clienteUf: string
  clienteTelefone: string
  vendedorNome: string
  /** ISO yyyy-mm-dd */
  data: string
  /** ISO yyyy-mm-dd */
  validade: string
  observacoesInternas: string
}

export interface Produto {
  especie: Especie
  /** Chave da categoria no catálogo, ou texto livre quando `categoriaLivre`. */
  categoria: string
  /** Preenchido quando o vendedor escolheu "Outro" e digitou o nome. */
  categoriaLivre: string
}

export interface Quantidade {
  modo: 'animais' | 'direto'

  // --- modo "animais"
  numeroAnimais: number
  consumoPorAnimal: number
  baseConsumo: BaseConsumo
  /** Nº de dias — usado quando baseConsumo = 'dia' (mês comercial) ou 'ciclo'. */
  dias: number
  /** Sobra/segurança sobre a demanda calculada, em % (10 = +10%). */
  sobraPct: number

  // --- modo "direto"
  quantidadeInformada: number
  unidadeQuantidade: UnidadeQuantidade
  /** Quantas vezes esse pedido se repete no mês (pra receita/lucro mensal). */
  pedidosPorMes: number

  // --- comum
  pesoSaco: number
}

export interface IngredienteFormula {
  id: string
  nome: string
  participacao: number
  unidadeParticipacao: UnidadeParticipacao
  preco: number
  unidadePreco: UnidadePreco
  /** Só usado quando unidadePreco = 'saco'. */
  pesoSacoIngrediente: number
}

export interface Formula {
  /** id da fórmula salva que originou esta composição (informativo). */
  formulaId: string | null
  nome: string
  itens: IngredienteFormula[]

  // --- modo milho triturado (dispensa composição)
  milhoPreco: number
  milhoUnidadePreco: UnidadePreco
  milhoPesoSaca: number
}

/** Custo com liga/desliga — desligado NÃO entra na conta. */
export interface CustoOpcional {
  ativo: boolean
  valor: number
}

export interface Custos {
  /** Perda de produção (ou de limpeza/moagem, no milho), em %. */
  perdaPct: number

  energia: CustoOpcional
  maoDeObra: CustoOpcional
  moagem: CustoOpcional
  mistura: CustoOpcional
  manutencao: CustoOpcional
  depreciacao: CustoOpcional
  administrativo: CustoOpcional
  carregamento: CustoOpcional
  outrosVariaveis: CustoOpcional

  /** Por SACO (convertidos pra kg no motor, dividindo pelo peso do saco). */
  embalagem: CustoOpcional
  etiqueta: CustoOpcional

  frete: CustoOpcional
  /** 'kg' = o valor já é R$/kg; 'total' = valor do frete do pedido inteiro. */
  freteModo: 'kg' | 'total'

  /** Custos fixos do PEDIDO (rateados pela quantidade). */
  outrosFixosPedido: CustoOpcional

  /** Custos fixos MENSAIS da operação — só pro ponto de equilíbrio. */
  custosFixosMensais: number
}

export interface CondicoesVenda {
  modoPreco: ModoPreco
  impostosPct: number
  comissaoPct: number
  taxaFinanceiraPct: number
  taxaCartaoPct: number
  margemDesejadaPct: number
  margemMinimaPct: number

  /** R$/kg que o cliente paga hoje (comparação). 0 = não informado. */
  precoAtualClientePorKg: number
  /** R$/kg de mercado informado pelo vendedor (referência). 0 = não informado. */
  precoMercadoPorKg: number

  prazoPagamento: string
  formaPagamento: string
  condicaoEntrega: string

  /** R$/kg efetivamente negociado. null = ainda usando o sugerido. */
  precoNegociadoPorKg: number | null
}

export interface AjusteCenario {
  /** Variação da matéria-prima, em pontos percentuais (+20 = +20%). */
  materiaPrimaPct: number
  /** Variação do frete, em %. */
  fretePct: number
  /** Variação da perda, em pontos percentuais no valor da perda (-50 = metade). */
  perdaPct: number
  /** Margem usada no cenário, em % absoluto. null = usa a desejada. */
  margemPct: number | null
}

export interface Cenarios {
  conservador: AjusteCenario
  provavel: AjusteCenario
  otimista: AjusteCenario
}

/** Estado completo do formulário — é isso que vai pro JSONB `dados`. */
export interface SimulacaoInput {
  identificacao: Identificacao
  produto: Produto
  quantidade: Quantidade
  formula: Formula
  custos: Custos
  venda: CondicoesVenda
  cenarios: Cenarios
  status: StatusProposta
}

// ---------------------------------------------------------------------------
// Saídas
// ---------------------------------------------------------------------------

export interface ProblemaValidacao {
  campo: string
  mensagem: string
  /** 'bloqueio' impede o cálculo/salvamento; 'aviso' só alerta. */
  nivel: 'bloqueio' | 'aviso'
}

export interface DemandaCalculada {
  /** Quantidade do PEDIDO em kg (o que está sendo cotado). */
  quantidadeKg: number
  /** Quantidade recorrente por mês em kg (receita/lucro mensal). */
  quantidadeMensalKg: number
  sacos: number
  toneladas: number
  sacosMes: number
  toneladasMes: number
}

export interface LinhaIngredienteCalculada {
  id: string
  nome: string
  /** kg desse ingrediente em 1 tonelada de ração. */
  kgPorTonelada: number
  /** Participação normalizada em % da fórmula. */
  participacaoPct: number
  precoPorKg: number
  custoPorToneladaRacao: number
  custoPorKgRacao: number
}

export interface FormulaCalculada {
  linhas: LinhaIngredienteCalculada[]
  totalKgPorTonelada: number
  totalParticipacaoPct: number
  /** 1000 - totalKgPorTonelada. Positivo = falta; negativo = passou. */
  diferencaKgPorTonelada: number
  fechada: boolean
  custoIngredientesPorKg: number
  custoIngredientesPorTonelada: number
}

export interface GruposCusto {
  materiaPrima: number
  producao: number
  embalagem: number
  logistica: number
  fixos: number
}

export interface CustosCalculados {
  custoIngredientesPorKg: number
  /** Ingredientes já acrescidos da perda. */
  custoIngredientesAjustadoPorKg: number
  perdaPorKg: number

  energiaPorKg: number
  maoDeObraPorKg: number
  moagemPorKg: number
  misturaPorKg: number
  manutencaoPorKg: number
  depreciacaoPorKg: number
  administrativoPorKg: number
  carregamentoPorKg: number
  outrosVariaveisPorKg: number
  embalagemPorKg: number
  fretePorKg: number
  fixosPedidoPorKg: number

  grupos: GruposCusto
  /** Soma de tudo — a base da precificação. */
  custoBasePorKg: number
  /** custoBase sem o rateio dos fixos do pedido (pro ponto de equilíbrio). */
  custoVariavelPorKg: number
  custoPorSaco: number
  custoPorTonelada: number
  custoTotalPedido: number
}

export interface PrecosCalculados {
  /** Soma de margem + impostos + comissão + taxas, em decimal. */
  cargaTotal: number
  /** Idem, mas com a margem MÍNIMA. */
  cargaMinima: number
  /** Impostos + comissão + taxas (sem margem), em decimal. */
  cargaSemMargem: number

  precoEquilibrioPorKg: number
  precoMinimoPorKg: number
  precoSugeridoPorKg: number

  descontoMaximoReaisPorKg: number
  descontoMaximoPct: number
}

export interface ResultadoNegociado {
  precoPorKg: number
  precoPorSaco: number
  precoPorTonelada: number

  impostosPorKg: number
  comissaoPorKg: number
  taxasPorKg: number
  lucroPorKg: number
  lucroPorSaco: number
  lucroPorTonelada: number

  margemRealPct: number
  abaixoDoMinimo: boolean
  /** Desconto aplicado sobre o preço sugerido, em %. */
  descontoAplicadoPct: number

  valorTotalPedido: number
  lucroTotalPedido: number
  impostosTotalPedido: number
  comissaoTotalPedido: number

  receitaMensal: number
  lucroMensal: number
}

export interface ComparacaoMercado {
  informado: boolean
  diferencaPorKg: number
  diferencaPorSaco: number
  diferencaMensal: number
  diferencaAnual: number
  diferencaPct: number
  /** true = nosso preço está ABAIXO do que o cliente paga hoje. */
  maisBarato: boolean
}

export interface CenarioCalculado {
  chave: 'conservador' | 'provavel' | 'otimista'
  rotulo: string
  custoBasePorKg: number
  precoPorKg: number
  margemPct: number
  lucroMensal: number
  descontoDisponivelPct: number
}

export interface PontoEquilibrio {
  aplicavel: boolean
  margemContribuicaoPorKg: number
  kgPorMes: number
  sacosPorMes: number
  toneladasPorMes: number
  clientesDesseTamanho: number
}

export interface LinhaMemoria {
  rotulo: string
  valor: number
  /** 'moeda' = R$/kg; 'moeda_total' = R$; 'pct' = %; 'texto' = valor cru. */
  formato: 'moeda' | 'moeda_total' | 'pct'
  destaque?: boolean
  nota?: string
}

export interface ResultadoSimulacao {
  problemas: ProblemaValidacao[]
  bloqueado: boolean
  demanda: DemandaCalculada
  formula: FormulaCalculada
  custos: CustosCalculados
  precos: PrecosCalculados
  negociado: ResultadoNegociado
  comparacao: ComparacaoMercado
  cenarios: CenarioCalculado[]
  equilibrio: PontoEquilibrio
  memoria: LinhaMemoria[]
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

export interface SimulacaoRow {
  id: string
  codigo: string
  created_by: string
  vendedor_nome: string | null
  cliente_nome: string
  cliente_empresa: string | null
  cliente_cidade: string | null
  cliente_uf: string | null
  cliente_telefone: string | null
  especie: Especie
  categoria: string | null
  quantidade_kg: number
  quantidade_mensal_kg: number
  peso_saco: number
  custo_base_kg: number
  margem_desejada_pct: number
  margem_minima_pct: number
  preco_sugerido_kg: number
  preco_minimo_kg: number
  preco_negociado_kg: number
  margem_real_pct: number
  valor_total: number
  lucro_total: number
  lucro_mensal: number
  status: StatusProposta
  validade: string | null
  observacoes: string | null
  dados: SimulacaoInput
  created_at: string
  updated_at: string
}

export interface IngredienteCatalogoRow {
  id: string
  nome: string
  preco: number
  unidade_preco: UnidadePreco
  peso_saco: number | null
  observacao: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface FormulaSalvaRow {
  id: string
  nome: string
  especie: Especie | null
  categoria: string | null
  itens: IngredienteFormula[]
  observacoes: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

/** Defaults da empresa (venda_racao_config.config). */
export interface ConfigVendaRacao {
  margemPorEspecie: Record<Especie, number>
  margemMinimaPorEspecie: Record<Especie, number>
  impostosPct: number
  comissaoPct: number
  taxaFinanceiraPct: number
  taxaCartaoPct: number
  pesoSacoPadrao: number
  custosPadrao: Pick<
    Custos,
    | 'perdaPct' | 'energia' | 'maoDeObra' | 'moagem' | 'mistura' | 'manutencao'
    | 'depreciacao' | 'administrativo' | 'carregamento' | 'outrosVariaveis'
    | 'embalagem' | 'etiqueta'
  >
  prazoPadrao: string
  formaPagamentoPadrao: string
  condicaoEntregaPadrao: string
  validadeDias: number
  textoComercial: string
  avisoNutricional: string
  cenarios: Cenarios
}
