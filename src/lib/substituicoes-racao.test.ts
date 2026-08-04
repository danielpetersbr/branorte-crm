import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBSTITUICOES, grupoDe, substitutosDe, temSubstituto,
  maximoSubstituivel, textoLimite,
} from './substituicoes-racao'

// A regra do arquivo é que nada entra sem fonte. Teste existe pra impedir que
// alguém acrescente um substituto "de cabeça" mais pra frente.
test('todo substituto tem fonte com instituição e limite coerente', () => {
  for (const g of SUBSTITUICOES) {
    assert.ok(g.papel.length > 3, `grupo sem papel: ${g.alvos.join(',')}`)
    assert.ok(g.alvos.length > 0, `grupo ${g.papel} sem alvo`)
    for (const s of g.substitutos) {
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
