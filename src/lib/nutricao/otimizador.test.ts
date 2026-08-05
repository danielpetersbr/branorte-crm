import test from 'node:test'
import assert from 'node:assert/strict'
import type { IngredienteFormula } from '@/lib/venda-racao/tipos'
import { otimizar, prepararIngredientes, limitesDe } from './otimizador'
import { acharIngrediente } from './ingredientes'
import { analisarFormula } from './analise'

function ing(nome: string, pct: number, preco = 1): IngredienteFormula {
  return {
    id: `t-${nome}`, nome, participacao: pct, unidadeParticipacao: 'pct',
    preco, unidadePreco: 'kg', pesoSacoIngrediente: 60,
  }
}
const perto = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

/** Fórmula de terminação de suíno com preços realistas. */
const TERMINACAO = [
  ing('Milho', 82, 1.08),
  ing('Farelo de soja', 15, 1.60),
  ing('Núcleo suínos', 3, 5.33),
]

test('a soma fecha em 100% — sempre, e é restrição rígida', () => {
  const r = otimizar(prepararIngredientes(TERMINACAO, 'suinos'), 'suinos', 'terminacao')
  assert.notEqual(r.status, 'erro')
  perto(r.itens.reduce((s, i) => s + i.participacao, 0), 100, 0.001)
})

test('SOLVER e ANALISADOR não podem discordar sobre a mesma fórmula', () => {
  // A prova que mais importa: são dois códigos independentes olhando o mesmo
  // resultado. Se o solver diz "atendi" e o analisador diz "fora", um dos dois
  // está mentindo — e o vendedor vê os dois na mesma tela.
  //
  // Foi este teste que pegou o solver parando EXATAMENTE no piso de cálcio
  // (0,500) e o arredondamento da saída empurrando para 0,49999, o que o
  // analisador lia como "fora". 2×10⁻⁵ de cálcio virando semáforo vermelho.
  const r = otimizar(prepararIngredientes(TERMINACAO, 'suinos'), 'suinos', 'terminacao')
  const a = analisarFormula(
    r.itens.map(i => ing(i.nome, i.participacao)), 'suinos', 'terminacao',
  )
  const foraNoAnalisador = a.linhas.filter(l => l.status === 'fora').map(l => l.chave)
  const naoAtendidasNoSolver = new Set(r.naoAtendidas.map(x => x.chave))

  for (const chave of foraNoAnalisador) {
    assert.ok(naoAtendidasNoSolver.has(chave),
      `o analisador diz que "${chave}" está fora, mas o solver não reportou — os dois discordam`)
  }
})

test('otimizar nunca PIORA: não aumenta o número de exigências furadas', () => {
  const prep = prepararIngredientes(TERMINACAO, 'suinos')
  const antes = analisarFormula(TERMINACAO, 'suinos', 'terminacao')
    .linhas.filter(l => l.status === 'fora').length

  const r = otimizar(prep, 'suinos', 'terminacao', 'menor_custo')
  const depois = analisarFormula(
    r.itens.map(i => ing(i.nome, i.participacao)), 'suinos', 'terminacao',
  ).linhas.filter(l => l.status === 'fora').length

  assert.ok(depois <= antes, `piorou: ${antes} exigências furadas viraram ${depois}`)
})

test('quando TUDO fecha, o menor custo é de fato menor', () => {
  // Fórmula de postura com sal: as exigências que o banco consegue cobrir
  // fecham, e aí a comparação de custo faz sentido.
  const partida = [
    ing('Milho moído', 60, 1.08), ing('Farelo de soja', 30, 1.60),
    ing('Sal comum', 0.5, 0.90), ing('Núcleo de postura', 9.5, 6.80),
  ]
  const prep = prepararIngredientes(partida, 'aves')
  const r = otimizar(prep, 'aves', 'postura', 'menor_custo')
  assert.notEqual(r.status, 'erro')

  const custoPartida = prep.reduce((s, i) => s + (i.atual / 100) * i.precoPorKg, 0)
  perto(r.deltaCustoPorKg, r.custoPorKg - custoPartida, 1e-9)
  // Com as mesmas exigências furadas antes e depois, o custo tem que cair.
  if (r.naoAtendidas.length === 0) {
    assert.ok(r.custoPorKg <= custoPartida + 1e-9,
      `otimizado ${r.custoPorKg} deveria ser <= partida ${custoPartida}`)
  }
})

test('"menor mudança" mexe MENOS na fórmula que "menor custo"', () => {
  const prep = prepararIngredientes(TERMINACAO, 'suinos')
  const dist = (itens: Array<{ participacao: number }>) =>
    itens.reduce((s, it, i) => s + Math.abs(it.participacao - prep[i].atual), 0)

  const barato = otimizar(prep, 'suinos', 'terminacao', 'menor_custo')
  const parecido = otimizar(prep, 'suinos', 'terminacao', 'menor_mudanca')
  assert.notEqual(parecido.status, 'erro')
  assert.ok(dist(parecido.itens) <= dist(barato.itens) + 1e-6,
    `menor_mudanca (${dist(parecido.itens).toFixed(2)}) tinha que mexer <= menor_custo (${dist(barato.itens).toFixed(2)})`)
})

// ═══════════════════════════════════════════════════════════════════════════
// A ARMADILHA DO INGREDIENTE CEGO
// ═══════════════════════════════════════════════════════════════════════════

test('ingrediente SEM composição fica travado — o solver não zera o que não enxerga', () => {
  // Se o núcleo entrasse livre, o solver o zeraria: é o mais caro da fórmula e,
  // pro modelo, "não entrega nutriente nenhum". Só que ele entrega vitamina e
  // micromineral que nenhuma exigência desta tela cobre.
  const comGenerico = [
    ing('Milho', 82, 1.08), ing('Farelo de soja', 15, 1.60), ing('Núcleo / premix', 3, 6.00),
  ]
  const prep = prepararIngredientes(comGenerico, 'suinos')
  const nucleo = prep.find(i => i.nome === 'Núcleo / premix')!
  assert.equal(nucleo.travado, true)
  assert.equal(nucleo.min, 3)
  assert.equal(nucleo.max, 3)

  const r = otimizar(prep, 'suinos', 'terminacao')
  const saida = r.itens.find(i => i.nome === 'Núcleo / premix')!
  perto(saida.participacao, 3, 0.001)
  assert.ok(r.travados.some(t => /sem composição/.test(t.motivo)))
})

test('ingrediente proibido pra espécie é travado em ZERO, não some da lista', () => {
  // Sumir esconderia do vendedor que ele tinha posto ureia numa ração de ave.
  const prep = prepararIngredientes(
    [ing('Milho', 70, 1.08), ing('Farelo de soja', 29, 1.6), ing('Ureia', 1, 3.6)], 'aves',
  )
  const ureia = prep.find(i => i.nome === 'Ureia')!
  assert.equal(ureia.max, 0)
  assert.equal(ureia.travado, true)

  const r = otimizar(prep, 'aves', 'postura')
  const saida = r.itens.find(i => i.nome === 'Ureia')!
  perto(saida.participacao, 0, 0.001)
  assert.ok(r.travados.some(t => /proibido/.test(t.motivo)))
})

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 — QUANDO NÃO DÁ, EXPLICA. NÃO INVENTA FÓRMULA.
// ═══════════════════════════════════════════════════════════════════════════

test('exigência impossível é REPORTADA com nome, alvo e quanto falta', () => {
  // Só milho e mandioca: nem juntos chegam nos 13% de PB da terminação.
  const prep = prepararIngredientes(
    [ing('Milho', 50, 1.08), ing('Raspa de mandioca', 50, 0.9)], 'suinos',
  )
  const r = otimizar(prep, 'suinos', 'terminacao')

  assert.equal(r.status, 'parcial', 'não pode dizer "ótimo" com exigência furada')
  const pb = r.naoAtendidas.find(x => x.chave === 'proteinaBruta')
  assert.ok(pb, 'a proteína tinha que aparecer como não atendida')
  assert.equal(pb!.tipo, 'min')
  assert.equal(pb!.alvo, 13.0)
  assert.ok(pb!.obtido < 13.0)
  perto(pb!.diferenca, 13.0 - pb!.obtido, 1e-6)
  assert.match(r.diagnostico.join(' '), /NÃO é uma fórmula pronta/)
})

test('e diz QUAL ingrediente resolveria', () => {
  const prep = prepararIngredientes(
    [ing('Milho', 50, 1.08), ing('Raspa de mandioca', 50, 0.9)], 'suinos',
  )
  const r = otimizar(prep, 'suinos', 'terminacao')
  const pb = r.naoAtendidas.find(x => x.chave === 'proteinaBruta')!
  assert.ok(pb.poderiaResolver.length > 0, 'tinha que sugerir alguma fonte proteica')
  // O de maior proteína do banco que não está na fórmula.
  assert.ok(pb.poderiaResolver.some(n => /soja|algod/i.test(n)),
    `sugestões pouco úteis: ${pb.poderiaResolver.join(', ')}`)
})

test('penalidade domina o custo: o solver NÃO troca exigência por economia', () => {
  // Farelo de soja é 48% mais caro que o milho. Se o peso da folga fosse baixo,
  // sairia mais barato "desistir" da proteína e encher de milho — a fórmula
  // ficaria linda no preço e mataria de fome.
  const prep = prepararIngredientes(TERMINACAO, 'suinos')
  const r = otimizar(prep, 'suinos', 'terminacao', 'menor_custo')

  const soja = r.itens.find(i => /soja/i.test(i.nome))!
  assert.ok(soja.participacao > 10,
    `soja a ${soja.participacao}% — o solver desistiu da proteína pra economizar, `
    + 'a penalidade da folga está baixa demais')
  // E a proteína NÃO pode estar na lista de furadas: ela é atendível aqui.
  assert.equal(r.naoAtendidas.some(x => x.chave === 'proteinaBruta'), false)
})

test('a sugestão do §7.5 é ACIONÁVEL: acrescentar o que ele indica fecha a lacuna', () => {
  // O solver reclama de sódio e sugere sal comum. Se a sugestão não resolvesse,
  // seria conselho decorativo.
  const semSal = prepararIngredientes(TERMINACAO, 'suinos')
  const r1 = otimizar(semSal, 'suinos', 'terminacao')
  const sodio = r1.naoAtendidas.find(x => x.chave === 'sodio')
  assert.ok(sodio, 'sódio tinha que faltar — nenhum ingrediente da fórmula tem sódio')
  assert.ok(sodio!.poderiaResolver.some(n => /sal comum/i.test(n)),
    `sugeriu ${sodio!.poderiaResolver.join(', ')} em vez de sal`)

  const comSal = prepararIngredientes([...TERMINACAO, ing('Sal comum', 0.4, 0.9)], 'suinos')
  const r2 = otimizar(comSal, 'suinos', 'terminacao')
  assert.equal(r2.naoAtendidas.some(x => x.chave === 'sodio'), false,
    'seguindo a própria sugestão, o sódio tinha que fechar')
})

test('pisos travados somando mais de 100% dão IMPOSSÍVEL com o motivo escrito', () => {
  const itens = [ing('Milho', 60, 1.08), ing('Farelo de soja', 60, 1.6)]
  const prep = prepararIngredientes(itens, 'suinos', {
    [itens[0].id]: true, [itens[1].id]: true,
  })
  const r = otimizar(prep, 'suinos', 'terminacao')
  assert.equal(r.status, 'impossivel')
  assert.match(r.diagnostico.join(' '), /somam 120|mais que os 100/)
})

test('sem exigência cadastrada o otimizador RECUSA, em vez de fazer 100% do mais barato', () => {
  const r = otimizar(
    prepararIngredientes([ing('Milho', 60, 1.08), ing('Farelo de soja', 40, 1.6)], 'aves'),
    'aves', 'frango_final',
  )
  assert.equal(r.status, 'impossivel')
  assert.match(r.diagnostico.join(' '), /não existe "fórmula ótima"|errar mais rápido/)
})

// ═══════════════════════════════════════════════════════════════════════════
// LIMITES
// ═══════════════════════════════════════════════════════════════════════════

test('teto de inclusão é RÍGIDO — o solver não estoura pra economizar', () => {
  const prep = prepararIngredientes(
    [ing('Milho', 40, 1.08), ing('Triguilho', 40, 0.5), ing('Farelo de soja', 20, 1.6)], 'aves',
  )
  const trig = prep.find(i => i.nome === 'Triguilho')!
  assert.equal(trig.max, 30, 'triguilho tem teto de 30% pra aves')

  const r = otimizar(prep, 'aves', 'postura')
  const saida = r.itens.find(i => i.nome === 'Triguilho')!
  assert.ok(saida.participacao <= 30 + 1e-6,
    `triguilho a ${saida.participacao}% passou do teto de 30%, mesmo sendo o mais barato`)
})

test('teto sobre a DIETA não vira teto de fórmula', () => {
  // DDG tem limite de 20% da dieta em MS. A tela monta só o concentrado.
  const ddg = acharIngrediente('DDG')!
  assert.equal(ddg.limites![0].base, 'dieta_ms')
  const lim = limitesDe(ddg, 'bovinos')!
  assert.equal(lim.max, 100, 'converter 20% da dieta em 20% da fórmula seria inventar')
})

test('limite de fórmula vira teto de verdade', () => {
  assert.equal(limitesDe(acharIngrediente('Triguilho'), 'aves')!.max, 30)
  assert.equal(limitesDe(acharIngrediente('Raspa de mandioca'), 'bovinos')!.max, 24)
})

test('proibido devolve null em limitesDe', () => {
  assert.equal(limitesDe(acharIngrediente('Ureia'), 'suinos'), null)
  assert.ok(limitesDe(acharIngrediente('Ureia'), 'bovinos'))
})

test('fórmula vazia não estoura', () => {
  const r = otimizar([], 'suinos', 'terminacao')
  assert.equal(r.status, 'impossivel')
  assert.deepEqual(r.itens, [])
})

test('unidade kg/t é convertida antes de otimizar', () => {
  const itens: IngredienteFormula[] = [
    { id: 'a', nome: 'Milho', participacao: 820, unidadeParticipacao: 'kg_t', preco: 1.08, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
    { id: 'b', nome: 'Farelo de soja', participacao: 180, unidadeParticipacao: 'kg_t', preco: 1.6, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
  ]
  const prep = prepararIngredientes(itens, 'suinos')
  perto(prep[0].atual, 82, 0.001)
  perto(prep[1].atual, 18, 0.001)
})
