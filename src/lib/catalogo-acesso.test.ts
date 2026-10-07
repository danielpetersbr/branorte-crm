import test from 'node:test'
import assert from 'node:assert/strict'
import { permissaoCatalogo, rotaCatalogo } from './catalogo-acesso'

test('somente vendedor com liberação individual recebe acesso ao catálogo', () => {
  assert.equal(permissaoCatalogo(true, true, false, true), true)
  assert.equal(permissaoCatalogo(true, true, false), false)
  assert.equal(permissaoCatalogo(true, true, false, false), false)
})

test('preserva acesso existente e aguarda validação antes de autorizar', () => {
  assert.equal(permissaoCatalogo(true, true, true), true)
  assert.equal(permissaoCatalogo(false, true, true, true), false)
  assert.equal(permissaoCatalogo(true, false, true, true), false)
  assert.equal(permissaoCatalogo(true, true, true, false), false)
})

test('liberação do catálogo não libera motores, preços nem outras rotas', () => {
  assert.equal(rotaCatalogo('/orcamentos/catalogo-admin'), true)
  assert.equal(rotaCatalogo('/orcamentos/catalogo-admin/'), true)
  assert.equal(rotaCatalogo('/ORCAMENTOS/CATALOGO-ADMIN'), true)
  assert.equal(rotaCatalogo('/orcamentos/%63atalogo-admin'), true)
  assert.equal(rotaCatalogo('/orcamentos/catalogo%2Dadmin'), true)
  assert.equal(rotaCatalogo('/orcamentos/%ZZ'), false)
  for (const path of ['/orcamentos/precos', '/orcamentos/motores', '/orcamentos/catalogo-admin-extra']) assert.equal(rotaCatalogo(path), false)
})
