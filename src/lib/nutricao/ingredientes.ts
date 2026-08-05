/**
 * BANCO DE MATÉRIAS-PRIMAS — composição rastreável.
 *
 * REGRA INQUEBRÁVEL: nenhum número entra sem `fontes` com instituição e ano.
 * O campo é obrigatório no tipo justamente pra travar isso em tempo de
 * compilação; há teste que quebra se alguém acrescentar entrada sem fonte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE ONDE VEM CADA NÚMERO
 *
 * (A) Embrapa Suínos e Aves + EMATER/RS — BIPERS nº 12 (dez/1999), Tabelas 33 e
 *     34, "Composição química e energética dos alimentos". Base MATÉRIA NATURAL.
 *     É a fonte da energia de monogástrico (EM aves, EM/ED suínos) e dos
 *     aminoácidos totais.
 *
 * (B) Valadares Filho, S.C. et al. — "Tabelas de composição de alimentos e
 *     exigências nutricionais de zebuínos: dados brasileiros" (CQBAL, UFV),
 *     V Simpósio de Produção de Gado de Corte. Base MATÉRIA SECA. É a fonte do
 *     NDT e do enxofre — que a tabela de monogástrico não traz.
 *
 * (C) Embrapa Milho e Sorgo / demais, já citadas em `substituicoes-racao.ts`.
 *
 * AS DUAS FONTES CONFEREM ENTRE SI, e isso não é coincidência boba: o milho dá
 * 7,93% de PB em matéria natural (A) e 9,11% em matéria seca (B). Convertendo
 * (B) para natural: 9,11 × 0,8764 = 7,98. Diferença de 0,05 ponto entre dois
 * levantamentos independentes, um deles com 690 amostras. É o tipo de checagem
 * que se faz ANTES de confiar no dado, não depois de o produtor reclamar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE INGREDIENTE AQUI COM PERFIL VAZIO
 *
 * Ureia, calcário, fosfato bicálcico, núcleo, DDG e casca de arroz entram sem
 * composição. Não é descuido — é o desenho:
 *
 * 1) SEGURANÇA NÃO DEPENDE DE COMPOSIÇÃO. Bloquear ureia em ave funciona pela
 *    IDENTIDADE do ingrediente. Se ele não estivesse cadastrado, o sistema não
 *    o reconheceria e não bloquearia nada.
 * 2) "Não cadastrado" é informação. A tela precisa dizer que a fórmula tem um
 *    ingrediente cuja composição ninguém conferiu — e não fingir que tem tudo.
 * 3) É o caminho pra encher o banco depois, sem mexer em código.
 */
import type { Especie } from '@/lib/venda-racao/tipos'
import {
  PERFIL_VAZIO, type CategoriaNutricional, type PerfilNutricional,
} from './tipos'

/** Uma referência e o que dela foi aproveitado. */
export interface FonteDado {
  /** Instituição, publicação e ano. Sem isto, não entra. */
  ref: string
  /** Que parte do perfil veio daqui. */
  cobre: string
}

export interface LimiteInclusao {
  /** Vazio = vale pra todas as espécies. */
  especies?: Especie[]
  max: number
  /** 'formula' = % da fórmula da tela. 'dieta_ms' = % da dieta total em MS. */
  base: 'formula' | 'dieta_ms'
  motivo: string
  fonte: string
}

export interface IngredienteNutricional {
  id: string
  nome: string
  /** Outras grafias, pro casamento por prefixo. */
  apelidos: string[]
  categoria: CategoriaNutricional
  /** Função em uma frase — aparece no card. */
  funcao: string
  perfil: PerfilNutricional
  /** OBRIGATÓRIO. Vazio não compila a intenção deste arquivo. */
  fontes: FonteDado[]
  /** Espécies em que este ingrediente NÃO pode entrar. Bloqueio duro. */
  proibidoPara?: Especie[]
  /** Por que é proibido. Aparece junto do bloqueio. */
  motivoProibicao?: string
  limites?: LimiteInclusao[]
  /** Ressalva que sempre aparece, mesmo quando o uso é permitido. */
  alerta?: string
  /** Composição varia tanto por lote que o número da tabela não serve sozinho. */
  exigeAnalise?: boolean
  /** Não entra em fábrica farelada sem kit de líquido. */
  liquido?: boolean
  /** Volumoso úmido — não entra em fábrica farelada. */
  umido?: boolean
}

// ── atalhos de escrita ───────────────────────────────────────────────────────

/** Monta um perfil preenchendo só o que a fonte traz; o resto fica `null`. */
function perfil(p: Partial<PerfilNutricional> & Pick<PerfilNutricional, 'base'>): PerfilNutricional {
  return { ...PERFIL_VAZIO, ...p }
}

const FONTE_BIPERS =
  'Embrapa Suínos e Aves / EMATER-RS — BIPERS nº 12 (dez/1999), Tabelas 33 e 34, '
  + '"Composição química e energética dos alimentos" (base: matéria natural)'
const FONTE_CQBAL =
  'Valadares Filho, S.C. et al. — Tabelas de composição de alimentos e exigências '
  + 'nutricionais de zebuínos: dados brasileiros (CQBAL/UFV), V Simpósio de Produção '
  + 'de Gado de Corte (base: matéria seca)'

// ═══════════════════════════════════════════════════════════════════════════
// ENERGÉTICOS
// ═══════════════════════════════════════════════════════════════════════════

const ENERGETICOS: IngredienteNutricional[] = [
  {
    id: 'milho-grao',
    nome: 'Milho triturado',
    apelidos: ['milho', 'milho moído', 'milho em grão moído', 'milho grão', 'fubá de milho'],
    categoria: 'energetico',
    funcao: 'Referência energética da formulação brasileira. Amido de alta digestibilidade, proteína baixa.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.68,
      proteinaBruta: 7.93, extratoEtereo: 3.67, fibraBruta: 2.25,
      fda: 4.54, fdn: 14.41, materiaMineral: 1.15,
      energiaBruta: 3944, edSuinos: 3472, emSuinos: 3421, emAves: 3229,
      ndt: 87.24,      // (B) — % da MS, por definição da tabela de ruminante
      enxofre: 0.03,   // (B)
      calcio: 0.04, fosforo: 0.26, magnesio: 0.10, potassio: 0.35, sodio: 0.00,
      lisina: 0.24, metionina: 0.21, metioninaCistina: 0.48,
      treonina: 0.27, triptofano: 0.05,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos, aminoácidos' },
      { ref: FONTE_CQBAL, cobre: 'NDT 87,24% (n=24) e enxofre 0,03% — energia de ruminante' },
    ],
  },
  {
    id: 'sorgo-baixo-tanino',
    nome: 'Sorgo (baixo tanino)',
    apelidos: ['sorgo', 'sorgo sem tanino', 'sorgo grão'],
    categoria: 'energetico',
    funcao: 'Substitui o milho parcial ou totalmente. Amido em torno de 72%, quase o mesmo do milho.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.73,
      proteinaBruta: 9.35, fibraBruta: 2.94, materiaMineral: 1.41,
      energiaBruta: 3910,
      calcio: 0.02, fosforo: 0.32,
      lisina: 0.19,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'composição do sorgo de baixo tanino (0,43% de tanino)' },
      {
        ref: 'Embrapa Milho e Sorgo — Milho e sorgo na alimentação de suínos e aves',
        cobre: 'EM do sorgo sem tanino 3.290 kcal/kg = 97% do milho; relação nutricional geral 85–90%',
      },
    ],
    alerta:
      'A tabela do BIPERS não traz EM para este sorgo. A Embrapa Milho e Sorgo publica 3.290 kcal/kg '
      + 'para o sorgo SEM tanino — use esse número sabendo que vem de outra fonte.',
  },
  {
    id: 'sorgo-alto-tanino',
    nome: 'Sorgo (alto tanino)',
    apelidos: ['sorgo com tanino', 'sorgo alto tanino'],
    categoria: 'energetico',
    funcao: 'Sorgo de variedade com tanino alto. NÃO equivale ao sorgo comum.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 86.80,
      proteinaBruta: 8.94, extratoEtereo: 2.48, fibraBruta: 2.38, materiaMineral: 1.32,
      energiaBruta: 3914,
      calcio: 0.02, fosforo: 0.27, magnesio: 0.14,
      metionina: 0.13, metioninaCistina: 0.27, treonina: 0.27,
      // Triptofano NÃO cadastrado de propósito: a Tabela 34 traz 2,50%, valor
      // impossível para um cereal (o sorgo de baixo tanino dá 0,08% na mesma
      // coluna). É erro de digitação do boletim. Repetir o número aqui seria
      // propagar um defeito da fonte — prefiro declarar que não sei.
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição do sorgo de alto tanino (1,78% de tanino)' }],
    alerta:
      'Sorgo COM tanino vale menos de 70% do milho e não é recomendado, especialmente para aves jovens. '
      + 'Confirme a variedade antes de fechar a conta — a diferença entre baixo e alto tanino é maior '
      + 'que a diferença entre sorgo e milho.',
    exigeAnalise: true,
  },
  {
    id: 'quirera-arroz',
    nome: 'Quirera de arroz',
    apelidos: ['quirera', 'arroz quirera', 'quirerinha'],
    categoria: 'energetico',
    funcao: 'Grão de arroz quebrado no beneficiamento. Energético de amido — é o que mais se parece com o milho.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 86.88,
      proteinaBruta: 8.04, extratoEtereo: 1.60, fibraBruta: 1.55, materiaMineral: 1.32,
      energiaBruta: 3712, edSuinos: 3613, emSuinos: 3525,
      calcio: 0.03, fosforo: 0.37, magnesio: 0.05,
      lisina: 0.30, treonina: 0.26, triptofano: 0.09,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
    alerta:
      'Quirera, farelo de arroz e casca de arroz são TRÊS produtos diferentes. Só a quirera é '
      + 'substituta energética do milho: tem 1,55% de fibra contra 9,91% do farelo desengordurado.',
  },
  {
    id: 'farelo-arroz-integral',
    nome: 'Farelo de arroz integral',
    apelidos: ['farelo de arroz', 'farelo arroz'],
    categoria: 'energetico',
    funcao: 'Película do grão com o óleo. Muito energético pela gordura (16,19% de EE) e rico em fósforo.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 89.47,
      proteinaBruta: 13.62, extratoEtereo: 16.19, fibraBruta: 7.80, materiaMineral: 7.98,
      energiaBruta: 4612, edSuinos: 4188, emSuinos: 4045,
      calcio: 0.09, fosforo: 1.74, magnesio: 0.87,
      lisina: 0.46, metionina: 0.18, metioninaCistina: 0.41,
      treonina: 0.38, triptofano: 0.12,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
    alerta:
      'A gordura do farelo integral RANCIFICA. Produto velho ou mal armazenado perde energia e '
      + 'prejudica o consumo. Confirme a data de produção.',
    exigeAnalise: true,
  },
  {
    id: 'farelo-arroz-desengordurado',
    nome: 'Farelo de arroz desengordurado',
    apelidos: ['farelo de arroz desengordurado', 'farelo arroz deseng'],
    categoria: 'fibroso',
    funcao: 'Farelo de arroz após extração do óleo. Perdeu a energia e ficou a fibra e a cinza.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.82,
      proteinaBruta: 15.26, extratoEtereo: 2.46, fibraBruta: 9.91, materiaMineral: 11.19,
      energiaBruta: 3777, edSuinos: 2608, emSuinos: 2344,
      calcio: 0.08, fosforo: 2.03, magnesio: 0.52,
      lisina: 0.66, metionina: 0.37, metioninaCistina: 0.68,
      treonina: 0.51, triptofano: 0.18,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
    alerta:
      'NÃO é substituto do milho: 2.344 kcal de EM para suínos contra 3.421 do milho — 31% menos energia. '
      + 'Tirar o óleo tirou justamente o que fazia dele um energético.',
  },
  {
    id: 'trigo-grao',
    nome: 'Trigo em grão',
    apelidos: ['trigo', 'trigo grão'],
    categoria: 'energetico',
    funcao: 'Cereal de inverno. Energia próxima do milho com quase o dobro da proteína.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.13,
      proteinaBruta: 16.63, extratoEtereo: 2.85, fibraBruta: 8.02,
      fda: 6.81, fdn: 28.13, materiaMineral: 4.25,
      energiaBruta: 3400, edSuinos: 3367, emSuinos: 3281, emAves: 2991,
      calcio: 0.10, fosforo: 0.89, magnesio: 0.24, potassio: 0.40, sodio: 0.00,
      lisina: 0.51, metionina: 0.27, metioninaCistina: 0.74,
      treonina: 0.42, triptofano: 0.18,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos, aminoácidos' }],
  },
  {
    id: 'triguilho',
    nome: 'Triguilho',
    apelidos: ['triguilho', 'residuo de trigo', 'resíduo de trigo'],
    categoria: 'energetico',
    funcao: 'Resíduo da limpeza do trigo. Energético com proteína intermediária.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.59,
      proteinaBruta: 14.72, extratoEtereo: 1.57, fibraBruta: 4.22,
      fda: 4.56, fdn: 19.60, materiaMineral: 2.55,
      energiaBruta: 3849, edSuinos: 3235, emSuinos: 3101, emAves: 2760,
      calcio: 0.11, fosforo: 0.41, magnesio: 0.14,
      lisina: 0.43, metionina: 0.23, metioninaCistina: 0.66,
      treonina: 0.40, triptofano: 0.15,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos, aminoácidos' },
      {
        ref: 'Embrapa Suínos e Aves — Utilização do triguilho em rações para frangos de corte',
        cobre: 'limite de inclusão de 30% para frango de corte, 1 a 42 dias',
      },
    ],
    limites: [{
      especies: ['aves'], max: 30, base: 'formula',
      motivo: 'Inclusão demonstrada em ração de frango de corte no ciclo inteiro (1 a 42 dias).',
      fonte: 'Embrapa Suínos e Aves — Utilização do triguilho em rações para frangos de corte',
    }],
    alerta:
      'É resíduo: a composição varia de lote pra lote muito mais que a do milho. Sem análise do lote, '
      + 'trabalhe abaixo do teto.',
    exigeAnalise: true,
  },
  {
    id: 'triticale',
    nome: 'Triticale',
    apelidos: ['triticale', 'triticale grão'],
    categoria: 'energetico',
    funcao: 'Híbrido de trigo com centeio. Entre os cereais de inverno, é o de energia mais próxima do milho para ave.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.91,
      proteinaBruta: 11.94, extratoEtereo: 1.32, fibraBruta: 2.75,
      fda: 3.37, fdn: 16.63, materiaMineral: 1.51,
      energiaBruta: 3858, edSuinos: 3158, emSuinos: 3038, emAves: 3171,
      calcio: 0.03, fosforo: 0.36, magnesio: 0.14, potassio: 0.54,
      lisina: 0.40, metionina: 0.24, metioninaCistina: 0.60,
      treonina: 0.34, triptofano: 0.12,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos, aminoácidos' }],
  },
  {
    id: 'cevada',
    nome: 'Cevada em grão',
    apelidos: ['cevada', 'cevada grão'],
    categoria: 'energetico',
    funcao: 'Cereal de inverno. Energia menor que a do milho pela fibra mais alta.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.55,
      proteinaBruta: 12.36, extratoEtereo: 1.24, fibraBruta: 6.94, materiaMineral: 1.97,
      energiaBruta: 3871, emSuinos: 3014, emAves: 2930,
      calcio: 0.06, fosforo: 0.38, magnesio: 0.13,
      lisina: 0.41, metionina: 0.12, metioninaCistina: 0.35,
      treonina: 0.32, triptofano: 0.15,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos, aminoácidos' }],
  },
  {
    id: 'aveia-branca',
    nome: 'Aveia branca em grão',
    apelidos: ['aveia', 'aveia branca'],
    categoria: 'energetico',
    funcao: 'Cereal fibroso. Energia bem abaixo do milho — 2.768 contra 3.421 kcal para suíno.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.76,
      proteinaBruta: 12.35, extratoEtereo: 3.24, fibraBruta: 9.25, materiaMineral: 2.59,
      energiaBruta: 4184, edSuinos: 2897, emSuinos: 2768,
      calcio: 0.09, fosforo: 0.35, magnesio: 0.09,
      lisina: 0.38, metionina: 0.27, metioninaCistina: 0.48,
      treonina: 0.30, triptofano: 0.18,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
  },
  {
    id: 'aveia-preta',
    nome: 'Aveia preta em grão',
    apelidos: ['aveia preta'],
    categoria: 'energetico',
    funcao: 'Aveia de grão escuro, mais fibrosa que a branca (11,08% de fibra bruta).',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 89.71,
      proteinaBruta: 13.06, extratoEtereo: 4.62, fibraBruta: 11.08, materiaMineral: 2.26,
      energiaBruta: 4038, edSuinos: 3077, emSuinos: 2975,
      calcio: 0.09, fosforo: 0.41, magnesio: 0.11,
      lisina: 0.50, metionina: 0.11, metioninaCistina: 0.77,
      treonina: 0.28, triptofano: 0.10,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
  },
  {
    id: 'mandioca-raspa',
    nome: 'Raspa de mandioca',
    apelidos: ['mandioca', 'raspa integral de mandioca', 'farelo de raspa de mandioca', 'raspa'],
    categoria: 'energetico',
    funcao: 'Energia de amido barata onde tem mandioca. Praticamente sem proteína (1,80%).',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.38,
      proteinaBruta: 1.80, extratoEtereo: 0.41, fibraBruta: 10.36, materiaMineral: 2.15,
      energiaBruta: 3648, edSuinos: 2997, emSuinos: 2924, emAves: 2406,
      calcio: 0.28, fosforo: 0.04, magnesio: 0.09,
      lisina: 0.11, treonina: 0.05, triptofano: 0.03,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'composição, energia de aves e suínos' },
      {
        ref: 'Embrapa/Alice — Digestibilidade da matéria seca e de nutrientes com raspa integral de '
          + 'mandioca em ovinos (0, 12, 24, 36 e 48%)',
        cobre: 'limite de inclusão',
      },
    ],
    limites: [{
      especies: ['bovinos'], max: 24, base: 'formula',
      motivo:
        'O ensaio é com OVINOS (0 a 48% sem efeito sobre digestibilidade). Para bovinos o dado direto '
        + 'não foi conferido — o teto aqui está posto na metade do testado.',
      fonte: 'Embrapa/Alice — raspa integral de mandioca em ovinos',
    }],
    alerta:
      'É pobre em proteína: 1,80% contra 7,93% do milho. Tirar milho e pôr mandioca DERRUBA a proteína '
      + 'da fórmula, e isso precisa ser recomposto com farelo.',
  },
  {
    id: 'mandioca-farinha',
    nome: 'Farinha de mandioca integral',
    apelidos: ['farinha de mandioca'],
    categoria: 'energetico',
    funcao: 'Energético de amido para ave — 3.040 kcal de EM, contra 3.229 do milho.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 92.29,
      proteinaBruta: 2.09, extratoEtereo: 0.13, fibraBruta: 3.98, materiaMineral: 1.51,
      energiaBruta: 3794, emAves: 3040,
      calcio: 0.12, fosforo: 0.07,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição e EM de aves' }],
    alerta: 'Quase sem proteína (2,09%). Substituir milho por ela exige recompor o farelo proteico.',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// PROTEICOS
// ═══════════════════════════════════════════════════════════════════════════

const PROTEICOS: IngredienteNutricional[] = [
  {
    id: 'farelo-soja-46',
    nome: 'Farelo de soja',
    apelidos: ['soja', 'farelo soja', 'farelo de soja 46', 'farelo de soja 45'],
    categoria: 'proteico',
    funcao: 'Referência proteica da formulação brasileira. Perfil de aminoácidos que nenhuma alternativa reproduz sozinha.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.67,
      proteinaBruta: 46.53, extratoEtereo: 1.45, fibraBruta: 5.39,
      fda: 7.20, fdn: 10.30, materiaMineral: 5.82,
      energiaBruta: 4196, edSuinos: 3643, emSuinos: 3309,
      ndt: 81.54,     // (B) — % da MS
      enxofre: 0.30,  // (B)
      calcio: 0.25, fosforo: 0.60, magnesio: 0.29, potassio: 1.95,
      lisina: 2.77, metionina: 0.67, metioninaCistina: 1.59,
      treonina: 1.68, triptofano: 0.67,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'farelo com mais de 45% de PB — composição, energia de suínos, aminoácidos' },
      { ref: FONTE_CQBAL, cobre: 'NDT 81,54% (n=18) e enxofre 0,30% — energia de ruminante' },
    ],
    alerta:
      'A tabela não traz EM para AVES do farelo de soja. O valor existe na literatura, mas não nesta '
      + 'fonte — por isso aparece como não cadastrado em vez de um número sem procedência.',
  },
  {
    id: 'farelo-soja-45',
    nome: 'Farelo de soja 45%',
    apelidos: ['farelo de soja 45%', 'soja farelo 45'],
    categoria: 'proteico',
    funcao: 'Farelo de soja de menor teor proteico (43,71% contra 46,53%).',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 88.35,
      proteinaBruta: 43.71, extratoEtereo: 2.01, fibraBruta: 5.65,
      fda: 7.66, fdn: 11.16, materiaMineral: 5.75,
      energiaBruta: 4197, edSuinos: 3585, emSuinos: 3215,
      calcio: 0.24, fosforo: 0.59, magnesio: 0.27, potassio: 2.36,
      lisina: 2.65, metionina: 0.60, metioninaCistina: 1.45,
      treonina: 1.60, triptofano: 0.68,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'farelo com até 45% de PB — composição, energia de suínos, aminoácidos' }],
  },
  {
    id: 'soja-integral',
    nome: 'Soja integral processada',
    apelidos: ['soja integral', 'soja grão', 'soja tostada', 'soja extrusada'],
    categoria: 'proteico',
    funcao: 'Grão inteiro processado. Proteína E gordura no mesmo ingrediente — 15,62% de EE.',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 89.93,
      proteinaBruta: 36.63, extratoEtereo: 15.62, fibraBruta: 8.54,
      fda: 14.40, fdn: 15.92, materiaMineral: 4.31,
      energiaBruta: 5155, edSuinos: 4025, emSuinos: 3824,
      ndt: 84.50,  // (B)
      calcio: 0.21, fosforo: 0.52, magnesio: 0.24,
      lisina: 2.34, metionina: 0.47, metioninaCistina: 1.09,
      treonina: 1.32, triptofano: 0.45,
    }),
    fontes: [
      { ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' },
      { ref: FONTE_CQBAL, cobre: 'NDT 84,50% — energia de ruminante' },
    ],
    alerta:
      'Tem que ser PROCESSADA (tostada, extrusada ou autoclavada). A soja crua carrega inibidor de '
      + 'tripsina e derruba o desempenho — o processamento é o que a torna utilizável.',
  },
  {
    id: 'caroco-algodao',
    nome: 'Caroço de algodão',
    apelidos: ['algodao', 'caroço de algodão', 'caroco de algodao'],
    categoria: 'proteico',
    funcao: 'Energia, proteína e fibra efetiva no mesmo ingrediente, com fósforo alto (0,75%).',
    perfil: perfil({
      base: 'MS',
      materiaSeca: 90.64,
      proteinaBruta: 22.62, extratoEtereo: 18.90, fibraBruta: 24.39,
      fdn: 46.04, fda: 35.85, materiaMineral: 4.66,
      ndt: 81.92,
      calcio: 0.33, fosforo: 0.75, magnesio: 0.75, potassio: 0.65, sodio: 0.08,
    }),
    fontes: [
      { ref: FONTE_CQBAL, cobre: 'composição completa (n=30 para MS e PB) e NDT 81,92%' },
      {
        ref: 'Moreira, F. B. — Subprodutos do algodão na alimentação de ruminantes (PubVet)',
        cobre: 'limites: 25% com volumoso ≥41%, 11% com concentrado 77%, recomendação prática 15%',
      },
    ],
    proibidoPara: ['suinos', 'aves'],
    motivoProibicao:
      'O caroço INTEIRO não serve para monogástrico — a fibra de 24,39% e o gossipol livre inviabilizam. '
      + 'O que serve para suíno é o FARELO (subproduto processado), que é outro cadastro.',
    limites: [{
      especies: ['bovinos'], max: 15, base: 'dieta_ms',
      motivo:
        'Gossipol. O limite prático de 15% é o que a literatura recomenda para não prejudicar a '
        + 'digestibilidade da fibra.',
      fonte: 'Moreira, F. B. — Subprodutos do algodão na alimentação de ruminantes (PubVet)',
    }],
  },
  {
    id: 'farelo-algodao',
    nome: 'Farelo de caroço de algodão',
    apelidos: ['farelo de algodao', 'farelo de algodão', 'farelo caroco de algodao'],
    categoria: 'proteico',
    funcao: 'Subproduto PROCESSADO do caroço. Diferente do caroço inteiro, serve para monogástrico.',
    perfil: perfil({
      base: 'MS',
      materiaSeca: 89.95,
      proteinaBruta: 40.90, extratoEtereo: 1.87, fibraBruta: 15.62,
      fdn: 34.92, fda: 24.19, materiaMineral: 6.82,
      ndt: 68.31,
      triptofano: 0.64,
    }),
    fontes: [
      { ref: FONTE_CQBAL, cobre: 'farelo de algodão 38% PB — composição (n=25 para PB) e NDT 68,31%' },
      {
        ref: 'Ludke, J. V.; Bertol, T. M. (Embrapa Suínos e Aves, 2021) — O desafio de substituir o '
          + 'milho e a soja na alimentação de suínos e aves',
        cobre: 'substitui 75 a 100% da proteína do farelo de soja em matrizes em lactação',
      },
    ],
    alerta:
      'O intervalo de 75–100% da proteína do farelo de soja é o citado para MATRIZ EM LACTAÇÃO. '
      + 'Para outras fases o dado não foi conferido. Gossipol continua presente: o processamento reduz, '
      + 'não elimina.',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// FIBROSOS
// ═══════════════════════════════════════════════════════════════════════════

const FIBROSOS: IngredienteNutricional[] = [
  {
    id: 'feno-alfafa',
    nome: 'Feno de alfafa',
    apelidos: ['alfafa', 'feno de alfafa'],
    categoria: 'fibroso',
    funcao: 'Leguminosa fenada. Proteína de volumoso com cálcio alto (1,07%).',
    perfil: perfil({
      base: 'MN',
      materiaSeca: 87.25,
      proteinaBruta: 16.79, extratoEtereo: 0.93, fibraBruta: 26.70, materiaMineral: 8.25,
      energiaBruta: 3934, edSuinos: 1928, emSuinos: 1651,
      calcio: 1.07, fosforo: 0.24, magnesio: 0.24,
      lisina: 0.94, metionina: 0.24, metioninaCistina: 0.50,
      treonina: 0.64, triptofano: 0.33,
    }),
    fontes: [{ ref: FONTE_BIPERS, cobre: 'composição, ED e EM de suínos, aminoácidos' }],
    alerta: '26,70% de fibra bruta. Não é energético — 1.651 kcal de EM para suíno, metade do milho.',
  },
  {
    id: 'casca-arroz',
    nome: 'Casca de arroz',
    apelidos: ['casca de arroz', 'casca arroz'],
    categoria: 'fibroso',
    funcao: 'Envoltório lenhoso do grão. É VOLUME, não alimento.',
    perfil: PERFIL_VAZIO,
    fontes: [{
      ref: 'Cadastro sem composição — nenhuma das tabelas consultadas (BIPERS 12, CQBAL/UFV) publica '
        + 'perfil para casca de arroz',
      cobre: 'apenas identidade e alerta técnico; nenhum valor nutricional',
    }],
    alerta:
      'NÃO é substituta energética do milho. É praticamente indigestível (alto teor de sílica e lignina) '
      + 'e entra como enchimento ou cama, não como alimento. Está cadastrada exatamente para não ser '
      + 'confundida com quirera de arroz nem com farelo de arroz — três produtos com o mesmo sobrenome '
      + 'e funções opostas.',
    exigeAnalise: true,
  },
  {
    id: 'casca-soja',
    nome: 'Casquinha de soja',
    apelidos: ['casca de soja', 'casquinha de soja'],
    categoria: 'fibroso',
    funcao: 'Coproduto fibroso do esmagamento da soja.',
    perfil: PERFIL_VAZIO,
    fontes: [{
      ref: 'Cadastro sem composição — o perfil não foi conferido nas fontes usadas neste banco',
      cobre: 'apenas identidade; nenhum valor nutricional',
    }],
  },
  {
    id: 'farelo-trigo',
    nome: 'Farelo de trigo',
    apelidos: ['farelo de trigo', 'farelo trigo'],
    categoria: 'fibroso',
    funcao: 'Coproduto da moagem do trigo. Entra como fibra e saciedade, não como energia.',
    perfil: PERFIL_VAZIO,
    fontes: [{
      ref: 'Embrapa/PAB — Níveis de farelo de trigo em rações de suínos em crescimento e terminação '
        + '(0/10/20/30% e 15/30/45%)',
      cobre: 'limite de inclusão; a composição não foi conferida (o BIPERS 12 traz TRIGO GRÃO e '
        + 'TRIGUILHO, que são outros produtos)',
    }],
    limites: [{
      especies: ['suinos'], max: 30, base: 'formula',
      motivo:
        'Ensaio com 0/10/20/30% em crescimento e 15/30/45% em terminação: o ganho de peso diário NÃO '
        + 'foi afetado. Acima de 30% o consumo sobe para compensar a energia menor.',
      fonte: 'Embrapa/PAB — Níveis de farelo de trigo em rações de suínos',
    }],
    alerta:
      'Composição NÃO cadastrada. Não confunda com "Trigo em grão" nem com "Triguilho" — os três estão '
      + 'no banco e são produtos diferentes. Em fase inicial e creche, use pouco: é mais fibroso que o milho.',
  },
  {
    id: 'ddg',
    nome: 'DDG / DDGS',
    apelidos: ['ddg', 'ddgs', 'grão seco de destilaria'],
    categoria: 'proteico',
    funcao: 'Coproduto do etanol de milho. É energético E proteico ao mesmo tempo.',
    perfil: PERFIL_VAZIO,
    fontes: [{
      ref: 'Vieira, L. C. (UFPel) — Utilização de DDG e WDG na nutrição de ruminantes',
      cobre: 'limite de inclusão de 20% da MS para milho moído; a composição não foi conferida nas '
        + 'fontes deste banco',
    }],
    limites: [{
      especies: ['bovinos'], max: 20, base: 'dieta_ms',
      motivo:
        'TETO POR SEGURANÇA, não por desempenho: o DDG é rico em enxofre e o excesso causa '
        + 'polioencefalomalácia. Com milho MOÍDO — que é o caso da fábrica farelada — a recomendação é '
        + 'a metade da usada com milho laminado: 20% da matéria seca, não 40%.',
      fonte: 'Vieira, L. C. (UFPel) — DDG e WDG na nutrição de ruminantes',
    }],
    alerta:
      'Composição NÃO cadastrada — e ela importa muito aqui: o DDG entra no lugar do milho E de parte '
      + 'do farelo de soja ao mesmo tempo, além de mexer em fibra, gordura, fósforo e enxofre. Sem o '
      + 'perfil, o sistema não consegue calcular esse efeito. O ENXOFRE é o que define o teto de '
      + 'segurança e é justamente o dado que falta.',
    exigeAnalise: true,
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// MINERAIS E ADITIVOS
//
// Nenhum tem composição cadastrada — as tabelas consultadas cobrem alimentos,
// não suplementos minerais. Estão aqui pela IDENTIDADE: é assim que a camada de
// segurança reconhece ureia numa fórmula de ave e bloqueia. Sem o cadastro, o
// ingrediente seria invisível pro sistema.
// ═══════════════════════════════════════════════════════════════════════════

const SEM_COMPOSICAO = (
  o: Omit<IngredienteNutricional, 'perfil' | 'fontes'> & { fontes?: FonteDado[] },
): IngredienteNutricional => ({
  ...o,
  perfil: PERFIL_VAZIO,
  fontes: o.fontes ?? [{
    ref: 'Cadastro sem composição — as tabelas usadas neste banco (BIPERS 12, CQBAL/UFV) cobrem '
      + 'alimentos, não suplementos minerais e aditivos',
    cobre: 'apenas identidade e regra de segurança; nenhum valor nutricional',
  }],
})

const MINERAIS: IngredienteNutricional[] = [
  SEM_COMPOSICAO({
    id: 'ureia',
    nome: 'Ureia',
    apelidos: ['ureia', 'uréia', 'ureia pecuária'],
    categoria: 'aditivo',
    funcao: 'Nitrogênio não proteico. O rúmen transforma em proteína microbiana — o monogástrico não.',
    proibidoPara: ['suinos', 'aves'],
    motivoProibicao:
      'Ureia é nitrogênio NÃO PROTEICO. Só o ruminante aproveita, porque a microbiota do rúmen converte '
      + 'em proteína microbiana. Suíno e ave não têm rúmen: a ureia vira amônia no sangue e INTOXICA. '
      + 'Não existe nível seguro — é bloqueio, não é limite.',
    alerta:
      'Mesmo em bovino, exige adaptação gradual do animal e mistura HOMOGÊNEA. Ureia mal misturada '
      + 'concentra e mata. A dosagem tem que ser definida por responsável técnico.',
  }),
  SEM_COMPOSICAO({
    id: 'sulfato-amonia',
    nome: 'Sulfato de amônia',
    apelidos: ['sulfato de amonia', 'sulfato de amônio', 'sulfato de amonio'],
    categoria: 'aditivo',
    funcao: 'Fonte de enxofre que acompanha a ureia — o rúmen precisa de enxofre para usar o nitrogênio.',
    proibidoPara: ['suinos', 'aves'],
    motivoProibicao:
      'Entra na fórmula de ruminante como par da ureia, para dar o enxofre que a síntese de proteína '
      + 'microbiana exige. Sem rúmen não cumpre função nenhuma e é fonte de risco.',
  }),
  SEM_COMPOSICAO({
    id: 'calcario',
    nome: 'Calcário calcítico',
    apelidos: ['calcario', 'calcário', 'calcario calcitico'],
    categoria: 'mineral',
    funcao: 'Fonte de cálcio. Em poedeira é o que forma a casca do ovo.',
    alerta:
      'Composição NÃO cadastrada. O teor de cálcio varia com a jazida e está no laudo do fornecedor — '
      + 'use o laudo, não uma média.',
  }),
  SEM_COMPOSICAO({
    id: 'fosfato-bicalcico',
    nome: 'Fosfato bicálcico',
    apelidos: ['fosfato bicalcico', 'fosfato bicálcico', 'fosfato'],
    categoria: 'mineral',
    funcao: 'Fonte de fósforo DISPONÍVEL e de cálcio. O fósforo do vegetal está em fitato e o monogástrico não aproveita.',
    alerta:
      'Composição NÃO cadastrada. Traz cálcio junto do fósforo — mexer nele desequilibra os dois ao '
      + 'mesmo tempo. Use a garantia do rótulo.',
  }),
  SEM_COMPOSICAO({
    id: 'sal-comum',
    nome: 'Sal comum (NaCl)',
    apelidos: ['sal comum', 'sal', 'cloreto de sodio', 'nacl'],
    categoria: 'mineral',
    funcao: 'Fonte de sódio e cloro.',
  }),
  SEM_COMPOSICAO({
    id: 'nucleo',
    nome: 'Núcleo / premix',
    apelidos: ['nucleo', 'núcleo', 'premix', 'núcleo mineral', 'nucleo mineral',
      'mistura mineral', 'sal mineral'],
    categoria: 'aditivo',
    funcao: 'Concentrado de vitaminas e minerais formulado pelo fabricante.',
    alerta:
      'Composição NÃO cadastrada e nem poderia: cada fabricante tem a sua. O único número válido é o da '
      + 'GARANTIA DO RÓTULO daquele produto. Trocar de marca sem refazer a conta muda cálcio, fósforo e '
      + 'sódio da fórmula inteira.',
    exigeAnalise: true,
  }),

  // ── núcleos COM garantia de rótulo ────────────────────────────────────────
  //
  // POR QUE ESTES DOIS TÊM NÚMERO E O GENÉRICO ACIMA NÃO
  // As fichas técnicas destes produtos JÁ ERAM a fonte das fórmulas de referência
  // em `formulacoes-racao.ts` — o número estava citado lá, em texto, e não estava
  // no banco nutricional. Trazer pra cá não inventa nada: é o mesmo dado, agora
  // onde a conta acontece.
  //
  // Eles casam com o termo genérico ("Núcleo suínos", "Núcleo de postura") porque
  // as fórmulas de referência que usam esses nomes foram construídas EXATAMENTE
  // dessas fichas. O risco de generalizar está escrito no alerta: se o cliente usa
  // outra marca, o número muda e a conta precisa ser refeita.
  //
  // O VALOR CADASTRADO É O MÍNIMO DA GARANTIA — que é o número a que o fabricante
  // se obriga. A faixa cheia fica no alerta, porque pra checar TETO o mínimo
  // subestima.
  {
    id: 'nucleo-suinos-adm',
    nome: 'Núcleo suínos 3%',
    apelidos: ['núcleo suínos', 'nucleo suinos', 'núcleo suino', 'nucleo suino'],
    categoria: 'aditivo',
    funcao: 'Concentrado vitamínico-mineral para suíno, formulado para inclusão de 3% na ração.',
    perfil: perfil({
      base: 'MN',
      // Sem MS declarada na ficha; 98% é o usual de produto mineral seco, e eu
      // NÃO vou cadastrar isso como se fosse dado. Fica null: o que a ficha traz
      // é o cálcio, e é só o cálcio que entra na conta.
      calcio: 24.0,
    }),
    fontes: [{
      ref: 'Ficha técnica ADM Núcleo Suínos Crescimento/Terminação 3% — garantia de Ca 24 a 24,5%',
      cobre: 'cálcio (mínimo da garantia); nenhum outro nutriente consta',
    }],
    alerta:
      'Números da ficha ADM, que é a fonte das fórmulas de referência de suíno deste sistema. '
      + 'A garantia é de Ca 24 a 24,5% — cadastrei o MÍNIMO (24%), então para checar TETO de cálcio o '
      + 'valor está subestimado. SE O CLIENTE USA OUTRA MARCA, o número muda: pegue a garantia do rótulo '
      + 'dele. A 3% de inclusão isto entrega 0,72% de cálcio na ração, e por isso estas fórmulas não '
      + 'levam calcário por fora — o núcleo já traz.',
    exigeAnalise: true,
  },
  {
    id: 'nucleo-postura-integral',
    nome: 'Núcleo de postura 5%',
    apelidos: ['núcleo de postura', 'nucleo de postura', 'avenúcleo', 'avenucleo', 'núcleo postura'],
    categoria: 'aditivo',
    funcao: 'Concentrado vitamínico-mineral para poedeira, formulado para inclusão de 5% na ração.',
    perfil: perfil({
      base: 'MN',
      calcio: 20.0,   // garantia 200-300 g/kg → 20 a 30%
      fosforo: 7.5,   // 75 g/kg
      sodio: 3.0,     // 30 g/kg
    }),
    fontes: [{
      ref: 'Ficha Integral Mix Avenúcleo Postura (50 kg/1.000 kg) — garantia Ca 200-300 g/kg, '
        + 'P 75 g/kg, Na 30 g/kg',
      cobre: 'cálcio (mínimo da garantia), fósforo e sódio',
    }],
    alerta:
      'Números da ficha Integral Mix, que é a fonte da fórmula de referência de postura deste sistema. '
      + 'A garantia de cálcio é uma FAIXA (20 a 30%) e cadastrei o mínimo — a 5% de inclusão isso vai de '
      + '1,0 a 1,5% de cálcio na ração, e é o calcário por fora que fecha os 3,4% que a poedeira precisa '
      + 'para fazer casca. Outra marca, outro número: use a garantia do rótulo do cliente.',
    exigeAnalise: true,
  },
  SEM_COMPOSICAO({
    id: 'oleo',
    nome: 'Óleo / gordura',
    apelidos: ['oleo', 'óleo', 'oleo de soja', 'óleo de soja', 'gordura'],
    categoria: 'aditivo',
    funcao: 'Concentrado de energia. Mais que o dobro da energia de um cereal por quilo.',
    liquido: true,
    alerta:
      'É LÍQUIDO. A Compacta é farelada e mistura só ingrediente seco. Ou o cliente tem kit de adição '
      + 'de líquido, ou a fórmula precisa ser refeita sem óleo por um zootecnista — o que derruba a '
      + 'energia e muda o desempenho.',
  }),
  SEM_COMPOSICAO({
    id: 'farinha-carne-ossos',
    nome: 'Farinha de carne e ossos',
    apelidos: ['fco', 'farinha de carne', 'farinha de carne e ossos'],
    categoria: 'proteico',
    funcao: 'Proteína de origem animal, com cálcio e fósforo junto.',
    limites: [{
      especies: ['aves'], max: 9, base: 'formula',
      motivo:
        'Em ração comercial de frango de corte a inclusão vai de 3,9 a 9% conforme a formulação; os '
        + 'ensaios testaram 3 e 6%, e também 5 e 10%.',
      fonte: 'Revista Brasileira de Ciência Avícola (SciELO) — Avaliação da farinha de carne e ossos '
        + 'na alimentação de frangos de corte',
    }],
    proibidoPara: ['bovinos'],
    motivoProibicao:
      'Proteína de origem animal de ruminante é PROIBIDA na alimentação de ruminante pela legislação '
      + 'brasileira (medida de controle da encefalopatia espongiforme). Confirme a norma vigente com o '
      + 'responsável técnico antes de qualquer uso.',
    alerta:
      'O ganho de peso foi MAIOR sem a farinha nos ensaios — ela abarata, não melhora desempenho. E '
      + 'como carrega cálcio e fósforo, entrar com ela sem baixar fosfato bicálcico e calcário '
      + 'desequilibra o mineral da fórmula.',
    exigeAnalise: true,
  }),
  SEM_COMPOSICAO({
    id: 'silagem',
    nome: 'Silagem / volumoso',
    apelidos: ['silagem', 'volumoso'],
    categoria: 'volumoso',
    funcao: 'Forragem conservada úmida.',
    umido: true,
    proibidoPara: ['suinos', 'aves'],
    motivoProibicao: 'Volumoso úmido não é alimento de monogástrico.',
    alerta:
      'É ÚMIDO. Não entra em fábrica farelada. Entra na dieta por fora, e é justamente o que esta tela '
      + 'não enxerga — por isso limite "% da dieta em matéria seca" não vira "% da fórmula" aqui.',
  }),
]

/** O banco inteiro. */
export const BANCO_NUTRICIONAL: IngredienteNutricional[] = [
  ...ENERGETICOS, ...PROTEICOS, ...FIBROSOS, ...MINERAIS,
]

// ── consulta por nome ────────────────────────────────────────────────────────

/**
 * Normaliza pra comparar. Mesma regra de `substituicoes-racao.ts`: sem acento,
 * sem pontuação, minúsculo.
 */
const chave = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Casa por prefixo nos dois sentidos, igual ao motor de substituição. */
function casa(ing: IngredienteNutricional, nome: string): number {
  const k = chave(nome)
  if (!k) return 0
  let melhor = 0
  for (const alvo of [ing.nome, ...ing.apelidos]) {
    const a = chave(alvo)
    if (!a) continue
    if (k === a || k.startsWith(a + ' ') || a.startsWith(k + ' ')) {
      melhor = Math.max(melhor, a.length)
    }
  }
  return melhor
}

/**
 * Acha o ingrediente do banco pelo nome digitado.
 *
 * PREFERE O CASAMENTO MAIS LONGO, e isso não é detalhe: "Farelo de caroço de
 * algodão" tem que cair no farelo (que serve pra suíno), não no "Caroço de
 * algodão" (que não serve). Mesma armadilha que já custou um bug no motor de
 * substituição — a regra foi copiada de lá de propósito.
 */
export function acharIngrediente(nome: string): IngredienteNutricional | null {
  if (!chave(nome)) return null
  let melhor: { ing: IngredienteNutricional; tam: number } | null = null
  for (const ing of BANCO_NUTRICIONAL) {
    const tam = casa(ing, nome)
    if (tam > 0 && (!melhor || tam > melhor.tam)) melhor = { ing, tam }
  }
  return melhor?.ing ?? null
}

/** true quando o perfil não tem NENHUM nutriente preenchido. */
export function semComposicao(ing: IngredienteNutricional): boolean {
  return Object.entries(ing.perfil)
    .filter(([k]) => k !== 'base')
    .every(([, v]) => v == null)
}

/** Ingredientes que podem ser oferecidos pra esta espécie. */
export function disponiveisPara(especie: Especie): IngredienteNutricional[] {
  return BANCO_NUTRICIONAL.filter(i => !i.proibidoPara?.includes(especie))
}
