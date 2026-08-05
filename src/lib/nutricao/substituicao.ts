/**
 * SUBSTITUIÇÃO INTELIGENTE — o que entra no lugar, e o que isso muda no resto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTAVA ERRADO ANTES (§1 do pedido)
 *
 * O ⇄ trocava X% de A por X% de B e não mexia em mais nada. Duas consequências,
 * e as duas o pedido descreve com precisão:
 *
 *   1. POUCAS ALTERNATIVAS. A lista era curada à mão: 2 grupos, 10 membros.
 *      Filtrando por espécie, o vendedor via de 1 a 3 opções. Calcário, fosfato,
 *      núcleo e sal nem tinham botão.
 *
 *   2. TROCA CEGA. Pôr DDG no lugar do milho não é trocar energia por energia:
 *      o DDG traz proteína, fibra, gordura, fósforo e enxofre junto. Quem não
 *      baixa o farelo de soja depois fica com a fórmula desequilibrada — e o
 *      sistema não avisava.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO ISTO RESOLVE
 *
 * As alternativas passam a sair do BANCO NUTRICIONAL, não de uma lista curada.
 * Quem tem composição e cumpre a mesma função vira candidato automaticamente —
 * e a ordem é por mérito técnico-econômico, não alfabética.
 *
 * A lista curada (`substituicoes-racao.ts`) NÃO foi jogada fora, e não podia
 * ser: ela carrega o RISCO em prosa — gossipol, polioencefalomalácia, tanino,
 * "o ganho de peso foi maior sem". Isso não se deriva de tabela de composição.
 * Aqui as duas se juntam: o banco dá os números, a lista curada dá o aviso.
 *
 * E o que a troca causa no RESTO da fórmula não é estimado por regra de três —
 * é o solver (`otimizador.ts`) que refaz a conta. Por isso "Aplicar e
 * rebalancear" existe e é o botão padrão.
 */
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import { lerNutriente, type ChaveNutriente } from './tipos'
import {
  BANCO_NUTRICIONAL, acharIngrediente, semComposicao,
  type IngredienteNutricional,
} from './ingredientes'
import { limitePara } from './seguranca'
import { substitutosDe, type Substituto } from '@/lib/substituicoes-racao'
import { INGREDIENTES_PADRAO } from '@/lib/venda-racao/catalogo'

export type Compatibilidade = 'excelente' | 'boa' | 'parcial' | 'nao_recomendada'

export const ROTULO_COMPAT: Record<Compatibilidade, string> = {
  excelente: 'Excelente compatibilidade',
  boa: 'Boa compatibilidade',
  parcial: 'Compatibilidade parcial',
  nao_recomendada: 'Não recomendada',
}

export interface Alternativa {
  ingrediente: IngredienteNutricional
  compatibilidade: Compatibilidade
  /** Frases curtas do §8: "Substituto energético", "Exige correção proteica"… */
  motivos: string[]
  /** Nutrientes que mudam de forma relevante ao trocar 1 ponto por 1 ponto. */
  muda: Array<{ chave: ChaveNutriente; rotulo: string; de: number | null; para: number | null; sinal: 1 | -1 }>
  /** Teto de inclusão que se aplica, se houver. */
  limite: { max: number; base: 'formula' | 'dieta_ms'; fonte: string } | null
  /** Quanto do ingrediente atual dá pra trocar. `null` = teto é sobre a dieta. */
  maximoSubstituivel: number | null
  precoReferencia: number
  /** Risco em prosa da lista curada. É o que tabela de composição não dá. */
  risco?: string
  ganho?: string
  fonte: string
  /** Quanto maior, melhor. Só pra ordenar. */
  pontos: number
}

/** O nutriente que define a função do ingrediente, por espécie. */
function eixoPrincipal(cat: IngredienteNutricional['categoria'], especie: Especie): ChaveNutriente {
  if (cat === 'proteico') return 'proteinaBruta'
  if (cat === 'mineral') return 'calcio'
  if (cat === 'fibroso') return 'fibraBruta'
  // energético e o resto: energia da espécie
  return especie === 'aves' ? 'emAves' : especie === 'suinos' ? 'emSuinos' : 'ndt'
}

const ROTULO: Partial<Record<ChaveNutriente, string>> = {
  proteinaBruta: 'Proteína bruta', extratoEtereo: 'Gordura', fibraBruta: 'Fibra bruta',
  fdn: 'FDN', emAves: 'Energia (aves)', emSuinos: 'Energia (suínos)', ndt: 'NDT',
  calcio: 'Cálcio', fosforo: 'Fósforo', enxofre: 'Enxofre', sodio: 'Sódio',
  lisina: 'Lisina', metionina: 'Metionina',
}

/** Nutrientes que a troca pode desequilibrar e o vendedor precisa ver. */
const OLHAR: ChaveNutriente[] = [
  'proteinaBruta', 'extratoEtereo', 'fibraBruta', 'calcio', 'fosforo', 'enxofre', 'lisina',
]

/** Mudança relativa que já merece aparecer. Abaixo disso é ruído. */
const RELEVANTE = 0.15

export interface OpcoesSubstituicao {
  /** Mostrar também o que não é recomendado. Padrão: esconde. */
  incluirNaoRecomendadas?: boolean
}

/**
 * Alternativas para trocar um ingrediente, ordenadas por mérito.
 *
 * `participacaoAtual` em % da fórmula — usado pra calcular quanto dá pra trocar
 * sem estourar o teto do candidato.
 */
export function alternativasPara(
  nomeAtual: string, participacaoAtual: number, especie: Especie,
  opcoes: OpcoesSubstituicao = {},
): Alternativa[] {
  const atual = acharIngrediente(nomeAtual)
  if (!atual) return []

  const eixo = eixoPrincipal(atual.categoria, especie)
  const valorAtual = lerNutriente(atual.perfil, eixo, 'MN')

  // A lista curada, indexada pelo ID DO BANCO — não pelo nome.
  //
  // Os dois catálogos escrevem diferente: a lista curada tem "Sorgo (sem
  // tanino)" e "DDG (grão seco de destilaria)"; o banco tem "Sorgo (baixo
  // tanino)" e "DDG / DDGS". Casar por chave exata falhava calado, e o efeito
  // era grave: o sorgo perdia a equivalência da Embrapa e caía pra "parcial",
  // e o DDG sumia inteiro da lista de bovinos — junto com o aviso de
  // polioencefalomalácia.
  //
  // `acharIngrediente` já resolve isso (prefixo nos dois sentidos, preferindo o
  // mais longo) e está coberto por teste. Reusar é melhor que reescrever.
  const curados = new Map<string, Substituto>()
  for (const s of substitutosDe(nomeAtual, especie)) {
    const noBanco = acharIngrediente(s.nome)
    if (noBanco) curados.set(noBanco.id, s)
  }

  const saida: Alternativa[] = []

  for (const cand of BANCO_NUTRICIONAL) {
    if (cand.id === atual.id) continue
    if (cand.proibidoPara?.includes(especie)) continue
    // Sem composição não dá pra dizer o que a troca faz. A lista curada pode
    // trazer o item mesmo assim (é o caso do DDG), e aí ele entra por lá.
    const curado = curados.get(cand.id)
    if (semComposicao(cand) && !curado) continue
    // Líquido/úmido não entra em fábrica farelada — a tela já barra no seletor.
    if (cand.liquido || cand.umido) continue

    const valorCand = lerNutriente(cand.perfil, eixo, 'MN')

    // ── o que muda, nutriente a nutriente ─────────────────────────────────
    const muda: Alternativa['muda'] = []
    for (const k of OLHAR) {
      const de = lerNutriente(atual.perfil, k, 'MN')
      const para = lerNutriente(cand.perfil, k, 'MN')
      if (de == null || para == null) continue
      const base = Math.max(Math.abs(de), 0.01)
      if (Math.abs(para - de) / base < RELEVANTE) continue
      muda.push({ chave: k, rotulo: ROTULO[k] ?? k, de, para, sinal: para > de ? 1 : -1 })
    }

    // ── limite de inclusão ────────────────────────────────────────────────
    const lim = limitePara(cand, especie)
    const limite = lim ? { max: lim.max, base: lim.base, fonte: lim.fonte } : null
    const maximoSubstituivel = !limite ? participacaoAtual
      : limite.base === 'dieta_ms' ? null
      : Math.min(participacaoAtual, limite.max)

    // ── motivos, na linguagem do §8 ───────────────────────────────────────
    const motivos: string[] = []
    motivos.push(
      cand.categoria === 'proteico' ? 'Substituto proteico'
        : cand.categoria === 'fibroso' ? 'Substituto fibroso'
        : cand.categoria === 'mineral' ? 'Substituto mineral'
        : cand.categoria === 'aditivo' ? 'Aditivo / núcleo'
        : 'Substituto energético',
    )

    // Diferença no eixo principal — é o que decide a compatibilidade.
    let razao: number | null = null
    if (valorAtual != null && valorCand != null && valorAtual > 0) razao = valorCand / valorAtual
    // Sem número no banco, vale a EQUIVALÊNCIA da lista curada — que existe
    // exatamente pra isso ("quanto vale, em energia, comparado ao que saiu") e
    // vem com fonte. É o caso do sorgo: a tabela do BIPERS não traz EM para
    // suíno, mas a Embrapa Milho e Sorgo publica 3.290 kcal = 87,5% do milho.
    // Sem isto o substituto mais canônico do milho cairia em "parcial" por
    // falta de dado, não por mérito.
    if (razao == null && curado?.equivalencia != null) razao = curado.equivalencia

    if (cand.categoria !== atual.categoria) {
      motivos.push('Cumpre função diferente do ingrediente atual')
    }
    if (razao != null && razao < 0.9) {
      motivos.push(atual.categoria === 'proteico' ? 'Exige correção proteica' : 'Exige correção energética')
    }
    for (const m of muda) {
      if (m.chave === 'proteinaBruta' && m.sinal === 1) motivos.push('Traz proteína junto — provável redução do farelo')
      if (m.chave === 'proteinaBruta' && m.sinal === -1) motivos.push('Exige correção proteica')
      if ((m.chave === 'calcio' || m.chave === 'fosforo') && m.sinal === 1) motivos.push('Exige correção mineral')
      if (m.chave === 'lisina' && m.sinal === -1) motivos.push('Exige correção de aminoácidos')
      if (m.chave === 'fibraBruta' && m.sinal === 1) motivos.push('Aumenta a fibra')
      if (m.chave === 'enxofre' && m.sinal === 1) motivos.push('Aumenta o enxofre — atenção ao teto de segurança')
    }
    if (limite) {
      motivos.push(limite.base === 'formula'
        ? `Limite de ${limite.max}% da fórmula`
        : `Limite de ${limite.max}% da dieta total`)
    }
    if (cand.exigeAnalise) motivos.push('Exige análise laboratorial')
    if (maximoSubstituivel != null && maximoSubstituivel < participacaoAtual - 0.01) {
      motivos.push('Pode substituir parcialmente')
    }

    // ── compatibilidade ───────────────────────────────────────────────────
    let compat: Compatibilidade
    if (cand.categoria !== atual.categoria) {
      // Categoria diferente só é aceitável quando o candidato AINDA cumpre bem
      // o eixo principal — é o caso do DDG, proteico que também dá energia.
      compat = razao != null && razao >= 0.8 ? 'parcial' : 'nao_recomendada'
    } else if (razao == null) {
      compat = 'parcial' // mesma função, mas sem número pra comparar
    } else if (razao >= 0.95 && muda.length <= 1) {
      compat = 'excelente'
    } else if (razao >= 0.85) {
      compat = 'boa'
    } else if (razao >= 0.7) {
      compat = 'parcial'
    } else {
      compat = 'nao_recomendada'
    }

    // A LISTA CURADA GANHA DA HEURÍSTICA.
    //
    // Se o ingrediente foi escrito à mão como substituto DESTE ingrediente,
    // com fonte e limite conferidos, isso é julgamento humano — e não pode ser
    // rebaixado por um score que não tem número pra calcular.
    //
    // O caso concreto: DDG para milho em bovinos. Ele é proteico (categoria
    // diferente do milho) e não tem NDT cadastrado, então a regra automática o
    // jogava em "não recomendada" e ele SUMIA da lista. Junto com ele sumia o
    // aviso de polioencefalomalácia, que é a coisa mais importante que o
    // sistema tem a dizer sobre esse ingrediente.
    //
    // Não promovo a "excelente": sem número não dá pra afirmar isso. "Parcial"
    // é o piso — aparece, com o risco escrito e o teto visível.
    if (curado && compat === 'nao_recomendada') compat = 'parcial'

    // ── ranking técnico-econômico ─────────────────────────────────────────
    // Técnico manda: 100 pontos pela proximidade no eixo principal. O preço
    // desempata (até 25), porque entre dois que servem, o mais barato ganha —
    // mas nenhum preço compra compatibilidade.
    const precoRef = curado?.preco ?? precoDoBanco(cand)
    const precoAtualRef = precoDoBanco(atual)
    let pontos = razao == null ? 40 : Math.max(0, 100 - Math.abs(1 - razao) * 200)
    if (precoRef > 0 && precoAtualRef > 0) {
      pontos += Math.max(-25, Math.min(25, (1 - precoRef / precoAtualRef) * 50))
    }
    pontos -= muda.length * 4
    if (cand.exigeAnalise) pontos -= 6
    if (limite?.base === 'dieta_ms') pontos -= 8

    if (compat === 'nao_recomendada' && !opcoes.incluirNaoRecomendadas) continue

    saida.push({
      ingrediente: cand, compatibilidade: compat,
      motivos: [...new Set(motivos)], muda, limite, maximoSubstituivel,
      precoReferencia: precoRef,
      risco: curado?.risco, ganho: curado?.ganho,
      fonte: curado?.fonte ?? cand.fontes[0]?.ref ?? '',
      pontos,
    })
  }

  // A CLASSIFICAÇÃO MANDA PRIMEIRO; os pontos só desempatam dentro dela.
  //
  // Ordenar só por pontos punha "Soja integral processada" (parcial — é
  // proteico, cumpre função diferente) ACIMA do sorgo (boa) na lista do milho,
  // porque a soja tem NDT mais perto do milho e não tem preço de referência pra
  // penalizar. O vendedor abre a primeira opção e vê o sistema propondo trocar
  // 69,8% de milho por 69,8% de soja — que estoura a proteína.
  //
  // "Melhor equilíbrio técnico-econômico" do §8 é técnico PRIMEIRO. Nenhum
  // preço, e nenhum ponto, compra uma classificação melhor.
  const nivel: Record<Compatibilidade, number> = {
    excelente: 0, boa: 1, parcial: 2, nao_recomendada: 3,
  }
  return saida.sort((a, b) =>
    nivel[a.compatibilidade] - nivel[b.compatibilidade] || b.pontos - a.pontos)
}

/** true quando vale mostrar o ⇄ no card. */
export function temAlternativa(nome: string, participacao: number, especie: Especie): boolean {
  return alternativasPara(nome, participacao, especie).length > 0
}

/**
 * Aplica a troca de `pontos` percentuais na fórmula.
 *
 * Devolve a lista NOVA de itens. Não rebalanceia: quem rebalanceia é o
 * otimizador, e é uma decisão do vendedor (o botão "Aplicar e rebalancear").
 * Separar as duas coisas é o que permite existir o "Aplicar sem rebalancear"
 * que o §9 pede para usuário avançado.
 */
export function aplicarTroca(
  itens: IngredienteFormula[], idAlvo: string, nomeNovo: string,
  pontos: number, precoNovo: number, novoId: () => string,
): IngredienteFormula[] {
  const alvo = itens.find(i => i.id === idAlvo)
  if (!alvo) return itens

  const emPct = alvo.unidadeParticipacao === 'pct'
  const div = emPct ? 1 : alvo.unidadeParticipacao === 'kg_t' ? 10 : 10000
  const atualPct = alvo.participacao / div
  const trocar = Math.max(0, Math.min(pontos, atualPct))
  if (trocar <= 0) return itens
  const resto = atualPct - trocar

  return itens.flatMap(i => {
    if (i.id !== idAlvo) return [i]
    const entrando: IngredienteFormula = {
      id: novoId(), nome: nomeNovo,
      participacao: Number((trocar * div).toFixed(4)),
      unidadeParticipacao: i.unidadeParticipacao,
      preco: precoNovo, unidadePreco: 'kg', pesoSacoIngrediente: 60,
    }
    // Sobrou original? Vira DUAS linhas — é o caso normal. Ninguém tira 69,8%
    // de milho e põe 69,8% de DDG. A soma da fórmula não se mexe.
    return resto > 0.0001
      ? [{ ...i, participacao: Number((resto * div).toFixed(4)) }, entrando]
      : [entrando]
  })
}

// ── utilidades ───────────────────────────────────────────────────────────────

const chave = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Preço de referência quando a lista curada não tem o item.
 *
 * O banco nutricional NÃO guarda preço, de propósito: preço muda toda semana e
 * composição não. Misturar os dois obrigaria a versionar composição a cada
 * mudança de cotação. Quem guarda preço de referência é `INGREDIENTES_PADRAO`,
 * que já existia no catálogo.
 *
 * Sem nenhum dos dois, devolve 0 — e aí o ranking ignora o critério econômico
 * em vez de inventar uma cotação. A tela pede o preço ao vendedor.
 */
function precoDoBanco(ing: IngredienteNutricional): number {
  const k = chave(ing.nome)
  const achado = INGREDIENTES_PADRAO.find(p => {
    const a = chave(p.nome)
    return a === k || k.startsWith(a + ' ') || a.startsWith(k + ' ')
      || ing.apelidos.some(ap => chave(ap) === a)
  })
  return achado?.preco ?? 0
}
