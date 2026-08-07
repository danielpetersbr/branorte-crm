import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GRUPO_COR_UF, corDoEstado, faixaIdade4, corDaFaixa4, rotuloFaixa4, FAIXAS_IDADE4,
} from './mapa-modos'

// Vizinhança real dos estados. É a prova de que a coloração serve para um MAPA:
// o que precisa contrastar é estado que encosta em estado.
const VIZINHOS: Record<string, string[]> = {
  AC: ['AM', 'RO'], AL: ['PE', 'SE', 'BA'], AP: ['PA'], AM: ['AC', 'RO', 'MT', 'PA', 'RR'],
  BA: ['AL', 'SE', 'PE', 'PI', 'TO', 'GO', 'MG', 'ES'], CE: ['PI', 'PE', 'PB', 'RN'],
  DF: ['GO', 'MG'], ES: ['BA', 'MG', 'RJ'], GO: ['DF', 'MT', 'MS', 'MG', 'BA', 'TO'],
  MA: ['PA', 'TO', 'PI'], MT: ['AM', 'PA', 'TO', 'GO', 'MS', 'RO'],
  MS: ['MT', 'GO', 'MG', 'SP', 'PR'], MG: ['BA', 'ES', 'RJ', 'SP', 'MS', 'GO', 'DF'],
  PA: ['AP', 'AM', 'RR', 'MT', 'TO', 'MA'], PB: ['RN', 'CE', 'PE'], PR: ['MS', 'SP', 'SC'],
  PE: ['AL', 'BA', 'PI', 'CE', 'PB'], PI: ['MA', 'TO', 'BA', 'PE', 'CE'],
  RJ: ['ES', 'MG', 'SP'], RN: ['CE', 'PB'], RS: ['SC'], RO: ['AC', 'AM', 'MT'],
  RR: ['AM', 'PA'], SC: ['PR', 'RS'], SP: ['MG', 'RJ', 'MS', 'PR'], SE: ['AL', 'BA'],
  TO: ['PA', 'MA', 'PI', 'BA', 'GO', 'MT'],
}

test('as 27 UFs têm grupo de cor', () => {
  assert.equal(Object.keys(GRUPO_COR_UF).length, 27)
  for (const uf of Object.keys(VIZINHOS)) {
    assert.notEqual(GRUPO_COR_UF[uf], undefined, `${uf} sem grupo`)
  }
})

test('NENHUM estado vizinho divide cor — é o que faz a coloração servir num mapa', () => {
  const colisoes: string[] = []
  for (const [uf, vs] of Object.entries(VIZINHOS)) {
    for (const v of vs) {
      if (corDoEstado(uf, false) === corDoEstado(v, false)) colisoes.push(`${uf}-${v}`)
      if (corDoEstado(uf, true) === corDoEstado(v, true)) colisoes.push(`${uf}-${v} (escuro)`)
    }
  }
  assert.deepEqual(colisoes, [])
})

test('a vizinhança de teste é simétrica (senão o teste acima passa por engano)', () => {
  for (const [uf, vs] of Object.entries(VIZINHOS)) {
    for (const v of vs) {
      assert.ok(VIZINHOS[v]?.includes(uf), `${v} não lista ${uf} de volta`)
    }
  }
})

test('usa 4 cores, não 27 — acima de ~8 hues o olho não separa', () => {
  const distintas = new Set(Object.keys(GRUPO_COR_UF).map(u => corDoEstado(u, false)))
  assert.equal(distintas.size, 4)
})

test('UF desconhecida fica cinza — ausência de dado não ganha cor de dado', () => {
  const cinza = corDoEstado(null, false)
  assert.equal(corDoEstado('', false), cinza)
  assert.equal(corDoEstado('XX', false), cinza)
  assert.notEqual(corDoEstado('SP', false), cinza)
})

test('UF aceita minúscula e espaço', () => {
  assert.equal(corDoEstado(' sp ', false), corDoEstado('SP', false))
})

test('claro e escuro são steps do MESMO hue — o estado não troca de cor ao virar o tema', () => {
  // grupos iguais continuam iguais, grupos diferentes continuam diferentes
  for (const a of Object.keys(GRUPO_COR_UF)) {
    for (const b of Object.keys(GRUPO_COR_UF)) {
      const mesmoClaro = corDoEstado(a, false) === corDoEstado(b, false)
      const mesmoEscuro = corDoEstado(a, true) === corDoEstado(b, true)
      assert.equal(mesmoClaro, mesmoEscuro, `${a} vs ${b} muda de agrupamento entre temas`)
    }
  }
})

test('faixaIdade4: fronteiras 30 / 90 / 365', () => {
  assert.equal(faixaIdade4(0), 'ate1mes')
  assert.equal(faixaIdade4(30), 'ate1mes')
  assert.equal(faixaIdade4(31), 'ate3meses')
  assert.equal(faixaIdade4(90), 'ate3meses')
  assert.equal(faixaIdade4(91), 'ate1ano')
  assert.equal(faixaIdade4(365), 'ate1ano')
  assert.equal(faixaIdade4(366), 'mais1ano')
  assert.equal(faixaIdade4(5000), 'mais1ano')
})

test('faixaIdade4: sem data é faixa própria', () => {
  assert.equal(faixaIdade4(null), 'sem-data')
  assert.notEqual(faixaIdade4(null), faixaIdade4(5000))
})

test('as 4 faixas de idade têm cores distintas nos dois temas', () => {
  for (const escuro of [false, true]) {
    const cores = FAIXAS_IDADE4.map(f => corDaFaixa4(f.id, escuro))
    assert.equal(new Set(cores).size, 4, `cores repetidas no tema ${escuro ? 'escuro' : 'claro'}`)
  }
})

test('rotuloFaixa4 devolve o texto da legenda', () => {
  assert.equal(rotuloFaixa4('ate1mes'), 'Até 1 mês')
  assert.equal(rotuloFaixa4('ate1ano'), '3 meses a 1 ano')
  assert.equal(rotuloFaixa4('mais1ano'), 'Mais de 1 ano')
  assert.equal(rotuloFaixa4('sem-data'), 'Sem data')
})
