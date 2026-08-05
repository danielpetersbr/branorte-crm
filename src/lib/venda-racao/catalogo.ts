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

/**
 * Capacidades da linha Branorte, em kg/h. Editável em Configurações.
 *
 * Conferido contra `precos_branorte`, categoria MOINHO, **com `ativo = true`**,
 * em 05/08/2026 — que é o mesmo filtro que `usePrecosBranorte.ts` usa, ou seja,
 * a definição que o app inteiro dá pra "isto se vende".
 *
 * ⚠️ O FILTRO É A PARTE QUE IMPORTA. Minha primeira versão desta lista consultou
 * a tabela SEM ele e trouxe 20 capacidades — oito delas de SKU descontinuado
 * (BNMM150 500, BNMM212 1.250, BNMM430/BNMM325 2.500, BNMM330 2.900, BNMM445
 * 4.000, e a geração BNM inteira: 5.500 / 6.000 / 6.500). Eu tirei o 600 kg/h
 * por não existir e ressuscitei oito máquinas que também não existem — num
 * número que sai impresso na apresentação que vai pro cliente.
 *
 * A lista anterior — [300, 600, 1000, 1500, 2000, 3000, 5000] — era sintética e
 * errava dos dois lados:
 *   - **600 kg/h não existe.** O degrau real entre 500 e 750 não tem nada, e o
 *     estudo apontava uma máquina que ninguém fabrica.
 *   - **parava em 5.000.** Acima disso o resultado vinha marcado `acimaDaLinha`
 *     ("levar à engenharia") enquanto o catálogo tem BNMM675 (7.500) e
 *     BNMM7100 (10.000) prontos.
 *   - faltavam 500, 1.250, 2.200, 2.500, 2.900, 4.000, 4.500, 5.500, 6.000 e
 *     6.500 — o cliente subia um porte inteiro à toa.
 *
 * O "75000KG/H" do BNMM775 cai fora por dois motivos independentes: o SKU está
 * `ativo = false`, e o número é erro de digitação (75 t/h é dez vezes o BNMM675
 * e sete vezes e meia o BNMM7100, num modelo cuja nomenclatura BNMM7-75 aponta
 * 7.500). Entrando aqui viraria o teto da linha e `acimaDaLinha` nunca mais
 * dispararia.
 *
 * Isto é FALLBACK de último recurso: a verdade viva é `precos_branorte`, que o
 * configurador do guia já lê direto via `usePrecosBranorte`.
 */
export const CAPACIDADES_BRANORTE = [
  300, 750, 1000, 1500, 1700, 2000, 2200, 3000, 4500, 5000, 7500, 10000,
]

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
