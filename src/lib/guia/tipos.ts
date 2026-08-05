/**
 * Guia do Vendedor — tipos.
 *
 * Espelham as tabelas `guia_*` do Supabase. NENHUM conteúdo técnico mora aqui:
 * este arquivo descreve a FORMA do dado, não o dado. O conteúdo vem do banco e
 * é editado no painel (/guia/admin) — foi essa a razão de matar o guia.html,
 * que tinha 49 cards hardcoded e não dava pra revisar nem versionar.
 */

export type Especie = 'bovinos' | 'suinos' | 'aves' | 'ovinos' | 'caprinos'
export type TipoAnimal = 'raca' | 'linhagem' | 'cruzamento' | 'composto' | 'categoria'

export type StatusConteudo =
  | 'rascunho' | 'em_revisao' | 'aprovado' | 'desatualizado' | 'arquivado'

export type CategoriaMateria =
  | 'energetico' | 'proteico' | 'fibroso' | 'mineral'
  | 'nucleo_premix' | 'aditivo' | 'coproduto' | 'liquido' | 'risco'

/** Escala que o guia antigo não tinha: tudo usava a mesma tarja amarela. */
export type NivelRisco = 'informacao' | 'atencao' | 'alto_risco' | 'incompativel'

/** A pergunta que o vendedor precisa responder antes de prometer qualquer coisa. */
export type CompatBranorte = 'ok' | 'ressalva' | 'incompativel' | 'avaliar'

export type Fluidez = 'livre' | 'media' | 'dificil' | 'nao_flui'
export type MisturadorIndicado = 'vertical' | 'horizontal' | 'qualquer' | 'nenhum'

export type StatusImagem = 'pendente' | 'verificada' | 'reprovada'

export interface GuiaImagem {
  id: number
  slug: string
  arquivo_url: string | null
  alt: string
  legenda: string | null
  autor: string | null
  fonte_url: string | null
  url_original: string | null
  licenca: string | null
  status: StatusImagem
  /** A foto PROVA a identidade do item, ou é só contexto? Em linhagem de ave é sempre false. */
  identifica_item: boolean
  verificada_em: string | null
  aprovada_por: string | null
  motivo_reprovacao: string | null
  largura_px: number | null
  peso_kb: number | null
}

export interface GuiaFonte {
  id: number
  chave: string
  titulo: string
  organizacao: string | null
  tipo: string
  edicao: string | null
  ano: number | null
  url: string | null
  consultada_em: string | null
  observacao: string | null
}

/** O que a Branorte faz, não faz e com que ressalva. Bloco obrigatório. */
export interface BlocoBranorte {
  atende?: string[]
  nao_atende?: string[]
  ressalvas?: string[]
}

export interface GuiaAnimal {
  id: number
  slug: string
  nome: string
  sinonimos: string[]
  especie: Especie
  subgrupo: string | null
  tipo: TipoAnimal
  classificacao: string | null
  finalidade: string | null
  resumo: string
  sistemas: string[]
  fases: string[]
  /** Chave de CATEGORIAS em venda-racao/catalogo.ts — alimenta o "usar no estudo". */
  fase_estudo: string | null
  peso_min_kg: number | null
  peso_max_kg: number | null
  peso_nota: string | null
  consumo_ref: string | null
  consumo_unidade: string | null
  consumo_fatores: string[]
  tipos_alimentacao: string[]
  forma_fisica: string[]
  materias_comuns: string[]
  restricoes: string[]
  perguntas: string[]
  sinais_falta_info: string[]
  processo: string | null
  equipamentos: string[]
  argumento: string | null
  promessas_proibidas: string[]
  branorte: BlocoBranorte
  explicar_cliente: string | null
  resumo_30s: string | null
  regiao: string | null
  imagem_slug: string | null
  emoji: string | null
  status: StatusConteudo
  pendente_validacao: boolean
  pendencias: string[]
  fontes: string[]
  autor: string | null
  revisor_tecnico: string | null
  revisado_em: string | null
  proxima_revisao: string | null
  /** Assinaturas por frente. `pendente_validacao` é derivado disto por trigger. */
  revisao: Revisao
  ordem: number
  updated_at: string
}

export interface GuiaMateria {
  id: number
  slug: string
  nome: string
  sinonimos: string[]
  categoria: CategoriaMateria
  resumo: string
  funcao: string | null
  composicao: string | null
  /** { aves: "55–70% da ração", bovinos: "…" } — sempre REFERÊNCIA, nunca número fechado. */
  inclusao: Record<string, string>
  especies: string[]
  restricoes: string[]
  // --- ficha mecânica: o que o ingrediente faz COM A MÁQUINA ---
  umidade: string | null
  densidade_kg_m3: string | null
  forma_fisica: string | null
  fluidez: Fluidez | null
  empedra: boolean | null
  forma_ponte: boolean | null
  abrasivo: boolean | null
  oleoso: boolean | null
  gera_poeira: boolean | null
  corrosivo: boolean | null
  risco_micotoxina: boolean | null
  precisa_moer: boolean | null
  granulometria: string | null
  direto_misturador: boolean | null
  exige_pre_mistura: boolean | null
  microingrediente: boolean | null
  compat_rosca: boolean | null
  exige_exaustao: boolean | null
  exige_limpeza_rapida: boolean | null
  misturador_indicado: MisturadorIndicado | null
  afeta_homogeneidade: boolean | null
  armazenamento: string | null
  // --- compatibilidade e risco ---
  compat_branorte: CompatBranorte
  compat_motivo: string | null
  equipamentos: string[]
  nivel_risco: NivelRisco
  alerta: string | null
  // --- venda ---
  perguntas: string[]
  explicar_cliente: string | null
  resumo_30s: string | null
  regiao: string | null
  imagem_slug: string | null
  emoji: string | null
  // --- editorial ---
  status: StatusConteudo
  pendente_validacao: boolean
  pendencias: string[]
  fontes: string[]
  autor: string | null
  revisor_tecnico: string | null
  revisado_em: string | null
  proxima_revisao: string | null
  /** Assinaturas por frente. `pendente_validacao` é derivado disto por trigger. */
  revisao: Revisao
  ordem: number
  updated_at: string
}

/** Frente de revisão: cada uma é assinada por gente diferente. */
export type FrenteRevisao = 'nutricao' | 'engenharia'

export interface Assinatura { por: string; em: string }

/** `{ nutricao: {por, em}, engenharia: {por, em} }` — vazio até alguém assinar. */
export type Revisao = Partial<Record<FrenteRevisao, Assinatura>>

/** Uma linha da fila de revisão (view `guia_fila_revisao`). */
export interface ItemFila {
  tabela: 'guia_animais' | 'guia_materias'
  slug: string
  nome: string
  grupo: string
  status: StatusConteudo
  pendente_validacao: boolean
  /** Frentes que ESTE card exige, derivadas do que ele afirma. */
  frentes_exigidas: FrenteRevisao[]
  /** Das exigidas, as que ainda não têm assinatura. */
  frentes_pendentes: FrenteRevisao[]
  revisao: Revisao
}

export interface GuiaVersao {
  id: number
  tabela: string
  registro_id: number
  slug: string | null
  versao: number
  snapshot: Record<string, unknown>
  alterado_por: string | null
  alterado_em: string
}

export type TipoItem = 'animal' | 'materia'

/** Item genérico para busca global e para a grade — animal e matéria no mesmo formato. */
export interface ItemGuia {
  tipo: TipoItem
  slug: string
  nome: string
  resumo: string
  emoji: string | null
  imagem_slug: string | null
  /** Rótulo curto no card (espécie ou categoria). */
  grupo: string
  status: StatusConteudo
  pendente_validacao: boolean
  nivel_risco?: NivelRisco
  compat_branorte?: CompatBranorte
  /**
   * Item sem retrato possível (fase produtiva, sistema de criação). Não existe
   * "foto de confinamento" a verificar — o card não acusa ausência.
   */
  semRetrato?: boolean
  /** Só para ordenar o resultado da busca. */
  score?: number
}

/** Estado do modo Atendimento Rápido. */
/**
 * De onde vem o volume mensal.
 *  `rebanho` — o cliente CONSOME: o volume sai de animais x consumo por animal.
 *  `volume`  — o cliente VENDE ração, ou já sabe o quanto quer produzir: informa
 *              a tonelagem direto, e o rebanho deixa de fazer sentido.
 * Sem isto, quem vende ração tinha que inventar um rebanho pra chegar no número
 * que ele já sabia.
 */
export type ModoVolume = 'rebanho' | 'volume'

export interface Atendimento {
  especie: Especie | null
  fase: string | null
  quantidade: number | null
  sistema: string | null
  produto: string | null
  materias: string[]
  consumoConfirmado: boolean
  /** default 'rebanho' quando ausente — é como o campo sempre funcionou. */
  modo?: ModoVolume
  /**
   * Consumo por animal/mês DITO PELO CLIENTE. Sobrepõe o de catálogo.
   * O de catálogo é média de tabela; o produtor sabe o dele, e a diferença
   * multiplica pelo rebanho inteiro — 20 kg a mais em 500 cabeças são 10 t/mês.
   */
  consumoKgAnimalMes?: number | null
  /** Só no modo `volume`: tonelagem por mês, em kg. */
  volumeMesKg?: number | null
}

/** O que o Atendimento Rápido devolve. Nunca fecha equipamento sem dados. */
export interface ResultadoAtendimento {
  faltando: string[]
  perguntas: string[]
  consumoMesKg: number | null
  necessidadeMesKg: number | null
  processo: string[]
  atencao: Array<{ nivel: NivelRisco; texto: string }>
  capacidadeSugeridaKgH: number | null
  capacidadeNota: string | null
  equipamentos: string[]
  relacionados: ItemGuia[]
  podeFecharEquipamento: boolean
  /**
   * O PRIMEIRO motivo de `podeFecharEquipamento` ser false, em texto curto.
   * `null` quando pode fechar.
   *
   * Existe porque `faltando[0]` não serve pra isso: produto e matérias-primas
   * entram em `faltando` e não travam equipamento nenhum. O mostrador dizia
   * "Referência — falta matérias-primas que o cliente já tem" enquanto o que
   * realmente segurava era o consumo não confirmado.
   */
  bloqueioEquipamento: string | null
  /**
   * `true` quando MAIS DE UMA categoria casou — e aí `processo`, `perguntas` e
   * as restrições são a UNIÃO de todas elas: úteis como repertório, mentirosas
   * como resposta específica.
   *
   * O critério é `base.length > 1`, e NÃO "a queda pra todas as categorias da
   * espécie disparou" — sem fase escolhida, `casaFase` devolve true pra todo
   * mundo, então as 12 entram pelo caminho normal e a queda nem roda. Este
   * comentário já disse a coisa errada uma vez.
   */
  baseAmpla: boolean
  /**
   * O que a linha NÃO faz, vindo de `branorte.nao_atende` das categorias que
   * casam com espécie/fase. Existia no banco e só era renderizado na FICHA do
   * animal — a tela em que o vendedor está com o cliente no telefone não lia o
   * campo. É o defeito que a auditoria de 03-04/08 matou no guia.html (Ross 308
   * recomendando ração peletizada) voltando pela porta do layout.
   */
  naoAtende: string[]
  /** `promessas_proibidas` das mesmas categorias. Mesmo motivo. */
  promessasProibidas: string[]
  /**
   * Tipo de misturador que as matérias marcadas exigem. `horizontal` ganha:
   * produto denso ou corrosivo (sal, mineral) não roda em vertical, e basta um
   * ingrediente da fórmula pedir pra decidir a máquina inteira.
   */
  misturadorIndicado: 'vertical' | 'horizontal' | null
}
