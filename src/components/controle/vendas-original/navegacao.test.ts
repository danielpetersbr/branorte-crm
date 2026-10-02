import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as ts from 'typescript'
import * as politica from './navegacao'

const app = ts.createSourceFile('App.tsx', readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pagina = ts.createSourceFile('ControleVendasOriginal.tsx', readFileSync(new URL('../../../pages/controle/ControleVendasOriginal.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const nodes: ts.Node[] = []
const coletar = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, coletar) }
coletar(app)
const variavel = (nome: string) => nodes.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(app) === nome))!.getText(app)
const condicional = (inicio: string) => nodes.find(node => ts.isIfStatement(node) && node.expression.getText(app).startsWith(inicio))!.getText(app)

/** Executa os mesmos blocos de rota do App; todas as permissões retornam true. */
function guardReal(papel: 'vendor' | 'mapa', rota: string) {
  const fonte = [variavel('freteLiberado'), variavel('VENDOR_PREFIXES'), condicional("profile.role === 'vendor'"), variavel('ROTAS_RESTRITAS'), variavel('rotasDoPapel'), condicional('rotasDoPapel &&')].join('\n')
  const js = ts.transpileModule(fonte, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText
  return new Function('profile', 'loc', 'can', 'fabricaPermitida', 'React', 'Navigate', `${js}; return 'permitida';`)(
    { role: papel }, { pathname: rota }, () => true, false,
    { createElement: (_tipo: unknown, props: { to: string }) => ({ redireciona: props.to }) }, 'Navigate',
  )
}

function callbackPagina(tag: string, conteudo: string) {
  let expressao = ''
  const visitar = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(pagina) === tag && node.getText(pagina).includes(conteudo)) {
      const atributo = node.openingElement.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(pagina) === 'onClick')
      if (atributo && ts.isJsxAttribute(atributo) && atributo.initializer && ts.isJsxExpression(atributo.initializer)) expressao = atributo.initializer.expression!.getText(pagina)
    }
    ts.forEachChild(node, visitar)
  }
  visitar(pagina)
  assert.ok(expressao, `callback ${tag} encontrado na página real`)
  return new Function('pedido', 'navigate', 'podeAbrirPedidos', 'setExpansaoListagem', 'contextoListagem', `return (${expressao});`)
}

test('vendor e mapa têm Vendas mas não Pedidos mesmo com todas as permissões true', () => {
  for (const papel of ['vendor', 'mapa'] as const) {
    assert.equal(guardReal(papel, '/controle/vendas'), 'permitida')
    assert.notEqual(guardReal(papel, '/controle/pedidos'), 'permitida')
    assert.notEqual(guardReal(papel, '/controle/pedidos/pedido-sintetico'), 'permitida')
    assert.equal(politica.podeNavegarPedidosVendas(papel, true), false)
  }
})

test('links exigem papel compatível com Controle e permissão própria', () => {
  for (const papel of ['admin', 'financeiro', 'marketing']) {
    assert.equal(politica.podeNavegarPedidosVendas(papel, true), true)
    assert.equal(politica.podeNavegarPedidosVendas(papel, false), false)
  }
  for (const papel of ['visualizador', 'consultor', 'representante', 'pending', 'rejected', undefined]) {
    assert.equal(politica.podeNavegarPedidosVendas(papel, true), false)
  }
})

test('callback real da linha fica ausente para quem não entra em Pedidos', () => {
  const navegar: string[] = []
  const callback = callbackPagina('tr', '/controle/pedidos')({ id: 'pedido-sintetico' }, (rota: string) => navegar.push(rota), false)
  if (callback) callback()
  assert.equal(callback, undefined)
  assert.deepEqual(navegar, [])
})

test('callback real mantém detalhe nativo para quem já pode entrar em Pedidos', () => {
  const navegar: string[] = []
  const callback = callbackPagina('tr', '/controle/pedidos')({ id: 'pedido-sintetico' }, (rota: string) => navegar.push(rota), true)
  callback()
  assert.deepEqual(navegar, ['/controle/pedidos/pedido-sintetico'])
})

test('Ver todos real expande consulta autorizada sem navegar quando Pedidos é bloqueado', () => {
  const navegar: string[] = []
  const expandido: string[] = []
  const callback = callbackPagina('Button', 'Ver todos')({}, (rota: string) => navegar.push(rota), false, (contexto: string) => expandido.push(contexto), 'contexto-atual')
  callback()
  assert.deepEqual(navegar, [])
  assert.deepEqual(expandido, ['contexto-atual'])
})

test('Ver todos mantém lista nativa para quem já pode entrar em Pedidos', () => {
  const navegar: string[] = []
  const expandido: string[] = []
  const callback = callbackPagina('Button', 'Ver todos')({}, (rota: string) => navegar.push(rota), true, (contexto: string) => expandido.push(contexto), 'contexto-atual')
  callback()
  assert.deepEqual(navegar, ['/controle/pedidos'])
  assert.deepEqual(expandido, [])
})

test('expansão local mantém todas as linhas filtradas só no contexto solicitado', () => {
  const filtradas = Array.from({ length: 75 }, (_, id) => ({ id }))
  assert.equal(politica.linhasVisiveisVendas(filtradas, 'atual', null).length, 50)
  assert.deepEqual(politica.linhasVisiveisVendas(filtradas, 'atual', 'atual'), filtradas)
  assert.equal(politica.linhasVisiveisVendas(filtradas, 'novo-filtro', 'atual').length, 50)
  assert.equal(politica.linhasVisiveisVendas(filtradas, 'nova-identidade', 'atual').length, 50)
})
