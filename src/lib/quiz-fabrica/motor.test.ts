/**
 * Testes do motor do "Monte sua fábrica".
 *
 * Roda com `npm test` (tsx --test). Nada aqui toca React nem Supabase — se um
 * dia precisar, o motor é que está errado.
 *
 * O que estes testes protegem, em ordem de estrago:
 *
 *  1. O CÓDIGO DA COMPACTA NÃO É A CAPACIDADE. Ler `30150` como "30 kg/h" dá
 *     fábrica 10× menor que a real. O erro circulou por dois meses em 2026 e
 *     contaminou todo mundo que consultou a tabela — tem teste travando isso.
 *  2. A jornada manda mais que o rebanho: mesma tonelagem em jornada diferente
 *     tem que dar máquina diferente.
 *  3. A escada arredonda PRA CIMA. Máquina apertada é cliente insatisfeito.
 *  4. Peixe e peletizada não são lead pequeno — são outro produto.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COMPACTAS, MOINHOS, TETO_FAMILIA, degrau, ehMaster, fotoDoModelo, temCacamba, temEnsacadeira } from './linha'
import {
  BATELADAS_POR_HORA, DIAS_MES_COMERCIAL, FOLGA_OPERACIONAL_PCT, MESES_ENTRESSAFRA,
  baseNaturalDe, calcularDimensionamento, calcularQuiz, consumoDeReferencia,
  consumoNaBase, consumoParaMes,
  escolherCompacta, faltando, familiaCompacta, fracaoMilho,
  porteDeRecepcao, preferemHorizontal, respostasIniciais,
} from './motor'
import type { RespostasQuiz } from './tipos'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Confinamento de 400 bois: ~120 t/mês. O caso mais comum na porta. */
function bovinos(over: Partial<RespostasQuiz> = {}): RespostasQuiz {
  return {
    ...respostasIniciais(),
    especie: 'bovinos',
    categoria: 'confinamento',
    modo: 'animais',
    numeroAnimais: 400,
    consumoPorAnimalMes: 297,
    diasPorSemana: 6,
    horasPorDia: 4,
    recebimento: 'granel',
    estoqueGrao: 'nenhum',
    expedicao: 'granel',
    pesagemAutomatica: false,
    energia: 'trifasico',
    ...over,
  }
}

function estacao(r: ReturnType<typeof calcularQuiz>, chave: string) {
  return r.estacoes.find(e => e.chave === chave)
}

function textoDa(r: ReturnType<typeof calcularQuiz>, chave: string): string {
  return (estacao(r, chave)?.itens ?? []).map(i => `${i.nome} ${i.porque}`).join(' | ')
}

// ---------------------------------------------------------------------------

describe('escada de produtos', () => {
  it('arredonda sempre PRA CIMA — nunca entrega máquina menor que o pedido', () => {
    assert.equal(degrau([300, 750, 1000], 301), 750)
    assert.equal(degrau([300, 750, 1000], 750), 750)
    assert.equal(degrau([300, 750, 1000], 1), 300)
  })

  it('acima do último degrau devolve o maior, não undefined', () => {
    assert.equal(degrau([300, 750, 1000], 99999), 1000)
  })

  it('os moinhos estão em ordem crescente — a busca linear depende disso', () => {
    const kgh = MOINHOS.map(m => m.kgh)
    assert.deepEqual(kgh, [...kgh].sort((a, b) => a - b))
  })

  it('CV × 100 é o piso da capacidade, não a fórmula — o chassi pode render mais', () => {
    // "Produção = CV × 100" é a regra-mestra que a fábrica usa pra falar de
    // Compacta, e vale na maior parte da escada. Mas NÃO é universal: ela
    // descreve o chassi mais leve de cada potência. A planilha oficial traz uma
    // coluna literal de capacidade, e nela o BNMM540 rende 4.500 kg/h com 40 CV
    // — 12% acima do que a regra preveria, porque é chassi maior.
    //
    // Por isso `linha.ts` copia a capacidade IMPRESSA de cada BNMM em vez de
    // derivar de CV. O que este teste trava é o sentido do erro: a escada pode
    // render mais que a regra, nunca menos. Se um dia um moinho aparecer
    // rendendo abaixo de CV × 100, alguém digitou errado.
    for (const m of MOINHOS) {
      assert.ok(m.kgh >= m.cv * 100, `${m.codigo}: ${m.kgh} kg/h abaixo do piso de ${m.cv * 100}`)
    }
  })

  it('BNMM540 é a exceção conhecida: 40 CV rendendo 4.500 kg/h', () => {
    const m = MOINHOS.find(x => x.codigo === 'BNMM540')!
    assert.equal(m.cv, 40)
    assert.equal(m.kgh, 4500)
    // Todos os outros seguem a regra na risca.
    for (const o of MOINHOS.filter(x => x.codigo !== 'BNMM540')) {
      assert.equal(o.kgh, o.cv * 100, `${o.codigo} virou uma segunda exceção — conferir com a fábrica`)
    }
  })
})

describe('Compactas — o código NÃO é a capacidade', () => {
  it('COMPACTA 01 - 30150 é 300 kg/h com misturador de 150 kg, não 30 kg/h', () => {
    const c = COMPACTAS.find(x => x.codigo === 'COMPACTA 01 - 30150')!
    assert.equal(c.producaoKgH, 300)
    assert.equal(c.misturadorKg, 150)
  })

  it('o código é [CV×10][kg do misturador] em TODAS as linhas', () => {
    for (const c of COMPACTAS) {
      // Tira o nome da linha (inclusive "MINI FÁBRICA COMPACTA JR") e o sufixo
      // de caixas ("- 4000/4000") da 03. O que sobra é o código puro.
      const bruto = c.codigo.replace(/^.*? - /, '').split(' - ')[0]
      const esperado = `${c.producaoKgH / 10}${c.misturadorKg}`
      assert.equal(bruto, esperado, `${c.codigo} deveria codificar ${esperado}`)
    }
  })

  it('MASTER significa misturador horizontal, e só isso', () => {
    assert.equal(ehMaster('02 MASTER'), true)
    assert.equal(ehMaster('02'), false)
  })

  it('caçamba entra na 02; ensacadeira, só na 03', () => {
    assert.equal(temCacamba('01'), false)
    assert.equal(temCacamba('02 MASTER'), true)
    assert.equal(temEnsacadeira('02'), false)
    assert.equal(temEnsacadeira('03 MASTER'), true)
  })

  it('só a 03 embarca caixas de ração pronta', () => {
    for (const c of COMPACTAS) {
      if (c.linha.startsWith('03')) assert.ok(c.caixas.length > 0, `${c.codigo} sem caixas`)
      else assert.equal(c.caixas.length, 0, `${c.codigo} não deveria ter caixas`)
    }
  })
})

describe('dimensionamento — a jornada manda mais que o rebanho', () => {
  it('400 bois de confinamento dão ~119 t/mês', () => {
    const d = calcularDimensionamento(bovinos())
    assert.equal(d.demandaMensalKg, 400 * 297)
  })

  it('a MESMA tonelagem em jornada diferente dá fábrica diferente', () => {
    const seisDias = calcularDimensionamento(bovinos({ diasPorSemana: 6, horasPorDia: 8 }))
    const umDia = calcularDimensionamento(bovinos({ diasPorSemana: 1, horasPorDia: 8 }))

    assert.equal(seisDias.demandaMensalKg, umDia.demandaMensalKg)
    assert.ok(
      umDia.capacidadeEscolhidaKgH > seisDias.capacidadeEscolhidaKgH,
      'produzir o mês inteiro num dia só tem que exigir moinho maior',
    )
  })

  it('aplica a folga operacional de 20% antes de escolher o moinho', () => {
    const d = calcularDimensionamento(bovinos())
    assert.equal(d.capacidadeAlvoKgH, d.capacidadeMinimaKgH * (1 + FOLGA_OPERACIONAL_PCT / 100))
    assert.ok(d.capacidadeEscolhidaKgH >= d.capacidadeAlvoKgH)
  })

  it('4,33 semanas por mês, não 4 — o mês comercial mente em 8%', () => {
    const d = calcularDimensionamento(bovinos({ diasPorSemana: 6 }))
    assert.ok(d.diasPorMes > 25.9 && d.diasPorMes < 26.1, `deu ${d.diasPorMes}`)
  })

  it('marca acimaDaLinha quando nem o maior moinho atende', () => {
    const d = calcularDimensionamento(bovinos({ modo: 'direto', toneladasMes: 5000, diasPorSemana: 1, horasPorDia: 4 }))
    assert.equal(d.acimaDaLinha, true)
  })

  it('demanda zero não estoura em NaN nem Infinity', () => {
    const d = calcularDimensionamento(bovinos({ numeroAnimais: 0, diasPorSemana: 0, horasPorDia: 0 }))
    for (const v of Object.values(d)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `valor não finito: ${v}`)
    }
  })
})

describe('escolha da linha', () => {
  it('A ESCADA DO DONO: 600 → Mini · 1.500 → 01 · 2.000 → 02 · acima → 03', () => {
    // Ditada em 20/08/2026: "Até 600 quilo hora tu indica a mini fábrica. De
    // mais de 600 até 1500, Compacta 1. Mais de 1500 até 2 toneladas a hora,
    // Compacta 2. Acima, Compacta 3."
    assert.equal(familiaCompacta(1), 'MINI')
    assert.equal(familiaCompacta(600), 'MINI')
    assert.equal(familiaCompacta(601), '01')
    assert.equal(familiaCompacta(1500), '01')
    assert.equal(familiaCompacta(1501), '02')
    assert.equal(familiaCompacta(2000), '02')
    assert.equal(familiaCompacta(2001), '03')
    assert.equal(familiaCompacta(2200), '03')  // o exemplo que ele deu
    assert.equal(familiaCompacta(99999), '03')
  })

  it('quem decide a linha é a CAPACIDADE — ensacar e pesagem não mudam família', () => {
    // Duas versões anteriores erraram aqui. A primeira mandava pra 03 assim
    // que o produtor dizia que ensaca; como a 03 começava em 1.000 kg/h, quem
    // produz 240 kg/h levava fábrica 4x maior por causa do saco.
    const capacidades = [200, 700, 1600, 2500]
    for (const cap of capacidades) {
      const esperado = familiaCompacta(cap)
      // A função nem recebe mais as respostas — a assinatura é a garantia.
      assert.equal(familiaCompacta(cap), esperado)
    }
    // E de ponta a ponta: mesma demanda, respostas opostas, MESMA família.
    const comum = { modo: 'direto' as const, toneladasMes: 25, diasPorSemana: 6, horasPorDia: 4 }
    const a = calcularQuiz(bovinos({ ...comum, expedicao: 'ensacada', pesagemAutomatica: true }))
    const b = calcularQuiz(bovinos({ ...comum, expedicao: 'granel', pesagemAutomatica: false }))
    assert.equal(a.compacta!.linha, b.compacta!.linha,
      `ensacar mudou a linha: ${a.compacta!.codigo} vs ${b.compacta!.codigo}`)
    assert.equal(a.dimensionamento.capacidadeEscolhidaKgH, b.dimensionamento.capacidadeEscolhidaKgH)
  })

  it('a MINI FÁBRICA existe e atende quem é pequeno', () => {
    // 12 t/mês em 6 dias × 4 h → ~138 kg/h. É Mini, não Compacta 01.
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 12 }))
    assert.equal(r.compacta!.linha, 'MINI', `virou ${r.compacta!.codigo}`)
    assert.match(r.compacta!.codigo, /MINI FÁBRICA/)
  })

  it('a Mini não tem variante MASTER — nem pra ave', () => {
    const r = calcularQuiz(bovinos({ especie: 'aves', categoria: 'postura', modo: 'direto', toneladasMes: 8 }))
    if (r.compacta?.linha === 'MINI') assert.doesNotMatch(r.compacta.codigo, /MASTER/)
  })

  it('ave e suíno preferem horizontal; bovino roda no vertical', () => {
    assert.equal(preferemHorizontal('aves'), true)
    assert.equal(preferemHorizontal('suinos'), true)
    assert.equal(preferemHorizontal('bovinos'), false)
  })

  it('nunca DESCE de família — 02 pedida não vira 01 sem caçamba', () => {
    const r = bovinos({ pesagemAutomatica: true, expedicao: 'granel', modo: 'direto', toneladasMes: 300 })
    const c = escolherCompacta(r, calcularDimensionamento(r))
    assert.ok(c, 'deveria achar uma Compacta')
    assert.ok(!c!.linha.startsWith('01'), `desceu pra ${c!.linha}`)
  })

  it('TETO DA 02 = 2 t/h: acima disso é 03, não uma 02 grande', () => {
    // REGRA DO DONO (20/08/2026): "Compacta 2 vai até 2 toneladas por hora.
    // Acima de... 2.200 quilo hora pode considerar Compacta 3."
    //
    // A tabela de preços TEM `COMPACTA 02 - 3001000`, cujo código decodifica
    // 3.000 kg/h. Derivar a escada só do código fazia o quiz oferecer uma 02
    // de 3.000 kg/h pra quem precisava de 2.142 — produto que a fábrica não
    // vende nesse porte. Foi exatamente o que o dono viu na tela.
    assert.equal(TETO_FAMILIA.MINI, 750)
    assert.equal(TETO_FAMILIA['01'], 1500)
    assert.equal(TETO_FAMILIA['01 MASTER'], 1500)
    assert.equal(TETO_FAMILIA['02'], 2000, 'a 02 tem que parar em 2.000 kg/h')
    assert.equal(TETO_FAMILIA['02 MASTER'], 2000)

    const r = bovinos({ expedicao: 'granel', pesagemAutomatica: true, modo: 'direto', toneladasMes: 74, diasPorSemana: 5, horasPorDia: 2 })
    const d = calcularDimensionamento(r)
    assert.ok(d.capacidadeAlvoKgH > 2000, `alvo deu ${d.capacidadeAlvoKgH}, precisa passar de 2.000`)
    const c = escolherCompacta(r, d)!
    assert.ok(c.linha.startsWith('03'), `${Math.round(d.capacidadeAlvoKgH)} kg/h virou ${c.codigo}`)
  })

  it('nenhuma recomendação passa do teto da própria família', () => {
    for (const t of [10, 25, 60, 74, 120, 200, 400]) {
      for (const exp of ['granel', 'ensacada'] as const) {
        const r = bovinos({ modo: 'direto', toneladasMes: t, expedicao: exp })
        const c = escolherCompacta(r, calcularDimensionamento(r))
        if (!c) continue
        assert.ok(c.producaoKgH <= TETO_FAMILIA[c.linha],
          `${c.codigo}: ${c.producaoKgH} kg/h passa do teto ${TETO_FAMILIA[c.linha]} da ${c.linha}`)
      }
    }
  })

  it('a Compacta escolhida atende o alvo, sempre', () => {
    for (const t of [10, 50, 120, 300, 600]) {
      const r = bovinos({ modo: 'direto', toneladasMes: t })
      const d = calcularDimensionamento(r)
      const c = escolherCompacta(r, d)
      if (!c) { assert.ok(d.capacidadeAlvoKgH > 5000, `${t} t/mês sem Compacta e sem estar acima da linha`); continue }
      assert.ok(c.producaoKgH >= d.capacidadeAlvoKgH, `${t} t/mês: ${c.codigo} não atende ${d.capacidadeAlvoKgH}`)
    }
  })

  it('misturador é ~metade da produção horária — o pareamento real do catálogo', () => {
    const r = bovinos({ modo: 'direto', toneladasMes: 120, pesagemAutomatica: true, expedicao: 'granel' })
    const c = escolherCompacta(r, calcularDimensionamento(r))!
    assert.ok(
      c.misturadorKg >= c.producaoKgH / BATELADAS_POR_HORA
      || c.misturadorKg === Math.max(...COMPACTAS.filter(x => x.linha === c.linha && x.producaoKgH === c.producaoKgH).map(x => x.misturadorKg)),
      `${c.codigo}: misturador ${c.misturadorKg} pra ${c.producaoKgH} kg/h`,
    )
  })

  it('milho triturado não tem Compacta — não mistura nada', () => {
    const r = bovinos({ especie: 'milho', categoria: 'granel', modo: 'direto', toneladasMes: 50 })
    assert.equal(escolherCompacta(r, calcularDimensionamento(r)), null)
  })

  it('acima de 5.000 kg/h não existe Compacta de catálogo — devolve null, não inventa', () => {
    const r = bovinos({ modo: 'direto', toneladasMes: 3000, diasPorSemana: 1, horasPorDia: 4 })
    assert.equal(escolherCompacta(r, calcularDimensionamento(r)), null)
  })
})

describe('fora de escopo — a Branorte só faz ração FARELADA', () => {
  it('peixe curto-circuita: exige extrusão, que a Branorte não fabrica', () => {
    const r = calcularQuiz({ ...bovinos(), foraDeEscopo: 'peixe' })
    assert.equal(r.foraDeEscopo, 'peixe')
    assert.equal(r.completo, false)
    assert.equal(r.estacoes.length, 0)
    assert.equal(r.compacta, null)
  })

  it('peletizada idem — não é lead pequeno, é outro produto', () => {
    const r = calcularQuiz({ ...bovinos(), foraDeEscopo: 'peletizada' })
    assert.equal(r.foraDeEscopo, 'peletizada')
    assert.equal(r.estacoes.length, 0)
  })
})

describe('a linha completa, do recebimento à expedição', () => {
  it('entrega as estações na ordem do processo', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'safra', expedicao: 'ambos', pesagemAutomatica: true }))
    assert.equal(r.completo, true)
    const ordem = r.estacoes.filter(e => e.ordem > 0).map(e => e.chave)
    assert.deepEqual(ordem, [
      'recebimento', 'armazenagem', 'moagem',
      'dosagem', 'mistura', 'racao_pronta', 'expedicao',
    ])
  })

  it('PRÉ-LIMPEZA nunca é recomendada — falta a pergunta que a qualifica', () => {
    // REGRA DO DONO (20/08/2026): "não coloca ali porque não tem nenhuma
    // pergunta que classifica se precisa ou não". Deduzir a máquina de
    // "recebe a granel" é dedução frouxa: grão de armazém chega limpo, a
    // granel ou não. Quem carrega palha e pedra é lavoura, e o quiz não
    // pergunta a procedência.
    for (const rec of ['granel', 'ensacado', 'propria'] as const) {
      const r = calcularQuiz(bovinos({ recebimento: rec, estoqueGrao: 'safra' }))
      assert.equal(estacao(r, 'prelimpeza'), undefined, `recebimento=${rec} trouxe pré-limpeza de volta`)
      const tudo = r.estacoes.flatMap(e => e.itens.map(i => i.nome)).join(' | ')
      assert.doesNotMatch(tudo, /pré-limpeza/i, tudo)
    }
  })

  it('a numeração do fluxo é sequencial e a infraestrutura fica fora dela', () => {
    const r = calcularQuiz(bovinos())
    const numeradas = r.estacoes.filter(e => e.ordem > 0)
    assert.deepEqual(numeradas.map(e => e.ordem), numeradas.map((_, i) => i + 1))
    assert.equal(estacao(r, 'apoio')!.ordem, 0)
  })

  it('toda estação entregue tem pelo menos um equipamento — nada de caixa vazia', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'mes', expedicao: 'ambos' }))
    for (const e of r.estacoes) assert.ok(e.itens.length > 0, `${e.chave} veio vazia`)
  })

  it('todo equipamento explica por que está ali', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'safra', expedicao: 'ambos', pesagemAutomatica: true }))
    for (const e of r.estacoes) {
      for (const i of e.itens) {
        assert.ok(i.nome.trim().length > 0, `${e.chave}: item sem nome`)
        assert.ok(i.porque.trim().length > 10, `${e.chave}/${i.nome}: sem justificativa`)
      }
    }
  })

  it('grão ensacado leva suporte de big bag, não moega de granel', () => {
    const r = calcularQuiz(bovinos({ recebimento: 'ensacado' }))
    assert.match(textoDa(r, 'recebimento'), /big bag/i)
  })

  it('grão a granel leva moega', () => {
    const r = calcularQuiz(bovinos({ recebimento: 'granel' }))
    assert.match(textoDa(r, 'recebimento'), /moega/i)
  })

  it('quem não estoca grão não recebe silo', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'nenhum' }))
    assert.doesNotMatch(textoDa(r, 'armazenagem'), /Silo de milho/i)
  })

  it('silo de safra é maior que silo de um mês', () => {
    const capacidade = (e: 'mes' | 'safra') => {
      const t = textoDa(calcularQuiz(bovinos({ estoqueGrao: e })), 'armazenagem')
      return Number(/Silo de milho ([\d.,]+) t/.exec(t)![1].replace(/\./g, '').replace(',', '.'))
    }
    assert.ok(capacidade('safra') > capacidade('mes'))
  })

  it('FARELO DE SOJA só em funil 60° — em 45° ele forma ponte e trava', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'safra' }))
    const t = textoDa(r, 'armazenagem')
    assert.match(t, /Farelo de soja.*60°/i)
  })

  it('núcleo, ureia e sal ficam na sacaria — nunca em silo', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'safra' }))
    assert.match(textoDa(r, 'armazenagem'), /sacaria/i)
  })

  it('pesagem automática traz caçamba e balança; sem ela, plataforma', () => {
    const com = calcularQuiz(bovinos({ pesagemAutomatica: true }))
    assert.match(textoDa(com, 'dosagem'), /Caçamba de pesagem/i)
    assert.match(textoDa(com, 'dosagem'), /célula de carga/i)

    // Sem pesagem automática ninguém COTA caçamba. O texto ainda cita a palavra
    // ("se um dia a fórmula complicar, a caçamba entra depois"), e isso é
    // intencional — por isso a asserção olha o NOME do equipamento, não a prosa.
    const sem = calcularQuiz(bovinos({ pesagemAutomatica: false }))
    const nomes = estacao(sem, 'dosagem')!.itens.map(i => i.nome)
    assert.ok(!nomes.some(n => /caçamba/i.test(n)), nomes.join(' | '))
    assert.ok(nomes.some(n => /Balança de plataforma/i.test(n)))
  })

  it('quem ensaca ganha ensacadeira e esteira; quem entrega a granel, não', () => {
    const ensaca = calcularQuiz(bovinos({ expedicao: 'ensacada' }))
    assert.match(textoDa(ensaca, 'expedicao'), /Ensacadeira/i)
    assert.match(textoDa(ensaca, 'expedicao'), /Esteira/i)

    const granel = calcularQuiz(bovinos({ expedicao: 'granel' }))
    assert.doesNotMatch(textoDa(granel, 'expedicao'), /Ensacadeira/i)
    assert.match(textoDa(granel, 'expedicao'), /granel/i)
  })

  it('acima de 6 t de ração por dia a indicação é SILO, não caixa (regra do dono)', () => {
    // Vale quando a Compacta escolhida NÃO embarca caixas (linhas 01/02). Se a
    // linha for a 03, as caixas dela é que mandam — ver o teste logo abaixo.
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 250, diasPorSemana: 6, horasPorDia: 8, expedicao: 'granel' }))
    assert.ok(r.dimensionamento.producaoPorDiaKg > 6000, `dia deu ${r.dimensionamento.producaoPorDiaKg}`)
    assert.equal(r.compacta?.caixas.length ?? 0, 0, `a ${r.compacta?.linha} embarca caixas — outro caso`)
    assert.match(textoDa(r, 'racao_pronta'), /Silo de ração.*60°/i)
  })

  it('produção pequena fica na caixa de ração pronta', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 30 }))
    assert.match(textoDa(r, 'racao_pronta'), /Caixa de ração pronta/i)
  })

  it('quando a Compacta 03 já traz caixas, a tela usa as dela — sem medida concorrente', () => {
    // 200 t/mes em 6 dias x 4 h pede ~2.300 kg/h: acima de 2.000, logo 03.
    const r = calcularQuiz(bovinos({ expedicao: 'ensacada', modo: 'direto', toneladasMes: 200 }))
    assert.ok(r.compacta?.caixas.length, "deveria cair na 03: " + r.compacta?.codigo)
    assert.match(textoDa(r, 'racao_pronta'), new RegExp(`Já vêm com a ${r.compacta!.linha}`))
  })

  it('milho triturado não recebe misturador nem dosagem', () => {
    const r = calcularQuiz(bovinos({ especie: 'milho', categoria: 'granel', modo: 'direto', toneladasMes: 50 }))
    assert.equal(estacao(r, 'mistura'), undefined)
    assert.equal(estacao(r, 'dosagem'), undefined)
    assert.ok(estacao(r, 'moagem'))
  })

  it('o que depende do galpão sai marcado como a projetar, sem medida inventada', () => {
    const r = calcularQuiz(bovinos({ estoqueGrao: 'safra' }))
    const apoio = estacao(r, 'apoio')!
    assert.ok(apoio.itens.some(i => i.aProjetar && /helicoidais/i.test(i.nome)))
    assert.ok(estacao(r, 'armazenagem')!.itens.some(i => i.aProjetar && /Elevador/i.test(i.nome)))
  })

  it('painel elétrico acompanha a linha da Compacta escolhida', () => {
    const r = calcularQuiz(bovinos({ pesagemAutomatica: true }))
    assert.match(textoDa(r, 'apoio'), new RegExp(`Painel elétrico da linha ${r.compacta!.linha}`))
  })
})

describe('defeitos achados dirigindo a tela em 20/08/2026', () => {
  it('o silo NÃO promete guardar mais do que cabe nele', () => {
    // 120 t/mês de ração viram ~80 t de milho; a safra pede 6 meses disso. A
    // escada parava em 368 t e a tela dizia "368,25 t — atravessa a entressafra".
    // A asserção é contra o volume CALCULADO, nunca contra um número chapado:
    // a fração de milho muda com a fórmula da fase.
    const entrada = bovinos({ modo: 'direto', toneladasMes: 120, estoqueGrao: 'safra' })
    const r = calcularQuiz(entrada)
    const precisaTon = (r.dimensionamento.demandaMensalKg / 1000)
      * fracaoMilho(entrada.especie, entrada.categoria) * MESES_ENTRESSAFRA
    const silo = estacao(r, 'armazenagem')!.itens.find(i => /Silo de milho/.test(i.nome))!
    const cap = Number(/([\d.,]+) t/.exec(silo.nome)![1].replace(/\./g, '').replace(',', '.'))
    assert.ok(precisaTon > 368, `fixture fraca: ${precisaTon} t não exercita o degrau que quebrou`)
    assert.ok(cap * silo.quantidade >= precisaTon,
      `${silo.quantidade}× ${cap} t não guarda as ${precisaTon.toFixed(0)} t necessárias`)
  })

  it('acima do maior silo a tela conta as baterias, não finge que cabe em um', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 3000, estoqueGrao: 'safra', diasPorSemana: 6, horasPorDia: 8 }))
    const silo = estacao(r, 'armazenagem')!.itens.find(i => /Silo de milho/.test(i.nome))!
    assert.ok(silo.quantidade > 1, 'deveria pedir mais de um silo')
    assert.match(silo.porque, /não cabe em um silo só/i)
  })

  it('a moega segue o VEÍCULO que encosta, não o consumo do mês', () => {
    // Antes, 84 t/mês virava moega de 75 m³ (56 t) pra quem recebe carreta de 36.
    assert.equal(porteDeRecepcao(10).m3, 25)
    assert.equal(porteDeRecepcao(84).m3, 50)
    assert.equal(porteDeRecepcao(400).m3, 75)
  })

  it('a contagem de caixas não sai duplicada ("2×2 caixas")', () => {
    const r = calcularQuiz(bovinos({ expedicao: 'ensacada', modo: 'direto', toneladasMes: 200 }))
    const caixa = estacao(r, 'racao_pronta')!.itens[0]
    assert.ok(caixa.quantidade >= 2)
    // O nome NÃO pode carregar número de unidades — a tela já imprime o "N×".
    assert.doesNotMatch(caixa.nome, /^\d+\s+caixas/i, caixa.nome)
    assert.match(caixa.nome, /^Caixa de ração pronta/i)
  })
})

describe('coerência da tela: UM número manda na página inteira', () => {
  /**
   * O defeito que isto trava (achado em 20/08 revisando a lógica das perguntas):
   * conviviam DUAS escadas independentes — a do moinho e a do produto. Quando a
   * família de Compacta forçava um degrau acima, a mesma tela mostrava
   * "COMPACTA 03 — o degrau é 1.000 kg/h" no título, "300 kg/h" no bloco de
   * números e "Moinho BNMM130 (3 CV)" na Moagem. Três números discordando.
   */
  const casos = [10, 25, 40, 60, 120, 400, 900]

  it('a capacidade exibida é SEMPRE a da Compacta recomendada', () => {
    for (const t of casos) {
      for (const exp of ['granel', 'ensacada'] as const) {
        const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t, expedicao: exp }))
        if (!r.compacta) continue
        assert.equal(r.dimensionamento.capacidadeEscolhidaKgH, r.compacta.producaoKgH,
          `${t} t/mês ${exp}: tile diz ${r.dimensionamento.capacidadeEscolhidaKgH}, produto é ${r.compacta.producaoKgH}`)
      }
    }
  })

  it('o moinho listado dá conta da produção que o produto promete', () => {
    for (const t of casos) {
      const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t, expedicao: 'ensacada' }))
      const nome = estacao(r, 'moagem')!.itens[0].nome
      const kgh = Number(/— ([\d.]+) kg\/h/.exec(nome)![1].replace(/\./g, ''))
      assert.ok(kgh >= r.dimensionamento.capacidadeEscolhidaKgH,
        `${t} t/mês: moinho de ${kgh} kg/h abaixo dos ${r.dimensionamento.capacidadeEscolhidaKgH} prometidos`)
    }
  })

  it('o misturador da estação é o mesmo que o código da Compacta carrega', () => {
    for (const t of casos) {
      const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t }))
      if (!r.compacta) continue
      const nome = estacao(r, 'mistura')!.itens[0].nome
      // Tira o separador de milhar antes de comparar: a tela escreve
      // "Misturador vertical 1.000 kg" e o código carrega 1000.
      const semSeparador = nome.replace(/\./g, '')
      assert.ok(semSeparador.includes(String(r.compacta.misturadorKg)) || /L \(carga de/.test(nome),
        `${t} t/mês: ${nome} vs misturador ${r.compacta.misturadorKg} kg do ${r.compacta.codigo}`)
    }
  })

  it('as horas por dia batem com a capacidade exibida', () => {
    for (const t of casos) {
      const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t, expedicao: 'ensacada' }))
      const d = r.dimensionamento
      const esperado = d.producaoPorDiaKg / d.capacidadeEscolhidaKgH
      assert.ok(Math.abs(d.horasReaisPorDia - esperado) < 0.001,
        `${t} t/mês: diz ${d.horasReaisPorDia} h, a conta dá ${esperado}`)
    }
  })
})

describe('ensacar NÃO obriga a linha industrial', () => {
  /**
   * A ensacadeira de saco aberto é SKU avulso e a estação de Expedição já a
   * lista. Forçar a 03 (que começa em 1.000 kg/h) fazia um produtor de 25 t/mês
   * — que precisa de 240 kg/h — receber fábrica 4x maior por dizer que ensaca.
   */
  it('produtor pequeno que ensaca não é empurrado pra 03', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 25, expedicao: 'ensacada' }))
    assert.ok(!r.compacta!.linha.startsWith('03'),
      `25 t/mês virou ${r.compacta!.codigo}`)
    assert.ok(r.dimensionamento.capacidadeEscolhidaKgH <= 750,
      `entregou ${r.dimensionamento.capacidadeEscolhidaKgH} kg/h pra quem precisa de ~240`)
  })

  it('mas ele CONTINUA recebendo a ensacadeira', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 25, expedicao: 'ensacada' }))
    assert.match(textoDa(r, 'expedicao'), /Ensacadeira/i)
  })

  it('quem já é industrial ganha a 03 integrada', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 200, expedicao: 'ensacada' }))
    assert.ok(r.compacta!.linha.startsWith('03'), `200 t/mês virou ${r.compacta!.codigo}`)
    assert.ok(r.compacta!.caixas.length > 0)
  })

  it('a fábrica entregue nunca passa de 2x o que o produtor precisa', () => {
    // Superdimensionar mata o payback do Estudo ao lado. O degrau da escada
    // pode dar folga, mas dobrar já é outra fábrica.
    for (const t of [10, 25, 40, 60, 120, 200]) {
      for (const exp of ['granel', 'ensacada'] as const) {
        const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t, expedicao: exp }))
        const d = r.dimensionamento
        const sobra = d.capacidadeEscolhidaKgH / d.capacidadeAlvoKgH
        // O degrau mínimo (300 kg/h) sempre sobra pra quem é muito pequeno —
        // não existe fábrica menor pra vender.
        if (d.capacidadeEscolhidaKgH === 300) continue
        assert.ok(sobra <= 2, `${t} t/mês ${exp}: ${sobra.toFixed(1)}x o necessário (${r.compacta?.codigo})`)
      }
    }
  })
})

describe('alertas — o que a fábrica NÃO resolve', () => {
  it('avisa quando a fábrica ficaria ociosa', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 2, diasPorSemana: 6, horasPorDia: 8 }))
    assert.ok(r.alertas.some(a => /ociosa|Sobra máquina/i.test(a)), r.alertas.join(' / '))
  })

  it('moinho acima de 15 CV não roda em monofásico', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 200, energia: 'monofasico' }))
    assert.ok(r.alertas.some(a => /monofásico/i.test(a)), r.alertas.join(' / '))
  })

  it('grão de colheita própria precisa estar seco — a fábrica não seca', () => {
    const r = calcularQuiz(bovinos({ recebimento: 'propria' }))
    assert.ok(r.alertas.some(a => /seco|umidade/i.test(a)))
  })

  it('avisa quando o consumo por animal ainda é o de referência do catálogo', () => {
    const r = calcularQuiz(bovinos({ consumoPorAnimalMes: consumoDeReferencia('bovinos', 'confinamento') }))
    assert.ok(r.alertas.some(a => /referência/i.test(a)))
  })

  it('consumo confirmado pelo produtor não dispara o aviso de referência', () => {
    const r = calcularQuiz(bovinos({ consumoPorAnimalMes: 250 }))
    assert.ok(!r.alertas.some(a => /referência/i.test(a)))
  })

  it('acima da linha avisa que vira projeto, e não finge uma Compacta', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 3000, diasPorSemana: 1, horasPorDia: 4 }))
    assert.equal(r.compacta, null)
    assert.ok(r.alertas.some(a => /projeto sob medida/i.test(a)))
    assert.ok(r.estacoes.length > 0, 'mesmo sem Compacta a linha avulsa tem que sair')
  })
})

describe('validação', () => {
  it('quiz em branco lista o que falta, em português de gente', () => {
    const f = faltando(respostasIniciais())
    assert.ok(f.includes('o que você produz'))
    assert.ok(f.includes('como o milho chega na propriedade'))
    assert.ok(f.length >= 5)
  })

  it('quiz completo não lista pendência', () => {
    assert.deepEqual(faltando(bovinos()), [])
  })

  it('incompleto não devolve estação nenhuma — nada de meia recomendação', () => {
    const r = calcularQuiz({ ...bovinos(), recebimento: null })
    assert.equal(r.completo, false)
    assert.equal(r.estacoes.length, 0)
    assert.ok(r.faltando.length > 0)
  })

  it('pesagemAutomatica = false é resposta; null é pendência', () => {
    assert.ok(!faltando(bovinos({ pesagemAutomatica: false })).some(x => /pesagem/i.test(x)))
    assert.ok(faltando(bovinos({ pesagemAutomatica: null })).some(x => /pesagem/i.test(x)))
  })
})

describe('consumo por DIA — como o produtor fala', () => {
  /**
   * Ninguém diz "o boi come 297 kg por mês"; diz "come 10 kg por dia". O quiz
   * deixa escolher a unidade, mas guarda SEMPRE em kg/mês — a unidade viaja só
   * na tela. Se o valor guardado mudasse de base, motor, banco e painel do
   * vendedor teriam que adivinhar qual era, e errar aí muda a fábrica por 30.
   */
  it('a base nasce em DIA', () => {
    assert.equal(respostasIniciais().baseConsumo, 'dia')
  })

  it('converte nos dois sentidos usando o mês comercial de 30 dias', () => {
    assert.equal(DIAS_MES_COMERCIAL, 30)
    assert.equal(consumoParaMes(10, 'dia'), 300)
    assert.equal(consumoParaMes(300, 'mes'), 300)
    assert.equal(consumoNaBase(297, 'dia'), 9.9)
    assert.equal(consumoNaBase(297, 'mes'), 297)
  })

  it('o campo nunca mostra dízima — 3,4 kg/mês vira 0,113, não 0,11333333333333333', () => {
    // Dezessete dígitos num input é número que ninguém confere nem edita.
    for (const mes of [3.4, 0.9, 1.95, 297, 165]) {
      for (const base of ['dia', 'mes'] as const) {
        const v = String(consumoNaBase(mes, base))
        const casas = (v.split('.')[1] ?? '').length
        assert.ok(casas <= 3, `${mes} em ${base} saiu "${v}" (${casas} casas)`)
      }
    }
    assert.equal(consumoNaBase(3.4, 'dia'), 0.113)
  })

  it('a unidade natural: boi e porco em kg/dia, ave em kg/mês', () => {
    // Ave come em GRAMA — 0,113 kg/dia é certo e ilegível; 3,4 kg/mês ela
    // reconhece. Trocar continua a um clique.
    assert.equal(baseNaturalDe('bovinos'), 'dia')
    assert.equal(baseNaturalDe('suinos'), 'dia')
    assert.equal(baseNaturalDe('aves'), 'mes')
  })

  it('o que o produtor digita por dia dá a MESMA fábrica que o mês equivalente', () => {
    const porMes = calcularQuiz(bovinos({ modo: 'animais', numeroAnimais: 400, consumoPorAnimalMes: 300 }))
    const porDia = calcularQuiz(bovinos({
      modo: 'animais', numeroAnimais: 400,
      consumoPorAnimalMes: consumoParaMes(10, 'dia'), baseConsumo: 'dia',
    }))
    assert.equal(porDia.dimensionamento.demandaMensalKg, porMes.dimensionamento.demandaMensalKg)
    assert.equal(porDia.compacta?.codigo, porMes.compacta?.codigo)
  })

  it('base zero não estoura', () => {
    assert.equal(consumoNaBase(0, 'dia'), 0)
    assert.equal(consumoParaMes(0, 'dia'), 0)
  })
})

describe('consumo e fórmula de referência', () => {
  it('não existe corte único de cabeças: 200 bovinos ≠ 200 aves', () => {
    const boi = consumoDeReferencia('bovinos', 'confinamento') * 200
    const ave = consumoDeReferencia('aves', 'postura') * 200
    assert.ok(boi > ave * 50, `boi ${boi} kg/mês vs ave ${ave} kg/mês`)
  })

  it('fase desconhecida não quebra — devolve 0 e a etapa fica pendente', () => {
    assert.equal(consumoDeReferencia('bovinos', 'inexistente'), 0)
    assert.equal(consumoDeReferencia(null, 'confinamento'), 0)
  })

  it('milho triturado é 100% milho', () => {
    assert.equal(fracaoMilho('milho', 'granel'), 1)
  })

  it('a fração de milho fica entre 0 e 1 em toda espécie', () => {
    for (const e of ['bovinos', 'suinos', 'aves'] as const) {
      const f = fracaoMilho(e, 'confinamento')
      assert.ok(f > 0 && f <= 1, `${e} deu ${f}`)
    }
  })
})

describe('foto do modelo', () => {
  /**
   * A pasta do marketing tem DUAS versões de cada fábrica: uma com o preço
   * estampado e outra sem. Esta página é PÚBLICA — subir a errada publicaria a
   * tabela de preços da empresa. As imagens vieram de "Sem preço".
   */
  it('toda recomendação vem com foto', () => {
    for (const t of [8, 12, 25, 40, 60, 90, 120, 160, 200, 300]) {
      for (const exp of ['granel', 'ensacada'] as const) {
        const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: t, expedicao: exp }))
        if (!r.compacta) continue
        assert.ok(r.compacta.fotoUrl.startsWith('https://'), `${r.compacta.codigo} sem foto`)
      }
    }
  })

  it('usa resize=contain — o padrão do Supabase RECORTA a ficha', () => {
    // Sem isto o corte come o nome do modelo e metade dos equipamentos.
    const url = fotoDoModelo('02', 2000, 1000)
    assert.match(url, /resize=contain/)
    assert.match(url, /width=\d+/)
    assert.match(url, /quality=\d+/)
  })

  it('quem tem ficha própria usa a dela; quem não tem cai na foto da família', () => {
    assert.match(fotoDoModelo('02', 2000, 1000), /modelos\/02-2000-1000\.png/)
    // 4.000 kg/h com misturador de 1.000 não tem ficha própria no marketing.
    assert.match(fotoDoModelo('02 MASTER', 4000, 1000), /compacta-02\/foto-master\.jpg/)
  })

  it('a MINI aproveita as fichas da 01 — é assim que o marketing as nomeia', () => {
    // "Compacta 01 - JR - 300150" e "Compacta 01 - 750300" SÃO a Mini.
    assert.match(fotoDoModelo('MINI', 300, 150), /modelos\/01-300-150\.png/)
    assert.match(fotoDoModelo('MINI', 750, 300), /modelos\/01-750-300\.png/)
  })

  it('nunca aponta pra pasta com preço', () => {
    for (const [linha, p, m] of [['MINI',300,150],['01',1000,500],['02 MASTER',2500,1000],['03',5000,1000]] as const) {
      const url = fotoDoModelo(linha as string, p as number, m as number)
      assert.doesNotMatch(url, /preco/i, url)
    }
  })
})
