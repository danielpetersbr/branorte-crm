import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erroDefinirDono } from './definir-dono'

test('erroDefinirDono: ok=true não é erro', () => {
  assert.equal(erroDefinirDono({ ok: true, vendedor: 'GUSTAVO' }), null)
})

test('erroDefinirDono: cada recusa da RPC vira frase, não some calada', () => {
  assert.equal(erroDefinirDono({ ok: false, erro: 'so_admin' }), 'só administrador pode dar dono')
  assert.equal(erroDefinirDono({ ok: false, erro: 'vendedor_invalido' }), 'esse vendedor não está ativo')
  assert.equal(erroDefinirDono({ ok: false, erro: 'contato_inexistente' }), 'o contato não existe mais')
  assert.match(erroDefinirDono({ ok: false, erro: 'reservado_por_outro_vendedor' }) ?? '', /reservado/)
})

test('erroDefinirDono: ja_tem_dono diz QUEM é o dono', () => {
  assert.equal(erroDefinirDono({ ok: false, erro: 'ja_tem_dono', vendedor: 'ANDRE' }), 'o contato já tem dono: ANDRE')
  assert.equal(erroDefinirDono({ ok: false, erro: 'ja_tem_dono', vendedor: null }), 'o contato já tem dono')
})

test('erroDefinirDono: código novo ou resposta vazia também é falha', () => {
  assert.equal(erroDefinirDono({ ok: false, erro: 'codigo_novo' }), 'recusado (codigo_novo)')
  assert.equal(erroDefinirDono({ ok: false }), 'a resposta do banco veio vazia')
  assert.equal(erroDefinirDono(null), 'a resposta do banco veio vazia')
  assert.equal(erroDefinirDono(undefined), 'a resposta do banco veio vazia')
})
