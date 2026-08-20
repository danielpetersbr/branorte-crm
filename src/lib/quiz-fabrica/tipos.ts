/**
 * Tipos do "Monte sua fábrica" — o quiz público que traduz a rotina do produtor
 * numa linha de equipamentos Branorte, do recebimento à expedição.
 *
 * Nada aqui fala de PREÇO, e é de propósito: a página é pública e o anon não
 * tem (nem pode ter) SELECT em precos_branorte. Preço é conversa de orçamento,
 * com vendedor junto.
 */
import type { Especie } from '@/lib/venda-racao/tipos'

export type { Especie }

/** Como o grão entra na propriedade. Decide moega, pré-limpeza e elevador. */
export type Recebimento =
  | 'granel'    // caminhão/carreta descarrega solto
  | 'ensacado'  // saco ou big bag
  | 'propria'   // colheita da própria lavoura (chega sujo, com palha)

/** Quanto tempo de grão o cliente segura em casa. Decide o silo de milho. */
export type EstoqueGrao =
  | 'nenhum'  // compra conforme usa
  | 'mes'     // ~1 mês
  | 'safra'   // enche na safra e usa o ano

/** Por onde a ração pronta sai. Decide ensacadeira, esteira, caixa e silo. */
export type Expedicao =
  | 'ensacada' // ensaca pra estocar/vender
  | 'granel'   // cai direto no vagão/carreta/comedouro
  | 'ambos'

export type Energia = 'trifasico' | 'monofasico' | 'nao_sei'

/**
 * Fora de escopo. A Branorte só faz ração FARELADA — não fabrica peletizadora
 * nem extrusora, e peixe exige extrusão. Detectar isso NO QUIZ evita que o lead
 * ande no funil pra morrer na frente do vendedor.
 */
export type ForaDeEscopo = 'peixe' | 'peletizada' | null

export interface RespostasQuiz {
  /** null enquanto o produtor não escolheu — mantém a etapa 1 incompleta. */
  especie: Especie | null
  categoria: string
  foraDeEscopo: ForaDeEscopo

  /** 'animais' = pelo rebanho; 'direto' = ele já sabe a tonelagem. */
  modo: 'animais' | 'direto'
  numeroAnimais: number
  /**
   * kg por animal por MÊS. Nasce do catálogo e o produtor pode corrigir.
   *
   * ⚠️ Este campo é a VERDADE e fica sempre em mês, mesmo quando a tela está
   * mostrando por dia. Guardar na unidade que o produtor escolheu obrigaria
   * todo mundo que lê (motor, banco, painel do vendedor) a saber qual era —
   * e uma leitura errada aí muda o tamanho da fábrica por 30.
   */
  consumoPorAnimalMes: number
  /**
   * Em que unidade o produtor está DIGITANDO. Só afeta a tela: o valor é
   * convertido na entrada e guardado em mês.
   *
   * Nasce em 'dia' porque é assim que se fala no campo — "o boi come 10 kg por
   * dia", nunca "297 kg por mês".
   */
  baseConsumo: 'dia' | 'mes'
  toneladasMes: number

  diasPorSemana: number
  horasPorDia: number

  recebimento: Recebimento | null
  estoqueGrao: EstoqueGrao | null
  expedicao: Expedicao | null
  pesagemAutomatica: boolean | null
  energia: Energia | null

  nome: string
  telefone: string
  cidade: string
  uf: string
}

/** Um equipamento concreto dentro de uma estação. */
export interface ItemLinha {
  /** Nome como sai na proposta: "Moinho de martelo BNMM210 — 1.000 kg/h". */
  nome: string
  /** Quantas unidades. Só aparece na tela quando > 1. */
  quantidade: number
  /** Por que este, nesta medida. Uma frase, linguagem de produtor. */
  porque: string
  /**
   * true quando o item não é dimensionável pelo quiz e depende do layout do
   * galpão (comprimento de transportador, altura de elevador). Sai na tela como
   * "definido no projeto" em vez de fingir uma medida.
   */
  aProjetar?: boolean
}

export type ChaveEstacao =
  | 'recebimento' | 'prelimpeza' | 'armazenagem' | 'moagem'
  | 'dosagem' | 'mistura' | 'racao_pronta' | 'expedicao' | 'apoio'

export interface Estacao {
  chave: ChaveEstacao
  /** Número que aparece no fluxo (1, 2, 3…). Estação vazia não recebe número. */
  ordem: number
  titulo: string
  /** O que acontece aqui, em uma linha. */
  resumo: string
  itens: ItemLinha[]
}

export interface CompactaSugerida {
  /** '01' | '01 MASTER' | '02' | … */
  linha: string
  codigo: string
  producaoKgH: number
  misturadorKg: number
  /** Caixas de ração pronta que acompanham a 03/03 MASTER, em kg. */
  caixas: number[]
  /** Por que esta linha e não a de baixo. */
  porque: string
  /** Mesma produção, misturador de outro tamanho — o vendedor fecha isso. */
  alternativas: Array<{ codigo: string; misturadorKg: number }>
}

export interface Dimensionamento {
  demandaMensalKg: number
  diasPorMes: number
  producaoPorDiaKg: number
  /** kg/h crus, sem folga. */
  capacidadeMinimaKgH: number
  /** kg/h com a folga operacional de 20% (mesmo default do estudo). */
  capacidadeAlvoKgH: number
  /** Capacidade do moinho realmente escolhido. */
  capacidadeEscolhidaKgH: number
  /** Horas por dia que a fábrica escolhida roda pra dar a demanda. */
  horasReaisPorDia: number
  /** % da jornada declarada que a fábrica ocuparia. */
  utilizacaoPct: number
  /** true quando nem o maior moinho da linha atende a jornada pedida. */
  acimaDaLinha: boolean
}

export interface ResultadoQuiz {
  /** false quando falta resposta pra dimensionar — a tela mostra o que falta. */
  completo: boolean
  faltando: string[]
  foraDeEscopo: ForaDeEscopo

  dimensionamento: Dimensionamento
  estacoes: Estacao[]
  compacta: CompactaSugerida | null
  /** Avisos honestos: fábrica ociosa, jornada apertada, grão úmido etc. */
  alertas: string[]
}
