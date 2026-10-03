import test from 'node:test'
import assert from 'node:assert/strict'
import { reconciliarRascunhoPermissoes, matrizesPermissoesIguais } from './admin-permissoes-draft'

const roles = ['admin', 'vendor']
const keys = ['menu.a', 'menu.b']
const original = { admin: { 'menu.a': true }, vendor: { 'menu.a': false } }

test('hidrata a matriz inicial sem manter referência ao resultado da query', () => {
  const state = reconciliarRascunhoPermissoes({ base: null, draft: {} }, original, roles, keys)
  assert.deepEqual(state.base, original)
  assert.deepEqual(state.draft, original)
  assert.notEqual(state.draft.admin, original.admin)
})

test('refetch preserva alterações locais em vez de sobrescrever o formulário', () => {
  const state = { base: original, draft: { ...original, vendor: { 'menu.a': true } } }
  const result = reconciliarRascunhoPermissoes(state, { ...original, admin: { 'menu.a': false } }, roles, keys)
  assert.equal(result, state)
  assert.equal(result.draft.vendor['menu.a'], true)
})

test('formulário sem edição acompanha novas permissões do servidor', () => {
  const next = { ...original, vendor: { 'menu.a': true } }
  const result = reconciliarRascunhoPermissoes({ base: original, draft: original }, next, roles, keys)
  assert.deepEqual(result.base, next)
  assert.deepEqual(result.draft, next)
})

test('comparação inclui chaves fora do catálogo e trata falso ausente como desmarcado', () => {
  assert.equal(matrizesPermissoesIguais(original, { ...original, vendor: { 'menu.a': false, 'menu.b': false } }, roles, keys), true)
  assert.equal(matrizesPermissoesIguais(original, { ...original, vendor: { 'acao.extra': true } }, roles, keys), false)
})

test('após salvar a base passa ao snapshot salvo e a query pode atualizar o draft', () => {
  const saved = { ...original, vendor: { 'menu.a': true } }
  const received = { ...saved, vendor: { 'menu.a': true, 'menu.b': false } }
  const result = reconciliarRascunhoPermissoes({ base: saved, draft: saved }, received, roles, keys)
  assert.deepEqual(result.draft, received)
})
