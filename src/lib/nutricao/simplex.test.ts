import test from 'node:test'
import assert from 'node:assert/strict'
import { resolverLP, type Restricao } from './simplex'

const perto = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

/**
 * Estes testes usam problemas de LIVRO, com resposta conhecida de antemão.
 * O ponto não é cobrir linhas — é provar que o solver acerta ANTES de alguém
 * confiar nele pra montar ração. Simplex errado não estoura: devolve um número
 * plausível e errado.
 */

test('problema clássico de maximização (resposta conhecida: 36)', () => {
  // max 3x + 5y  s.a.  x <= 4 · 2y <= 12 · 3x + 2y <= 18
  // Ótimo de livro: x=2, y=6, z=36. Minimizo o negativo.
  const r = resolverLP({
    objetivo: [-3, -5],
    restricoes: [
      { coef: [1, 0], tipo: '<=', rhs: 4 },
      { coef: [0, 2], tipo: '<=', rhs: 12 },
      { coef: [3, 2], tipo: '<=', rhs: 18 },
    ],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x[0], 2); perto(r.x[1], 6); perto(r.valor, -36)
})

test('minimização com restrições >= (problema de dieta clássico)', () => {
  // min 0,6x + 1,0y  s.a.  10x + 4y >= 20 · 5x + 5y >= 20
  //
  // Os vértices da região viável e seus custos:
  //   x=4  y=0      → 40>=20 ✓ · 20>=20 ✓ · custo 2,40  ← ÓTIMO
  //   x=2/3 y=10/3  → 20>=20 ✓ · 20>=20 ✓ · custo 3,73
  //   x=0  y=5      → 20>=20 ✓ · 25>=20 ✓ · custo 5,00
  //
  // Escrevi este teste esperando 3,20 (x=2, y=2) e o solver devolveu 2,40. Eu é
  // que estava errado: x=2,y=2 nem é vértice, é ponto interior de uma aresta.
  // Fica registrado porque é exatamente o tipo de engano que o solver existe
  // pra evitar — o vendedor também não enxerga o vértice de menor custo.
  const r = resolverLP({
    objetivo: [0.6, 1.0],
    restricoes: [
      { coef: [10, 4], tipo: '>=', rhs: 20 },
      { coef: [5, 5], tipo: '>=', rhs: 20 },
    ],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x[0], 4); perto(r.x[1], 0); perto(r.valor, 2.4)
})

test('igualdade é respeitada exatamente', () => {
  // min x + y  s.a.  x + y = 10 · x >= 3
  const r = resolverLP({
    objetivo: [1, 1],
    restricoes: [
      { coef: [1, 1], tipo: '=', rhs: 10 },
      { coef: [1, 0], tipo: '>=', rhs: 3 },
    ],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x[0] + r.x[1], 10)
  assert.ok(r.x[0] >= 3 - 1e-6)
  perto(r.valor, 10)
})

test('restrições que se contradizem devolvem INVIÁVEL, não um número qualquer', () => {
  // x >= 5 e x <= 3 ao mesmo tempo
  const r = resolverLP({
    objetivo: [1],
    restricoes: [
      { coef: [1], tipo: '>=', rhs: 5 },
      { coef: [1], tipo: '<=', rhs: 3 },
    ],
  })
  assert.equal(r.status, 'inviavel')
  assert.deepEqual(r.x, [])
})

test('objetivo sem limite devolve ILIMITADO', () => {
  // min -x sem teto nenhum
  const r = resolverLP({ objetivo: [-1], restricoes: [{ coef: [1], tipo: '>=', rhs: 1 }] })
  assert.equal(r.status, 'ilimitado')
})

test('rhs negativo é normalizado (a desigualdade tem que VIRAR)', () => {
  // -x - y <= -10  é o mesmo que  x + y >= 10
  const r = resolverLP({
    objetivo: [1, 1],
    restricoes: [{ coef: [-1, -1], tipo: '<=', rhs: -10 }],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x[0] + r.x[1], 10)
})

test('caso degenerado com soma travada não cicla', () => {
  // 6 variáveis somando 100, todas com teto — é a forma do problema de ração,
  // que é degenerado de nascença (vários ingredientes colam no limite).
  const n = 6
  const teto: Restricao[] = Array.from({ length: n }, (_, i) => ({
    coef: Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)),
    tipo: '<=' as const, rhs: 25,
  }))
  const r = resolverLP({
    objetivo: [1, 1, 1, 1, 1, 1],
    restricoes: [
      { coef: new Array(n).fill(1), tipo: '=', rhs: 100 },
      ...teto,
    ],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x.reduce((a, b) => a + b, 0), 100)
  assert.ok(r.x.every(v => v <= 25 + 1e-6), 'nenhuma variável passa do teto')
  assert.ok(r.iteracoes < 500, `convergiu em ${r.iteracoes} iterações`)
})

test('escolhe de fato o mais barato quando há folga', () => {
  // 3 ingredientes, soma 100, todos até 100, preços 1 / 2 / 3
  // e uma exigência que só o caro atende: 3ᵃ variável >= 20
  const r = resolverLP({
    objetivo: [1, 2, 3],
    restricoes: [
      { coef: [1, 1, 1], tipo: '=', rhs: 100 },
      { coef: [0, 0, 1], tipo: '>=', rhs: 20 },
    ],
  })
  assert.equal(r.status, 'otimo')
  perto(r.x[0], 80); perto(r.x[1], 0); perto(r.x[2], 20)
  perto(r.valor, 80 * 1 + 20 * 3)
})

test('problema vazio não estoura', () => {
  const r = resolverLP({ objetivo: [], restricoes: [] })
  assert.equal(r.status, 'otimo')
  assert.equal(r.valor, 0)
})
