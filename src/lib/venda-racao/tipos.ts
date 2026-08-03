/**
 * Tipos do módulo Produção Própria (/producao-propria).
 *
 * FINALIDADE: a Branorte NÃO vende ração. Esta ferramenta prova ao produtor
 * rural que produzir a própria ração numa fábrica Branorte sai mais barato que
 * comprar pronta — e em quanto tempo o equipamento se paga.
 *
 * Os nomes de arquivo/pasta (`venda-racao`) e o prefixo de CSS (`vr-`) foram
 * mantidos de propósito: espelham as tabelas `venda_racao_*` e as chaves de
 * permissão `menu.venda_racao`, que não podem ser renomeadas sem quebrar dados
 * e RLS já em produção. Nada disso aparece pro usuário.
 *
 * Convenção de unidades: TUDO que é massa vive em **kg** e todo preço em
 * **R$/kg** dentro do motor. Conversão (saco/tonelada) acontece só na borda.
 * Percentuais entram como NÚMERO INTEIRO na UI (20 = 20%) e viram decimal uma
 * única vez, dentro do motor (`dec()`).
 */

export type Especie = 'bovinos' | 'suinos' | 'aves' | 'milho'

/** Como o vendedor descreveu a participação do ingrediente na fórmula. */
export type UnidadeParticipacao = 'pct' | 'kg_t' | 'g_t'

/** Como a matéria-prima (ou a ração pronta) foi cotada. */
export type UnidadePreco = 'kg' | 'saco' | 't'

/** Base do consumo informado por animal. */
export type BaseConsumo = 'dia' | 'mes' | 'ciclo'

/** Como a quantidade foi informada no modo direto. */
export type UnidadeQuantidade = 'kg' | 't' | 'sacos'

/** Período a que a quantidade direta se refere. */
export type PeriodoQuantidade = 'dia' | 'mes' | 'ano'

/** Como o cliente se abastece hoje. */
export type ModoCenarioAtual = 'compra' | 'proprio'

/** Ritmo de produção pretendido — informativo, vira "rotina sugerida". */
export type Frequencia = 'diaria' | 'semanal' | 'periodica'

/** Como o investimento será bancado. Nunca inventamos taxa de juros. */
export type ModoFinanciamento = 'sem' | 'informado'

export type StatusEstudo =
  | 'rascunho' | 'apresentado' | 'analisando' | 'negociacao'
  | 'aprovado' | 'vendido' | 'nao_avancou' | 'cancelado'

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface Identificacao {
  clienteNome: string
  /** Propriedade ou empresa. */
  clienteEmpresa: string
  clienteCidade: string
  clienteUf: string
  clienteTelefone: string
  vendedorNome: string
  /** Data do estudo — ISO yyyy-mm-dd */
  data: string
  /** Até quando os preços usados valem — ISO yyyy-mm-dd */
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

/** Etapa 2 — a necessidade de produção do cliente. */
export interface Necessidade {
  modo: 'animais' | 'direto'

  // --- modo "animais"
  numeroAnimais: number
  consumoPorAnimal: number
  baseConsumo: BaseConsumo
  /** Dias considerados: do mês (base 'dia') ou do ciclo (base 'ciclo'). */
  dias: number
  /**
   * O consumo sugerido é REFERÊNCIA de catálogo. Enquanto isso for false a tela
   * avisa que o número não foi confirmado com o cliente.
   */
  consumoConfirmado: boolean
  /** Folga sobre a demanda calculada, em % (10 = +10%). */
  margemSegurancaPct: number

  // --- modo "direto"
  quantidadeInformada: number
  unidadeQuantidade: UnidadeQuantidade
  /** A que período a quantidade informada se refere. */
  periodoQuantidade: PeriodoQuantidade

  // --- comum (conversão secundária: sacaria não é o foco do estudo)
  pesoSaco: number
}

/** Etapa 3 — quanto o cliente gasta HOJE. */
export interface CenarioAtual {
  modo: ModoCenarioAtual

  /** Preço da ração pronta que ele compra. */
  preco: number
  unidadePreco: UnidadePreco
  /** Só usado quando unidadePreco = 'saco'. */
  pesoSacoCompra: number

  /** Adicionais da compra, todos em R$/kg. */
  frete: CustoOpcional
  descarga: CustoOpcional
  outros: CustoOpcional
  /** Perdas de armazenagem/manuseio da ração comprada, em %. */
  perdasPct: number

  /** Quando modo = 'proprio': custo atual da operação, em R$/kg. */
  custoManualPorKg: number

  observacoes: string
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

/** Etapa 5 — o que custa produzir na propriedade. */
export interface CustosProducao {
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

  /** Por SACO (convertidos pra kg no motor). Só quando o cliente ensaca. */
  embalagem: CustoOpcional
  etiqueta: CustoOpcional

  /** Custos fixos MENSAIS da operação, rateados pela produção do mês. */
  custosFixosMensais: CustoOpcional
}

/** Etapa 7 — capacidade de produção necessária. */
export interface Dimensionamento {
  diasPorMes: number
  horasPorDia: number
  /** Lotes por dia de produção. 0 = não informado. */
  lotesPorDia: number
  frequencia: Frequencia
  /** Folga sobre a capacidade mínima calculada, em % (20 = +20%). */
  margemOperacionalPct: number
}

/** Etapa 8 — investimento na fábrica. */
export interface Investimento {
  equipamentos: number
  frete: number
  montagem: number
  instalacaoEletrica: number
  obraCivil: number
  outros: number

  modoFinanciamento: ModoFinanciamento
  /** Custo financeiro TOTAL em R$, informado pelo vendedor. Nunca estimado. */
  custoFinanceiroInformado: number
}

/** Variação aplicada sobre os números informados, em %. Negativo reduz. */
export interface AjusteCenario {
  /** Preço dos ingredientes. */
  ingredientesPct: number
  /** Perda de produção. */
  perdaPct: number
  /** Custos operacionais (energia, mão de obra, manutenção…). */
  operacionaisPct: number
  /** Preço da ração comprada hoje. */
  racaoCompradaPct: number
  /** Consumo do rebanho/plantel. */
  consumoPct: number
  /** Investimento total. */
  investimentoPct: number
}

export interface Cenarios {
  conservador: AjusteCenario
  provavel: AjusteCenario
  otimista: AjusteCenario
}

/** Estado completo do formulário — é isso que vai pro JSONB `dados`. */
export interface EstudoInput {
  identificacao: Identificacao
  produto: Produto
  necessidade: Necessidade
  atual: CenarioAtual
  formula: Formula
  custos: CustosProducao
  dimensionamento: Dimensionamento
  investimento: Investimento
  cenarios: Cenarios
  status: StatusEstudo
}

// ---------------------------------------------------------------------------
// Saídas
// ---------------------------------------------------------------------------

export interface ProblemaValidacao {
  campo: string
  mensagem: string
  /** 'bloqueio' impede concluir o estudo; 'aviso' só alerta. */
  nivel: 'bloqueio' | 'aviso'
}

export interface DemandaCalculada {
  diariaKg: number
  mensalKg: number
  anualKg: number
  toneladasMes: number
  toneladasAno: number
  /** Conversão secundária — sacaria não é o foco do estudo. */
  sacosMes: number
}

export interface LinhaIngredienteCalculada {
  id: string
  nome: string
  /** kg desse ingrediente em 1 tonelada de ração. */
  kgPorTonelada: number
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
  fixos: number
}

export interface CustosProducaoCalculados {
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
  fixosPorKg: number

  /** Soma dos operacionais (tudo menos matéria-prima). */
  operacionaisPorKg: number

  grupos: GruposCusto
  custoTotalPorKg: number
  custoPorTonelada: number
  custoMensal: number
  custoAnual: number
}

export interface CustoAtualCalculado {
  informado: boolean
  /** Preço base da ração pronta convertido pra R$/kg (antes de adicionais). */
  precoBasePorKg: number
  fretePorKg: number
  descargaPorKg: number
  outrosPorKg: number
  perdasPorKg: number

  custoPorKg: number
  custoPorTonelada: number
  custoMensal: number
  custoAnual: number
}

export interface ComparacaoEconomia {
  economiaPorKg: number
  economiaPorTonelada: number
  economiaMensal: number
  economiaAnual: number
  reducaoPct: number
  /** true quando produzir sai mais barato. */
  vantajoso: boolean
  /** Economia por animal por mês. 0 quando o modo é quantidade direta. */
  economiaPorAnimalMes: number
}

export interface EquipamentoSugerido {
  /** kg/h nominal da linha Branorte. */
  capacidade: number
  rotulo: string
  /** Horas por dia pra atender a demanda nesse equipamento. */
  horasPorDia: number
  /** % do tempo disponível que a fábrica ficaria ligada. */
  utilizacaoPct: number
  /** true quando nem a maior capacidade da linha atende com folga. */
  acimaDaLinha: boolean
}

export interface DimensionamentoCalculado {
  aplicavel: boolean
  producaoPorDiaKg: number
  kgPorLote: number
  capacidadeMinimaKgHora: number
  capacidadeRecomendadaKgHora: number
  sugerido: EquipamentoSugerido | null
  /** Texto tipo "3× por semana, ~4 h por vez". */
  rotinaSugerida: string
}

export interface RetornoCalculado {
  investimentoTotal: number
  custoFinanceiro: number
  /** investimentoTotal + custoFinanceiro — a base do payback. */
  investimentoConsiderado: number

  aplicavel: boolean
  paybackMeses: number
  paybackAnos: number

  /** Economia acumulada e resultado líquido no fim de cada ano (1..5). */
  acumulado: Array<{ ano: number; economia: number; liquido: number }>
}

export interface CenarioCalculado {
  chave: 'conservador' | 'provavel' | 'otimista'
  rotulo: string
  custoProprioPorKg: number
  custoAtualPorKg: number
  economiaPorKg: number
  economiaMensal: number
  economiaAnual: number
  paybackMeses: number
  paybackAplicavel: boolean
}

export interface LinhaMemoria {
  rotulo: string
  valor: number
  /** 'moeda' = R$/kg (4 casas); 'moeda_total' = R$; 'pct' = %. */
  formato: 'moeda' | 'moeda_total' | 'pct'
  destaque?: boolean
  nota?: string
}

export interface ResultadoEstudo {
  problemas: ProblemaValidacao[]
  bloqueado: boolean
  demanda: DemandaCalculada
  formula: FormulaCalculada
  atual: CustoAtualCalculado
  producao: CustosProducaoCalculados
  comparacao: ComparacaoEconomia
  dimensionamento: DimensionamentoCalculado
  retorno: RetornoCalculado
  cenarios: CenarioCalculado[]
  memoria: LinhaMemoria[]
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

export interface EstudoRow {
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

  custo_atual_kg: number
  custo_proprio_kg: number
  economia_kg: number
  economia_mensal: number
  economia_anual: number
  reducao_pct: number
  capacidade_kg_hora: number
  investimento_total: number
  payback_meses: number | null

  status: StatusEstudo
  arquivado: boolean
  validade: string | null
  observacoes: string | null
  dados: EstudoInput
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
export interface ConfigEstudo {
  /** Custos operacionais padrão — estimativas, todas editáveis e desligáveis. */
  custosPadrao: Pick<
    CustosProducao,
    | 'perdaPct' | 'energia' | 'maoDeObra' | 'moagem' | 'mistura' | 'manutencao'
    | 'depreciacao' | 'administrativo' | 'carregamento' | 'outrosVariaveis'
    | 'embalagem' | 'etiqueta'
  >
  dimensionamentoPadrao: Dimensionamento
  /** Capacidades da linha Branorte, em kg/h. */
  capacidades: number[]
  pesoSacoPadrao: number
  validadeDias: number
  /**
   * Silagem, volumoso úmido e líquidos só entram quando o equipamento e o
   * processo forem compatíveis — a Compacta é farelada.
   */
  permiteIngredientesUmidos: boolean
  textoApresentacao: string
  avisoNutricional: string
  avisoEstimativa: string
  cenarios: Cenarios
}
