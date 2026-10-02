import test from 'node:test'
import assert from 'node:assert/strict'
import { isNavigationItemActive } from './navigation-active'

test('only the current guide mode is selected', () => {
  const destinations = [
    '/guia?modo=atendimento',
    '/guia?modo=animais',
    '/guia?modo=materias',
  ]
  for (const [search, expected] of [
    ['?modo=atendimento', '/guia?modo=atendimento'],
    ['?modo=animais', '/guia?modo=animais'],
    ['?modo=materias', '/guia?modo=materias'],
  ]) {
    assert.deepEqual(
      destinations.filter(to => isNavigationItemActive(to, '/guia', search)),
      [expected],
    )
  }
})

test('guide links require their destination query but accept unrelated parameters', () => {
  assert.equal(isNavigationItemActive('/guia?modo=animais', '/guia', ''), false)
  assert.equal(isNavigationItemActive('/guia?modo=animais', '/guia', '?modo=materias'), false)
  assert.equal(isNavigationItemActive('/guia?modo=animais', '/guia', '?time=campo&modo=animais'), true)
  assert.equal(isNavigationItemActive('/guia?modo=animais&origem=menu', '/guia', '?modo=animais'), false)
  assert.equal(isNavigationItemActive('/guia?modo=animais&origem=menu', '/guia', '?extra=1&origem=menu&modo=animais'), true)
})

test('query parameters cannot activate a different pathname', () => {
  assert.equal(isNavigationItemActive('/guia?modo=animais', '/venda-racao', '?modo=animais'), false)
  assert.equal(isNavigationItemActive('/guia?modo=animais', '/guia-outra', '?modo=animais'), false)
})

test('the home link with end only selects the root path', () => {
  assert.equal(isNavigationItemActive('/', '/', '', true), true)
  assert.equal(isNavigationItemActive('/', '/', '?tab=geral', true), true)
  assert.equal(isNavigationItemActive('/', '/atendimentos', '', true), false)
})

test('path prefixes stop at a slash boundary', () => {
  assert.equal(isNavigationItemActive('/orcamentos/contrato', '/orcamentos/contrato', ''), true)
  assert.equal(isNavigationItemActive('/orcamentos/contrato', '/orcamentos/contrato/novo', ''), true)
  assert.equal(isNavigationItemActive('/orcamentos/contrato', '/orcamentos/contratos', ''), false)
  assert.equal(isNavigationItemActive('/orcamentos/contrato', '/orcamentos/contratos/123', ''), false)
})

test('the sales overview with end does not select its child screens', () => {
  assert.equal(isNavigationItemActive('/controle', '/controle', '?periodo=mes', true), true)
  assert.equal(isNavigationItemActive('/controle', '/controle/vendas', '', true), false)
  assert.equal(isNavigationItemActive('/controle', '/controle/pedidos/123', '', true), false)
})

test('routing parent selection follows the end setting', () => {
  assert.equal(isNavigationItemActive('/disparos', '/disparos/links', ''), true)
  assert.equal(isNavigationItemActive('/disparos', '/disparos/links', '', true), false)
  assert.equal(isNavigationItemActive('/disparos', '/disparos', '', true), true)
  assert.equal(isNavigationItemActive('/disparos', '/disparos-antigos', ''), false)
})

test('links without query parameters remain active with a search query', () => {
  assert.equal(isNavigationItemActive('/relatorio-lider', '/relatorio-lider', '?time=caca-lead'), true)
})
