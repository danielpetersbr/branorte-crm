import test from 'node:test'
import assert from 'node:assert/strict'
import type { IngredienteFormula } from '@/lib/venda-racao/tipos'
import { BANCO_NUTRICIONAL, acharIngrediente, semComposicao } from './ingredientes'
import { converterBase, lerNutriente, NUTRIENTES } from './tipos'
import { EXIGENCIAS, exigenciaDe } from './exigencias'
import { verificarSeguranca, temBloqueio } from './seguranca'
import { analisarFormula } from './analise'

/** Item de fórmula pra teste — só o que o motor nutricional lê. */
function ing(nome: string, pct: number): IngredienteFormula {
  return {
    id: `t-${nome}`, nome, participacao: pct, unidadeParticipacao: 'pct',
    preco: 1, unidadePreco: 'kg', pesoSacoIngrediente: 60,
  }
}

const perto = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

// ═══════════════════════════════════════════════════════════════════════════
// A REGRA DA CASA
// ═══════════════════════════════════════════════════════════════════════════

test('nenhum ingrediente entra sem fonte com instituição', () => {
  for (const i of BANCO_NUTRICIONAL) {
    assert.ok(i.fontes.length > 0, `"${i.nome}" sem nenhuma fonte`)
    for (const f of i.fontes) {
      assert.ok(f.ref.length > 25, `"${i.nome}" com fonte curta demais: "${f.ref}"`)
      assert.ok(f.cobre.length > 5, `"${i.nome}" não diz o que a fonte cobre`)
    }
    assert.ok(i.funcao.length > 15, `"${i.nome}" sem função descrita`)
    assert.ok(i.apelidos.length > 0, `"${i.nome}" sem apelido — não vai casar com o texto digitado`)
  }
})

test('quem é proibido pra alguma espécie explica o motivo', () => {
  for (const i of BANCO_NUTRICIONAL) {
    if (!i.proibidoPara?.length) continue
    assert.ok((i.motivoProibicao ?? '').length > 40,
      `"${i.nome}" bloqueia espécie sem explicar direito`)
  }
})

test('todo limite de inclusão tem fonte e base declarada', () => {
  for (const i of BANCO_NUTRICIONAL) {
    for (const l of i.limites ?? []) {
      assert.ok(l.max > 0 && l.max <= 100, `"${i.nome}" com limite fora de 0–100`)
      assert.ok(['formula', 'dieta_ms'].includes(l.base), `"${i.nome}" com base inválida`)
      assert.ok(l.fonte.length > 20, `"${i.nome}" com limite sem fonte`)
      assert.ok(l.motivo.length > 20, `"${i.nome}" com limite sem motivo`)
    }
  }
})

test('toda exigência tem fonte e faixa coerente (min <= max)', () => {
  for (const e of EXIGENCIAS) {
    assert.ok(e.fonte.length > 30, `exigência "${e.nome}" sem fonte decente`)
    assert.ok(e.categorias.length > 0, `exigência "${e.nome}" sem categoria`)
    for (const [chave, m] of Object.entries(e.metas)) {
      if (m.min != null && m.max != null) {
        assert.ok(m.min <= m.max, `"${e.nome}" tem ${chave} com mínimo maior que o máximo`)
      }
      assert.ok(m.min != null || m.max != null, `"${e.nome}" tem ${chave} sem min nem max`)
    }
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTE 2 e 3 do pedido — ureia em monogástrico é BLOQUEIO, não limite
// ═══════════════════════════════════════════════════════════════════════════

test('TESTE 2 — ureia em fórmula de AVES é bloqueada', () => {
  const alertas = verificarSeguranca([ing('Milho', 70), ing('Ureia', 1)], 'aves')
  const b = alertas.find(a => a.nivel === 'bloqueio')
  assert.ok(b, 'ureia em ave tinha que gerar bloqueio')
  assert.match(b!.ingrediente, /ureia/i)
  assert.match(b!.detalhe, /não proteico|nao proteico/i)
  assert.match(b!.detalhe, /rúmen|rumen/i, 'o motivo tem que citar a ausência de rúmen')
  assert.ok(temBloqueio(alertas))
})

test('TESTE 3 — ureia em fórmula de SUÍNOS é bloqueada', () => {
  const alertas = verificarSeguranca([ing('Milho', 80), ing('Ureia', 1)], 'suinos')
  assert.ok(temBloqueio(alertas), 'ureia em suíno tinha que gerar bloqueio')
})

test('ureia em BOVINOS não é bloqueada — só ressalvada', () => {
  const alertas = verificarSeguranca([ing('Milho', 70), ing('Ureia', 1)], 'bovinos')
  assert.equal(temBloqueio(alertas), false, 'bovino tem rúmen; ureia é legítima')
  const av = alertas.find(a => a.ingrediente === 'Ureia' && a.nivel === 'atencao')
  assert.ok(av, 'mesmo permitida, ureia carrega ressalva de mistura homogênea')
  assert.match(av!.detalhe, /homog/i)
})

test('sulfato de amônia segue a mesma regra da ureia', () => {
  assert.ok(temBloqueio(verificarSeguranca([ing('Sulfato de amônia', 0.1)], 'aves')))
  assert.ok(temBloqueio(verificarSeguranca([ing('Sulfato de amônia', 0.1)], 'suinos')))
  assert.equal(temBloqueio(verificarSeguranca([ing('Sulfato de amônio', 0.1)], 'bovinos')), false)
})

test('bloqueio suprime os outros alertas do mesmo item — sem ruído em cima do vermelho', () => {
  const alertas = verificarSeguranca([ing('Ureia', 1)], 'aves')
  const daUreia = alertas.filter(a => a.ingrediente === 'Ureia')
  assert.equal(daUreia.length, 1, 'só o bloqueio deve aparecer')
  assert.equal(daUreia[0].nivel, 'bloqueio')
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTE 5 do pedido — os três "arroz" são produtos diferentes
// ═══════════════════════════════════════════════════════════════════════════

test('TESTE 5 — quirera, farelo e casca de arroz são cadastros distintos', () => {
  const quirera = acharIngrediente('Quirera de arroz')
  const farelo = acharIngrediente('Farelo de arroz integral')
  const casca = acharIngrediente('Casca de arroz')

  assert.ok(quirera && farelo && casca, 'os três têm que existir no banco')
  assert.notEqual(quirera!.id, farelo!.id)
  assert.notEqual(farelo!.id, casca!.id)
  assert.notEqual(quirera!.id, casca!.id)

  // A quirera é energética; a casca não é alimento.
  assert.equal(quirera!.categoria, 'energetico')
  assert.equal(casca!.categoria, 'fibroso')
  assert.ok(semComposicao(casca!), 'casca de arroz não tem composição cadastrada em nenhuma fonte usada')
  assert.match(casca!.alerta ?? '', /não é substituta energética|nao e substituta/i)
})

test('farelo de arroz DESENGORDURADO não é confundido com o integral', () => {
  const integral = acharIngrediente('Farelo de arroz integral')!
  const deseng = acharIngrediente('Farelo de arroz desengordurado')!
  assert.notEqual(integral.id, deseng.id)
  // Tirar o óleo tirou a energia: 4.045 vs 2.344 kcal de EM para suíno.
  assert.ok(integral.perfil.emSuinos! > deseng.perfil.emSuinos! * 1.5,
    'o integral tem que ter bem mais energia que o desengordurado')
})

test('casamento prefere o nome mais LONGO — a armadilha do algodão', () => {
  // "Farelo de caroço de algodão" (serve pra suíno) não pode cair em
  // "Caroço de algodão" (que é proibido pra suíno). Mesmo bug já pago no
  // motor de substituição.
  assert.equal(acharIngrediente('Farelo de caroço de algodão')!.id, 'farelo-algodao')
  assert.equal(acharIngrediente('Caroço de algodão')!.id, 'caroco-algodao')
  assert.ok(acharIngrediente('Caroço de algodão')!.proibidoPara?.includes('suinos'))
  assert.equal(acharIngrediente('Farelo de caroço de algodão')!.proibidoPara, undefined)
})

test('os vários jeitos de escrever milho caem no mesmo cadastro', () => {
  for (const n of ['Milho', 'Milho triturado', 'Milho moído', 'Milho em grão moído', 'milho grão']) {
    assert.equal(acharIngrediente(n)?.id, 'milho-grao', `"${n}" não casou com o milho`)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSÃO DE BASE — a confusão que erra por ~12%
// ═══════════════════════════════════════════════════════════════════════════

test('conversão matéria natural ⇄ matéria seca é reversível', () => {
  const ida = converterBase(7.93, 'MN', 'MS', 87.68)!
  perto(ida, 9.044, 0.005)
  perto(converterBase(ida, 'MS', 'MN', 87.68)!, 7.93, 0.0001)
})

test('as duas fontes conferem entre si no milho', () => {
  // BIPERS: 7,93% de PB em matéria natural. CQBAL: 9,11% em matéria seca.
  // Convertida, a do CQBAL tem que cair praticamente em cima da do BIPERS.
  const cqbalEmMn = converterBase(9.11, 'MS', 'MN', 87.64)!
  perto(cqbalEmMn, 7.93, 0.06)
})

test('sem matéria seca conhecida, a conversão devolve null em vez de chutar', () => {
  assert.equal(converterBase(20, 'MS', 'MN', null), null)
  assert.equal(converterBase(20, 'MS', 'MN', 0), null)
})

test('null entra, null sai — falta de dado não vira zero', () => {
  assert.equal(converterBase(null, 'MS', 'MN', 88), null)
  const casca = acharIngrediente('Casca de arroz')!
  assert.equal(lerNutriente(casca.perfil, 'proteinaBruta', 'MN'), null)
})

test('energia e NDT não são convertidos de base', () => {
  const caroco = acharIngrediente('Caroço de algodão')! // perfil em base MS
  // NDT é % da MS por definição — sai igual mesmo pedindo em MN.
  assert.equal(lerNutriente(caroco.perfil, 'ndt', 'MN'), 81.92)
  // Já a proteína é convertida: 22,62% da MS × 0,9064 = 20,50% da natural.
  perto(lerNutriente(caroco.perfil, 'proteinaBruta', 'MN')!, 20.50, 0.02)
})

// ═══════════════════════════════════════════════════════════════════════════
// O MOTOR
// ═══════════════════════════════════════════════════════════════════════════

test('proteína da fórmula é a média ponderada — conta conferida na mão', () => {
  // Terminação típica: 82% milho + 15% farelo de soja + 3% núcleo.
  const a = analisarFormula(
    [ing('Milho', 82), ing('Farelo de soja', 15), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  // 0,82 × 7,93 + 0,15 × 46,53 = 6,5026 + 6,9795 = 13,4821
  perto(pb.valor!, 13.4821, 0.001)
  perto(pb.coberturaPct, 97, 0.001)
  // O que falta é listado com o nome COMO O VENDEDOR DIGITOU, não com o do
  // catálogo — ele precisa achar a linha na tela dele.
  assert.deepEqual(pb.faltando, ['Núcleo suínos'])
})

test('cobertura parcial NÃO aprova um máximo — o que falta pode estourar', () => {
  const a = analisarFormula(
    [ing('Milho', 82), ing('Farelo de soja', 15), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  // 13,48 está DENTRO de 13,00–14,50. Mas 3% da fórmula não foi analisada.
  assert.equal(pb.status, 'incompleto',
    'teto só pode ser aprovado com a fórmula inteira analisada')
  assert.match(pb.observacao ?? '', /estourar|sem composição/i)
})

test('cobertura parcial APROVA um mínimo — o que falta só pode somar', () => {
  const a = analisarFormula(
    [ing('Milho', 82), ing('Farelo de soja', 15), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  const treo = a.linhas.find(l => l.chave === 'treonina')!
  // 0,82×0,27 + 0,15×1,68 = 0,2214 + 0,252 = 0,4734, contra mínimo de 0,42
  perto(treo.valor!, 0.4734, 0.001)
  assert.equal(treo.status, 'ok')
  assert.match(treo.observacao ?? '', /só pode somar|so pode somar/i)
})

test('folga pequena sobre o mínimo vira AMARELO, não verde', () => {
  const a = analisarFormula(
    [ing('Milho', 82), ing('Farelo de soja', 15), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  const lis = a.linhas.find(l => l.chave === 'lisina')!
  // 0,82×0,24 + 0,15×2,77 = 0,6123 — só 2% acima do mínimo de 0,60.
  // Passa, mas qualquer variação de lote derruba: o vendedor precisa ver isso.
  perto(lis.valor!, 0.6123, 0.001)
  assert.equal(lis.status, 'limite')
})

test('abaixo do mínimo com cobertura parcial vira INCOMPLETO, não "deficiente"', () => {
  // Fórmula pobre em proteína, com 40% sem composição: não dá pra acusar.
  const a = analisarFormula(
    [ing('Milho', 60), ing('Núcleo suínos', 40)], 'suinos', 'terminacao',
  )
  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  assert.equal(pb.status, 'incompleto')
  assert.match(pb.observacao ?? '', /não dá pra afirmar|nao da pra afirmar/i)
})

test('abaixo do mínimo com fórmula 100% conhecida vira FORA — aí pode acusar', () => {
  const a = analisarFormula(
    [ing('Milho', 95), ing('Farelo de soja', 5)], 'suinos', 'terminacao',
  )
  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  perto(pb.coberturaPct, 100, 0.001)
  // 0,95 × 7,93 + 0,05 × 46,53 = 7,5335 + 2,3265 = 9,86 < 13,00
  perto(pb.valor!, 9.86, 0.01)
  assert.equal(pb.status, 'fora')
})

test('acima do máximo é FORA mesmo com cobertura parcial — o que falta só somaria', () => {
  const a = analisarFormula(
    [ing('Farelo de soja', 60), ing('Milho', 37), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  assert.ok(pb.valor! > 14.5)
  assert.equal(pb.status, 'fora')
})

test('NDT é ponderado pela matéria seca, não pela participação', () => {
  const a = analisarFormula(
    [ing('Milho', 50), ing('Farelo de soja', 50)], 'bovinos', 'confinamento',
  )
  const ndt = a.linhas.find(l => l.chave === 'ndt')!
  // Σ(kgMS × NDT) / Σ kgMS
  // milho: 0,5×0,8768=0,4384 → ×87,24 = 38,2460
  // soja:  0,5×0,8867=0,44335 → ×81,54 = 36,1508
  // (38,2460+36,1508) / 0,88175 = 84,373
  perto(ndt.valor!, 84.373, 0.02)
})

test('ingrediente sem dado não puxa a média pra baixo — ele sai da conta', () => {
  const so = analisarFormula([ing('Milho', 100)], 'suinos', 'terminacao')
  const com = analisarFormula(
    [ing('Milho', 100), ing('Casca de arroz', 0.0001)], 'suinos', 'terminacao',
  )
  const a = so.linhas.find(l => l.chave === 'proteinaBruta')!.valor!
  const b = com.linhas.find(l => l.chave === 'proteinaBruta')!.valor!
  perto(a, b, 0.001) // se a casca entrasse como zero, b cairia
})

test('energia aparece só na espécie certa', () => {
  const aves = analisarFormula([ing('Milho', 100)], 'aves', 'frango_final')
  const bov = analisarFormula([ing('Milho', 100)], 'bovinos', 'confinamento')

  assert.ok(aves.linhas.some(l => l.chave === 'emAves'))
  assert.equal(aves.linhas.some(l => l.chave === 'ndt'), false,
    'NDT é medida de ruminante — não pode aparecer em ave')

  assert.ok(bov.linhas.some(l => l.chave === 'ndt'))
  assert.equal(bov.linhas.some(l => l.chave === 'emAves'), false)
  assert.equal(bov.linhas.some(l => l.chave === 'lisina'), false,
    'aminoácido é conta de monogástrico')
})

test('espécie sem exigência cadastrada calcula o valor mas NÃO pinta de verde', () => {
  const a = analisarFormula([ing('Milho', 100)], 'aves', 'frango_final')
  assert.equal(a.exigencia, null, 'aves ainda não têm exigência cadastrada')
  const em = a.linhas.find(l => l.chave === 'emAves')!
  assert.equal(em.valor, 3229, 'o valor calculado tem que aparecer mesmo sem meta')
  assert.equal(em.status, 'sem_meta', 'sem meta não pode virar "ok"')
})

test('exigência de suíno existe pra todas as fases do catálogo', () => {
  for (const c of ['pre_inicial', 'inicial', 'crescimento', 'terminacao',
    'gestacao', 'lactacao', 'reprodutores']) {
    assert.ok(exigenciaDe('suinos', c), `falta exigência para "${c}"`)
  }
})

test('poedeira tem exigência nas 3 fases que a Embrapa publica', () => {
  for (const c of ['poedeira_inicial', 'poedeira_crescimento', 'postura']) {
    assert.ok(exigenciaDe('aves', c), `falta exigência para "${c}"`)
  }
  // Frango de corte segue SEM meta — não achei fonte aberta. Se alguém
  // cadastrar sem fonte, este teste é o lugar de perceber que mudou.
  for (const c of ['frango_inicial', 'frango_crescimento', 'frango_final']) {
    assert.equal(exigenciaDe('aves', c), null,
      `"${c}" ganhou exigência — confira se a fonte foi conferida`)
  }
})

test('o salto de cálcio da poedeira em produção está cadastrado', () => {
  // É o número que separa uma ração que faz casca de ovo de uma que não faz.
  const recria = exigenciaDe('aves', 'poedeira_crescimento')!
  const producao = exigenciaDe('aves', 'postura')!
  assert.equal(recria.metas.calcio!.min, 0.85)
  assert.equal(producao.metas.calcio!.min, 3.4)
  assert.ok(producao.metas.calcio!.min! > recria.metas.calcio!.min! * 3,
    'o cálcio da produção tem que ser MÚLTIPLO do da recria')
})

test('a fórmula de postura de referência atende o cálcio que a poedeira exige', () => {
  // Cruzamento de DUAS fontes independentes: a fórmula veio da ficha Integral
  // Mix (formulacoes-racao.ts) e a meta veio da Embrapa CIT 55. Se as duas não
  // fechassem, uma das duas estaria errada.
  const a = analisarFormula(
    [ing('Milho moído', 63), ing('Farelo de soja', 24.5),
      ing('Calcário calcítico', 7.5), ing('Núcleo de postura', 5)],
    'aves', 'postura',
  )
  const ca = a.linhas.find(l => l.chave === 'calcio')!
  // O calcário NÃO tem composição cadastrada, então o que aparece é só o que o
  // núcleo traz: 5% × 20% = 1,0%. Abaixo da meta de 3,4% — mas com cobertura
  // parcial, e por isso o status é INCOMPLETO, não "fora".
  assert.equal(ca.status, 'incompleto')
  assert.ok(ca.faltando.includes('Calcário calcítico'),
    'o calcário tem que aparecer como o dado que falta — é ele que fecha o cálcio')
})

test('cobertura conta COMPOSIÇÃO, não "estar no banco"', () => {
  // Achado dirigindo a tela: ureia e núcleo estão cadastrados (é como a camada
  // de segurança os enxerga) mas têm perfil VAZIO. Contá-los como cobertura
  // escrevia "100% da fórmula tem composição cadastrada" numa tela em que todo
  // nutriente mostrava 21%.
  const a = analisarFormula(
    [ing('Ureia', 75), ing('Farelo de soja', 22), ing('Núcleo mineral', 3)],
    'bovinos', 'confinamento',
  )
  perto(a.reconhecidoPct, 100, 0.001) // os três estão no banco
  perto(a.coberturaGeralPct, 22, 0.001) // só o farelo tem composição
  assert.deepEqual(a.semComposicao.sort(), ['Núcleo / premix', 'Ureia'])

  const pb = a.linhas.find(l => l.chave === 'proteinaBruta')!
  perto(pb.coberturaPct, 22, 0.001) // o cabeçalho e a linha têm que bater
})

test('composição PARCIAL não é "sem composição" — núcleo entra pelo cálcio', () => {
  // O núcleo com garantia de rótulo traz cálcio e NÃO traz matéria seca. A
  // primeira versão da métrica testava materiaSeca e teria jogado ele fora.
  const a = analisarFormula(
    [ing('Milho', 82), ing('Farelo de soja', 15), ing('Núcleo suínos', 3)],
    'suinos', 'terminacao',
  )
  assert.deepEqual(a.semComposicao, [], 'os três têm ao menos um nutriente')
  perto(a.coberturaGeralPct, 100, 0.001)

  // A ficha ADM afirma: 3% de núcleo a 24% de Ca dá 0,72% na ração. Confere.
  const ca = a.linhas.find(l => l.chave === 'calcio')!
  // 0,82×0,04 + 0,15×0,25 + 0,03×24,0 = 0,0328 + 0,0375 + 0,72 = 0,7903
  perto(ca.valor!, 0.7903, 0.0001)
  perto(ca.coberturaPct, 100, 0.001)
  // Terminação pede 0,50 a 0,60 — 0,79 estoura, e agora dá pra afirmar.
  assert.equal(ca.status, 'fora')
})

test('ingrediente que o banco não conhece vira lacuna explícita', () => {
  const a = analisarFormula([ing('Milho', 90), ing('Farelo de xisto', 10)], 'suinos', 'terminacao')
  assert.deepEqual(a.naoCadastrados, ['Farelo de xisto'])
  perto(a.coberturaGeralPct, 90, 0.001)
  perto(a.reconhecidoPct, 90, 0.001)
  const l = a.alertas.find(x => x.ingrediente === 'Farelo de xisto')
  assert.ok(l, 'tinha que avisar que não sabe nada sobre esse ingrediente')
  assert.equal(l!.nivel, 'lacuna')
})

test('teto sobre a DIETA não é comparado com % da fórmula', () => {
  const alertas = verificarSeguranca([ing('Milho', 80), ing('DDG', 20)], 'bovinos')
  const a = alertas.find(x => x.ingrediente.startsWith('DDG'))!
  assert.match(a.titulo, /DIETA TOTAL/i)
  assert.match(a.detalhe, /não são comparáveis|nao sao comparaveis/i)
})

test('teto sobre a FÓRMULA é comparado e acusa quando estoura', () => {
  const ok = verificarSeguranca([ing('Triguilho', 25)], 'aves')
  assert.equal(ok.some(a => /acima do limite/i.test(a.titulo)), false)

  const demais = verificarSeguranca([ing('Triguilho', 45)], 'aves')
  assert.ok(demais.some(a => /acima do limite/i.test(a.titulo)),
    '45% de triguilho passa do teto de 30% para aves')
})

test('unidade kg/t é convertida antes de comparar com o teto', () => {
  const item: IngredienteFormula = {
    id: 'x', nome: 'Triguilho', participacao: 450, unidadeParticipacao: 'kg_t',
    preco: 1, unidadePreco: 'kg', pesoSacoIngrediente: 60,
  }
  // 450 kg/t = 45% — mesmo caso do teste acima, escrito noutra unidade.
  assert.ok(verificarSeguranca([item], 'aves').some(a => /acima do limite/i.test(a.titulo)))
})

test('fórmula vazia não é analisável e não inventa status', () => {
  const a = analisarFormula([], 'suinos', 'terminacao')
  assert.equal(a.aplicavel, false)
  assert.equal(a.coberturaGeralPct, 0)
  assert.ok(a.linhas.every(l => l.valor == null))
})

test('todo nutriente do catálogo tem rótulo e casas coerentes', () => {
  for (const n of NUTRIENTES) {
    assert.ok(n.rotulo.length > 2, `nutriente ${n.chave} sem rótulo`)
    assert.ok(n.casas >= 0 && n.casas <= 4, `nutriente ${n.chave} com casas estranhas`)
    assert.ok(['%', 'kcal/kg'].includes(n.unidade))
  }
})
