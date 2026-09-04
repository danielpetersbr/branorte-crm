// Recorte por vendedor na tela de DETALHE (/controle/pedidos/<id>).
//
// Os casos saem do banco real: os 9 usuários role='vendor' têm display_name
// DIFERENTE do nome do vendedor ("Igor Zanelato" vs "IGOR", "Pedro Dela Giustina "
// com espaço no fim vs "PEDRO"). Casar por display_name daria falso negativo e
// tiraria o vendedor dos próprios pedidos — por isso o nome vem de
// vendor_id -> vendors.name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverEscopo, pedidoNoEscopo, escopoPodeConsultar } from './escopo-pedidos'

const semCarregar = { nomeCarregando: false }

test('admin vê pedido de qualquer vendedor', () => {
  const e = resolverEscopo({ role: 'admin', nomeVendedor: '', ...semCarregar })
  assert.equal(e.tipo, 'tudo')
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, e), true)
})

test('financeiro também vê tudo (espelha PAPEIS_GESTORES do servidor)', () => {
  const e = resolverEscopo({ role: 'financeiro', nomeVendedor: '', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, e), true)
})

test('vendedor vê o pedido em que é o vendedor', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: 'IGOR', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'IGOR', vendedor_2: null }, e), true)
})

test('vendedor NAO ve o pedido do colega', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: 'IGOR', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, e), false)
})

test('venda dividida: vendedor_2 tambem e dono', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: 'GUSTAVO', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: 'GUSTAVO' }, e), true)
})

test('comparacao ignora caixa e espaco nas pontas', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: 'PEDRO', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: '  pedro ', vendedor_2: null }, e), true)
})

test('vendedor_2 vazio nao casa com nome vazio (nao vira curinga)', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: 'IGOR', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: '' }, e), false)
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, e), false)
})

test('CARREGANDO nao libera nada e nao deixa consultar', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: '', nomeCarregando: true })
  assert.equal(e.tipo, 'carregando')
  assert.equal(escopoPodeConsultar(e), false)
  assert.equal(pedidoNoEscopo({ vendedor: 'IGOR', vendedor_2: null }, e), false)
})

test('sem nome resolvido (falha ao ler vendors) NEGA — fail-closed', () => {
  const e = resolverEscopo({ role: 'vendor', nomeVendedor: '', ...semCarregar })
  assert.equal(e.tipo, 'sem-escopo')
  assert.equal(pedidoNoEscopo({ vendedor: 'IGOR', vendedor_2: null }, e), false)
})

test('sessao sem papel NEGA', () => {
  const e = resolverEscopo({ role: null, nomeVendedor: 'IGOR', ...semCarregar })
  assert.equal(e.tipo, 'sem-escopo')
  assert.equal(pedidoNoEscopo({ vendedor: 'IGOR', vendedor_2: null }, e), false)
})

test('papel restrito com nome apontado ve so o dele (caso PATRICK, role=mapa)', () => {
  const e = resolverEscopo({ role: 'mapa', nomeVendedor: 'PATRICK', ...semCarregar })
  assert.equal(pedidoNoEscopo({ vendedor: 'PATRICK', vendedor_2: null }, e), true)
  assert.equal(pedidoNoEscopo({ vendedor: 'JARDEL', vendedor_2: null }, e), false)
})
