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

import { COMPACTAS, MOINHOS, degrau, ehMaster, temCacamba, temEnsacadeira } from './linha'
import {
  BATELADAS_POR_HORA, FOLGA_OPERACIONAL_PCT, MESES_ENTRESSAFRA,
  calcularDimensionamento, calcularQuiz,
  consumoDeReferencia, escolherCompacta, faltando, familiaCompacta, fracaoMilho,
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
      // Tira o prefixo do nome e o sufixo de caixas ("- 4000/4000") da 03.
      const bruto = c.codigo.replace(/^COMPACTA \S+( MASTER)? - /, '').split(' - ')[0]
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
  it('quem ensaca cai na 03 — é a única linha com ensacadeira', () => {
    assert.equal(familiaCompacta(bovinos({ expedicao: 'ensacada' })), '03')
    assert.equal(familiaCompacta(bovinos({ expedicao: 'ambos' })), '03')
  })

  it('pesagem automática sobe pra 02; sem ela, fica na 01', () => {
    assert.equal(familiaCompacta(bovinos({ expedicao: 'granel', pesagemAutomatica: true })), '02')
    assert.equal(familiaCompacta(bovinos({ expedicao: 'granel', pesagemAutomatica: false })), '01')
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

  it('sobe pra MASTER quando a linha pedida não chega na produção', () => {
    // 01 vertical para em 2.000 kg/h; 01 MASTER vai até 3.000. 220 t/mês em
    // 6 dias × 4 h pede ~2.540 kg/h: cai exatamente nessa faixa.
    const r = bovinos({ expedicao: 'granel', pesagemAutomatica: false, modo: 'direto', toneladasMes: 220, diasPorSemana: 6, horasPorDia: 4 })
    const d = calcularDimensionamento(r)
    assert.ok(d.capacidadeAlvoKgH > 2000 && d.capacidadeAlvoKgH <= 3000, `alvo deu ${d.capacidadeAlvoKgH}`)
    const c = escolherCompacta(r, d)!
    assert.equal(c.linha, '01 MASTER')
    assert.match(c.porque, /horizontal/i)
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
      'recebimento', 'prelimpeza', 'armazenagem', 'moagem',
      'dosagem', 'mistura', 'racao_pronta', 'expedicao',
    ])
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

  it('grão ensacado não leva pré-limpeza — já veio limpo do armazém', () => {
    const r = calcularQuiz(bovinos({ recebimento: 'ensacado' }))
    assert.equal(estacao(r, 'prelimpeza'), undefined)
    assert.match(textoDa(r, 'recebimento'), /big bag/i)
  })

  it('grão a granel leva moega e pré-limpeza', () => {
    const r = calcularQuiz(bovinos({ recebimento: 'granel' }))
    assert.match(textoDa(r, 'recebimento'), /moega/i)
    assert.ok(estacao(r, 'prelimpeza'))
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
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 400, diasPorSemana: 6, horasPorDia: 8 }))
    assert.ok(r.dimensionamento.producaoPorDiaKg > 6000)
    assert.match(textoDa(r, 'racao_pronta'), /Silo de ração.*60°/i)
  })

  it('produção pequena fica na caixa de ração pronta', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 30 }))
    assert.match(textoDa(r, 'racao_pronta'), /Caixa de ração pronta/i)
  })

  it('quando a Compacta 03 já traz caixas, a tela usa as dela — sem medida concorrente', () => {
    const r = calcularQuiz(bovinos({ expedicao: 'ensacada', modo: 'direto', toneladasMes: 120 }))
    assert.ok(r.compacta?.caixas.length)
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

  it('a pré-limpeza acompanha a DESCARGA, não a moagem', () => {
    // Fábrica de 1.500 kg/h (1,5 t/h) com moega de carreta: pré-limpeza de
    // 3 t/h levava 12 h pra limpar uma carga. Tem que subir pra 7 t/h.
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 120, recebimento: 'granel' }))
    const pl = estacao(r, 'prelimpeza')!.itens[0]
    const tonH = Number(/([\d,]+) t\/h/.exec(pl.nome)![1].replace(',', '.'))
    assert.ok(tonH >= 7, `pré-limpeza de ${tonH} t/h é gargalo na descarga`)
  })

  it('a pré-limpeza nunca fica ABAIXO do que o moinho consome', () => {
    const r = calcularQuiz(bovinos({ modo: 'direto', toneladasMes: 900, diasPorSemana: 6, horasPorDia: 8 }))
    const tonH = Number(/([\d,]+) t\/h/.exec(estacao(r, 'prelimpeza')!.itens[0].nome)![1].replace(',', '.'))
    assert.ok(tonH * 1000 >= r.dimensionamento.capacidadeEscolhidaKgH,
      `${tonH} t/h abaixo do moinho de ${r.dimensionamento.capacidadeEscolhidaKgH} kg/h`)
  })

  it('a contagem de caixas não sai duplicada ("2×2 caixas")', () => {
    const r = calcularQuiz(bovinos({ expedicao: 'ensacada', modo: 'direto', toneladasMes: 120 }))
    const caixa = estacao(r, 'racao_pronta')!.itens[0]
    assert.ok(caixa.quantidade >= 2)
    // O nome NÃO pode carregar número de unidades — a tela já imprime o "N×".
    assert.doesNotMatch(caixa.nome, /^\d+\s+caixas/i, caixa.nome)
    assert.match(caixa.nome, /^Caixa de ração pronta/i)
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
