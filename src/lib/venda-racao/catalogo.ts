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
  Cenarios, ConfigEstudo, Especie, IngredienteFormula, Produto, StatusEstudo, UnidadePreco,
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
  /**
   * Duração da fase em dias, quando ela TEM duração definida (aves e suínos
   * têm; bovino de leite não).
   *
   * ⚠️ Existe porque o vendedor não tinha como saber que período o número de
   * referência cobre. Em aves de corte `consumoMes` é, na prática, o consumo da
   * FASE INTEIRA — 2,7 kg na inicial são os ~14 dias dela, não 2,7 kg/dia nem
   * 2,7 kg/mês. Sem esse dado na tela, escolher "kg por dia" multiplicava por
   * 30 e dimensionava a fábrica ~40× maior: 3.000 frangos viravam 333 t/mês
   * quando o real é ~7,9 t/mês.
   */
  diasFase?: number
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
    { chave: 'frango_inicial',      nome: 'Frango de corte — inicial',     consumoMes: 1.18, diasFase: 14, nota: '1 a 14 dias: ~0,55 kg por ave NA FASE (~39 g/dia).' },
    { chave: 'frango_crescimento',  nome: 'Frango de corte — crescimento', consumoMes: 3.32, diasFase: 14, nota: '15 a 28 dias: ~1,55 kg por ave NA FASE (~111 g/dia).' },
    { chave: 'frango_final',        nome: 'Frango de corte — final',       consumoMes: 5.79, diasFase: 14, nota: '29 a 42 dias: ~2,70 kg por ave NA FASE (~193 g/dia). Ciclo todo: 4,8 kg/ave.' },
    { chave: 'poedeira_inicial',    nome: 'Poedeiras — inicial',           consumoMes: 0.9,  diasFase: 42, nota: 'Pintainha / cria (1–6 semanas).' },
    { chave: 'poedeira_crescimento',nome: 'Poedeiras — crescimento',       consumoMes: 1.95, diasFase: 77, nota: 'Recria / franga (7–17 semanas).' },
    { chave: 'pre_postura',         nome: 'Pré-postura',                   consumoMes: 2.7 },
    { chave: 'postura',             nome: 'Postura',                       consumoMes: 3.4,  nota: 'Postura comercial (vermelha). Leve/branca ~3,0.' },
    { chave: 'caipira',             nome: 'Caipira ou colonial',           consumoMes: 3.0,  diasFase: 88, nota: 'Frango caipira 85-90 dias; poedeira colonial ~3,75.' },
    { chave: 'outro',               nome: 'Outro',                         consumoMes: 0 },
  ],
  milho: [
    { chave: 'granel',      nome: 'Milho triturado a granel', consumoMes: 0 },
    { chave: 'ensacado',    nome: 'Milho triturado ensacado', consumoMes: 0 },
    { chave: 'outro',       nome: 'Outro',                    consumoMes: 0 },
  ],
}

/**
 * Atalhos de "ciclo completo" — o que o produtor entende por tocar o ciclo
 * inteiro. NÃO é fase nova: é um botão que marca várias fases de uma vez, e
 * cada uma continua com plantel e consumo próprios na etapa da necessidade.
 */
export const CICLOS: Partial<Record<Especie, Array<{ nome: string; fases: string[] }>>> = {
  bovinos: [
    { nome: 'Ciclo completo (cria, recria e engorda)', fases: ['cria', 'recria', 'engorda'] },
  ],
  suinos: [
    {
      nome: 'Ciclo completo (matriz até terminação)',
      fases: ['gestacao', 'lactacao', 'pre_inicial', 'inicial', 'crescimento', 'terminacao'],
    },
    { nome: 'Só terminação (crescimento e terminação)', fases: ['crescimento', 'terminacao'] },
  ],
  aves: [
    {
      nome: 'Frango de corte — ciclo completo',
      fases: ['frango_inicial', 'frango_crescimento', 'frango_final'],
    },
    {
      nome: 'Poedeiras — ciclo completo',
      fases: ['poedeira_inicial', 'poedeira_crescimento', 'pre_postura', 'postura'],
    },
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

// As formulações de referência moram em @/lib/formulacoes-racao — fonte única
// compartilhada com a /venda-racao. Reexportadas aqui pra não quebrar quem já
// importa deste arquivo.
// `export ... from` reexporta mas NÃO cria binding local — o formulaPadrao
// abaixo precisa do import de verdade.
import { formulasReferencia } from '@/lib/formulacoes-racao'
export { FORMULAS_REFERENCIA, formulasReferencia } from '@/lib/formulacoes-racao'
export type { FormulaReferencia } from '@/lib/formulacoes-racao'



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

/**
 * Fases marcadas, na ordem do catálogo e sempre com pelo menos uma. Estudo
 * antigo (sem `categorias`) devolve só a fase principal — que é o que ele é.
 */
export function fasesDoProduto(p: Produto): string[] {
  const marcadas = (p.categorias ?? []).filter(Boolean)
  if (marcadas.length === 0) return [p.categoria]
  const ordem = (CATEGORIAS[p.especie] ?? []).map(c => c.chave)
  const ordenadas = ordem.filter(c => marcadas.includes(c))
  // fase que não existe mais no catálogo (renomeada) não pode sumir do estudo
  const orfas = marcadas.filter(c => !ordem.includes(c))
  const todas = [...ordenadas, ...orfas]
  return todas.includes(p.categoria) ? todas : [p.categoria, ...todas]
}

/** "Crescimento, Terminação" — todas as fases do estudo, pra cabeçalho e PDF. */
export function nomeCategorias(p: Produto): string {
  return fasesDoProduto(p)
    .map(c => nomeCategoria(p.especie, c, p.categoriaLivre))
    .join(', ')
}
