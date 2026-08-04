/**
 * Catálogos do módulo Venda de Ração: espécies, categorias/fases, consumo
 * sugerido, fórmulas de partida, ingredientes e defaults da empresa.
 *
 * ORIGEM DOS NÚMEROS: reaproveitados do estudo de viabilidade que já roda em
 * produção (branorte-viabilidade), que foi calibrado com criadores reais e
 * material Embrapa/genéticas. NÃO são recomendação nutricional — são ponto de
 * partida EDITÁVEL. O consumo real varia com peso, genética, fase, manejo e
 * objetivo produtivo; a formulação tem que ser definida/validada por
 * profissional habilitado.
 *
 * Consumo está sempre em **kg por animal por mês** (mês comercial de 30 dias).
 * Preço de ingrediente em **R$/kg**.
 */
import { formulasReferencia } from '@/lib/formulacoes-racao'
import type {
  Cenarios, ConfigVendaRacao, Especie, IngredienteFormula, UnidadePreco,
} from './tipos'

export const ESPECIES: Array<{
  chave: Especie
  nome: string
  icone: string
  /** Como chamar o animal no plural ("frangos", "cabeças"…). */
  animal: string
  /** Espécie sem contagem de animais (vende por volume direto). */
  semAnimais?: boolean
}> = [
  { chave: 'bovinos', nome: 'Ração para bovinos', icone: '🐂', animal: 'cabeças' },
  { chave: 'suinos',  nome: 'Ração para suínos',  icone: '🐷', animal: 'suínos' },
  { chave: 'aves',    nome: 'Ração para aves',    icone: '🐔', animal: 'aves' },
  { chave: 'milho',   nome: 'Milho triturado',    icone: '🌽', animal: 'animais', semAnimais: true },
]

export interface Categoria {
  chave: string
  nome: string
  /** kg por animal por mês — sugestão editável. 0 = sem sugestão. */
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
    { chave: 'granel',    nome: 'Milho triturado a granel',      consumoMes: 0 },
    { chave: 'ensacado',  nome: 'Milho triturado ensacado',      consumoMes: 0 },
    { chave: 'com_entrega', nome: 'Milho triturado com entrega', consumoMes: 0 },
    { chave: 'outro',     nome: 'Outro',                         consumoMes: 0 },
  ],
}

/** Catálogo local de matérias-primas (fallback quando o banco está vazio). */
export const INGREDIENTES_PADRAO: Array<{ nome: string; preco: number; unidade: UnidadePreco }> = [
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
  { nome: 'Óleo / gordura',     preco: 6.00, unidade: 'kg' },
  { nome: 'Silagem / volumoso', preco: 0.40, unidade: 'kg' },
  { nome: 'Ureia',              preco: 3.50, unidade: 'kg' },
]

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
 * Composição de PARTIDA por espécie (soma 100%). É um rascunho pro vendedor
 * editar — não substitui formulação profissional.
 */
export function formulaPadrao(especie: Especie, categoria?: string): IngredienteFormula[] {
  // MESMA fonte da /producao-propria: @/lib/formulacoes-racao, com percentual
  // rastreado a Embrapa/ficha técnica. Antes daqui esta tela tinha catálogo
  // próprio, e ele estava PIOR que o do estudo: bovinos com "Silagem/volumoso
  // 20%" — que a Compacta nem mistura, e o outro módulo proíbe por teste — mais
  // núcleo mineral 14%, o mesmo erro de confundir núcleo com proteinado.
  if (categoria) {
    const opcoes = formulasReferencia(especie, categoria)
    const escolhida = opcoes.find(f => !f.exigeLiquido) ?? opcoes[0]
    if (escolhida) return escolhida.itens.map(i => ({ ...i, id: novoIdIngrediente() }))
  }
  switch (especie) {
    case 'aves':
      return [
        item('Milho', 58, 1.08),
        item('Farelo de soja', 33, 1.60),
        item('Óleo / gordura', 2, 6.00),
        item('Núcleo / premix', 7, 6.80),
      ]
    case 'suinos':
      return [
        item('Milho', 72, 1.08),
        item('Farelo de soja', 22, 1.60),
        item('Núcleo / premix', 6, 5.33),
      ]
    case 'bovinos':
      return [
        item('Milho', 56, 1.08),
        item('Silagem / volumoso', 20, 0.40),
        item('Núcleo mineral', 14, 2.20),
        item('Farelo de soja', 10, 1.60),
      ]
    case 'milho':
    default:
      return []
  }
}

export const PESOS_SACO = [20, 25, 30, 40, 50]

export const STATUS_PROPOSTA: Array<{ chave: string; nome: string; cor: string }> = [
  { chave: 'rascunho',   nome: 'Rascunho',        cor: 'cinza' },
  { chave: 'enviada',    nome: 'Proposta enviada', cor: 'azul' },
  { chave: 'negociacao', nome: 'Em negociação',    cor: 'ouro' },
  { chave: 'aprovada',   nome: 'Aprovada',         cor: 'verde' },
  { chave: 'vendida',    nome: 'Vendida',          cor: 'verde' },
  { chave: 'perdida',    nome: 'Perdida',          cor: 'vermelho' },
  { chave: 'cancelada',  nome: 'Cancelada',        cor: 'cinza' },
]

export const CENARIOS_PADRAO: Cenarios = {
  conservador: { materiaPrimaPct: 20, fretePct: 20,  perdaPct: 0,   margemPct: null },
  provavel:    { materiaPrimaPct: 0,  fretePct: 0,   perdaPct: 0,   margemPct: null },
  otimista:    { materiaPrimaPct: -10, fretePct: -5, perdaPct: -50, margemPct: null },
}

/**
 * Defaults da empresa. Ficam em venda_racao_config (JSONB) e são editáveis na
 * área de Configurações — o código nunca trava valor comercial.
 */
export const CONFIG_PADRAO: ConfigVendaRacao = {
  margemPorEspecie:       { bovinos: 20, suinos: 18, aves: 15, milho: 15 },
  margemMinimaPorEspecie: { bovinos: 15, suinos: 12, aves: 10, milho: 10 },
  impostosPct: 5,
  comissaoPct: 3,
  taxaFinanceiraPct: 0,
  taxaCartaoPct: 0,
  pesoSacoPadrao: 40,
  custosPadrao: {
    perdaPct: 1.5,
    energia:        { ativo: true,  valor: 0.035 },
    maoDeObra:      { ativo: true,  valor: 0.10 },
    moagem:         { ativo: true,  valor: 0.02 },
    mistura:        { ativo: true,  valor: 0.02 },
    manutencao:     { ativo: true,  valor: 0.03 },
    depreciacao:    { ativo: true,  valor: 0.03 },
    administrativo: { ativo: true,  valor: 0.03 },
    carregamento:   { ativo: true,  valor: 0.02 },
    outrosVariaveis:{ ativo: false, valor: 0 },
    embalagem:      { ativo: true,  valor: 1.20 },
    etiqueta:       { ativo: false, valor: 0.10 },
  },
  prazoPadrao: '28 dias',
  formaPagamentoPadrao: 'Boleto',
  condicaoEntregaPadrao: 'CIF — entrega inclusa',
  validadeDias: 7,
  textoComercial: 'Ração produzida sob encomenda, com matéria-prima conferida lote a lote.',
  avisoNutricional:
    'A formulação deve ser definida ou validada por profissional habilitado em nutrição animal. '
    + 'O consumo pode variar conforme peso, genética, fase, manejo e objetivo produtivo.',
  cenarios: CENARIOS_PADRAO,
}

/** Mescla o que veio do banco em cima dos defaults (config parcial é válida). */
export function mesclarConfig(bruto: unknown): ConfigVendaRacao {
  if (!bruto || typeof bruto !== 'object') return CONFIG_PADRAO
  const c = bruto as Partial<ConfigVendaRacao>
  return {
    ...CONFIG_PADRAO,
    ...c,
    margemPorEspecie:       { ...CONFIG_PADRAO.margemPorEspecie,       ...(c.margemPorEspecie ?? {}) },
    margemMinimaPorEspecie: { ...CONFIG_PADRAO.margemMinimaPorEspecie, ...(c.margemMinimaPorEspecie ?? {}) },
    custosPadrao:           { ...CONFIG_PADRAO.custosPadrao,           ...(c.custosPadrao ?? {}) },
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
