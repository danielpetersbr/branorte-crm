import test from 'node:test'
import assert from 'node:assert/strict'
import {
  producaoNecessaria, escolherMoinho, capacidadeEmKg, necessidadesDeMateria,
  armazenagemRacaoPronta, dimensionar, exigeFunil60, vaiParaSacaria,
  SEMANAS_MES, LIMITE_CAIXA_KG, type ItemCatalogo,
} from './dimensionamento-fabrica'

// Catálogo recortado do `precos_branorte` real (2026-08-04), com as unidades
// bagunçadas de propósito — é assim que a coluna `capacidade` está.
const item = (o: Partial<ItemCatalogo>): ItemCatalogo => ({
  modelo: null, capacidade: null, categoria: null, subcategoria: null,
  funilTipo: null, motorCv: null, valor: null, ...o,
})

const CATALOGO: ItemCatalogo[] = [
  // moinhos — números REAIS da tabela
  item({ modelo: 'BNMM130',  capacidade: '300KG/H',   categoria: 'MOINHO', motorCv: 7.5 }),
  item({ modelo: 'BNMM175',  capacidade: '750KG/H',   categoria: 'MOINHO', motorCv: 7.5 }),
  item({ modelo: 'BNMM210',  capacidade: '1000KG/H',  categoria: 'MOINHO', motorCv: 10 }),
  item({ modelo: 'BNMM215',  capacidade: '1500KG/H',  categoria: 'MOINHO', motorCv: 15 }),
  item({ modelo: 'BNMM315',  capacidade: '1700KG/H',  categoria: 'MOINHO', motorCv: 20 }),
  item({ modelo: 'BNMM550',  capacidade: '5000KG/H',  categoria: 'MOINHO', motorCv: 50 }),
  item({ modelo: 'BNMM7100', capacidade: '10000KG/H', categoria: 'MOINHO', motorCv: 100 }),
  // silos de matéria-prima
  item({ capacidade: '28 ton',     categoria: 'SILO', subcategoria: 'MILHO', funilTipo: '60' }),
  item({ modelo: 'SAB4695', capacidade: '35.21 ton', categoria: 'SILO', subcategoria: 'MILHO', funilTipo: '60' }),
  item({ modelo: 'SAB5663', capacidade: '42.47 ton', categoria: 'SILO', subcategoria: 'MILHO', funilTipo: '60' }),
  item({ capacidade: '196.5 ton',  categoria: 'SILO', subcategoria: 'MILHO', funilTipo: '45' }),
  item({ capacidade: '298.5 ton',  categoria: 'SILO', subcategoria: 'MILHO', funilTipo: '45' }),
  item({ capacidade: '961.5 ton',  categoria: 'SILO', subcategoria: 'MILHO', funilTipo: 'PLANO' }),
  // silos de ração pronta (todos 60°)
  item({ modelo: 'SAB471',  capacidade: '3.0615 ton', categoria: 'SILO', subcategoria: 'RACAO', funilTipo: '60' }),
  item({ modelo: 'SAB1313', capacidade: '8.53 ton',   categoria: 'SILO', subcategoria: 'RACAO', funilTipo: '60' }),
  item({ modelo: 'SAB3727', capacidade: '24.23 ton',  categoria: 'SILO', subcategoria: 'RACAO', funilTipo: '60' }),
  // caixas de ração pronta (capacidade em kg, SEM unidade no texto)
  item({ modelo: 'BNCX1212/1300-2100', capacidade: '1300', categoria: 'CAIXA', subcategoria: 'PICADOS' }),
  item({ modelo: 'BNCX1224/2600-2100', capacidade: '2600', categoria: 'CAIXA', subcategoria: 'PICADOS' }),
  item({ modelo: 'BNCX1248/5200-2900', capacidade: '5200', categoria: 'CAIXA', subcategoria: 'PICADOS' }),
  // caixa de recepção em M³ — não vira massa sem densidade
  item({ modelo: 'BNCX33', capacidade: '25 M³', categoria: 'CAIXA', subcategoria: 'RECEPCAO' }),
]

// ═════════════════════════════════════════════════════════════════════════════
// passo 3: consumo + jornada -> kg/h
// ═════════════════════════════════════════════════════════════════════════════

test('o caso que o Daniel ditou: 3 dias na semana, 4 horas por dia', () => {
  // 60 t/mês. 3 × (52/12) × 4 = 52 h/mês. 60.000 / 52 = 1.154 kg/h.
  const p = producaoNecessaria(60_000, { diasPorSemana: 3, horasPorDia: 4 })
  assert.ok(p)
  assert.ok(Math.abs(p.horasPorMes - 52) < 0.01, `${p.horasPorMes} h/mês`)
  assert.ok(Math.abs(p.kgHoraBase - 1153.8) < 1, `${p.kgHoraBase} kg/h`)
  assert.equal(p.kgHoraNecessaria, p.kgHoraBase, 'sem margem, uma coisa é igual à outra')
})

test('A JORNADA é que manda — mesmo rebanho, máquina diferente', () => {
  // É o ponto do método: sem esta pergunta, o dimensionamento é chute.
  const pouco = producaoNecessaria(60_000, { diasPorSemana: 3, horasPorDia: 4 })
  const muito = producaoNecessaria(60_000, { diasPorSemana: 5, horasPorDia: 8 })
  assert.ok(pouco && muito)
  assert.ok(pouco.kgHoraNecessaria > muito.kgHoraNecessaria * 3,
    'trabalhar menos exige máquina MUITO maior')

  const mA = escolherMoinho(pouco.kgHoraNecessaria, CATALOGO)
  const mB = escolherMoinho(muito.kgHoraNecessaria, CATALOGO)
  assert.equal(mA?.modelo, 'BNMM215', 'jornada curta puxa moinho maior')
  assert.equal(mB?.modelo, 'BNMM175', 'jornada longa aceita moinho menor')
})

test('margem do cliente entra em cima da produção, não do consumo', () => {
  const p = producaoNecessaria(60_000, { diasPorSemana: 3, horasPorDia: 4, margemPct: 30 })
  assert.ok(p)
  assert.ok(Math.abs(p.kgHoraNecessaria - p.kgHoraBase * 1.3) < 0.01)
})

test('mês tem 4,33 semanas, não 4 — senão perde 8% do ano', () => {
  assert.ok(Math.abs(SEMANAS_MES - 4.3333) < 0.001)
})

test('jornada zerada devolve null em vez de Infinity', () => {
  assert.equal(producaoNecessaria(60_000, { diasPorSemana: 0, horasPorDia: 4 }), null)
  assert.equal(producaoNecessaria(60_000, { diasPorSemana: 3, horasPorDia: 0 }), null)
  assert.equal(producaoNecessaria(0, { diasPorSemana: 3, horasPorDia: 4 }), null)
})

// ═════════════════════════════════════════════════════════════════════════════
// moinho
// ═════════════════════════════════════════════════════════════════════════════

test('a regra "CV × 100" NÃO vale — quem manda é a capacidade da tabela', () => {
  // BNMM130 tem 7,5 CV e faz 300 kg/h. Pela regra de bolso daria 750.
  // BNMM315 tem 20 CV e faz 1.700, não 2.000. Confiar na fórmula erraria o
  // equipamento em 4 dos 12 modelos reais.
  const m = escolherMoinho(400, CATALOGO)
  assert.equal(m?.modelo, 'BNMM175', 'o 130 (300 kg/h) não atende 400, mesmo com 7,5 CV')
})

test('escolhe o MENOR que atende, não o primeiro que aparece', () => {
  assert.equal(escolherMoinho(1000, CATALOGO)?.modelo, 'BNMM210')
  assert.equal(escolherMoinho(1001, CATALOGO)?.modelo, 'BNMM215')
  assert.equal(escolherMoinho(300, CATALOGO)?.modelo, 'BNMM130')
})

test('produção acima do maior moinho devolve null, não o maior', () => {
  // Devolver o maior faria a tela prometer uma fábrica que não existe.
  assert.equal(escolherMoinho(20_000, CATALOGO), null)
})

// ═════════════════════════════════════════════════════════════════════════════
// capacidade: a coluna é texto livre e mistura unidade
// ═════════════════════════════════════════════════════════════════════════════

test('capacidadeEmKg normaliza as três unidades da tabela', () => {
  assert.equal(capacidadeEmKg('5000KG/H'), 5000)
  assert.equal(capacidadeEmKg('42.47 ton'), 42470)
  assert.equal(capacidadeEmKg('1300'), 1300)
  assert.equal(capacidadeEmKg(null), null)
  assert.equal(capacidadeEmKg('75 M³'), null, 'volume não vira massa sem densidade')
})

test('sem normalizar, 42 ton pareceria menor que 1300 kg', () => {
  assert.ok(capacidadeEmKg('42.47 ton')! > capacidadeEmKg('1300')!)
})

// ═════════════════════════════════════════════════════════════════════════════
// matérias-primas: silo, funil, sacaria
// ═════════════════════════════════════════════════════════════════════════════

test('farelo de soja EXIGE funil 60° — nunca 45° nem plano', () => {
  assert.ok(exigeFunil60('Farelo de soja'))
  assert.ok(!exigeFunil60('Milho moído'))

  const r = necessidadesDeMateria(
    [{ nome: 'Farelo de soja', participacaoPct: 30 }],
    300_000, 30, CATALOGO,
  )
  assert.equal(r[0].silo?.funilTipo, '60',
    `indicou funil ${r[0].silo?.funilTipo} pra farelo — empedra e trava a fábrica`)
})

test('milho pode usar qualquer funil — inclusive os grandes 45° e plano', () => {
  const r = necessidadesDeMateria(
    [{ nome: 'Milho moído', participacaoPct: 70 }],
    3_000_000, 30, CATALOGO,
  )
  assert.ok(r[0].silo, 'devia ter achado silo')
  assert.ok(['45', 'PLANO', '60'].includes(String(r[0].silo!.funilTipo)))
})

test('núcleo, ureia e sal vão pra SACARIA — silo pra eles é erro', () => {
  for (const n of ['Núcleo/premix', 'Ureia pecuária', 'Sal comum', 'Sal mineral', 'DL-Metionina']) {
    assert.ok(vaiParaSacaria(n), `${n} devia ir pra sacaria`)
  }
  const r = necessidadesDeMateria(
    [{ nome: 'Núcleo/premix', participacaoPct: 5 }], 300_000, 30, CATALOGO,
  )
  assert.equal(r[0].silo, null)
  assert.equal(r[0].recebimento, 'ensacado')
  assert.match(r[0].observacao ?? '', /sacaria/i)
})

test('silo sai do PERCENTUAL da matéria, não do total da ração', () => {
  const r = necessidadesDeMateria(
    [{ nome: 'Milho moído', participacaoPct: 70 }, { nome: 'Farelo de soja', participacaoPct: 30 }],
    300_000, 30, CATALOGO,
  )
  const milho = r.find(x => x.nome.includes('Milho'))!
  const soja = r.find(x => x.nome.includes('soja'))!
  assert.ok(Math.abs(milho.kgEstocar - 210_000) < 1, `${milho.kgEstocar}`)
  assert.ok(Math.abs(soja.kgEstocar - 90_000) < 1, `${soja.kgEstocar}`)
})

test('volume que nenhum silo aguenta vira N silos, com a conta explicada', () => {
  // Farelo só pode 60°, e o maior 60° do catálogo tem 42,47 t.
  const r = necessidadesDeMateria(
    [{ nome: 'Farelo de soja', participacaoPct: 100 }], 3_000_000, 30, CATALOGO,
  )
  assert.ok(r[0].quantidadeSilos > 1, 'devia pedir mais de um silo')
  assert.equal(r[0].silo?.funilTipo, '60', 'e continuar respeitando o funil')
  assert.match(r[0].observacao ?? '', /Nenhum silo isolado/)
})

test('o vendedor pode marcar uma matéria como ensacada e o silo sai da conta', () => {
  const r = necessidadesDeMateria(
    [{ nome: 'Milho moído', participacaoPct: 70 }],
    300_000, 30, CATALOGO, { 'Milho moído': 'ensacado' },
  )
  assert.equal(r[0].silo, null)
  assert.equal(r[0].recebimento, 'ensacado')
})

// ═════════════════════════════════════════════════════════════════════════════
// ração pronta: caixa até 5 t, silo acima
// ═════════════════════════════════════════════════════════════════════════════

test('até 5 t é CAIXA; acima é SILO de ração', () => {
  const caixa = armazenagemRacaoPronta(2500, CATALOGO)
  assert.equal(caixa.tipo, 'caixa')
  // A MENOR que serve, não a maior: 2.600 kg cobre 2.500. Vender a de 5.200
  // seria empurrar caixa que o cliente não precisa.
  assert.equal(caixa.item?.modelo, 'BNCX1224/2600-2100')
  assert.equal(armazenagemRacaoPronta(3000, CATALOGO).item?.modelo, 'BNCX1248/5200-2900',
    'passou de 2.600 → sobe pra próxima')

  const silo = armazenagemRacaoPronta(LIMITE_CAIXA_KG + 1, CATALOGO)
  assert.equal(silo.tipo, 'silo_racao')
  assert.equal(silo.item?.subcategoria, 'RACAO')
})

test('silo de ração é sempre 60°', () => {
  const s = armazenagemRacaoPronta(20_000, CATALOGO)
  assert.equal(s.item?.funilTipo, '60')
})

// ═════════════════════════════════════════════════════════════════════════════
// o pacote: as pendências são a parte honesta
// ═════════════════════════════════════════════════════════════════════════════

test('sem os dados, diz o que falta em vez de inventar equipamento', () => {
  const d = dimensionar({
    consumoMensalKg: 0,
    jornada: { diasPorSemana: 0, horasPorDia: 0 },
    formula: [], diasEstoqueMateria: 30, kgRacaoPronta: 0, expedicao: [],
  }, CATALOGO)
  assert.equal(d.producao, null)
  assert.equal(d.moinho, null)
  assert.ok(d.pendencias.length >= 4, d.pendencias.join(' | '))
  assert.ok(d.pendencias.some(p => /consumo mensal/i.test(p)))
  assert.ok(d.pendencias.some(p => /dias e quantas horas/i.test(p)))
  assert.ok(d.pendencias.some(p => /formula[çc][ãa]o/i.test(p)))
  assert.ok(d.pendencias.some(p => /expedi[çc][ãa]o/i.test(p)))
})

test('com tudo preenchido, fecha sem pendência', () => {
  const d = dimensionar({
    consumoMensalKg: 60_000,
    jornada: { diasPorSemana: 3, horasPorDia: 4, margemPct: 20 },
    formula: [
      { nome: 'Milho moído', participacaoPct: 70 },
      { nome: 'Farelo de soja', participacaoPct: 25 },
      { nome: 'Núcleo/premix', participacaoPct: 5 },
    ],
    diasEstoqueMateria: 30,
    kgRacaoPronta: 4000,
    expedicao: ['ensacada'],
  }, CATALOGO)

  assert.deepEqual(d.pendencias, [], d.pendencias.join(' | '))
  assert.equal(d.moinho?.modelo, 'BNMM215', '1.154 × 1,20 = 1.385 kg/h → o de 1.500')
  assert.equal(d.racaoPronta.tipo, 'caixa')
  assert.equal(d.materias.find(m => m.nome.includes('Núcleo'))?.silo, null, 'núcleo não tem silo')
  assert.equal(d.materias.find(m => m.nome.includes('soja'))?.silo?.funilTipo, '60')
})

test('produção acima do catálogo vira pendência com o número na frente', () => {
  const d = dimensionar({
    consumoMensalKg: 5_000_000,
    jornada: { diasPorSemana: 3, horasPorDia: 4 },
    formula: [{ nome: 'Milho moído', participacaoPct: 100 }],
    diasEstoqueMateria: 30, kgRacaoPronta: 1000, expedicao: ['granel'],
  }, CATALOGO)
  assert.equal(d.moinho, null)
  assert.ok(d.pendencias.some(p => /passa do maior moinho/i.test(p)), d.pendencias.join(' | '))
  assert.ok(d.pendencias.some(p => /\d+ kg\/h/.test(p)), 'a pendência tem que trazer o número')
})

test('degrau enorme do catálogo: oferece a combinação de menores', () => {
  // Medido no catálogo real: pra 45 t de milho o menor silo que cabe SOZINHO é
  // o de 196,5 t — 4× o necessário — porque a linha pula de 42,47 direto pra
  // 196,5. Dois de 42,47 resolvem. Quem escolhe é o vendedor; a conta mostra as
  // duas em vez de empurrar o silo grande.
  const r = necessidadesDeMateria(
    [{ nome: 'Milho moído', participacaoPct: 100 }],
    45_000, 30, CATALOGO,
  )
  const m = r[0]
  assert.ok(m.silo, 'devia escolher um silo')
  assert.ok(m.alternativa, 'devia oferecer alternativa — a sobra é de 4×')
  assert.ok(m.alternativa!.quantidade >= 2)
  const capAlt = capacidadeEmKg(m.alternativa!.silo.capacidade)!
  const capUnico = capacidadeEmKg(m.silo!.capacidade)!
  assert.ok(capAlt * m.alternativa!.quantidade < capUnico,
    'a combinação tem que somar MENOS que o silo único, senão não é alternativa')
  assert.ok(capAlt * m.alternativa!.quantidade >= 45_000, 'e ainda tem que caber')
  assert.match(m.observacao ?? '', /Sobra muita capacidade/)
})

test('quando o silo único serve bem, NÃO inventa alternativa', () => {
  // 25 t no silo de 28 t: sobra pouca. Oferecer combinação aqui seria ruído.
  const r = necessidadesDeMateria(
    [{ nome: 'Farelo de soja', participacaoPct: 100 }], 25_000, 30, CATALOGO,
  )
  assert.equal(r[0].alternativa, null)
})

test('a alternativa respeita o funil obrigatório', () => {
  const r = necessidadesDeMateria(
    [{ nome: 'Farelo de soja', participacaoPct: 100 }], 80_000, 30, CATALOGO,
  )
  if (r[0].alternativa) {
    assert.equal(r[0].alternativa.silo.funilTipo, '60',
      'alternativa de farelo não pode cair em 45° nem em fundo plano')
  }
})
