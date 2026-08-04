/**
 * Catálogos do Estudo de Viabilidade da Produção Própria: espécies, fases,
 * consumo de REFERÊNCIA, fórmulas de partida, matérias-primas, capacidades da
 * linha Branorte e defaults da empresa.
 *
 * ORIGEM DOS NÚMEROS: reaproveitados do estudo de viabilidade que já roda em
 * produção (branorte-viabilidade), calibrado com criadores reais e material
 * Embrapa/genéticas. NÃO são recomendação nutricional nem verdade sobre o
 * cliente — são ponto de partida EDITÁVEL. O consumo real varia com peso,
 * genética, fase, manejo, formulação e objetivo produtivo; a formulação tem que
 * ser definida/validada por profissional habilitado.
 *
 * Consumo está sempre em **kg por animal por mês** (mês comercial de 30 dias).
 * Preço de ingrediente em **R$/kg**.
 */
import type {
  Cenarios, ConfigEstudo, Especie, IngredienteFormula, StatusEstudo, UnidadePreco,
} from './tipos'

export const ESPECIES: Array<{
  chave: Especie
  nome: string
  icone: string
  /** Como chamar o animal no plural ("aves", "cabeças"…). */
  animal: string
  /** Produto sem contagem de animais (dimensiona por volume direto). */
  semAnimais?: boolean
}> = [
  { chave: 'bovinos', nome: 'Ração farelada para bovinos', icone: '🐂', animal: 'cabeças' },
  { chave: 'suinos',  nome: 'Ração farelada para suínos',  icone: '🐷', animal: 'suínos' },
  { chave: 'aves',    nome: 'Ração farelada para aves',    icone: '🐔', animal: 'aves' },
  { chave: 'milho',   nome: 'Milho triturado',             icone: '🌽', animal: 'animais', semAnimais: true },
]

export interface Categoria {
  chave: string
  nome: string
  /** kg por animal por mês — REFERÊNCIA editável. 0 = sem sugestão. */
  consumoMes: number
  nota?: string
}

/**
 * Categorias/fases por espécie. A última é sempre "Outro" (texto livre) pra
 * nunca travar o vendedor numa lista fechada.
 */
export const CATEGORIAS: Record<Especie, Categoria[]> = {
  bovinos: [
    { chave: 'gado_corte',        nome: 'Gado de corte',            consumoMes: 300, nota: 'Concentrado/mix — no confinamento a dieta completa (TMR com silagem) é bem maior.' },
    { chave: 'gado_leite',        nome: 'Gado de leite',            consumoMes: 240, nota: 'Só o concentrado; a vaca também consome pasto/silagem.' },
    { chave: 'cria',              nome: 'Cria (matriz)',            consumoMes: 5,   nota: 'Sal mineral/proteinado — ~165 g/dia.' },
    { chave: 'recria',            nome: 'Recria',                   consumoMes: 60,  nota: 'Garrote/novilha a pasto — ~0,67% do peso vivo.' },
    { chave: 'engorda',           nome: 'Engorda',                  consumoMes: 297 },
    { chave: 'semi_confinamento', nome: 'Semi-confinamento',        consumoMes: 120, nota: 'Concentrado ~1,0% do peso vivo.' },
    { chave: 'confinamento',      nome: 'Confinamento',             consumoMes: 297, nota: 'Concentrado ~2,2% do peso vivo (450 kg).' },
    { chave: 'manutencao',        nome: 'Ração de manutenção',      consumoMes: 18,  nota: 'Suplementação a pasto — ~0,15% do peso vivo.' },
    { chave: 'proteica',          nome: 'Ração proteica',           consumoMes: 18,  nota: 'Proteinado de seca.' },
    { chave: 'outro',             nome: 'Outro',                    consumoMes: 0 },
  ],
  suinos: [
    { chave: 'pre_inicial',  nome: 'Pré-inicial',   consumoMes: 7,   nota: 'Pós-desmame — consumo baixo e ração cara.' },
    { chave: 'inicial',      nome: 'Inicial',       consumoMes: 14,  nota: 'Creche.' },
    { chave: 'crescimento',  nome: 'Crescimento',   consumoMes: 57 },
    { chave: 'terminacao',   nome: 'Terminação',    consumoMes: 90 },
    { chave: 'gestacao',     nome: 'Gestação',      consumoMes: 75,  nota: 'Matriz em gestação — consumo controlado.' },
    { chave: 'lactacao',     nome: 'Lactação',      consumoMes: 165, nota: 'Matriz em lactação — pico de consumo.' },
    { chave: 'reprodutores', nome: 'Reprodutores',  consumoMes: 67,  nota: 'Cachaço.' },
    { chave: 'outro',        nome: 'Outro',         consumoMes: 0 },
  ],
  aves: [
    { chave: 'frango_inicial',      nome: 'Frango de corte — inicial',     consumoMes: 2.7,  nota: '8–21 dias.' },
    { chave: 'frango_crescimento',  nome: 'Frango de corte — crescimento', consumoMes: 3.0,  nota: 'Média do ciclo completo.' },
    { chave: 'frango_final',        nome: 'Frango de corte — final',       consumoMes: 5.4,  nota: 'Fase de engorda (pico).' },
    { chave: 'poedeira_inicial',    nome: 'Poedeiras — inicial',           consumoMes: 0.9,  nota: 'Pintainha / cria (1–6 sem).' },
    { chave: 'poedeira_crescimento',nome: 'Poedeiras — crescimento',       consumoMes: 1.95, nota: 'Recria / frangã (7–17 sem).' },
    { chave: 'pre_postura',         nome: 'Pré-postura',                   consumoMes: 2.7 },
    { chave: 'postura',             nome: 'Postura',                       consumoMes: 3.4,  nota: 'Postura comercial (vermelha). Leve/branca ~3,0.' },
    { chave: 'caipira',             nome: 'Caipira ou colonial',           consumoMes: 3.0,  nota: 'Frango caipira 85–90 dias; poedeira colonial ~3,75.' },
    { chave: 'outro',               nome: 'Outro',                         consumoMes: 0 },
  ],
  milho: [
    { chave: 'granel',      nome: 'Milho triturado a granel', consumoMes: 0 },
    { chave: 'ensacado',    nome: 'Milho triturado ensacado', consumoMes: 0 },
    { chave: 'outro',       nome: 'Outro',                    consumoMes: 0 },
  ],
}

/**
 * Catálogo local de matérias-primas (fallback quando o banco está vazio).
 *
 * `umido` e `liquido` marcam o que NÃO entra numa fábrica farelada comum. Só
 * aparecem no seletor quando a configuração declara que o equipamento e o
 * processo são compatíveis (`permiteIngredientesUmidos`).
 */
export const INGREDIENTES_PADRAO: Array<{
  nome: string; preco: number; unidade: UnidadePreco; umido?: boolean; liquido?: boolean
}> = [
  { nome: 'Milho',              preco: 1.08, unidade: 'kg' },
  { nome: 'Farelo de soja',     preco: 1.60, unidade: 'kg' },
  { nome: 'Sorgo',              preco: 0.95, unidade: 'kg' },
  { nome: 'Farelo de trigo',    preco: 1.10, unidade: 'kg' },
  { nome: 'Casquinha de soja',  preco: 0.85, unidade: 'kg' },
  { nome: 'Caroço de algodão',  preco: 1.30, unidade: 'kg' },
  { nome: 'Farelo de algodão',  preco: 1.40, unidade: 'kg' },
  { nome: 'Raspa de mandioca',  preco: 0.90, unidade: 'kg' },
  { nome: 'Núcleo / premix',    preco: 6.00, unidade: 'kg' },
  { nome: 'Núcleo mineral',     preco: 2.20, unidade: 'kg' },
  { nome: 'Calcário',           preco: 0.40, unidade: 'kg' },
  { nome: 'Sal comum',          preco: 1.20, unidade: 'kg' },
  { nome: 'Fosfato bicálcico',  preco: 4.50, unidade: 'kg' },
  { nome: 'Ureia',              preco: 3.50, unidade: 'kg' },
  { nome: 'Óleo / gordura',     preco: 6.00, unidade: 'kg', liquido: true },
  { nome: 'Silagem / volumoso', preco: 0.40, unidade: 'kg', umido: true },
]

/** Nomes que exigem processo compatível — usado pra avisar em fórmula salva. */
export const INGREDIENTES_RESTRITOS = INGREDIENTES_PADRAO
  .filter(i => i.umido || i.liquido)
  .map(i => i.nome.toLowerCase())

/** Detecta ingrediente úmido/líquido pelo nome (fórmulas antigas e digitadas). */
export function ehIngredienteRestrito(nome: string): boolean {
  const t = (nome || '').toLowerCase()
  if (!t) return false
  return ['silagem', 'volumoso', 'óleo', 'oleo', 'gordura', 'melaço', 'melaco', 'soro']
    .some(x => t.includes(x))
}

let seqIngrediente = 0
export function novoIdIngrediente(): string {
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

/**
 * Composição de PARTIDA por espécie (soma exatamente 100%). É um rascunho pro
 * vendedor editar — não substitui formulação profissional. Só ingredientes
 * secos: a Compacta é farelada.
 */
export function formulaPadrao(especie: Especie, categoria?: string): IngredienteFormula[] {
  // O catálogo de referência manda, quando tem entrada pra esta categoria.
  // Era aqui que morava o problema: UMA composição por espécie, sendo que
  // bovinos tem 9 categorias com consumo de 5 a 300 kg/mês. A participação de
  // mineral é INVERSAMENTE proporcional ao quanto o animal come por dia — a
  // exigência é em gramas/dia, e a porcentagem é só a diluição. Por isso
  // nenhum número único podia estar certo em mais de uma linha.
  if (categoria) {
    const opcoes = formulasReferencia(especie, categoria)
    // PREFERE a que não exige líquido — a Compacta é farelada. Mas se a única
    // com fonte carrega óleo (é o caso do frango de corte, onde a Embrapa
    // formula com 4 a 5,7%), ela entra mesmo assim, com a ressalva junto.
    //
    // A escolha entre os dois erros possíveis: cair no padrão antigo deixaria o
    // vendedor montando estudo com premix 7% — 35 vezes o real — e cálcio mal
    // especificado, SEM aviso nenhum. Com a da Embrapa ele vê o número certo e
    // lê que precisa de kit de líquido ou de um zootecnista pra refazer. Erro
    // avisado é melhor que erro silencioso.
    const doCatalogo = opcoes.find(f => !f.exigeLiquido) ?? opcoes[0]
    if (doCatalogo) return doCatalogo.itens.map(i => ({ ...i, id: novoIdIngrediente() }))
  }
  switch (especie) {
    case 'aves':
      return [
        item('Milho', 58, 1.08),
        item('Farelo de soja', 33, 1.60),
        item('Núcleo / premix', 7, 6.80),
        item('Calcário', 2, 0.40),
      ]
    case 'suinos':
      return [
        item('Milho', 72, 1.08),
        item('Farelo de soja', 22, 1.60),
        item('Núcleo / premix', 6, 5.33),
      ]
    case 'bovinos':
      return [
        item('Milho', 60, 1.08),
        item('Farelo de soja', 22, 1.60),
        item('Núcleo mineral', 15, 2.20),
        item('Calcário', 3, 0.40),
      ]
    case 'milho':
    default:
      return []
  }
}

export const PESOS_SACO = [20, 25, 30, 40, 50]

/** Capacidades da linha Branorte, em kg/h. Editável em Configurações. */
export const CAPACIDADES_BRANORTE = [300, 600, 1000, 1500, 2000, 3000, 5000]

export const STATUS_ESTUDO: Array<{ chave: StatusEstudo; nome: string; cor: string }> = [
  { chave: 'rascunho',    nome: 'Rascunho',              cor: 'cinza' },
  { chave: 'apresentado', nome: 'Estudo apresentado',    cor: 'azul' },
  { chave: 'analisando',  nome: 'Cliente analisando',    cor: 'azul' },
  { chave: 'negociacao',  nome: 'Projeto em negociação', cor: 'ouro' },
  { chave: 'aprovado',    nome: 'Projeto aprovado',      cor: 'verde' },
  { chave: 'vendido',     nome: 'Equipamento vendido',   cor: 'verde' },
  { chave: 'nao_avancou', nome: 'Não avançou',           cor: 'vermelho' },
  { chave: 'cancelado',   nome: 'Cancelado',             cor: 'cinza' },
]

/**
 * Status do módulo antigo de precificação → status do estudo. Simulação salva
 * antes de 08/2026 continua abrindo, só que já com o nome novo.
 */
export const STATUS_LEGADO: Record<string, StatusEstudo> = {
  rascunho: 'rascunho',
  enviada: 'apresentado',
  negociacao: 'negociacao',
  aprovada: 'aprovado',
  vendida: 'vendido',
  perdida: 'nao_avancou',
  cancelada: 'cancelado',
}

export function normalizarStatus(bruto: unknown): StatusEstudo {
  const s = String(bruto ?? '')
  if (STATUS_ESTUDO.some(x => x.chave === s)) return s as StatusEstudo
  return STATUS_LEGADO[s] ?? 'rascunho'
}

export function nomeStatus(s: string): string {
  return STATUS_ESTUDO.find(x => x.chave === normalizarStatus(s))?.nome ?? s
}

/**
 * Cenários: variam SÓ o que é coerente com um estudo de viabilidade — preço de
 * ingrediente, perda, custo operacional, preço da ração comprada, consumo e
 * investimento. Nada de margem comercial.
 */
export const CENARIOS_PADRAO: Cenarios = {
  conservador: { ingredientesPct: 20, perdaPct: 50, operacionaisPct: 20, racaoCompradaPct: -10, consumoPct: 0, investimentoPct: 10 },
  provavel:    { ingredientesPct: 0,  perdaPct: 0,  operacionaisPct: 0,  racaoCompradaPct: 0,   consumoPct: 0, investimentoPct: 0 },
  otimista:    { ingredientesPct: -10, perdaPct: -50, operacionaisPct: -10, racaoCompradaPct: 5, consumoPct: 0, investimentoPct: 0 },
}

/**
 * De onde veio cada valor padrão. Aparece na tela ao lado do campo — nenhum
 * default pode ser tratado como custo real da propriedade sem o vendedor
 * confirmar.
 */
export const ORIGEM_CUSTOS: Record<string, string> = {
  perdaPct: 'Estimativa: quebra de moagem e mistura em fábrica farelada bem operada.',
  energia: 'Estimativa: motores da linha a ~70% de carga, tarifa rural média.',
  maoDeObra: 'Estimativa: operador em tempo parcial rateado no volume produzido.',
  moagem: 'Estimativa: desgaste de martelos e peneiras do moinho.',
  mistura: 'Estimativa: energia e desgaste do misturador.',
  manutencao: 'Estimativa: manutenção preventiva anual diluída no volume.',
  depreciacao: 'Estimativa: depreciação contábil do equipamento diluída no volume.',
  administrativo: 'Estimativa: controle de estoque, notas e conferência.',
  carregamento: 'Estimativa: movimentação interna até o trato.',
  outrosVariaveis: 'Campo livre — desligado por padrão.',
  embalagem: 'Estimativa: saco de ráfia novo. Desligue quando o trato for a granel.',
  etiqueta: 'Só quando o cliente identifica lote. Desligado por padrão.',
  custosFixosMensais: 'Informe apenas o que existe de fato na propriedade.',
}

/**
 * Defaults da empresa. Ficam em venda_racao_config (JSONB) e são editáveis na
 * área de Configurações — o código nunca trava valor de custo.
 */
export const CONFIG_PADRAO: ConfigEstudo = {
  custosPadrao: {
    perdaPct: 1.5,
    energia:        { ativo: true,  valor: 0.035 },
    maoDeObra:      { ativo: true,  valor: 0.10 },
    moagem:         { ativo: true,  valor: 0.02 },
    mistura:        { ativo: true,  valor: 0.02 },
    manutencao:     { ativo: true,  valor: 0.03 },
    depreciacao:    { ativo: true,  valor: 0.03 },
    administrativo: { ativo: false, valor: 0.03 },
    carregamento:   { ativo: false, valor: 0.02 },
    outrosVariaveis:{ ativo: false, valor: 0 },
    embalagem:      { ativo: false, valor: 1.20 },
    etiqueta:       { ativo: false, valor: 0.10 },
  },
  dimensionamentoPadrao: {
    diasPorMes: 26,
    horasPorDia: 4,
    lotesPorDia: 0,
    frequencia: 'diaria',
    margemOperacionalPct: 20,
  },
  capacidades: CAPACIDADES_BRANORTE,
  pesoSacoPadrao: 40,
  validadeDias: 15,
  permiteIngredientesUmidos: false,
  textoApresentacao:
    'Estudo preliminar preparado pela Branorte a partir das informações fornecidas pelo cliente. '
    + 'O objetivo é comparar o custo atual da ração comprada com o custo estimado de produzi-la na própria propriedade.',
  avisoNutricional:
    'A formulação deve ser definida ou validada por profissional habilitado em nutrição animal. '
    + 'O consumo pode variar conforme peso, genética, fase, manejo e objetivo produtivo.',
  avisoEstimativa:
    'Todos os valores são ESTIMATIVAS baseadas nas informações informadas pelo vendedor e pelo cliente. '
    + 'Preços de matéria-prima, consumo, custos operacionais e investimento podem variar. '
    + 'Este documento não constitui garantia de resultado.',
  cenarios: CENARIOS_PADRAO,
}

/** Mescla o que veio do banco em cima dos defaults (config parcial é válida). */
export function mesclarConfig(bruto: unknown): ConfigEstudo {
  if (!bruto || typeof bruto !== 'object') return CONFIG_PADRAO
  const c = bruto as Partial<ConfigEstudo>
  const capacidades = Array.isArray(c.capacidades) && c.capacidades.length > 0
    ? c.capacidades.map(Number).filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
    : CONFIG_PADRAO.capacidades

  return {
    ...CONFIG_PADRAO,
    ...c,
    capacidades,
    custosPadrao: { ...CONFIG_PADRAO.custosPadrao, ...(c.custosPadrao ?? {}) },
    dimensionamentoPadrao: { ...CONFIG_PADRAO.dimensionamentoPadrao, ...(c.dimensionamentoPadrao ?? {}) },
    cenarios: {
      conservador: { ...CONFIG_PADRAO.cenarios.conservador, ...(c.cenarios?.conservador ?? {}) },
      provavel:    { ...CONFIG_PADRAO.cenarios.provavel,    ...(c.cenarios?.provavel ?? {}) },
      otimista:    { ...CONFIG_PADRAO.cenarios.otimista,    ...(c.cenarios?.otimista ?? {}) },
    },
  }
}

export function nomeEspecie(e: Especie): string {
  return ESPECIES.find(x => x.chave === e)?.nome ?? e
}

export function nomeCategoria(e: Especie, chave: string, livre?: string): string {
  if (chave === 'outro') return livre?.trim() || 'Outro'
  return CATEGORIAS[e]?.find(c => c.chave === chave)?.nome ?? chave
}
