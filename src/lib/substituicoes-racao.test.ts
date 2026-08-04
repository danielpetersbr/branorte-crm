import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBSTITUICOES, grupoDe, substitutosDe, temSubstituto,
  maximoSubstituivel, textoLimite,
  membroDe,
} from './substituicoes-racao'

// A regra do arquivo é que nada entra sem fonte. Teste existe pra impedir que
// alguém acrescente um substituto "de cabeça" mais pra frente.
test('todo substituto tem fonte com instituição e limite coerente', () => {
  for (const g of SUBSTITUICOES) {
    assert.ok(g.papel.length > 3, `grupo sem papel`)
    assert.ok(g.membros.length > 1, `grupo ${g.papel} precisa de pelo menos 2 membros`)
    assert.equal(g.membros.filter(m => m.referencia).length, 1,
      `grupo ${g.papel} precisa de exatamente 1 ingrediente de referência (a opção de voltar)`)
    for (const s of g.membros) {
      assert.ok(s.fonte && s.fonte.length > 20, `"${s.nome}" sem fonte decente`)
      assert.ok(s.ganho && s.ganho.length > 20, `"${s.nome}" sem explicação do ganho`)
      assert.ok(s.limite.max > 0 && s.limite.max <= 100, `"${s.nome}" com limite fora de 0–100`)
      assert.ok(s.preco > 0, `"${s.nome}" sem preço de referência`)
      assert.ok(['formula', 'dieta_ms'].includes(s.limite.base), `"${s.nome}" com base de limite inválida`)
    }
  }
})

test('coproduto de risco carrega o aviso — não é opcional', () => {
  const ddg = substitutosDe('Milho triturado', 'bovinos').find(s => s.nome.startsWith('DDG'))
  assert.ok(ddg, 'DDG deveria aparecer como substituto de milho para bovinos')
  assert.match(ddg!.risco ?? '', /polioencefalomal/i, 'o risco de enxofre tem que estar escrito')

  const algodao = substitutosDe('Farelo de soja', 'bovinos').find(s => s.nome.includes('algodão'))
  assert.ok(algodao, 'caroço de algodão deveria aparecer como substituto de farelo de soja')
  assert.match(algodao!.risco ?? '', /gossipol/i, 'o gossipol tem que estar escrito')
})

test('casa os vários jeitos de escrever milho que as fórmulas de referência usam', () => {
  // formulacoes-racao.ts escreve de 4 jeitos diferentes — todos têm que cair no mesmo grupo
  for (const nome of ['Milho', 'Milho triturado', 'Milho moído', 'Milho em grão moído']) {
    const g = grupoDe(nome)
    assert.ok(g, `"${nome}" não achou grupo`)
    assert.equal(g!.papel, 'Energia (amido)')
  }
  assert.equal(grupoDe('Farelo de soja')?.papel, 'Proteína')
})

test('ingrediente sem substituto conhecido devolve vazio, não inventa', () => {
  assert.equal(grupoDe('Sal comum (NaCl)'), null)
  assert.equal(grupoDe('Ionóforo'), null)
  assert.equal(grupoDe(''), null)
  assert.deepEqual(substitutosDe('Calcário calcítico', 'bovinos'), [])
  assert.equal(temSubstituto('Ureia', 'bovinos'), false)
})

test('substituto restrito a bovinos não vaza para aves e suínos', () => {
  const bov = substitutosDe('Milho triturado', 'bovinos').map(s => s.nome)
  const aves = substitutosDe('Milho triturado', 'aves').map(s => s.nome)
  assert.ok(bov.some(n => n.startsWith('DDG')), 'DDG vale pra bovinos')
  assert.ok(!aves.some(n => n.startsWith('DDG')), 'DDG NÃO pode aparecer pra aves')
  assert.ok(aves.some(n => n.startsWith('Sorgo')), 'sorgo vale pra todas as espécies')
})

test('máximo substituível respeita o teto E o que existe na fórmula', () => {
  const sorgo = substitutosDe('Milho', 'bovinos').find(s => s.nome.startsWith('Sorgo'))!
  // sorgo vai a 100% da fórmula: o teto é o próprio milho disponível
  assert.equal(maximoSubstituivel(sorgo, 69.8), 69.8)
  assert.equal(maximoSubstituivel(sorgo, 30), 30)

  const mandioca = substitutosDe('Milho', 'bovinos').find(s => s.nome.includes('mandioca'))!
  // teto de 24% da fórmula: com 69,8% de milho, só 24 podem virar mandioca
  assert.equal(maximoSubstituivel(mandioca, 69.8), 24)
  // mas se só há 10% de milho, o teto é 10
  assert.equal(maximoSubstituivel(mandioca, 10), 10)
})

test('limite sobre a dieta total NÃO vira número na fórmula — a tela não vê o volumoso', () => {
  const ddg = substitutosDe('Milho triturado', 'bovinos').find(s => s.nome.startsWith('DDG'))!
  assert.equal(ddg.limite.base, 'dieta_ms')
  assert.equal(
    maximoSubstituivel(ddg, 69.8), null,
    'afirmar que 20% da dieta são 20% da fórmula seria inventar',
  )
  assert.match(textoLimite(ddg), /dieta total/)
  assert.match(textoLimite(substitutosDe('Milho', 'bovinos')[0]), /da fórmula/)
})

// ═══════════════════════════════════════════════════════════════════════════
// BIDIRECIONAL — o bug que o Daniel achou usando: depois de trocar milho por
// sorgo, o ⇄ sumia do card. O sorgo não era alvo de ninguém.
// ═══════════════════════════════════════════════════════════════════════════

test('quem já foi trocado continua podendo trocar — o grupo é roda, não seta', () => {
  const doSorgo = substitutosDe('Sorgo (sem tanino)', 'bovinos').map(s => s.nome)
  assert.ok(doSorgo.length > 0, 'sorgo tem que oferecer opções')
  assert.ok(doSorgo.some(n => n.startsWith('Milho')), 'e a principal é VOLTAR pro milho')
  assert.ok(doSorgo.some(n => n.startsWith('DDG')), 'sorgo → DDG também tem que existir')
  assert.ok(!doSorgo.some(n => n.startsWith('Sorgo')), 'sorgo NÃO pode se oferecer')
  assert.equal(temSubstituto('Sorgo (sem tanino)', 'bovinos'), true)
})

test('caroço de algodão também volta pro farelo de soja', () => {
  const opts = substitutosDe('Caroço de algodão', 'bovinos').map(s => s.nome)
  assert.ok(opts.some(n => n === 'Farelo de soja'), `deveria oferecer a volta: ${opts.join(', ')}`)
  assert.ok(!opts.some(n => n.startsWith('Caroço')), 'não pode se oferecer')
})

test('"Farelo de caroço de algodão" não é confundido com "Caroço de algodão"', () => {
  // prefixo ingênuo casaria os dois no mesmo membro; o mais específico tem que ganhar
  const m = membroDe('Farelo de caroço de algodão')
  assert.equal(m?.nome, 'Farelo de caroço de algodão')
  assert.deepEqual(m?.especies, ['suinos'])
  assert.equal(membroDe('Caroço de algodão')?.nome, 'Caroço de algodão')
})

test('cada espécie enxerga o que serve pra ela — e nada além', () => {
  const nomes = (e: 'bovinos'|'suinos'|'aves') => substitutosDe('Milho triturado', e).map(s => s.nome)
  const bov = nomes('bovinos'), sui = nomes('suinos'), av = nomes('aves')

  assert.ok(bov.some(n => n.startsWith('DDG')) && bov.some(n => n.includes('mandioca')),
    `bovinos: ${bov.join(', ')}`)
  assert.ok(sui.some(n => n === 'Farelo de trigo'), `suínos precisam do farelo de trigo: ${sui.join(', ')}`)
  assert.ok(av.some(n => n === 'Triguilho'), `aves precisam do triguilho: ${av.join(', ')}`)

  // o que é de uma espécie NÃO vaza pras outras
  assert.ok(!sui.some(n => n.startsWith('DDG')), 'DDG (ruminante) não pode aparecer pra suíno')
  assert.ok(!av.some(n => n === 'Farelo de trigo'), 'farelo de trigo está fonteado só pra suíno')
  assert.ok(!bov.some(n => n === 'Triguilho'), 'triguilho está fonteado só pra ave')

  // sorgo é o único sem restrição: serve pras três
  for (const [e, l] of [['bovinos',bov],['suinos',sui],['aves',av]] as const) {
    assert.ok(l.some(n => n.startsWith('Sorgo')), `sorgo tem que servir pra ${e}`)
  }
})

test('suínos ganharam alternativa de proteína; bovinos mantêm a deles', () => {
  const sui = substitutosDe('Farelo de soja', 'suinos').map(s => s.nome)
  assert.ok(sui.some(n => n === 'Farelo de caroço de algodão'), `suínos: ${sui.join(', ')}`)
  assert.ok(!sui.some(n => n === 'Caroço de algodão'), 'caroço INTEIRO não serve pra monogástrico')

  const bov = substitutosDe('Farelo de soja', 'bovinos').map(s => s.nome)
  assert.ok(bov.some(n => n === 'Caroço de algodão'), `bovinos: ${bov.join(', ')}`)
})
