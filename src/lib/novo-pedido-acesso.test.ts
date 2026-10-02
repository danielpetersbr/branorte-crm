import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissaoNovoPedido, rotaPedidosVendedorPermitida } from './novo-pedido-acesso'

test('vendedor pode criar pedidos com a permissão própria sem acessar o controle geral', () => {
  assert.equal(permissaoNovoPedido({ 'menu.novo_pedido': true, 'menu.controle': false }), true)
})

test('revogar pedidos fecha o acesso mesmo para quem tem controle geral', () => {
  assert.equal(permissaoNovoPedido({ 'menu.novo_pedido': false, 'menu.controle': true }), false)
  assert.equal(permissaoNovoPedido({ 'menu.novo_pedido': 'true', 'menu.controle': true }), false)
})

test('perfis antigos preservam sua permissão de criação', () => {
  assert.equal(permissaoNovoPedido({ 'menu.controle': true }), true)
  assert.equal(permissaoNovoPedido({ 'menu.controle': false }), false)
  assert.equal(permissaoNovoPedido({}), false)
})

test('criação completa, acessórios, simples e garantia chegam à lista e ao detalhe', () => {
  for (const path of ['/controle/novo-pedido', '/controle/novo-pedido/', '/controle/pedido-simples', '/controle/pedido-garantia', '/controle/pedidos', '/controle/pedidos/00ee409d-a25a-4c73-bf52-cb66917e43fd']) {
    assert.equal(rotaPedidosVendedorPermitida(path, true), true, path)
    assert.equal(rotaPedidosVendedorPermitida(path, false), false, path)
  }
})

test('a liberação não abre edição, cadastro legado, painéis nem outras rotas de controle', () => {
  for (const path of ['/controle', '/controle/vendas', '/controle/financeiro', '/controle/novo-pedido-rapido', '/controle/novo-pedido/outro', '/controle/pedidos/editar/00ee409d-a25a-4c73-bf52-cb66917e43fd', '/controle/pedidos/exportar', '/controle/pedidos/00ee409d-a25a-4c73-bf52-cb66917e43fd/editar']) {
    assert.equal(rotaPedidosVendedorPermitida(path, true), false, path)
  }
})
