import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarSpecsParaSalvar } from './catalogo-specs-salvar'
import { atributosParaSpecs, parseSpecsParaAtributos } from './categoria-atributos'

// Specs REAIS do banco (catalogo_items, lidas em 29/09/2026).
const ITEM_34 = [ // TRITURADOR DE GRÃOS 50 CV
  'Construído em aço galvanizado',
  'Capacidade 5.000 kg/h (na densidade do milho e peneira 3,0mm)',
  'Acoplamento elástico',
  'Montado com peneira 3,0mm',
  'Equipamento fabricado com 36 martelos',
  'Acionamento: potência 50,0 CV. (motor não incluso)',
]
const ITEM_12 = [ // TRITURADOR DE GRÃOS 7,5 CV
  'Construída em aço galvanizado',
  'Capacidade 0,75 ton./h (pen 3,0mm) (milho com uma densidade 750 kg/m³)',
  'Acoplamento elástico',
  'Equipamento com 16 martelos',
  'Montado com peneira 3,0mm',
  'Acionamento: potência 7,5 CV. (motor não incluso)',
]
const ITEM_464 = [ // TRITURADOR DE GRÃOS 100 CV (já regravado pelo modal antigo)
  'Tipo: Martelo',
  'Capacidade: 10000 kg/h',
  'Peneira: 3 mm',
  'Quantidade de martelos: 64',
  'Funil dosador: 45 Lts',
  'Construído em aço galvanizado',
  'Equipamento Fabricado Com 64 Martelos',
]

/** O que o modal tem em mãos logo depois de abrir o item. */
function abrir(specs: string[], categoria = 'MOINHO') {
  const p = parseSpecsParaAtributos(specs, categoria)
  return { atributos: { ...p.atributos }, livres: [...p.specsLivres], carregado: { categoria, specs } }
}

test('abrir e salvar sem mexer devolve as specs do banco intactas (texto e ordem)', () => {
  for (const specs of [ITEM_34, ITEM_12, ITEM_464]) {
    const { atributos, livres, carregado } = abrir(specs)
    assert.deepEqual(montarSpecsParaSalvar(atributos, livres, 'MOINHO', carregado), specs)
  }
})

test('item 12: a ida-e-volta antiga trocava 0,75 ton/h por "0.75 kg/h" — não troca mais', () => {
  const { atributos, livres, carregado } = abrir(ITEM_12)
  // o comportamento antigo, para registrar o que o teste protege:
  assert.ok(atributosParaSpecs(atributos, livres, 'MOINHO').includes('Capacidade: 0.75 kg/h'))
  // editar só uma linha livre ainda preserva a linha da capacidade como estava
  const livresEditadas = livres.map(s => (s === 'Acoplamento elástico' ? 'Acoplamento elástico reforçado' : s))
  const out = montarSpecsParaSalvar(atributos, livresEditadas, 'MOINHO', carregado)
  assert.ok(out.includes('Capacidade 0,75 ton./h (pen 3,0mm) (milho com uma densidade 750 kg/m³)'))
  assert.ok(!out.some(s => s.includes('0.75 kg/h')))
  assert.ok(out.includes('Acoplamento elástico reforçado'))
})

test('item 464: "Tipo: Martelo" (o parse não reconhece) volta uma vez só, como linha livre', () => {
  const { atributos, livres, carregado } = abrir(ITEM_464)
  const out = montarSpecsParaSalvar(atributos, [...livres, 'Filtro De Manga'], 'MOINHO', carregado)
  assert.equal(out.filter(s => s === 'Tipo: Martelo').length, 1)
  assert.ok(out.includes('Filtro De Manga'))
})

test('o que o admin mudou é regravado no formato estruturado; o resto fica como estava', () => {
  const { atributos, livres, carregado } = abrir(ITEM_464)
  const out = montarSpecsParaSalvar({ ...atributos, capacidade_kgh: '12000' }, livres, 'MOINHO', carregado)
  assert.ok(out.includes('Capacidade: 12000 kg/h'))
  assert.ok(!out.includes('Capacidade: 10000 kg/h'))
  assert.ok(out.includes('Quantidade de martelos: 64'))
})

test('atributo novo preenchido entra; atributo apagado sai', () => {
  const { atributos, livres, carregado } = abrir(ITEM_34)
  const comMartelos = montarSpecsParaSalvar({ ...atributos, martelos_qtd: '36' }, livres, 'MOINHO', carregado)
  assert.ok(comMartelos.includes('Quantidade de martelos: 36'))
  const semCapacidade = montarSpecsParaSalvar({ ...atributos, capacidade_kgh: '' }, livres, 'MOINHO', carregado)
  assert.ok(!semCapacidade.some(s => s.startsWith('Capacidade')))
})

test('modo criar (sem item carregado) e categoria trocada seguem o atributosParaSpecs', () => {
  const atributos = { capacidade_kgh: '1000', peneira_mm: '3' }
  const livres = ['Construída em aço galvanizado', '  ']
  assert.deepEqual(
    montarSpecsParaSalvar(atributos, livres, 'MOINHO', null),
    atributosParaSpecs(atributos, ['Construída em aço galvanizado'], 'MOINHO'),
  )
  const { atributos: a34, livres: l34, carregado } = abrir(ITEM_34)
  assert.deepEqual(
    montarSpecsParaSalvar(a34, l34, 'ACESSORIO', carregado),
    atributosParaSpecs(a34, l34, 'ACESSORIO'),
  )
})

test('espaço a mais digitado na categoria não derruba as linhas estruturadas', () => {
  const { atributos, livres, carregado } = abrir(ITEM_464)
  const out = montarSpecsParaSalvar({ ...atributos, capacidade_kgh: '12000' }, livres, 'MOINHO ', carregado)
  assert.ok(out.includes('Capacidade: 12000 kg/h'))
  assert.ok(out.includes('Peneira: 3 mm'))
})

test('linha livre em branco deixada no formulário não conta como mudança', () => {
  const { atributos, livres, carregado } = abrir(ITEM_34)
  assert.deepEqual(montarSpecsParaSalvar(atributos, [...livres, '   '], 'MOINHO', carregado), ITEM_34)
})
