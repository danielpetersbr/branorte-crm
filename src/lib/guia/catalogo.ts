/**
 * Guia do Vendedor — rótulos, filtros e regras de apresentação.
 *
 * Aqui mora VOCABULÁRIO (como chamar cada coisa na tela), não CONTEÚDO técnico.
 * Nenhuma afirmação sobre animal ou ingrediente pode entrar neste arquivo — isso
 * é do banco, com fonte, revisor e data.
 */
import type {
  CategoriaMateria, CompatBranorte, Especie, Fluidez, MisturadorIndicado,
  NivelRisco, StatusConteudo, TipoAnimal,
} from './tipos'

// ---------------------------------------------------------------------------
// Espécies — mesma ordem e mesmos ícones de /producao-propria
// ---------------------------------------------------------------------------
export const ESPECIES: Array<{ chave: Especie; nome: string; icone: string; animal: string }> = [
  { chave: 'bovinos',  nome: 'Bovinos',  icone: '🐂', animal: 'cabeças' },
  { chave: 'aves',     nome: 'Aves',     icone: '🐔', animal: 'aves' },
  { chave: 'suinos',   nome: 'Suínos',   icone: '🐷', animal: 'suínos' },
  { chave: 'ovinos',   nome: 'Ovinos',   icone: '🐑', animal: 'cabeças' },
  { chave: 'caprinos', nome: 'Caprinos', icone: '🐐', animal: 'cabeças' },
]

export const NOME_ESPECIE: Record<Especie, string> =
  Object.fromEntries(ESPECIES.map(e => [e.chave, e.nome])) as Record<Especie, string>

export const SUBGRUPOS: Record<string, string> = {
  corte: 'Corte', leite: 'Leite', frango_corte: 'Frango de corte',
  postura: 'Poedeiras', caipira: 'Caipira / colonial', comercial: 'Comercial',
  geral: 'Geral',
}

// ---------------------------------------------------------------------------
// Sistemas de criação — o eixo que o guia antigo não tinha
// ---------------------------------------------------------------------------
export const SISTEMAS: Array<{ chave: string; nome: string; especies: Especie[] }> = [
  { chave: 'pasto',            nome: 'Pasto',              especies: ['bovinos', 'ovinos', 'caprinos'] },
  { chave: 'semiconfinamento', nome: 'Semiconfinamento',   especies: ['bovinos', 'ovinos', 'caprinos'] },
  { chave: 'confinamento',     nome: 'Confinamento',       especies: ['bovinos', 'ovinos', 'caprinos'] },
  { chave: 'free_stall',       nome: 'Free stall',         especies: ['bovinos'] },
  { chave: 'compost_barn',     nome: 'Compost barn',       especies: ['bovinos'] },
  { chave: 'bezerreiro',       nome: 'Bezerreiro',         especies: ['bovinos'] },
  { chave: 'creche',           nome: 'Creche',             especies: ['suinos'] },
  { chave: 'comercial',        nome: 'Produção comercial', especies: ['suinos', 'aves'] },
  { chave: 'integracao',       nome: 'Integração',         especies: ['aves'] },
  { chave: 'independente',     nome: 'Independente',       especies: ['aves'] },
  { chave: 'caipira',          nome: 'Caipira',            especies: ['aves', 'suinos'] },
  { chave: 'colonial',         nome: 'Colonial',           especies: ['aves'] },
  { chave: 'familiar',         nome: 'Familiar',           especies: ['suinos'] },
  { chave: 'agroecologico',    nome: 'Agroecológico',      especies: ['aves'] },
]

export const NOME_SISTEMA = (c: string) => SISTEMAS.find(s => s.chave === c)?.nome ?? c

export const TIPOS_ANIMAL: Record<TipoAnimal, string> = {
  categoria: 'Fase / sistema',
  raca: 'Raça',
  linhagem: 'Linhagem',
  cruzamento: 'Cruzamento',
  composto: 'Composto',
}

// ---------------------------------------------------------------------------
// Matérias-primas
// ---------------------------------------------------------------------------
export const CATEGORIAS_MATERIA: Array<{ chave: CategoriaMateria; nome: string; icone: string }> = [
  { chave: 'energetico',    nome: 'Energéticos',        icone: '⚡' },
  { chave: 'proteico',      nome: 'Proteicos',          icone: '💪' },
  { chave: 'fibroso',       nome: 'Fibrosos e volumosos', icone: '🌾' },
  { chave: 'mineral',       nome: 'Minerais',           icone: '🦴' },
  { chave: 'nucleo_premix', nome: 'Núcleos e premixes', icone: '💊' },
  { chave: 'aditivo',       nome: 'Aditivos',           icone: '🧪' },
  { chave: 'coproduto',     nome: 'Coprodutos regionais', icone: '♻️' },
  { chave: 'liquido',       nome: 'Ingredientes líquidos', icone: '🛢️' },
  { chave: 'risco',         nome: 'Ingredientes de risco', icone: '☠️' },
]

export const NOME_CATEGORIA: Record<CategoriaMateria, string> =
  Object.fromEntries(CATEGORIAS_MATERIA.map(c => [c.chave, c.nome])) as Record<CategoriaMateria, string>

// ---------------------------------------------------------------------------
// Risco — escala visual. O guia antigo pintava tudo de amarelo, então "ureia
// mata o animal" tinha o mesmo peso de "farelo de trigo absorve umidade".
// ---------------------------------------------------------------------------
export const RISCOS: Record<NivelRisco, { nome: string; classe: string; icone: string; ordem: number }> = {
  informacao:   { nome: 'Informação',     classe: 'bg-info-bg text-info',       icone: 'ℹ️', ordem: 0 },
  atencao:      { nome: 'Atenção',        classe: 'bg-warning-bg text-warning', icone: '⚠️', ordem: 1 },
  alto_risco:   { nome: 'Alto risco',     classe: 'bg-danger-bg text-danger',   icone: '☠️', ordem: 2 },
  incompativel: { nome: 'Uso incompatível', classe: 'bg-danger-bg text-danger', icone: '⛔', ordem: 3 },
}

export const COMPAT: Record<CompatBranorte, { nome: string; classe: string; curto: string }> = {
  ok:           { nome: 'A Branorte processa',            classe: 'bg-success-bg text-success', curto: 'Processa' },
  ressalva:     { nome: 'Processa, com ressalva',         classe: 'bg-warning-bg text-warning', curto: 'Com ressalva' },
  incompativel: { nome: 'Não entra na fábrica farelada',  classe: 'bg-danger-bg text-danger',   curto: 'Não entra' },
  avaliar:      { nome: 'Avaliar com a engenharia',       classe: 'bg-surface-2 text-ink-muted', curto: 'Avaliar' },
}

export const STATUS: Record<StatusConteudo, { nome: string; classe: string }> = {
  rascunho:      { nome: 'Rascunho',      classe: 'bg-surface-2 text-ink-faint' },
  em_revisao:    { nome: 'Em revisão',    classe: 'bg-info-bg text-info' },
  aprovado:      { nome: 'Aprovado',      classe: 'bg-success-bg text-success' },
  desatualizado: { nome: 'Desatualizado', classe: 'bg-warning-bg text-warning' },
  arquivado:     { nome: 'Arquivado',     classe: 'bg-surface-2 text-ink-faint' },
}

export const FLUIDEZ: Record<Fluidez, string> = {
  livre: 'Escoa livre', media: 'Escoa razoável',
  dificil: 'Escoa mal', nao_flui: 'Não escoa',
}

export const MISTURADOR: Record<MisturadorIndicado, string> = {
  vertical: 'Vertical', horizontal: 'Horizontal',
  qualquer: 'Vertical ou horizontal', nenhum: 'Não entra no misturador de ração',
}

/** Categorias reais de `precos_branorte` → nome que o vendedor usa. */
export const EQUIPAMENTOS: Record<string, string> = {
  MOINHO: 'Moinho de martelo',
  MISTURADOR: 'Misturador',
  TRANSPORTADOR: 'Chupim / rosca transportadora',
  ELEVADOR: 'Elevador de canecas',
  SILO: 'Silo',
  CAIXA: 'Caixa de recepção / de ração',
  CACAMBA_PESAGEM: 'Caçamba de pesagem',
  BALANCA: 'Balança',
  ENSACADEIRA: 'Ensacadeira',
  PRE_LIMPEZA: 'Pré-limpeza',
  MOEGA: 'Moega',
  PAINEL_ELETRICO: 'Painel elétrico',
  ESTEIRA: 'Esteira',
  ACESSORIO: 'Peneiras e martelos',
  SUPORTE_BAG: 'Suporte de big bag',
}

/**
 * Ficha mecânica: rótulo e o que significa quando o campo é `true`.
 * A frase é o que o vendedor vai LER — por isso é afirmativa e prática.
 */
export const FICHA_MECANICA: Array<{
  campo: string; rotulo: string; quandoTrue: string; alerta?: boolean
}> = [
  { campo: 'precisa_moer',         rotulo: 'Moagem',            quandoTrue: 'Passa pelo moinho antes' },
  { campo: 'direto_misturador',    rotulo: 'Misturador',        quandoTrue: 'Entra direto no misturador' },
  { campo: 'exige_pre_mistura',    rotulo: 'Pré-mistura',       quandoTrue: 'Exige pré-mistura', alerta: true },
  { campo: 'microingrediente',     rotulo: 'Microingrediente',  quandoTrue: 'Entra em dose pequena — balança precisa', alerta: true },
  { campo: 'compat_rosca',         rotulo: 'Rosca / chupim',    quandoTrue: 'Compatível com transporte helicoidal' },
  { campo: 'forma_ponte',          rotulo: 'Ponte no silo',     quandoTrue: 'Tende a formar ponte', alerta: true },
  { campo: 'empedra',              rotulo: 'Empedra',           quandoTrue: 'Empedra com umidade', alerta: true },
  { campo: 'gera_poeira',          rotulo: 'Poeira',            quandoTrue: 'Gera poeira', alerta: true },
  { campo: 'exige_exaustao',       rotulo: 'Exaustão',          quandoTrue: 'Pede exaustão ou filtro de manga', alerta: true },
  { campo: 'abrasivo',             rotulo: 'Abrasivo',          quandoTrue: 'Desgasta martelo e peneira', alerta: true },
  { campo: 'oleoso',               rotulo: 'Oleoso',            quandoTrue: 'Adere ao equipamento', alerta: true },
  { campo: 'corrosivo',            rotulo: 'Corrosão',          quandoTrue: 'Corrói o equipamento', alerta: true },
  { campo: 'exige_limpeza_rapida', rotulo: 'Limpeza',           quandoTrue: 'Não deixar parado na máquina', alerta: true },
  { campo: 'afeta_homogeneidade',  rotulo: 'Homogeneidade',     quandoTrue: 'Pode comprometer a mistura', alerta: true },
  { campo: 'risco_micotoxina',     rotulo: 'Micotoxina',        quandoTrue: 'Risco se mal armazenado', alerta: true },
]

// ---------------------------------------------------------------------------
// Capacidades da linha — MESMA lista de venda-racao/catalogo.ts.
// Duplicar valor entre módulos foi um dos achados da auditoria; aqui a gente
// reexporta em vez de recopiar.
// ---------------------------------------------------------------------------
export { CAPACIDADES_BRANORTE } from '../venda-racao/catalogo'

/** Exemplos de busca mostrados quando o campo está vazio. */
export const EXEMPLOS_BUSCA = [
  'gado confinamento',
  'ração para suínos',
  'milho',
  'ingrediente que não pode ir para aves',
  'misturador para sal',
  'ração para poedeiras',
]

/**
 * Atalhos semânticos: o vendedor digita a INTENÇÃO, não o nome do registro.
 * Cada atalho vira um filtro, não um resultado de texto.
 */
export const ATALHOS_BUSCA: Array<{ termos: string[]; rotulo: string; filtro: Record<string, string> }> = [
  { termos: ['nao pode ir para aves', 'nao pode em aves', 'proibido para aves', 'toxico para aves'],
    rotulo: 'Ingredientes com restrição para aves', filtro: { restritoPara: 'aves' } },
  { termos: ['nao pode ir para suinos', 'nao pode em suinos', 'proibido para suinos'],
    rotulo: 'Ingredientes com restrição para suínos', filtro: { restritoPara: 'suinos' } },
  { termos: ['nao entra', 'incompativel', 'nao processa', 'nao faz'],
    rotulo: 'O que NÃO entra na fábrica farelada', filtro: { compat: 'incompativel' } },
  { termos: ['misturador para sal', 'misturador horizontal', 'produto denso'],
    rotulo: 'Ingredientes que pedem misturador horizontal', filtro: { misturador: 'horizontal' } },
  { termos: ['alto risco', 'perigoso', 'mata o animal'],
    rotulo: 'Ingredientes de alto risco', filtro: { risco: 'alto_risco' } },
  { termos: ['corrosivo', 'corrosao', 'enferruja'],
    rotulo: 'Ingredientes corrosivos', filtro: { propriedade: 'corrosivo' } },
  { termos: ['precisa moer', 'passa no moinho', 'moagem'],
    rotulo: 'Ingredientes que passam pelo moinho', filtro: { propriedade: 'precisa_moer' } },
  { termos: ['peletizada', 'peletizacao', 'pellet', 'extrusada', 'extrusao'],
    rotulo: 'A Branorte produz ração FARELADA — peletização e extrusão exigem processo não incluído',
    filtro: { aviso: 'processo' } },
]
