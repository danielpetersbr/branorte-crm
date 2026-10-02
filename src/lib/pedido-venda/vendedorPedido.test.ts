import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destinoAposCriarPedido, identificarVendedorPedido, vendedorPrincipalPedido } from './vendedorPedido'

test('vendedor vinculado cria em seu nome mesmo se o campo indicar outro colega', () => {
  const identidade = identificarVendedorPedido({
    role: 'vendor', vendorId: 'vendor-igor', nomeCadastro: ' igor ', carregando: false, erro: false,
  })
  assert.equal(identidade.fixo, true)
  assert.equal(identidade.bloqueado, false)
  assert.equal(vendedorPrincipalPedido(identidade, 'JARDEL'), 'IGOR')
})

test('sem vínculo o vendedor não consegue gerar pedido com um nome escolhido', () => {
  const identidade = identificarVendedorPedido({
    role: 'vendor', vendorId: null, nomeCadastro: 'DANIEL', carregando: false, erro: false,
  })
  assert.equal(identidade.nome, '')
  assert.equal(identidade.bloqueado, true)
  assert.throws(() => vendedorPrincipalPedido(identidade, 'DANIEL'))
})

test('carregamento e falha da consulta não liberam autoria antiga em cache', () => {
  for (const estado of [
    { carregando: true, erro: false },
    { carregando: false, erro: true },
  ]) {
    const identidade = identificarVendedorPedido({
      role: 'vendor', vendorId: 'vendor-igor', nomeCadastro: 'IGOR', ...estado,
    })
    assert.equal(identidade.nome, '')
    assert.throws(() => vendedorPrincipalPedido(identidade, 'IGOR'))
  }
})

test('vínculo sem nome cadastrado fecha a geração em vez de usar nome de exibição', () => {
  const identidade = identificarVendedorPedido({
    role: 'vendor', vendorId: 'vendor-inexistente', nomeCadastro: '  ', carregando: false, erro: false,
  })
  assert.equal(identidade.bloqueado, true)
  assert.throws(() => vendedorPrincipalPedido(identidade, 'DANIEL'))
})

test('demais papéis continuam escolhendo o responsável sem vínculo pessoal', () => {
  for (const role of ['admin', 'financeiro', 'marketing', 'mapa']) {
    const identidade = identificarVendedorPedido({
      role, vendorId: null, nomeCadastro: '', carregando: false, erro: false,
    })
    assert.equal(identidade.fixo, false)
    assert.equal(identidade.bloqueado, false)
    assert.equal(vendedorPrincipalPedido(identidade, 'JARDEL'), 'JARDEL')
    assert.throws(() => vendedorPrincipalPedido(identidade, '  '))
  }
})

test('pedido recém-criado pelo vendedor abre a fonte viva sem esperar o espelho', () => {
  assert.equal(destinoAposCriarPedido(true, '007b2c72-1234-5678-9012-000000000001'), '/controle/pedidos/007b2c72-1234-5678-9012-000000000001')
})

test('retorno dos demais papéis continua na listagem de pedidos', () => {
  assert.equal(destinoAposCriarPedido(false, '007b2c72-1234-5678-9012-000000000001'), '/controle/pedidos')
})

test('resposta sem ID não abre uma rota de pedido inválida', () => {
  for (const id of [undefined, null, '', '  ']) {
    assert.equal(destinoAposCriarPedido(true, id), '/controle/pedidos')
  }
})
