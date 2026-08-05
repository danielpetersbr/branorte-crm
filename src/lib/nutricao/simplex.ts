/**
 * PROGRAMAÇÃO LINEAR — Simplex de duas fases, tabela densa.
 *
 * POR QUE ESCREVER EM VEZ DE INSTALAR
 * O problema aqui é pequeno: até ~40 ingredientes e ~60 restrições. Uma
 * biblioteca de LP (glpk.js, javascript-lp-solver) traria WASM ou ~100 kB pro
 * bundle de uma SPA que já carrega three.js, leaflet e puppeteer-core. E o que
 * eu precisava não é performance, é CONTROLE do que acontece quando não há
 * solução — que é justamente onde as bibliotecas devolvem "INFEASIBLE" e ponto.
 *
 * Este arquivo é matemática pura, sem nada de ração: entra matriz, sai vetor.
 * A tradução do problema de fórmula está em `otimizador.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ANTI-CICLAGEM
 *
 * Simplex pode ciclar em problemas degenerados — e o nosso é degenerado por
 * construção: a soma dá exatamente 100 e vários ingredientes ficam colados no
 * limite. Uso Dantzig (o mais negativo) por ser rápido e troco pra REGRA DE
 * BLAND depois de um número de iterações. Bland é mais lenta mas tem garantia
 * de terminação. Sem isso, um caso ruim trava a aba do vendedor.
 */

export type TipoRestricao = '<=' | '>=' | '='

export interface Restricao {
  /** Um coeficiente por variável, na mesma ordem do objetivo. */
  coef: number[]
  tipo: TipoRestricao
  rhs: number
}

export interface ProblemaLP {
  /** Coeficientes da função a MINIMIZAR. Pra maximizar, negue antes de entrar. */
  objetivo: number[]
  restricoes: Restricao[]
}

export type StatusLP = 'otimo' | 'inviavel' | 'ilimitado' | 'sem_convergencia'

export interface ResultadoLP {
  status: StatusLP
  /** Valor de cada variável. Vazio quando não houve solução. */
  x: number[]
  /** Valor da função objetivo. */
  valor: number
  iteracoes: number
}

const TOL = 1e-9
/** A partir daqui troco Dantzig por Bland, que termina sempre. */
const ITER_BLAND = 500
const ITER_MAX = 5000

/**
 * Resolve `min cᵀx` sujeito às restrições, com `x >= 0`.
 *
 * Limites superiores de variável NÃO são tratados aqui de forma especial: entre
 * com eles como restrições `<=` normais. É mais lento que a variante com bounds,
 * mas na escala deste problema não muda nada e o código fica com metade dos
 * caminhos possíveis — que é onde bug de simplex mora.
 */
export function resolverLP(p: ProblemaLP): ResultadoLP {
  const n = p.objetivo.length
  const m = p.restricoes.length
  if (n === 0) return { status: 'otimo', x: [], valor: 0, iteracoes: 0 }

  // ── normalização: o simplex padrão exige rhs >= 0 ────────────────────────
  // Linha com rhs negativo é multiplicada por -1, e aí a desigualdade VIRA.
  const linhas = p.restricoes.map(r => {
    if (r.rhs < 0) {
      return {
        coef: r.coef.map(v => -v),
        tipo: (r.tipo === '<=' ? '>=' : r.tipo === '>=' ? '<=' : '=') as TipoRestricao,
        rhs: -r.rhs,
      }
    }
    return { coef: [...r.coef], tipo: r.tipo, rhs: r.rhs }
  })

  // ── montagem da tabela ───────────────────────────────────────────────────
  // Colunas: [variáveis originais | folgas/excedentes | artificiais]
  const folgas = linhas.filter(l => l.tipo !== '=').length
  const artificiais = linhas.filter(l => l.tipo !== '<=').length
  const total = n + folgas + artificiais

  const T: number[][] = []          // m linhas × (total + 1), última coluna = rhs
  const base: number[] = []         // índice da variável básica de cada linha
  const idxArtificiais: number[] = []

  let colFolga = n
  let colArt = n + folgas

  for (let i = 0; i < m; i++) {
    const linha = new Array(total + 1).fill(0)
    for (let j = 0; j < n; j++) linha[j] = linhas[i].coef[j] ?? 0
    linha[total] = linhas[i].rhs

    if (linhas[i].tipo === '<=') {
      linha[colFolga] = 1
      base.push(colFolga)
      colFolga++
    } else if (linhas[i].tipo === '>=') {
      linha[colFolga] = -1              // excedente
      linha[colArt] = 1                 // artificial entra na base
      base.push(colArt)
      idxArtificiais.push(colArt)
      colFolga++; colArt++
    } else {
      linha[colArt] = 1
      base.push(colArt)
      idxArtificiais.push(colArt)
      colArt++
    }
    T.push(linha)
  }

  let iteracoes = 0

  // ── FASE 1: minimizar a soma das artificiais ─────────────────────────────
  if (idxArtificiais.length > 0) {
    const custo1 = new Array(total).fill(0)
    for (const a of idxArtificiais) custo1[a] = 1

    const r1 = iterar(T, base, custo1, total)
    iteracoes += r1.iteracoes
    if (r1.status === 'sem_convergencia') {
      return { status: 'sem_convergencia', x: [], valor: 0, iteracoes }
    }

    // Alguma artificial sobrou positiva? Então as restrições se contradizem.
    let soma = 0
    for (let i = 0; i < m; i++) {
      if (idxArtificiais.includes(base[i])) soma += T[i][total]
    }
    if (soma > 1e-7) return { status: 'inviavel', x: [], valor: 0, iteracoes }

    // Artificial degenerada ainda na base (valor 0): tenta trocar por qualquer
    // variável real com pivô não nulo. Se a linha for toda zero, é redundante.
    for (let i = 0; i < m; i++) {
      if (!idxArtificiais.includes(base[i])) continue
      let trocou = false
      for (let j = 0; j < n + folgas; j++) {
        if (Math.abs(T[i][j]) > TOL) { pivotar(T, base, i, j, total); trocou = true; break }
      }
      if (!trocou) for (let j = 0; j <= total; j++) T[i][j] = 0
    }
  }

  // ── FASE 2: o objetivo de verdade ────────────────────────────────────────
  // As artificiais são zeradas pra não poderem voltar à base.
  const custo2 = new Array(total).fill(0)
  for (let j = 0; j < n; j++) custo2[j] = p.objetivo[j]
  for (const a of idxArtificiais) custo2[a] = 0

  const bloqueadas = new Set(idxArtificiais)
  const r2 = iterar(T, base, custo2, total, bloqueadas)
  iteracoes += r2.iteracoes
  if (r2.status !== 'otimo') {
    return { status: r2.status, x: [], valor: 0, iteracoes }
  }

  const x = new Array(n).fill(0)
  for (let i = 0; i < m; i++) {
    if (base[i] < n) x[base[i]] = T[i][total]
  }
  // Ruído numérico vira zero — devolver -1e-16 pra tela seria feio e inútil.
  for (let j = 0; j < n; j++) if (Math.abs(x[j]) < 1e-10) x[j] = 0

  const valor = x.reduce((s, v, j) => s + v * p.objetivo[j], 0)
  return { status: 'otimo', x, valor, iteracoes }
}

/**
 * Itera até o ótimo com o vetor de custo dado.
 * `bloqueadas` = colunas que não podem entrar na base (artificiais, na fase 2).
 */
function iterar(
  T: number[][], base: number[], custo: number[], total: number,
  bloqueadas: Set<number> = new Set(),
): { status: StatusLP; iteracoes: number } {
  const m = T.length
  let it = 0

  while (it < ITER_MAX) {
    it++
    // custo reduzido: z_j - c_j, com z_j = Σ c_B[i] * T[i][j]
    const reduzido = new Array(total).fill(0)
    for (let j = 0; j < total; j++) {
      if (bloqueadas.has(j)) continue
      let z = 0
      for (let i = 0; i < m; i++) z += custo[base[i]] * T[i][j]
      reduzido[j] = z - custo[j]
    }

    // Escolha da coluna. Bland (primeiro índice válido) depois de ITER_BLAND
    // porque garante terminação; Dantzig (maior ganho) antes, porque é rápido.
    let entra = -1
    if (it > ITER_BLAND) {
      for (let j = 0; j < total; j++) {
        if (!bloqueadas.has(j) && reduzido[j] > TOL) { entra = j; break }
      }
    } else {
      let melhor = TOL
      for (let j = 0; j < total; j++) {
        if (!bloqueadas.has(j) && reduzido[j] > melhor) { melhor = reduzido[j]; entra = j }
      }
    }
    if (entra < 0) return { status: 'otimo', iteracoes: it }

    // Razão mínima. Empate desfeito pelo MENOR índice de variável básica —
    // é a outra metade da regra de Bland; sem ela o anti-ciclagem não vale.
    let sai = -1
    let melhorRazao = Infinity
    for (let i = 0; i < m; i++) {
      if (T[i][entra] <= TOL) continue
      const razao = T[i][total] / T[i][entra]
      if (razao < melhorRazao - TOL || (Math.abs(razao - melhorRazao) <= TOL && (sai < 0 || base[i] < base[sai]))) {
        melhorRazao = razao
        sai = i
      }
    }
    // Nenhuma linha limita o crescimento: o objetivo vai a -infinito.
    if (sai < 0) return { status: 'ilimitado', iteracoes: it }

    pivotar(T, base, sai, entra, total)
  }
  return { status: 'sem_convergencia', iteracoes: it }
}

/** Eliminação de Gauss-Jordan na coluna `col`, usando a linha `lin` como pivô. */
function pivotar(T: number[][], base: number[], lin: number, col: number, total: number): void {
  const p = T[lin][col]
  for (let j = 0; j <= total; j++) T[lin][j] /= p
  for (let i = 0; i < T.length; i++) {
    if (i === lin) continue
    const f = T[i][col]
    if (Math.abs(f) < TOL) continue
    for (let j = 0; j <= total; j++) T[i][j] -= f * T[lin][j]
  }
  base[lin] = col
}
