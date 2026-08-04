/**
 * FORMULAÇÕES DE REFERÊNCIA — fonte ÚNICA das duas telas de ração.
 *
 * Por que aqui e não dentro de um dos módulos: isto é fato de nutrição animal,
 * não regra de negócio. A participação de núcleo numa ração de suíno em
 * terminação é a mesma verdade pro /producao-propria (o cliente produzindo) e
 * pro /venda-racao (a Branorte vendendo). Duplicar significaria corrigir um
 * percentual num lado e esquecer do outro — e o custo de errar aqui é o
 * produtor comprando fábrica com base em conta furada.
 *
 * Os MOTORES continuam separados de propósito (lib/venda-racao e
 * lib/precificacao-racao): ali as contas são de fato diferentes. O que se
 * compartilha é só o dado do mundo real.
 *
 * REGRA INQUEBRÁVEL: nada entra sem `fonte` com instituição e ano. Se um dia
 * alguém quiser acrescentar uma formulação "de cabeça", o campo obrigatório
 * está aqui pra impedir.
 */
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'

let seqIngrediente = 0
function novoIdIngrediente(): string {
  seqIngrediente += 1
  return `ing-${Date.now().toString(36)}-${seqIngrediente}`
}

function item(nome: string, pct: number, preco: number): IngredienteFormula {
  return {
    id: novoIdIngrediente(),
    nome,
    participacao: pct,
    unidadeParticipacao: 'pct',
    preco,
    unidadePreco: 'kg',
    pesoSacoIngrediente: 60,
  }
}

/**
 * CATÁLOGO DE FORMULAÇÕES DE REFERÊNCIA.
 *
 * Cada entrada é uma composição de partida rastreável a uma fonte técnica —
 * Embrapa, Rostagno (Tabelas Brasileiras para Aves e Suínos), NRC, universidade.
 * O vendedor escolhe a que se parece com o caso do cliente e edita em cima.
 *
 * Por que existe: até 03/08/2026 havia UMA composição fixa por espécie, e a de
 * bovinos trazia "núcleo mineral 15%" — número que o dono da empresa apontou
 * como alto pela experiência de campo. A checagem confirmou: 15% é participação
 * de PROTEINADO (suplemento proteico-mineral), não de núcleo. São produtos
 * diferentes com funções diferentes, e a tela tratava como um só.
 *
 * REGRA: nada entra aqui sem `fonte` preenchida com instituição e ano. Este
 * número vai pra dentro de um estudo que um produtor usa pra decidir
 * investimento — estimativa de memória aqui vira prejuízo na fazenda dele.
 */
export interface FormulaReferencia {
  chave: string
  nome: string
  especie: Especie
  /** Categorias do sistema em que faz sentido oferecer. Vazio = todas. */
  categorias: string[]
  /** Onde faz sentido. Vazio = Brasil todo. Usado pras trocas regionais. */
  regiao?: string
  /** Instituição + ano. Sem isto, não entra. */
  fonte: string
  /** O que o vendedor precisa saber antes de usar. */
  nota?: string
  /**
   * A fórmula leva ingrediente LÍQUIDO (óleo). A Compacta é farelada: mistura
   * só ingrediente seco. Marcar aqui não esconde a fórmula — ela continua
   * escolhível, porque é a nutricionalmente correta e o vendedor precisa saber
   * que existe. O que a marca faz é impedir que ela entre como padrão
   * automático, pra ninguém montar estudo de um equipamento que não faz aquilo
   * sem ter lido o aviso.
   */
  exigeLiquido?: boolean
  itens: IngredienteFormula[]
}

/**
 * Ainda VAZIO de propósito. O mecanismo (escolher e carregar) está pronto e
 * ligado; o conteúdo entra quando cada percentual tiver passado pela conferência
 * de fonte. Enquanto está vazio, o seletor mostra só as fórmulas salvas pelo
 * próprio time, exatamente como antes — nada muda pro vendedor.
 */
export const FORMULAS_REFERENCIA: FormulaReferencia[] = [
  // ═══════════ BOVINOS DE CORTE ═══════════
  {
    chave: 'bc-semiconf', nome: 'Semiconfinamento — Embrapa', especie: 'bovinos',
    categorias: ['gado_corte', 'semi_confinamento'],
    fonte: 'Embrapa, Nutrição de bovinos de corte (2015), Cap. 9, Quadro 9.4, p.128',
    nota: 'A Embrapa apresenta como produzível no estabelecimento rural. É a resposta direta ao antigo "núcleo 15%": menos de UM por cento de mineral.',
    itens: [
      item('Milho triturado', 69.8, 1.08), item('Farelo de soja', 28, 1.6),
      item('Ureia', 1, 3.6), item('Sal mineral', 0.7, 2.2),
      item('Sal comum (NaCl)', 0.4, 0.9), item('Sulfato de amônia', 0.1, 2.8),
    ],
  },
  {
    chave: 'bc-pasto-8', nome: 'Engorda a pasto — oferta 8 g/kg PV', especie: 'bovinos',
    categorias: ['engorda', 'recria'],
    fonte: 'Embrapa Gado de Corte, Documentos 108 (2001), Tabela 3',
    nota: 'PB 21,1% / NDT 80,1%. Compare com a de 12 g/kg: mesma fonte, mesmo animal, só mudou a oferta diária — e o mineral cai pela metade.',
    itens: [
      item('Milho triturado', 78.94, 1.08), item('Farelo de soja', 16.49, 1.6),
      item('Ureia', 1.69, 3.6), item('Calcário calcítico', 1.29, 0.4),
      item('Mistura mineral', 1.24, 2.2), item('Sulfato de amônio', 0.3, 2.8),
      item('Ionóforo', 0.05, 45),
    ],
  },
  {
    chave: 'bc-pasto-12', nome: 'Engorda a pasto — oferta 12 g/kg PV', especie: 'bovinos',
    categorias: ['engorda'],
    fonte: 'Embrapa Gado de Corte, Documentos 108 (2001), Tabela 3',
    nota: 'O mineral cai de 1,24% para 0,60% só porque o animal come mais por dia. A exigência é em GRAMAS/dia; a porcentagem é consequência da diluição.',
    itens: [
      item('Milho triturado', 81.86, 1.08), item('Farelo de soja', 15.17, 1.6),
      item('Ureia', 1.22, 3.6), item('Calcário calcítico', 0.89, 0.4),
      item('Mistura mineral', 0.6, 2.2), item('Sulfato de amônio', 0.22, 2.8),
      item('Ionóforo', 0.04, 45),
    ],
  },
  {
    chave: 'bc-confinamento', nome: 'Concentrado de confinamento', especie: 'bovinos',
    categorias: ['confinamento'],
    fonte: 'Embrapa Pecuária Sudeste, Criação de Bovinos de Corte na Região Sudeste',
    nota: 'É a parte CONCENTRADA da dieta — o volumoso entra por fora e não conta aqui.',
    itens: [
      item('Milho em grão moído', 56.6, 1.08), item('Farelo de trigo', 21.6, 1.05),
      item('Farelo de soja', 18.4, 1.6), item('Mistura mineral', 2, 2.2),
      item('Calcário calcítico', 1.4, 0.4),
    ],
  },

  // ═══════════ BOVINOS DE LEITE ═══════════
  {
    chave: 'bl-15-25', nome: 'Concentrado — vaca de 15 a 25 L/dia', especie: 'bovinos',
    categorias: ['gado_leite'],
    fonte: 'Embrapa Gado de Leite, Orientação Técnica nº 17 (1996), opção 02',
    nota: 'PB 20,0%. A fração mineral fica em 3% em 17 das 23 formulações oficiais da Embrapa.',
    itens: [
      item('Milho moído', 51.5, 1.08), item('Farelo de soja', 27, 1.6),
      item('Farelo de algodão', 15, 1.3), item('Farelo de trigo', 3.5, 1.05),
      item('Calcário calcítico', 2, 0.4), item('Mistura mineral', 1, 2.2),
    ],
  },
  {
    chave: 'bl-acima-25', nome: 'Concentrado — vaca acima de 25 L/dia', especie: 'bovinos',
    categorias: ['gado_leite'],
    fonte: 'Embrapa Gado de Leite, Orientação Técnica nº 17 (1996), opção 01',
    nota: 'PB 22,0%.',
    itens: [
      item('Milho moído', 62, 1.08), item('Farelo de soja', 35, 1.6),
      item('Calcário calcítico', 1.5, 0.4), item('Mistura mineral', 1.5, 2.2),
    ],
  },
  {
    chave: 'bl-ate-15', nome: 'Concentrado — vaca até 15 L/dia', especie: 'bovinos',
    categorias: ['gado_leite', 'manutencao'],
    fonte: 'Embrapa Gado de Leite, Orientação Técnica nº 17 (1996), opção 09',
    nota: 'PB 19,7%.',
    itens: [
      item('Milho moído', 85, 1.08), item('Farelo de soja', 10, 1.6),
      item('Ureia', 2, 3.6), item('Calcário calcítico', 2, 0.4),
      item('Mistura mineral', 1, 2.2),
    ],
  },
  {
    chave: 'bl-bezerra', nome: 'Concentrado — bezerra/novilha até 12 meses', especie: 'bovinos',
    categorias: ['cria', 'recria'],
    fonte: 'Embrapa Gado de Leite, Instrução Técnica 39, opção 8',
    itens: [
      item('Milho moído', 75, 1.08), item('Farelo de soja', 22, 1.6),
      item('Calcário calcítico', 2, 0.4), item('Mistura mineral', 1, 2.2),
    ],
  },

  // ═══════════ SUÍNOS ═══════════
  {
    chave: 'su-ciclo', nome: 'Ciclo completo (quando não separa fases)', especie: 'suinos',
    categorias: [],
    fonte: 'Embrapa Suínos e Aves, Sistema de Produção de Suínos',
    nota: 'MATRIZ FECHADA, não estimativa: 7.000 kg de ração = 5.260 milho + 1.500 soja + 240 núcleo, por porca/ano com 20 leitões terminados a 105 kg. É o número mais defensável do catálogo.',
    itens: [
      item('Milho', 75.14, 1.08), item('Farelo de soja', 21.43, 1.6),
      item('Núcleo suínos', 3.43, 5.33),
    ],
  },
  {
    chave: 'su-cresc', nome: 'Crescimento (25 a 55/70 kg)', especie: 'suinos',
    categorias: ['crescimento'],
    fonte: 'Ficha técnica ADM Núcleo Suínos Crescimento/Terminação 3%',
    nota: 'Garantia de Ca 24-24,5% no núcleo dá 0,72% de Ca na ração — a exigência Embrapa na casa decimal. Sem calcário por fora: o núcleo já traz.',
    itens: [
      item('Milho', 77, 1.08), item('Farelo de soja', 20, 1.6),
      item('Núcleo suínos', 3, 5.33),
    ],
  },
  {
    chave: 'su-term', nome: 'Terminação (55/70 a 110 kg)', especie: 'suinos',
    categorias: ['terminacao'],
    fonte: 'Ficha técnica ADM Núcleo Suínos Crescimento/Terminação 3%',
    nota: 'A fase que mais pesa no custo total. PB 13,9% contra 13,0% da exigência Embrapa.',
    itens: [
      item('Milho', 82, 1.08), item('Farelo de soja', 15, 1.6),
      item('Núcleo suínos', 3, 5.33),
    ],
  },
  {
    chave: 'su-gest', nome: 'Matriz em gestação', especie: 'suinos',
    categorias: ['gestacao', 'reprodutores'],
    fonte: 'Ficha técnica ADM Núcleo Suínos Reprodução 3% (580+240+150+30 kg/t)',
    nota: 'O farelo de trigo entra como FIBRA: a matriz é arraçoada restrita e precisa de saciedade. Sem trigo na região, a fórmula muda bastante.',
    itens: [
      item('Milho', 58, 1.08), item('Farelo de trigo', 24, 1.05),
      item('Farelo de soja', 15, 1.6), item('Núcleo suínos', 3, 5.33),
    ],
  },
  {
    chave: 'su-lact', nome: 'Matriz em lactação', especie: 'suinos',
    categorias: ['lactacao'],
    fonte: 'Ficha técnica ADM Núcleo Suínos Reprodução 3% (650+280+40+30 kg/t)',
    itens: [
      item('Milho', 65, 1.08), item('Farelo de soja', 28, 1.6),
      item('Açúcar', 4, 3.2), item('Núcleo suínos', 3, 5.33),
    ],
  },

  // ═══════════ AVES ═══════════
  {
    chave: 'av-postura', nome: 'Poedeira em postura', especie: 'aves',
    categorias: ['postura', 'pre_postura'],
    fonte: 'Ficha Integral Mix Avenúcleo Postura (50 kg/1.000 kg) — garantia Ca 200-300 g/kg, P 75 g/kg, Na 30 g/kg',
    nota: 'ÚNICA categoria de ave em que calcário por fora é OBRIGATÓRIO: a poedeira precisa de 3,4 a 4,2% de cálcio pra fazer casca. 5% de núcleo + 7,5% de calcário entrega 3,9-4,4%. O padrão antigo (calcário 2%) entregava 0,76% — ração incapaz de fazer casca de ovo.',
    itens: [
      item('Milho moído', 63, 1.08), item('Farelo de soja', 24.5, 1.6),
      item('Calcário calcítico', 7.5, 0.4), item('Núcleo de postura', 5, 6.8),
    ],
  },
  {
    chave: 'av-frango-ini', nome: 'Frango de corte — inicial (0 a 21 dias)', especie: 'aves',
    categorias: ['frango_inicial'],
    exigeLiquido: true,
    fonte: 'Embrapa Suínos e Aves, Coeficientes técnicos para o cálculo do custo de produção de frango de corte (2010), Tabela 7, p.9 — extraída do PDF e somada: fecha 100,000%',
    nota: 'ATENÇÃO — LEVA ÓLEO. A Embrapa formula com 4 a 5,7% de óleo de soja, e a Compacta é FARELADA: mistura só ingrediente seco. Ou o cliente tem kit de adição de líquido, ou um zootecnista precisa refazer a fórmula sem óleo — o que derruba a energia e muda o desempenho. Não tire o óleo por conta própria. Percentuais são da Embrapa; os preços são referência, ajuste pelos da região.',
    itens: [
      item('Milho moído', 55.64, 1.08),
      item('Farelo de soja', 36.0, 1.6),
      item('Óleo de soja', 4.0, 7.5),
      item('Fosfato bicálcico', 1.85, 4.5),
      item('Calcário calcítico', 1.2, 0.4),
      item('Sal comum', 0.5, 0.9),
      item('Adsorvente', 0.2, 3.0),
      item('DL-Metionina', 0.25, 28.0),
      item('Premix mineral', 0.1, 15.0),
      item('Premix vitamínico', 0.1, 22.0),
      item('Cloreto de colina', 0.04, 12.0),
      item('Aditivo zootécnico', 0.01, 45.0),
      item('Antioxidante', 0.015, 18.0),
      item('Aditivo anticoccidiano', 0.025, 60.0),
      item('L-Lisina HCL', 0.07, 12.0),
    ],
  },
  {
    chave: 'av-frango-cres', nome: 'Frango de corte — crescimento (22 a 35 dias)', especie: 'aves',
    categorias: ['frango_crescimento'],
    exigeLiquido: true,
    fonte: 'Embrapa Suínos e Aves, Coeficientes técnicos para o cálculo do custo de produção de frango de corte (2010), Tabela 7, p.9 — extraída do PDF e somada: fecha 100,000%',
    nota: 'ATENÇÃO — LEVA ÓLEO. A Embrapa formula com 4 a 5,7% de óleo de soja, e a Compacta é FARELADA: mistura só ingrediente seco. Ou o cliente tem kit de adição de líquido, ou um zootecnista precisa refazer a fórmula sem óleo — o que derruba a energia e muda o desempenho. Não tire o óleo por conta própria. Percentuais são da Embrapa; os preços são referência, ajuste pelos da região.',
    itens: [
      item('Milho moído', 58.19, 1.08),
      item('Farelo de soja', 33.2, 1.6),
      item('Óleo de soja', 5.0, 7.5),
      item('Fosfato bicálcico', 1.65, 4.5),
      item('Calcário calcítico', 0.8, 0.4),
      item('Sal comum', 0.45, 0.9),
      item('Adsorvente', 0.2, 3.0),
      item('DL-Metionina', 0.19, 28.0),
      item('Premix mineral', 0.1, 15.0),
      item('Premix vitamínico', 0.1, 22.0),
      item('Cloreto de colina', 0.07, 12.0),
      item('Aditivo zootécnico', 0.01, 45.0),
      item('Antioxidante', 0.015, 18.0),
      item('Aditivo anticoccidiano', 0.025, 60.0),
    ],
  },
  {
    chave: 'av-frango-fin', nome: 'Frango de corte — final (36 dias ao abate)', especie: 'aves',
    categorias: ['frango_final'],
    exigeLiquido: true,
    fonte: 'Embrapa Suínos e Aves, Coeficientes técnicos para o cálculo do custo de produção de frango de corte (2010), Tabela 7, p.9 — extraída do PDF e somada: fecha 100,000%',
    nota: 'ATENÇÃO — LEVA ÓLEO. A Embrapa formula com 4 a 5,7% de óleo de soja, e a Compacta é FARELADA: mistura só ingrediente seco. Ou o cliente tem kit de adição de líquido, ou um zootecnista precisa refazer a fórmula sem óleo — o que derruba a energia e muda o desempenho. Não tire o óleo por conta própria. Percentuais são da Embrapa; os preços são referência, ajuste pelos da região.',
    itens: [
      item('Milho moído', 62.43, 1.08),
      item('Farelo de soja', 28.59, 1.6),
      item('Óleo de soja', 5.693, 7.5),
      item('Fosfato bicálcico', 1.5, 4.5),
      item('Calcário calcítico', 0.75, 0.4),
      item('Sal comum', 0.44, 0.9),
      item('Adsorvente', 0.2, 3.0),
      item('DL-Metionina', 0.109, 28.0),
      item('Premix mineral', 0.1, 15.0),
      item('Premix vitamínico', 0.1, 22.0),
      item('Cloreto de colina', 0.063, 12.0),
      item('Aditivo zootécnico', 0.01, 45.0),
      item('Antioxidante', 0.015, 18.0),
    ],
  }
]

/**
 * As de referência que servem pra esta espécie/categoria.
 *
 * ORDEM IMPORTA: quem cita a categoria explicitamente vem antes de quem vale
 * pra todas (`categorias: []`), porque `formulaPadrao` usa o primeiro da lista.
 * Sem isso, o "Ciclo completo" de suínos — que é o coringa — sequestrava
 * Crescimento e Terminação, que têm fórmula própria e mais precisa.
 */
export function formulasReferencia(especie: Especie, categoria: string): FormulaReferencia[] {
  const daEspecie = FORMULAS_REFERENCIA.filter(f => f.especie === especie)
  const especificas = daEspecie.filter(f => f.categorias.includes(categoria))
  const coringas = daEspecie.filter(f => f.categorias.length === 0)
  return [...especificas, ...coringas]
}
