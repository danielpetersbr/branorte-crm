import test from 'node:test'
import assert from 'node:assert/strict'
import type { IngredienteFormula } from '@/lib/venda-racao/tipos'
import { alternativasPara, aplicarTroca, temAlternativa } from './substituicao'
import { analisarFormula } from './analise'

function ing(nome: string, pct: number, preco = 1): IngredienteFormula {
  return {
    id: `t-${nome}`, nome, participacao: pct, unidadeParticipacao: 'pct',
    preco, unidadePreco: 'kg', pesoSacoIngrediente: 60,
  }
}
let seq = 0
const novoId = () => `novo-${++seq}`
const perto = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

// ═══════════════════════════════════════════════════════════════════════════
// §1 — "aparecem poucas alternativas"
// ═══════════════════════════════════════════════════════════════════════════

test('o milho passa a ter MUITAS alternativas, não 2 ou 3', () => {
  // Antes: 2 grupos curados, 10 membros, e o vendedor via de 1 a 3 opções.
  const alts = alternativasPara('Milho', 80, 'suinos')
  assert.ok(alts.length >= 6, `só ${alts.length} alternativas para o milho em suínos`)
})

test('SAL não tem substituto, e isso está certo', () => {
  // Escrevi este teste esperando que sal ganhasse alternativas junto com o
  // resto. Não ganhou — e não devia mesmo: sódio de ração vem de sal, e nenhum
  // outro ingrediente do banco entrega sódio. Lista vazia aqui é a resposta
  // correta, não uma lacuna.
  assert.deepEqual(alternativasPara('Sal comum', 0.4, 'suinos'), [])
})

test('a ordem é por MÉRITO técnico-econômico, não alfabética', () => {
  const alts = alternativasPara('Milho', 80, 'suinos')
  const nomes = alts.map(a => a.ingrediente.nome)
  assert.notDeepEqual(nomes, [...nomes].sort(), 'está ordenado por nome')
})

test('CLASSIFICAÇÃO manda na ordem — "parcial" nunca vem antes de "boa"', () => {
  // Ordenar só por pontos punha "Soja integral processada" (parcial, é
  // proteico) ACIMA do sorgo (boa) na lista do milho — e a primeira opção que o
  // vendedor abria propunha trocar 69,8% de milho por 69,8% de soja.
  // Técnico-econômico é técnico PRIMEIRO.
  const nivel = { excelente: 0, boa: 1, parcial: 2, nao_recomendada: 3 }
  for (const especie of ['bovinos', 'suinos', 'aves'] as const) {
    const alts = alternativasPara('Milho', 80, especie, { incluirNaoRecomendadas: true })
    for (let i = 1; i < alts.length; i++) {
      const a = nivel[alts[i - 1].compatibilidade]
      const b = nivel[alts[i].compatibilidade]
      assert.ok(a <= b,
        `${especie}: "${alts[i - 1].ingrediente.nome}" (${alts[i - 1].compatibilidade}) veio antes de `
        + `"${alts[i].ingrediente.nome}" (${alts[i].compatibilidade})`)
      if (a === b) {
        assert.ok(alts[i - 1].pontos >= alts[i].pontos, `${especie}: pontos fora de ordem dentro do mesmo nível`)
      }
    }
  }
})

test('a PRIMEIRA opção do milho é sempre um energético bem classificado', () => {
  // Escrevi este teste exigindo que fosse o SORGO, e falhou: em suínos vem a
  // quirera de arroz na frente. Fui eu que errei — a quirera tem 3.525 kcal de
  // EM contra 3.421 do milho, então ela é energeticamente MELHOR que o sorgo,
  // que vale 87,5%. O invariante que importa não é qual ingrediente ganha, é
  // que quem ganha cumpra a mesma função e esteja bem classificado.
  for (const especie of ['bovinos', 'suinos', 'aves'] as const) {
    const primeira = alternativasPara('Milho', 80, especie)[0]
    assert.ok(primeira, `${especie}: nenhuma alternativa para o milho`)
    assert.ok(['excelente', 'boa'].includes(primeira.compatibilidade),
      `${especie}: a primeira opção é "${primeira.ingrediente.nome}" (${primeira.compatibilidade}) — `
      + 'a lista não pode abrir com algo que só serve em parte')
    assert.equal(primeira.ingrediente.categoria, 'energetico',
      `${especie}: a primeira opção do MILHO é "${primeira.ingrediente.nome}", que não é energético`)
  }
})

test('o que não serve fica de fora por padrão, e aparece se pedirem', () => {
  const normal = alternativasPara('Milho', 80, 'suinos')
  const tudo = alternativasPara('Milho', 80, 'suinos', { incluirNaoRecomendadas: true })
  assert.ok(tudo.length >= normal.length)
  assert.equal(normal.some(a => a.compatibilidade === 'nao_recomendada'), false)
})

test('ingrediente proibido pra espécie NUNCA aparece como alternativa', () => {
  for (const especie of ['suinos', 'aves'] as const) {
    const alts = alternativasPara('Farelo de soja', 20, especie)
    assert.equal(alts.some(a => /ureia|sulfato de am/i.test(a.ingrediente.nome)), false,
      `ofereceu NNP para ${especie}`)
    assert.equal(alts.some(a => a.ingrediente.id === 'caroco-algodao'), false,
      `ofereceu caroço INTEIRO de algodão para ${especie} — é de ruminante`)
  }
})

test('líquido não é oferecido — a Compacta é farelada', () => {
  const alts = alternativasPara('Milho', 80, 'suinos')
  assert.equal(alts.some(a => /óleo|oleo/i.test(a.ingrediente.nome)), false)
})

// ═══════════════════════════════════════════════════════════════════════════
// §8 — classificação e motivo
// ═══════════════════════════════════════════════════════════════════════════

test('toda alternativa vem com classificação e pelo menos um motivo', () => {
  for (const a of alternativasPara('Milho', 80, 'suinos')) {
    assert.ok(['excelente', 'boa', 'parcial', 'nao_recomendada'].includes(a.compatibilidade))
    assert.ok(a.motivos.length > 0, `"${a.ingrediente.nome}" sem motivo`)
    assert.ok(a.fonte.length > 15, `"${a.ingrediente.nome}" sem fonte`)
  }
})

test('o sorgo não é rebaixado por falta de dado — usa a equivalência da Embrapa', () => {
  // O BIPERS não traz EM de suíno pro sorgo. Sem a equivalência da lista curada
  // (3.290 kcal = 87,5% do milho), o substituto mais canônico do milho cairia
  // em "parcial" por buraco de tabela, não por mérito.
  const sorgo = alternativasPara('Milho', 80, 'suinos')
    .find(a => /sorgo/i.test(a.ingrediente.nome))
  assert.ok(sorgo, 'sorgo tinha que aparecer como alternativa do milho')
  assert.ok(['excelente', 'boa'].includes(sorgo!.compatibilidade),
    `sorgo veio como "${sorgo!.compatibilidade}"`)
})

test('quem tem menos energia que o milho pede correção energética', () => {
  const aveia = alternativasPara('Milho', 80, 'suinos')
    .find(a => /aveia branca/i.test(a.ingrediente.nome))
  assert.ok(aveia, 'aveia branca tinha que aparecer')
  // 2.768 contra 3.421 kcal — 81% da energia do milho.
  assert.ok(aveia!.motivos.includes('Exige correção energética'))
})

test('mandioca avisa que derruba a proteína', () => {
  const m = alternativasPara('Milho', 80, 'bovinos')
    .find(a => /raspa de mandioca/i.test(a.ingrediente.nome))
  assert.ok(m, 'raspa de mandioca tinha que aparecer para bovinos')
  // 1,80% de PB contra 7,93% do milho.
  assert.ok(m!.motivos.includes('Exige correção proteica'), m!.motivos.join(' | '))
  const pb = m!.muda.find(x => x.chave === 'proteinaBruta')
  assert.ok(pb && pb.sinal === -1, 'a queda de proteína tinha que estar listada')
})

test('limite de inclusão vira motivo E limita quanto dá pra trocar', () => {
  const t = alternativasPara('Milho', 80, 'aves').find(a => /triguilho/i.test(a.ingrediente.nome))
  assert.ok(t, 'triguilho tinha que aparecer para aves')
  assert.equal(t!.limite?.max, 30)
  assert.equal(t!.limite?.base, 'formula')
  // Há 80% de milho, mas o triguilho só vai até 30%.
  assert.equal(t!.maximoSubstituivel, 30)
  assert.ok(t!.motivos.some(m => /Limite de 30%/.test(m)))
  assert.ok(t!.motivos.includes('Pode substituir parcialmente'))
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTE 1 do pedido — DDGS em bovinos
// ═══════════════════════════════════════════════════════════════════════════

test('TESTE 1 — DDG aparece pro milho em bovinos, com o risco do enxofre', () => {
  const ddg = alternativasPara('Milho triturado', 70, 'bovinos')
    .find(a => /ddg/i.test(a.ingrediente.nome))
  assert.ok(ddg, 'DDG tinha que aparecer como alternativa do milho em bovinos')
  assert.match(ddg!.risco ?? '', /polioencefalomal/i,
    'o risco de enxofre TEM que estar escrito — é o que mata boi')
  assert.match(ddg!.ganho ?? '', /proteico|proteína/i,
    'o ganho tem que dizer que ele é energético E proteico')
})

test('TESTE 1 — o teto do DDG é sobre a DIETA, e isso não vira % da fórmula', () => {
  const ddg = alternativasPara('Milho triturado', 70, 'bovinos')
    .find(a => /ddg/i.test(a.ingrediente.nome))!
  assert.equal(ddg.limite?.base, 'dieta_ms')
  assert.equal(ddg.maximoSubstituivel, null,
    'a tela monta só o concentrado — converter 20% da dieta em 20% da fórmula seria inventar')
})

test('TESTE 1 — DDG NÃO é oferecido para suíno nem ave', () => {
  for (const e of ['suinos', 'aves'] as const) {
    assert.equal(
      alternativasPara('Milho', 70, e).some(a => /ddg/i.test(a.ingrediente.nome)), false,
      `DDG apareceu para ${e}, e a fonte só cobre bovinos`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTE 4 e 5 do pedido — arroz
// ═══════════════════════════════════════════════════════════════════════════

test('TESTE 4 — quirera de arroz é compatível energeticamente com o milho', () => {
  const q = alternativasPara('Milho', 80, 'suinos')
    .find(a => /quirera/i.test(a.ingrediente.nome))
  assert.ok(q, 'quirera tinha que aparecer')
  assert.ok(['excelente', 'boa'].includes(q!.compatibilidade),
    `quirera veio "${q!.compatibilidade}" — ela tem 3.525 kcal contra 3.421 do milho`)
  assert.ok(q!.motivos.includes('Substituto energético'))
})

test('TESTE 5 — os três arroz têm classificações DIFERENTES', () => {
  const alts = alternativasPara('Milho', 80, 'suinos', { incluirNaoRecomendadas: true })
  const quirera = alts.find(a => a.ingrediente.id === 'quirera-arroz')
  const deseng = alts.find(a => a.ingrediente.id === 'farelo-arroz-desengordurado')

  assert.ok(quirera, 'quirera tinha que estar na lista')
  assert.ok(deseng, 'farelo desengordurado tinha que estar na lista')
  assert.notEqual(quirera!.compatibilidade, deseng!.compatibilidade,
    'quirera e farelo desengordurado não podem ter a mesma classificação')
  assert.ok(quirera!.pontos > deseng!.pontos,
    'a quirera tem que ranquear acima do desengordurado como energético')

  // Casca de arroz não tem composição e não é da lista curada: nem entra.
  assert.equal(alts.some(a => a.ingrediente.id === 'casca-arroz'), false,
    'casca de arroz não pode ser oferecida como substituta energética do milho')
})

// ═══════════════════════════════════════════════════════════════════════════
// APLICAR A TROCA
// ═══════════════════════════════════════════════════════════════════════════

test('troca PARCIAL vira duas linhas e a soma não se mexe', () => {
  const f = [ing('Milho', 80, 1.08), ing('Farelo de soja', 20, 1.6)]
  const novo = aplicarTroca(f, f[0].id, 'Sorgo (baixo tanino)', 30, 0.95, novoId)
  assert.equal(novo.length, 3)
  perto(novo.reduce((s, i) => s + i.participacao, 0), 100, 1e-6)
  perto(novo.find(i => i.nome === 'Milho')!.participacao, 50)
  perto(novo.find(i => /sorgo/i.test(i.nome))!.participacao, 30)
})

test('troca TOTAL substitui a linha, não duplica', () => {
  const f = [ing('Milho', 80, 1.08), ing('Farelo de soja', 20, 1.6)]
  const novo = aplicarTroca(f, f[0].id, 'Sorgo (baixo tanino)', 80, 0.95, novoId)
  assert.equal(novo.length, 2)
  assert.equal(novo.some(i => i.nome === 'Milho'), false)
  perto(novo.reduce((s, i) => s + i.participacao, 0), 100, 1e-6)
})

test('trocar mais do que existe não cria participação negativa', () => {
  const f = [ing('Milho', 80, 1.08), ing('Farelo de soja', 20, 1.6)]
  const novo = aplicarTroca(f, f[0].id, 'Sorgo (baixo tanino)', 999, 0.95, novoId)
  perto(novo.reduce((s, i) => s + i.participacao, 0), 100, 1e-6)
  assert.ok(novo.every(i => i.participacao >= 0))
})

test('a unidade do vendedor é preservada — kg/t entra e kg/t sai', () => {
  const f: IngredienteFormula[] = [
    { id: 'a', nome: 'Milho', participacao: 800, unidadeParticipacao: 'kg_t', preco: 1.08, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
    { id: 'b', nome: 'Farelo de soja', participacao: 200, unidadeParticipacao: 'kg_t', preco: 1.6, unidadePreco: 'kg', pesoSacoIngrediente: 60 },
  ]
  const novo = aplicarTroca(f, 'a', 'Sorgo (baixo tanino)', 30, 0.95, novoId)
  assert.ok(novo.every(i => i.unidadeParticipacao === 'kg_t'))
  perto(novo.reduce((s, i) => s + i.participacao, 0), 1000, 1e-4)
  perto(novo.find(i => /sorgo/i.test(i.nome))!.participacao, 300)
})

test('a troca é reconhecida pelo analisador — não vira ingrediente órfão', () => {
  const f = [ing('Milho', 80, 1.08), ing('Farelo de soja', 20, 1.6)]
  const novo = aplicarTroca(f, f[0].id, 'Quirera de arroz', 40, 1.0, novoId)
  const a = analisarFormula(novo, 'suinos', 'terminacao')
  assert.deepEqual(a.naoCadastrados, [], 'o nome gravado tem que casar com o banco')
  perto(a.coberturaGeralPct, 100, 0.001)
})

test('temAlternativa é coerente com alternativasPara', () => {
  assert.equal(temAlternativa('Milho', 80, 'suinos'), true)
  assert.equal(temAlternativa('Ingrediente que não existe', 10, 'suinos'), false)
})

test('ingrediente fora do banco não oferece nada em vez de estourar', () => {
  assert.deepEqual(alternativasPara('Farelo de xisto', 10, 'suinos'), [])
})
