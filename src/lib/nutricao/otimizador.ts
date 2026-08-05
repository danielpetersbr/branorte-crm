/**
 * OTIMIZADOR DE FÓRMULA — acha a composição de menor custo que atende a fase.
 *
 * Traduz "montar ração" para programação linear e devolve o resultado em
 * linguagem de ração. A matemática está em `simplex.ts` e não sabe o que é
 * proteína.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DECISÃO MAIS IMPORTANTE DAQUI: RESTRIÇÃO ELÁSTICA
 *
 * O jeito ingênuo é jogar as exigências como restrições rígidas. Aí, quando não
 * dá pra atender, o solver devolve INVIÁVEL — uma palavra só — e o vendedor fica
 * sabendo que não deu, sem saber POR QUÊ.
 *
 * Aqui cada exigência ganha uma variável de folga com penalidade altíssima. O
 * problema passa a ter solução SEMPRE, e a folga que sobrar positiva diz
 * exatamente qual nutriente não fechou e por quanto. É o §7.5 do pedido
 * respondido por construção, não por mensagem de erro genérica.
 *
 * A penalidade (1e6) é grande o bastante pra que atender a exigência domine
 * qualquer economia de custo: o solver só deixa de atender se for IMPOSSÍVEL,
 * nunca porque saiu mais barato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE É RÍGIDO E NÃO NEGOCIA
 *
 * Soma = 100% e os limites de cada ingrediente. Limite de inclusão não é meta,
 * é segurança — DDG acima do teto mata boi por polioencefalomalácia. Deixar o
 * solver "estourar um pouquinho" o teto pra economizar seria exatamente o tipo
 * de otimização que não pode existir aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ARMADILHA QUE QUASE PASSOU: INGREDIENTE SEM COMPOSIÇÃO
 *
 * Se o núcleo entra no modelo com nutriente zerado, o solver conclui que ele não
 * serve pra nada, é caro, e ZERA. Só que o núcleo não tem nutriente zero — ele
 * tem nutriente DESCONHECIDO, e é justamente ele que carrega vitamina e
 * microminerais que nenhuma exigência desta tela cobre.
 *
 * Por isso: ingrediente SEM NENHUMA composição cadastrada é TRAVADO no valor
 * atual. O solver não mexe no que não consegue enxergar. É a mesma regra do
 * `ausente ≠ zero` do resto do módulo, aplicada à otimização.
 */
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import { NUTRIENTES, lerNutriente, type ChaveNutriente } from './tipos'
import {
  BANCO_NUTRICIONAL, acharIngrediente, semComposicao,
  type IngredienteNutricional,
} from './ingredientes'
import { exigenciaDe, type Meta } from './exigencias'
import { limitePara } from './seguranca'
import { resolverLP, type Restricao } from './simplex'

/** Peso da folga de exigência. Alto o bastante pra nunca compensar economizar. */
const PENALIDADE = 1e6

export type Objetivo =
  /** A ração mais barata que atende a fase. */
  | 'menor_custo'
  /** A que mexe o mínimo possível na fórmula que já está na tela. */
  | 'menor_mudanca'

export interface IngredienteOtim {
  id: string
  nome: string
  precoPorKg: number
  /** Participação atual na fórmula, em %. */
  atual: number
  /** Piso em %. */
  min: number
  /** Teto em %. */
  max: number
  /** Vendedor travou: o solver não pode mexer. */
  travado?: boolean
}

export interface ExigenciaNaoAtendida {
  chave: ChaveNutriente
  rotulo: string
  tipo: 'min' | 'max'
  alvo: number
  obtido: number
  /** Quanto falta (min) ou quanto excedeu (max). Sempre positivo. */
  diferenca: number
  unidade: string
  /** Ingredientes do banco que resolveriam, e não estão sendo usados. */
  poderiaResolver: string[]
}

export interface ResultadoOtimizacao {
  status:
    /** Fechou 100% e atendeu tudo. */
    | 'otimo'
    /** Fechou, mas alguma exigência não foi atendida. NÃO é fórmula pronta. */
    | 'parcial'
    /** Nem os limites físicos fecham — não há fórmula possível. */
    | 'impossivel'
    /** O solver não convergiu. Não deveria acontecer; se acontecer, é bug. */
    | 'erro'
  itens: Array<{ id: string; nome: string; participacao: number }>
  custoPorKg: number
  /** Diferença de custo contra a fórmula que estava na tela. Negativo = economizou. */
  deltaCustoPorKg: number
  naoAtendidas: ExigenciaNaoAtendida[]
  /** Nutrientes cuja conta usou composição PARCIAL da fórmula. */
  coberturaParcial: Array<{ rotulo: string; coberturaPct: number }>
  /** Ingredientes que o solver não pôde mexer, e por quê. */
  travados: Array<{ nome: string; motivo: string }>
  /** Explicação pronta pra tela. */
  diagnostico: string[]
}

/**
 * Piso e teto de um ingrediente, já considerando espécie e limite técnico.
 * `null` = o ingrediente não pode entrar nesta espécie.
 */
export function limitesDe(
  ing: IngredienteNutricional | null, especie: Especie,
): { min: number; max: number } | null {
  if (!ing) return { min: 0, max: 100 }
  if (ing.proibidoPara?.includes(especie)) return null

  const lim = limitePara(ing, especie)
  // Teto sobre a DIETA TOTAL não vira teto de fórmula — a tela não enxerga o
  // volumoso. Converter seria inventar; aqui vira aviso, lá em `seguranca.ts`.
  if (lim && lim.base === 'formula') return { min: 0, max: lim.max }
  return { min: 0, max: 100 }
}

/** Monta a lista de ingredientes otimizáveis a partir da fórmula da tela. */
export function prepararIngredientes(
  itens: IngredienteFormula[], especie: Especie,
  travasManuais: Record<string, boolean> = {},
): IngredienteOtim[] {
  return itens
    .map(i => {
      const nome = (i.nome || '').trim()
      const ing = acharIngrediente(nome)
      const lim = limitesDe(ing, especie)
      const atual = i.unidadeParticipacao === 'pct' ? i.participacao
        : i.unidadeParticipacao === 'kg_t' ? i.participacao / 10
        : i.participacao / 10000

      // Proibido pra espécie: fica travado em ZERO, não some. Sumir esconderia
      // do vendedor que ele tinha posto ureia numa ração de ave.
      if (!lim) {
        return { id: i.id, nome, precoPorKg: i.preco, atual, min: 0, max: 0, travado: true }
      }
      // Sem composição nenhuma: o solver não enxerga: não mexe. Veja o cabeçalho.
      const cego = !!ing && semComposicao(ing)
      const travado = travasManuais[i.id] === true || cego
      return {
        id: i.id, nome, precoPorKg: i.preco, atual,
        min: travado ? atual : lim.min,
        max: travado ? atual : Math.min(lim.max, 100),
        travado,
      }
    })
    .filter(x => x.nome)
}

/**
 * Otimiza a fórmula.
 *
 * Devolve SEMPRE uma composição (graças à folga elástica), mas o `status` diz
 * se ela serve. `parcial` significa: é o mais perto que dá, e o que faltou está
 * listado em `naoAtendidas`. Não é fórmula pronta pra usar.
 */
export function otimizar(
  ingredientes: IngredienteOtim[], especie: Especie, categoria: string,
  objetivo: Objetivo = 'menor_custo',
): ResultadoOtimizacao {
  const n = ingredientes.length
  const vazio = (status: ResultadoOtimizacao['status'], diag: string[]): ResultadoOtimizacao => ({
    status, itens: [], custoPorKg: 0, deltaCustoPorKg: 0,
    naoAtendidas: [], coberturaParcial: [], travados: [], diagnostico: diag,
  })

  if (n === 0) return vazio('impossivel', ['A fórmula está vazia — não há o que otimizar.'])

  // ── as exigências que valem pra esta espécie e fase ───────────────────────
  const exigencia = exigenciaDe(especie, categoria)
  if (!exigencia) {
    return vazio('impossivel', [
      'Não há exigência nutricional cadastrada para esta espécie e fase. Sem meta para atender, '
      + 'não existe "fórmula ótima" — só a mais barata, que seria 100% do ingrediente de menor preço. '
      + 'Isso não é otimizar, é errar mais rápido.',
    ])
  }

  const perfis = ingredientes.map(i => acharIngrediente(i.nome))

  // Nutrientes com meta E que pelo menos um ingrediente conhece. Meta de um
  // nutriente que ninguém do banco tem não é restrição, é folga garantida.
  const metas: Array<{ chave: ChaveNutriente; rotulo: string; unidade: string; meta: Meta }> = []
  for (const def of NUTRIENTES) {
    if (def.especies?.length && !(def.especies as string[]).includes(especie)) continue
    const meta = exigencia.metas[def.chave]
    if (!meta || (meta.min == null && meta.max == null)) continue
    const alguem = perfis.some(p => p && lerNutriente(p.perfil, def.chave, 'MN') != null)
    if (!alguem) continue
    metas.push({ chave: def.chave, rotulo: def.rotulo, unidade: def.unidade, meta })
  }

  // ── layout das variáveis ──────────────────────────────────────────────────
  // [ x_0..x_{n-1} | folga por meta (def/exc) | (dp_i, dm_i) se menor_mudanca ]
  const minsComMeta = metas.filter(m => m.meta.min != null)
  const maxsComMeta = metas.filter(m => m.meta.max != null)
  const baseFolgaMin = n
  const baseFolgaMax = baseFolgaMin + minsComMeta.length
  const baseDesvio = baseFolgaMax + maxsComMeta.length
  const nVars = baseDesvio + (objetivo === 'menor_mudanca' ? 2 * n : 0)

  const zeros = () => new Array(nVars).fill(0)
  const restricoes: Restricao[] = []

  // 1) a soma fecha em 100%. Rígida.
  const soma = zeros()
  for (let i = 0; i < n; i++) soma[i] = 1
  restricoes.push({ coef: soma, tipo: '=', rhs: 100 })

  // 2) piso e teto de cada ingrediente. Rígidos — limite é segurança, não meta.
  for (let i = 0; i < n; i++) {
    if (ingredientes[i].min > 0) {
      const r = zeros(); r[i] = 1
      restricoes.push({ coef: r, tipo: '>=', rhs: ingredientes[i].min })
    }
    if (ingredientes[i].max < 100) {
      const r = zeros(); r[i] = 1
      restricoes.push({ coef: r, tipo: '<=', rhs: ingredientes[i].max })
    }
  }

  // 3) exigências, ELÁSTICAS. Cada linha é normalizada pelo alvo, então a folga
  //    sai como FRAÇÃO do alvo — o que deixa uma penalidade única servir tanto
  //    para kcal/kg (milhares) quanto para triptofano (centésimos).
  const conteudo = (i: number, chave: ChaveNutriente): number => {
    const p = perfis[i]
    if (!p) return 0
    return lerNutriente(p.perfil, chave, 'MN') ?? 0
  }

  minsComMeta.forEach((m, k) => {
    const alvo = m.meta.min!
    const r = zeros()
    for (let i = 0; i < n; i++) r[i] = conteudo(i, m.chave) / (100 * alvo)
    r[baseFolgaMin + k] = 1                       // déficit relativo
    restricoes.push({ coef: r, tipo: '>=', rhs: 1 })
  })

  maxsComMeta.forEach((m, k) => {
    const alvo = m.meta.max!
    const r = zeros()
    for (let i = 0; i < n; i++) r[i] = conteudo(i, m.chave) / (100 * alvo)
    r[baseFolgaMax + k] = -1                      // excesso relativo
    restricoes.push({ coef: r, tipo: '<=', rhs: 1 })
  })

  // 4) objetivo "menor mudança": |x_i - atual_i| = dp_i + dm_i
  if (objetivo === 'menor_mudanca') {
    for (let i = 0; i < n; i++) {
      const r = zeros()
      r[i] = 1
      r[baseDesvio + 2 * i] = -1
      r[baseDesvio + 2 * i + 1] = 1
      restricoes.push({ coef: r, tipo: '=', rhs: ingredientes[i].atual })
    }
  }

  // ── função objetivo ───────────────────────────────────────────────────────
  const c = zeros()
  if (objetivo === 'menor_custo') {
    // custo/kg de ração = Σ (x_i/100) × preço_i
    for (let i = 0; i < n; i++) c[i] = ingredientes[i].precoPorKg / 100
  } else {
    for (let i = 0; i < n; i++) { c[baseDesvio + 2 * i] = 1; c[baseDesvio + 2 * i + 1] = 1 }
  }
  for (let k = 0; k < minsComMeta.length; k++) c[baseFolgaMin + k] = PENALIDADE
  for (let k = 0; k < maxsComMeta.length; k++) c[baseFolgaMax + k] = PENALIDADE

  // ── resolve ───────────────────────────────────────────────────────────────
  const lp = resolverLP({ objetivo: c, restricoes })

  if (lp.status === 'inviavel') {
    const somaMin = ingredientes.reduce((s, i) => s + i.min, 0)
    const somaMax = ingredientes.reduce((s, i) => s + i.max, 0)
    const diag: string[] = []
    if (somaMin > 100 + 1e-6) {
      diag.push(
        `Os pisos travados somam ${somaMin.toFixed(2)}%, mais que os 100% da fórmula. `
        + 'Solte alguma trava ou baixe um piso.',
      )
    }
    if (somaMax < 100 - 1e-6) {
      diag.push(
        `Os tetos somam ${somaMax.toFixed(2)}%, menos que os 100% da fórmula. `
        + 'Falta ingrediente disponível para fechar — acrescente um ou solte um teto.',
      )
    }
    if (!diag.length) diag.push('Os limites dos ingredientes se contradizem e não há composição possível.')
    return vazio('impossivel', diag)
  }
  if (lp.status !== 'otimo') {
    return vazio('erro', [`O otimizador não convergiu (${lp.status}). Isto é defeito — reporte.`])
  }

  // ── leitura do resultado ──────────────────────────────────────────────────
  // 6 casas, não 4. O arredondamento é AMPLIFICADO pelo teor do ingrediente:
  // cortar 10⁻⁴ na participação de um núcleo com 24% de cálcio move o cálcio da
  // fórmula em 2,4×10⁻⁵ — o bastante pra derrubar abaixo de um piso em que o
  // solver tinha parado EXATAMENTE. Foi assim que solver e analisador
  // discordaram sobre a mesma fórmula. Aqui guardamos preciso; a tela formata.
  const itens = ingredientes.map((ing, i) => ({
    id: ing.id, nome: ing.nome,
    participacao: Math.round(lp.x[i] * 1e6) / 1e6,
  }))
  const custoPorKg = itens.reduce((s, it, i) => s + (it.participacao / 100) * ingredientes[i].precoPorKg, 0)
  const custoAtual = ingredientes.reduce((s, i) => s + (i.atual / 100) * i.precoPorKg, 0)

  // Folga positiva = exigência que não fechou.
  const naoAtendidas: ExigenciaNaoAtendida[] = []
  const valorNa = (chave: ChaveNutriente) =>
    itens.reduce((s, it, i) => s + (it.participacao / 100) * conteudo(i, chave), 0)

  minsComMeta.forEach((m, k) => {
    if (lp.x[baseFolgaMin + k] <= 1e-7) return
    const obtido = valorNa(m.chave)
    naoAtendidas.push({
      chave: m.chave, rotulo: m.rotulo, tipo: 'min',
      alvo: m.meta.min!, obtido, diferenca: m.meta.min! - obtido, unidade: m.unidade,
      poderiaResolver: quemResolve(m.chave, ingredientes, especie, 'min'),
    })
  })
  maxsComMeta.forEach((m, k) => {
    if (lp.x[baseFolgaMax + k] <= 1e-7) return
    const obtido = valorNa(m.chave)
    naoAtendidas.push({
      chave: m.chave, rotulo: m.rotulo, tipo: 'max',
      alvo: m.meta.max!, obtido, diferenca: obtido - m.meta.max!, unidade: m.unidade,
      poderiaResolver: quemResolve(m.chave, ingredientes, especie, 'max'),
    })
  })

  // Cobertura por nutriente: com que fração da fórmula a conta foi feita.
  const coberturaParcial = metas.map(m => {
    const cob = itens.reduce((s, it, i) => {
      const p = perfis[i]
      const tem = p && lerNutriente(p.perfil, m.chave, 'MN') != null
      return s + (tem ? it.participacao : 0)
    }, 0)
    return { rotulo: m.rotulo, coberturaPct: cob }
  }).filter(x => x.coberturaPct < 99.99)

  const travados = ingredientes
    .filter(i => i.travado)
    .map(i => {
      const ing = acharIngrediente(i.nome)
      if (ing?.proibidoPara?.includes(especie)) {
        return { nome: i.nome, motivo: 'proibido para esta espécie — mantido em 0%' }
      }
      if (ing && semComposicao(ing)) {
        return {
          nome: i.nome,
          motivo: 'sem composição cadastrada — o solver não mexe no que não enxerga',
        }
      }
      return { nome: i.nome, motivo: 'travado por você' }
    })

  const diagnostico: string[] = []
  if (naoAtendidas.length === 0) {
    diagnostico.push(
      objetivo === 'menor_custo'
        ? 'Todas as exigências da fase foram atendidas com o menor custo possível dentro dos limites.'
        : 'Todas as exigências foram atendidas com a menor mudança possível na fórmula.',
    )
  } else {
    diagnostico.push(
      `${naoAtendidas.length} exigência(s) NÃO foram atendidas. Esta composição é o mais perto que `
      + 'dá com os ingredientes e limites de hoje — NÃO é uma fórmula pronta para usar.',
    )
  }
  if (coberturaParcial.length > 0) {
    diagnostico.push(
      `A conta de ${coberturaParcial.map(c => c.rotulo).join(', ')} foi feita sem a fórmula inteira: `
      + 'há ingrediente sem esse dado cadastrado. O número real pode ser maior.',
    )
  }

  return {
    status: naoAtendidas.length ? 'parcial' : 'otimo',
    itens, custoPorKg,
    deltaCustoPorKg: custoPorKg - custoAtual,
    naoAtendidas, coberturaParcial, travados, diagnostico,
  }
}

/**
 * Que ingrediente do banco resolveria esta exigência e não está sendo usado.
 *
 * Responde ao "qual ingrediente poderia resolver" do §7.5. Para um MÍNIMO, quem
 * tem MAIS do nutriente; para um MÁXIMO, não há ingrediente que resolva
 * adicionando — o caminho é tirar quem tem muito, então devolve quem está na
 * fórmula puxando o valor pra cima.
 */
function quemResolve(
  chave: ChaveNutriente, naFormula: IngredienteOtim[], especie: Especie, tipo: 'min' | 'max',
): string[] {
  const usados = new Set(naFormula.map(i => acharIngrediente(i.nome)?.id).filter(Boolean))

  if (tipo === 'max') {
    return naFormula
      .map(i => {
        const p = acharIngrediente(i.nome)
        return { nome: i.nome, v: p ? lerNutriente(p.perfil, chave, 'MN') : null }
      })
      .filter((x): x is { nome: string; v: number } => typeof x.v === 'number' && x.v > 0)
      .sort((a, b) => b.v - a.v).slice(0, 3).map(x => x.nome)
  }

  return BANCO_NUTRICIONAL
    .filter(i => !usados.has(i.id))
    .filter(i => !i.proibidoPara?.includes(especie))
    .map(i => ({ nome: i.nome, v: lerNutriente(i.perfil, chave, 'MN') }))
    .filter((x): x is { nome: string; v: number } => typeof x.v === 'number' && x.v > 0)
    .sort((a, b) => b.v - a.v).slice(0, 3).map(x => x.nome)
}
