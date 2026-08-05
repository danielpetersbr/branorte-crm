/**
 * BANCO NUTRICIONAL — o que o sistema sabe sobre cada matéria-prima.
 *
 * POR QUE ISTO EXISTE
 * Até agora um ingrediente era `{ nome, participacao, preco }`. Nome é texto
 * livre. O sistema sabia o PREÇO da fórmula e nada sobre o que ela ENTREGA ao
 * animal. Dava pra montar uma ração de suíno com 5% de proteína e o estudo
 * mostrava economia bonita — porque economia é subtração de preço, e preço não
 * sabe de proteína.
 *
 * REGRA INQUEBRÁVEL (mesma de formulacoes-racao.ts e substituicoes-racao.ts):
 * nada entra sem `fonte` com instituição e ano. Aqui número errado não gera bug,
 * gera animal mal nutrido e produtor decidindo investimento em cima de conta
 * furada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS TRÊS CONFUSÕES QUE ESTE ARQUIVO EXISTE PRA IMPEDIR
 *
 * 1) MATÉRIA NATURAL ≠ MATÉRIA SECA
 *    A tabela de monogástrico (Embrapa/BIPERS) publica em matéria natural — do
 *    jeito que o ingrediente entra no misturador. A de ruminante (CQBAL/UFV)
 *    publica em matéria seca. Milho é 9,11% PB em MS e 7,99% em MN. Somar as
 *    duas dá uma fórmula com proteína inventada. Por isso `base` é obrigatório
 *    em todo perfil e a conversão é explícita (`emBase()`), nunca implícita.
 *
 * 2) ENERGIA NÃO É UM NÚMERO SÓ
 *    O mesmo milho vale 3.229 kcal de EM pra ave, 3.421 pra suíno e 87,24% de
 *    NDT pro boi. São grandezas de espécies diferentes, medidas de formas
 *    diferentes. Não existe campo "energia" aqui de propósito.
 *
 * 3) AUSENTE ≠ ZERO
 *    §22 do pedido, e é o ponto mais fácil de errar: preencher com 0 o que não
 *    se sabe faz a fórmula parecer deficiente (ou o mineral parecer ausente)
 *    quando o que houve foi falta de dado. Todo nutriente é `number | null`.
 *    `null` vira "Informação não cadastrada" na tela e TIRA o nutriente da
 *    conta, em vez de puxá-la pra baixo.
 */

/** Sobre que massa o percentual foi medido. Confundir as duas erra por ~12%. */
export type BaseNutriente =
  /** % do ingrediente como ele entra no misturador (as-fed). */
  | 'MN'
  /** % da matéria seca, descontada a água. */
  | 'MS'

/**
 * Um valor com `null` explícito. Não use `0` pra "não sei" — veja o cabeçalho.
 */
export type Valor = number | null

/**
 * Composição de uma matéria-prima.
 *
 * Todos os percentuais estão na `base` declarada. Energia é sempre kcal/kg de
 * matéria NATURAL (é assim que as tabelas publicam) — a exceção está anotada
 * campo a campo.
 */
export interface PerfilNutricional {
  /** Base dos percentuais deste perfil. */
  base: BaseNutriente

  /** % de matéria seca do ingrediente. Sempre em matéria natural. */
  materiaSeca: Valor

  // ── macro ─────────────────────────────────────────────────────────────────
  /** Proteína bruta, %. */
  proteinaBruta: Valor
  /** Extrato etéreo (gordura), %. */
  extratoEtereo: Valor
  /** Fibra bruta, %. */
  fibraBruta: Valor
  /** Fibra em detergente neutro, %. */
  fdn: Valor
  /** Fibra em detergente ácido, %. */
  fda: Valor
  /** Matéria mineral / cinza, %. */
  materiaMineral: Valor

  // ── energia, por espécie ──────────────────────────────────────────────────
  /** Energia metabolizável para AVES, kcal/kg de matéria natural. */
  emAves: Valor
  /** Energia metabolizável para SUÍNOS, kcal/kg de matéria natural. */
  emSuinos: Valor
  /** Energia digestível para SUÍNOS, kcal/kg de matéria natural. */
  edSuinos: Valor
  /** Nutrientes digestíveis totais — a medida de energia de RUMINANTE, % da MS. */
  ndt: Valor
  /** Energia bruta, kcal/kg. Serve de referência; não substitui EM nem NDT. */
  energiaBruta: Valor

  // ── minerais ──────────────────────────────────────────────────────────────
  /** Cálcio, %. */
  calcio: Valor
  /** Fósforo TOTAL, %. Nem todo fósforo total é disponível — veja `fosforoDisponivel`. */
  fosforo: Valor
  /**
   * Fósforo disponível/digestível, %. Em ingrediente vegetal boa parte do
   * fósforo está como fitato e o monogástrico não aproveita — por isso a
   * exigência de suíno e ave é cobrada em disponível, não em total.
   */
  fosforoDisponivel: Valor
  /** Sódio, %. */
  sodio: Valor
  /**
   * Enxofre, %. É o que limita DDG em bovino: excesso causa
   * polioencefalomalácia. Sem este dado não dá pra checar o teto de segurança.
   */
  enxofre: Valor
  /** Potássio, %. */
  potassio: Valor
  /** Magnésio, %. */
  magnesio: Valor

  // ── aminoácidos (TOTAIS, não digestíveis) ─────────────────────────────────
  /**
   * ATENÇÃO: são aminoácidos TOTAIS. A formulação moderna de monogástrico
   * trabalha com DIGESTÍVEIS, que são menores. Misturar total com digestível
   * superestima o aminoácido da fórmula. As exigências deste sistema estão em
   * total pela mesma fonte — só compare dentro da mesma base.
   */
  lisina: Valor
  metionina: Valor
  metioninaCistina: Valor
  treonina: Valor
  triptofano: Valor
}

/** Perfil com tudo `null` — ponto de partida honesto pra quem não tem dado. */
export const PERFIL_VAZIO: PerfilNutricional = {
  base: 'MN',
  materiaSeca: null,
  proteinaBruta: null, extratoEtereo: null, fibraBruta: null,
  fdn: null, fda: null, materiaMineral: null,
  emAves: null, emSuinos: null, edSuinos: null, ndt: null, energiaBruta: null,
  calcio: null, fosforo: null, fosforoDisponivel: null, sodio: null,
  enxofre: null, potassio: null, magnesio: null,
  lisina: null, metionina: null, metioninaCistina: null,
  treonina: null, triptofano: null,
}

/** Papel do ingrediente na fórmula — organiza filtros e o painel. */
export type CategoriaNutricional =
  | 'energetico' | 'proteico' | 'fibroso' | 'mineral' | 'aditivo' | 'volumoso'

export const NOME_CATEGORIA: Record<CategoriaNutricional, string> = {
  energetico: 'Energético',
  proteico: 'Proteico',
  fibroso: 'Fibroso / coproduto',
  mineral: 'Mineral',
  aditivo: 'Aditivo / núcleo',
  volumoso: 'Volumoso',
}

/** Chave estável de cada nutriente — usada no painel e nas exigências. */
export type ChaveNutriente =
  | 'proteinaBruta' | 'extratoEtereo' | 'fibraBruta' | 'fdn' | 'fda'
  | 'materiaMineral' | 'emAves' | 'emSuinos' | 'edSuinos' | 'ndt'
  | 'calcio' | 'fosforo' | 'fosforoDisponivel' | 'sodio' | 'enxofre'
  | 'potassio' | 'magnesio'
  | 'lisina' | 'metionina' | 'metioninaCistina' | 'treonina' | 'triptofano'

export interface DefNutriente {
  chave: ChaveNutriente
  rotulo: string
  /** Sufixo mostrado na tela. */
  unidade: '%' | 'kcal/kg'
  /** Casas decimais na exibição. */
  casas: number
  /** Só faz sentido pra estas espécies. Vazio = todas. */
  especies?: Array<'bovinos' | 'suinos' | 'aves'>
  /** Ordem de exibição no painel. */
  grupo: 'energia' | 'proteina' | 'fibra' | 'mineral' | 'aminoacido'
}

/**
 * Catálogo dos nutrientes que o painel sabe mostrar.
 *
 * A energia aparece filtrada por espécie de propósito: mostrar "EM aves" numa
 * fórmula de bovino convida o vendedor a comparar coisas incomparáveis.
 */
export const NUTRIENTES: DefNutriente[] = [
  { chave: 'emAves',    rotulo: 'Energia metabolizável', unidade: 'kcal/kg', casas: 0, especies: ['aves'],    grupo: 'energia' },
  { chave: 'emSuinos',  rotulo: 'Energia metabolizável', unidade: 'kcal/kg', casas: 0, especies: ['suinos'],  grupo: 'energia' },
  { chave: 'edSuinos',  rotulo: 'Energia digestível',    unidade: 'kcal/kg', casas: 0, especies: ['suinos'],  grupo: 'energia' },
  { chave: 'ndt',       rotulo: 'NDT',                   unidade: '%',       casas: 1, especies: ['bovinos'], grupo: 'energia' },

  { chave: 'proteinaBruta', rotulo: 'Proteína bruta',  unidade: '%', casas: 2, grupo: 'proteina' },
  { chave: 'extratoEtereo', rotulo: 'Gordura (EE)',    unidade: '%', casas: 2, grupo: 'proteina' },

  { chave: 'fibraBruta', rotulo: 'Fibra bruta', unidade: '%', casas: 2, grupo: 'fibra' },
  { chave: 'fdn',        rotulo: 'FDN',         unidade: '%', casas: 2, grupo: 'fibra' },
  { chave: 'fda',        rotulo: 'FDA',         unidade: '%', casas: 2, grupo: 'fibra' },

  { chave: 'calcio',            rotulo: 'Cálcio',              unidade: '%', casas: 3, grupo: 'mineral' },
  { chave: 'fosforo',           rotulo: 'Fósforo total',       unidade: '%', casas: 3, grupo: 'mineral' },
  { chave: 'fosforoDisponivel', rotulo: 'Fósforo disponível',  unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'mineral' },
  { chave: 'sodio',             rotulo: 'Sódio',               unidade: '%', casas: 3, grupo: 'mineral' },
  { chave: 'enxofre',           rotulo: 'Enxofre',             unidade: '%', casas: 3, especies: ['bovinos'], grupo: 'mineral' },

  { chave: 'lisina',           rotulo: 'Lisina',            unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'aminoacido' },
  { chave: 'metionina',        rotulo: 'Metionina',         unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'aminoacido' },
  { chave: 'metioninaCistina', rotulo: 'Metionina+Cistina', unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'aminoacido' },
  { chave: 'treonina',         rotulo: 'Treonina',          unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'aminoacido' },
  { chave: 'triptofano',       rotulo: 'Triptofano',        unidade: '%', casas: 3, especies: ['suinos', 'aves'], grupo: 'aminoacido' },
]

/**
 * Converte um valor entre matéria natural e matéria seca.
 *
 * `null` entra, `null` sai — a falta de dado se propaga em vez de virar 0.
 * Sem matéria seca conhecida também devolve `null`: sem ela a conversão é um
 * chute, e chute aqui é exatamente o que este arquivo existe pra impedir.
 */
export function converterBase(
  valor: Valor, de: BaseNutriente, para: BaseNutriente, materiaSecaPct: Valor,
): Valor {
  if (valor == null) return null
  if (de === para) return valor
  if (materiaSecaPct == null || materiaSecaPct <= 0) return null
  const ms = materiaSecaPct / 100
  // MS → MN: multiplica (o nutriente se dilui na água que existe no produto)
  // MN → MS: divide  (tira a água e o nutriente se concentra)
  return para === 'MN' ? valor * ms : valor / ms
}

/**
 * Lê um nutriente do perfil já convertido para a base pedida.
 *
 * Energia e NDT NÃO são convertidos:
 * - EM/ED já são publicados por kg de matéria natural;
 * - NDT é, por definição da tabela de ruminante, % da matéria seca.
 * Aplicar a conversão neles seria transformar um dado certo em errado.
 */
const SEM_CONVERSAO: ReadonlySet<string> = new Set([
  'emAves', 'emSuinos', 'edSuinos', 'energiaBruta', 'ndt', 'materiaSeca',
])

export function lerNutriente(
  perfil: PerfilNutricional, chave: ChaveNutriente | 'materiaSeca', base: BaseNutriente,
): Valor {
  const bruto = perfil[chave as keyof PerfilNutricional] as Valor
  if (SEM_CONVERSAO.has(chave)) return bruto
  return converterBase(bruto, perfil.base, base, perfil.materiaSeca)
}
