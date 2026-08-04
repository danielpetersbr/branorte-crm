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
 * A TROCA É BIDIRECIONAL (corrigido 04/08/2026)
 * O grupo é uma RODA, não uma seta. Quem trocou milho por sorgo tem que poder
 * voltar pro milho, ou pular pro DDG. Antes disso o ⇄ SUMIA depois da primeira
 * troca — o ingrediente novo não era reconhecido, porque só os alvos casavam, e
 * o substituto não era alvo de ninguém. Por isso o ingrediente de referência
 * (milho, farelo de soja) agora é um MEMBRO da lista: ele é a opção de volta.
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
  /** Outros jeitos de escrever o mesmo ingrediente, pro casamento por prefixo. */
  apelidos?: string[]
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
  /** true = é o ingrediente de referência do grupo (a opção de "voltar"). */
  referencia?: boolean
}

export interface GrupoSubstituicao {
  /** Papel do ingrediente na fórmula. Aparece como título do painel. */
  papel: string
  /** Todos os membros. QUALQUER um deles abre o painel com os outros. */
  membros: Substituto[]
}

/**
 * Ainda CURTO de propósito — cada entrada com fonte conferida. O mecanismo
 * (clicar, comparar, aplicar parcial, voltar) está pronto e ligado; entrada nova
 * só depois que o percentual passar pela conferência. Preferi poucas checadas a
 * muitas plausíveis: aqui um número errado não gera bug, gera boi morto.
 */
export const SUBSTITUICOES: GrupoSubstituicao[] = [
  {
    papel: 'Energia (amido)',
    membros: [
      {
        nome: 'Milho triturado',
        apelidos: ['milho', 'milho moído', 'milho em grão moído'],
        referencia: true,
        preco: 1.08,
        limite: { max: 100, base: 'formula' },
        ganho:
          'É a referência energética da formulação brasileira: 3.364 kcal de EM/kg para aves e '
          + '3.360 para suínos. Todo o resto desta lista é comparado com ele.',
        fonte: 'Embrapa Milho e Sorgo — Milho e sorgo na alimentação de suínos e aves (tabela de energia metabolizável)',
      },
      {
        nome: 'Sorgo (sem tanino)',
        apelidos: ['sorgo'],
        preco: 0.95,
        limite: { max: 100, base: 'formula' },
        equivalencia: 0.875,
        ganho:
          'Substitui o milho parcial ou totalmente. Amido em torno de 72%, praticamente o mesmo do milho. '
          + 'A equivalência de PREÇO acompanha a de energia: pagar mais que 85–90% do preço do milho não compensa.',
        risco:
          'Só serve sorgo SEM tanino. O com tanino vale menos de 70% do milho e não é recomendado, '
          + 'especialmente para aves jovens. Confirme a variedade antes de fechar a conta.',
        fonte: 'Embrapa Milho e Sorgo — Milho e sorgo na alimentação de suínos e aves (EM do sorgo sem tanino 3.290 kcal/kg = 97% do milho; relação nutricional geral 85–90%)',
      },
      {
        nome: 'DDG (grão seco de destilaria)',
        apelidos: ['ddg', 'ddgs'],
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
        apelidos: ['mandioca', 'raspa integral de mandioca'],
        preco: 0.90,
        limite: { max: 24, base: 'formula' },
        ganho: 'Energia de amido barata onde tem mandioca. Substitui parte do milho sem mexer no resto da fórmula.',
        risco:
          'A referência é de ensaio com OVINOS (0 a 48% da ração, sem efeito sobre digestibilidade da matéria '
          + 'orgânica e da FDN). Para bovinos o dado direto não foi conferido — o limite aqui está posto na '
          + 'metade do testado. É pobre em proteína: tirar milho e pôr mandioca derruba a PB da fórmula, '
          + 'e isso precisa ser recomposto.',
        fonte: 'Embrapa/Alice — Digestibilidade da matéria seca e de nutrientes com raspa integral de mandioca em ovinos (0, 12, 24, 36 e 48%)',
        especies: ['bovinos'],
      },
      {
        nome: 'Farelo de trigo',
        apelidos: ['trigo', 'farelo trigo'],
        preco: 1.10,
        limite: { max: 30, base: 'formula' },
        ganho:
          'Cereal de inverno — junto com o triticale, é o que tem valor nutricional mais próximo do milho '
          + 'para suíno. A Embrapa testou 0/10/20/30% em crescimento e 15/30/45% em terminação: o ganho de '
          + 'peso diário NÃO foi afetado em nenhum nível.',
        risco:
          'Acima de 30% o consumo sobe (o animal come mais pra compensar a energia menor) — por isso o teto '
          + 'aqui é 30%, e não os 45% que chegaram a ser testados. É mais fibroso que o milho: em fase '
          + 'inicial e creche, use pouco.',
        fonte: 'Embrapa/PAB — Níveis de farelo de trigo em rações de suínos em crescimento e terminação (0/10/20/30% e 15/30/45%)',
        especies: ['suinos'],
      },
      {
        nome: 'Triguilho',
        apelidos: ['triguilho', 'residuo de trigo'],
        preco: 1.00,
        limite: { max: 30, base: 'formula' },
        ganho:
          'Resíduo da limpeza do trigo. A Embrapa Suínos e Aves demonstrou inclusão de até 30% em ração de '
          + 'frango de corte no período de 1 a 42 dias — ou seja, no ciclo inteiro, não só numa fase.',
        risco:
          'É resíduo: a composição varia de lote pra lote muito mais que a do milho. Sem análise do lote, '
          + 'trabalhe abaixo do teto.',
        fonte: 'Embrapa Suínos e Aves — Utilização do triguilho em rações para frangos de corte (até 30%, 1 a 42 dias)',
        especies: ['aves'],
      },
    ],
  },
  {
    papel: 'Proteína',
    membros: [
      {
        nome: 'Farelo de soja',
        apelidos: ['soja', 'farelo soja'],
        referencia: true,
        preco: 1.60,
        limite: { max: 100, base: 'formula' },
        ganho:
          'É a referência proteica da formulação brasileira. As alternativas abaixo são comparadas com ele, '
          + 'e nenhuma o substitui sem ajuste de aminoácido.',
        fonte: 'Ludke, J. V.; Bertol, T. M. (Embrapa Suínos e Aves, 2021) — O desafio de substituir o milho e a soja na alimentação de suínos e aves',
      },
      {
        nome: 'Caroço de algodão',
        apelidos: ['algodao', 'caroco de algodao'],
        preco: 1.30,
        limite: { max: 15, base: 'dieta_ms' },
        ganho:
          'Energia e proteína no mesmo ingrediente, com fibra efetiva e fósforo. Em dieta com bastante '
          + 'volumoso (mínimo 41%) chega a 25%; em dieta de alto concentrado (77%) cai para 11%.',
        risco:
          'Gossipol. O limite prático de 15% é o que a literatura recomenda para não prejudicar a '
          + 'digestibilidade da fibra. Em reprodutores, dietas de até 30 mg de gossipol por kg de peso vivo '
          + 'não mostraram efeito sobre quantidade e qualidade do sêmen — acima disso é território de risco. '
          + 'O caroço INTEIRO não serve para monogástrico.',
        fonte: 'Moreira, F. B. — Subprodutos do algodão na alimentação de ruminantes (PubVet); limites 25% com volumoso ≥41%, 11% com concentrado 77%, recomendação prática 15%',
        especies: ['bovinos'],
      },
      {
        nome: 'Farinha de carne e ossos',
        apelidos: ['fco', 'farinha de carne'],
        preco: 2.20,
        limite: { max: 9, base: 'formula' },
        ganho:
          'Alternativa proteica de origem animal para ave. Em ração comercial de frango de corte a '
          + 'inclusão vai de 3,9 a 9% conforme a formulação; os ensaios testaram 3 e 6%, e também 5 e 10%. '
          + 'Entra com cálcio e fósforo junto, o que alivia o fosfato e o calcário da fórmula.',
        risco:
          'O ganho de peso foi MAIOR sem a farinha nos ensaios — ela abarata, não melhora desempenho. '
          + 'E como carrega cálcio e fósforo, entrar com ela sem baixar fosfato bicálcico e calcário '
          + 'desequilibra o mineral da fórmula. Produto de origem animal: confirme a restrição do '
          + 'comprador antes de propor.',
        fonte: 'Revista Brasileira de Ciência Avícola (SciELO) — Avaliação da farinha de carne e ossos na alimentação de frangos de corte; inclusão comercial de 3,9 a 9%',
        especies: ['aves'],
      },
      {
        nome: 'Farelo de caroço de algodão',
        apelidos: ['farelo de algodao', 'farelo caroco de algodao'],
        preco: 1.40,
        limite: { max: 100, base: 'formula' },
        ganho:
          'É o subproduto PROCESSADO do caroço — diferente do caroço inteiro, serve para suíno. A Embrapa '
          + 'aponta como a alternativa proteica de maior disponibilidade no país (~3,5 milhões t) e recomenda '
          + 'para substituir de 75 a 100% da proteína do farelo de soja em dieta de matriz em lactação.',
        risco:
          'O intervalo de 75–100% da proteína é o citado para MATRIZ EM LACTAÇÃO. Para outras fases o dado '
          + 'não foi conferido — trate como território a confirmar com o zootecnista. Gossipol continua '
          + 'presente: o processamento reduz, não elimina.',
        fonte: 'Ludke, J. V.; Bertol, T. M. (Embrapa Suínos e Aves, 2021) — subprodutos processados do caroço de algodão substituem 75 a 100% da proteína do farelo de soja em matrizes em lactação',
        especies: ['suinos'],
      },
    ],
  },
]

// ── consulta ─────────────────────────────────────────────────────────────────

const chave = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** O nome bate com este membro? Compara nome e apelidos, por prefixo nos dois sentidos. */
function casa(m: Substituto, nomeIngrediente: string): boolean {
  const k = chave(nomeIngrediente)
  if (!k) return false
  for (const alvo of [m.nome, ...(m.apelidos ?? [])]) {
    const a = chave(alvo)
    if (!a) continue
    if (k === a || k.startsWith(a + ' ') || a.startsWith(k + ' ')) return true
  }
  return false
}

/**
 * Grupo do ingrediente, se houver. Casa com QUALQUER membro — é o que faz a
 * troca ser bidirecional: quem já virou sorgo continua achando o grupo do amido.
 *
 * Ordem importa: "Farelo de caroço de algodão" tem que cair no membro dele, não
 * no "Caroço de algodão". Por isso a busca prefere o casamento mais LONGO.
 */
export function grupoDe(nomeIngrediente: string): GrupoSubstituicao | null {
  if (!chave(nomeIngrediente)) return null
  let melhor: { g: GrupoSubstituicao; tam: number } | null = null
  for (const g of SUBSTITUICOES) {
    for (const m of g.membros) {
      if (!casa(m, nomeIngrediente)) continue
      const tam = Math.max(...[m.nome, ...(m.apelidos ?? [])].map(x => chave(x).length))
      if (!melhor || tam > melhor.tam) melhor = { g, tam }
    }
  }
  return melhor?.g ?? null
}

/** O membro exato que corresponde ao ingrediente (o mais específico). */
export function membroDe(nomeIngrediente: string): Substituto | null {
  const g = grupoDe(nomeIngrediente)
  if (!g) return null
  const casados = g.membros.filter(m => casa(m, nomeIngrediente))
  if (!casados.length) return null
  return casados.reduce((a, b) => (chave(b.nome).length > chave(a.nome).length ? b : a))
}

/**
 * As outras opções do grupo, para aquela espécie. Exclui o próprio ingrediente:
 * não faz sentido oferecer sorgo pra quem já está com sorgo.
 */
export function substitutosDe(nomeIngrediente: string, especie: Especie): Substituto[] {
  const g = grupoDe(nomeIngrediente)
  if (!g) return []
  const eu = membroDe(nomeIngrediente)
  return g.membros.filter(m =>
    m !== eu && (!m.especies?.length || m.especies.includes(especie)))
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
