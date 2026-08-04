/**
 * SUBSTITUIÇÃO DE INGREDIENTE — o que entra no lugar do que o cliente não tem.
 *
 * POR QUE EXISTE
 * O vendedor monta o estudo com a fórmula de referência e o produtor diz "não
 * tenho milho" ou "aqui o sorgo é mais barato". Sem isto, o vendedor troca de
 * cabeça: apaga o milho, digita sorgo e mantém os mesmos 69,8%. Só que sorgo não
 * é milho — vale 85–90% da energia — e coproduto tem TETO. DDG em excesso mata
 * boi por polioencefalomalácia (enxofre); caroço de algodão em excesso derruba a
 * digestibilidade da fibra e carrega gossipol.
 *
 * MESMA REGRA DO formulacoes-racao.ts: nada entra sem `fonte` com instituição.
 * Este número vira decisão de investimento na fazenda de alguém. Estimativa de
 * memória aqui vira animal doente e produtor com prejuízo.
 *
 * O QUE ESTE ARQUIVO **NÃO** É
 * Não é formulador. Não calcula balanceamento de proteína, energia, aminoácido
 * ou mineral. Ele responde uma pergunta só: "o que dá pra pôr no lugar disto, até
 * quanto, e o que pode dar errado". Ajuste fino continua sendo do zootecnista —
 * o rodapé da tela já diz isso e continua valendo.
 */
import type { Especie } from '@/lib/venda-racao/tipos'

/** Em cima de que o `max` é medido. Confundir os dois é errar por 3×. */
export type BaseLimite =
  /** % da própria fórmula/concentrado que está sendo montado na tela. */
  | 'formula'
  /** % da dieta total em matéria seca — inclui volumoso, que a tela não vê. */
  | 'dieta_ms'

export interface Substituto {
  /** Nome que vai pro campo do ingrediente. */
  nome: string
  /** Preço de referência R$/kg. Serve de chute inicial; o vendedor corrige. */
  preco: number
  limite: { max: number; base: BaseLimite }
  /** Quanto vale, em energia, comparado ao que saiu. 0.87 = 87% do original. */
  equivalencia?: number
  /** Por que trocar. */
  ganho: string
  /** O que pode dar errado. É RISCO, não "observação" — aparece em vermelho. */
  risco?: string
  /** Instituição + referência. Sem isto, não entra. */
  fonte: string
  /** Vazio = serve pra todas as espécies da tela. */
  especies?: Especie[]
}

export interface GrupoSubstituicao {
  /** Papel do ingrediente na fórmula. Aparece como título do painel. */
  papel: string
  /** Nomes que casam com este grupo (comparação sem acento/caixa, por prefixo). */
  alvos: string[]
  substitutos: Substituto[]
}

/**
 * Ainda CURTO de propósito — 4 substitutos, cada um com fonte conferida. O
 * mecanismo (clicar, comparar, aplicar parcial) está pronto e ligado; entrada
 * nova só depois que o percentual passar pela conferência. Preferi 4 checados a
 * 20 plausíveis: aqui um número errado não gera bug, gera boi morto.
 */
export const SUBSTITUICOES: GrupoSubstituicao[] = [
  {
    papel: 'Energia (amido)',
    alvos: ['milho'],
    substitutos: [
      {
        nome: 'Sorgo (sem tanino)',
        preco: 0.95,
        limite: { max: 100, base: 'formula' },
        equivalencia: 0.875,
        ganho:
          'Substitui o milho parcial ou totalmente. Amido em torno de 72%, praticamente o mesmo do milho. '
          + 'A equivalência de PREÇO acompanha a de energia: pagar mais que 85–90% do preço do milho não compensa.',
        risco:
          'Só serve sorgo SEM tanino. O com tanino vale menos de 70% do milho e não é recomendado, '
          + 'especialmente para aves jovens. Confirme a variedade antes de fechar a conta.',
        fonte: 'Embrapa Milho e Sorgo — Milho e sorgo na alimentação de suínos e aves (Tabela de EM: sorgo sem tanino 3.290 kcal/kg = 97% do milho; relação nutricional geral 85–90%)',
      },
      {
        nome: 'DDG (grão seco de destilaria)',
        preco: 1.35,
        limite: { max: 20, base: 'dieta_ms' },
        ganho:
          'Coproduto do etanol de milho. Entra no lugar do milho E de parte do farelo de soja ao mesmo tempo — '
          + 'é energético e proteico. Em confinamento costuma ficar entre 10% e 40% da dieta.',
        risco:
          'TETO POR SEGURANÇA, não por desempenho: o DDG é rico em enxofre e o excesso causa '
          + 'polioencefalomalácia (intoxicação nervosa). Com milho MOÍDO — que é o caso da fábrica farelada — '
          + 'a recomendação é a metade da usada com milho laminado: 20% da matéria seca, não 40%. '
          + 'E o limite é sobre a DIETA TOTAL, incluindo o volumoso que esta tela não enxerga.',
        fonte: 'Vieira, L. C. (UFPel) — Utilização de DDG e WDG na nutrição de ruminantes; recomendação de 40% MS para milho laminado e 20% para milho moído',
        especies: ['bovinos'],
      },
      {
        nome: 'Raspa de mandioca',
        preco: 0.90,
        limite: { max: 24, base: 'formula' },
        ganho: 'Energia de amido barata onde tem mandioca. Substitui parte do milho sem mexer no resto da fórmula.',
        risco:
          'A referência é de ensaio com OVINOS (0 a 48% da ração, sem efeito sobre digestibilidade da matéria '
          + 'orgânica e da FDN). Para bovinos o dado direto não foi conferido — o limite aqui está posto na '
          + 'metade do testado. É pobre em proteína: tirar milho e pôr mandioca derruba a PB da fórmula, '
          + 'e isso precisa ser recomposto.',
        fonte: 'Embrapa/Alice — Digestibilidade da matéria seca e de nutrientes com raspa integral de mandioca em ovinos (0, 12, 24, 36 e 48%)',
      },
    ],
  },
  {
    papel: 'Proteína',
    alvos: ['farelo de soja', 'soja'],
    substitutos: [
      {
        nome: 'Caroço de algodão',
        preco: 1.30,
        limite: { max: 15, base: 'dieta_ms' },
        ganho:
          'Energia e proteína no mesmo ingrediente, com fibra efetiva e fósforo. Em dieta com bastante '
          + 'volumoso (mínimo 41%) chega a 25%; em dieta de alto concentrado (77%) cai para 11%.',
        risco:
          'Gossipol. O limite prático de 15% é o que a literatura recomenda para não prejudicar a '
          + 'digestibilidade da fibra. Em reprodutores, dietas de até 30 mg de gossipol por kg de peso vivo '
          + 'não mostraram efeito sobre quantidade e qualidade do sêmen — acima disso é território de risco. '
          + 'Não usar em monogástricos sem tratamento.',
        fonte: 'Moreira, F. B. — Subprodutos do algodão na alimentação de ruminantes (PubVet); limites 25% com volumoso ≥41%, 11% com concentrado 77%, recomendação prática 15%',
        especies: ['bovinos'],
      },
    ],
  },
]

// ── consulta ─────────────────────────────────────────────────────────────────

const chave = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Grupo de substituição do ingrediente, se houver.
 * Casa por PREFIXO normalizado: "Milho triturado", "Milho moído" e "Milho em
 * grão moído" caem todos no grupo do milho — é assim que as fórmulas de
 * referência escrevem, cada uma de um jeito.
 */
export function grupoDe(nomeIngrediente: string): GrupoSubstituicao | null {
  const k = chave(nomeIngrediente)
  if (!k) return null
  for (const g of SUBSTITUICOES) {
    for (const alvo of g.alvos) {
      const a = chave(alvo)
      if (k === a || k.startsWith(a + ' ') || k.startsWith(a)) return g
    }
  }
  return null
}

/** Substitutos válidos para o ingrediente naquela espécie. */
export function substitutosDe(nomeIngrediente: string, especie: Especie): Substituto[] {
  const g = grupoDe(nomeIngrediente)
  if (!g) return []
  return g.substitutos.filter(s => !s.especies?.length || s.especies.includes(especie))
}

export const temSubstituto = (nomeIngrediente: string, especie: Especie): boolean =>
  substitutosDe(nomeIngrediente, especie).length > 0

/**
 * Quanto do ingrediente atual dá pra trocar sem passar do teto do substituto.
 * `participacaoAtual` é o % que o ingrediente tem na fórmula hoje.
 *
 * Para limite com base 'dieta_ms' devolve `null`: a tela monta o CONCENTRADO e
 * não sabe quanto de volumoso o animal come, então não há como afirmar que 20%
 * da fórmula são 20% da dieta. Dizer um número aqui seria inventar. A UI mostra
 * o teto como aviso, não como cálculo.
 */
export function maximoSubstituivel(s: Substituto, participacaoAtual: number): number | null {
  if (s.limite.base === 'dieta_ms') return null
  return Math.min(participacaoAtual, s.limite.max)
}

/** Texto curto do limite, pro cabeçalho do card. */
export function textoLimite(s: Substituto): string {
  return s.limite.base === 'formula'
    ? `até ${s.limite.max}% da fórmula`
    : `até ${s.limite.max}% da dieta total (com volumoso)`
}
