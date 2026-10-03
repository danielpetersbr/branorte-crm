import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryNotice } from '../components/ui/QueryNotice'

const source = readFileSync(new URL('../pages/MapaVisitas.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('MapaVisitas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MapaVisitas') as ts.FunctionDeclaration
function opening(data: unknown, error: Error | null) {
  let retries = 0
  const cfg = { nome: 'Rascunho A preservado' }
  const context: Record<string, unknown> = {
    React: { createElement }, QueryNotice, carregarId: 'trip-b', cfgViagem: cfg,
    viagemContextoRef: { current: 0 }, setCarregarId: (id: unknown) => { context.carregarId = id },
    useViagem: () => ({ data, error, isFetching: false, isFetched: true, refetch: async () => { retries++ } }),
  }
  const declarations = page.body!.statements.filter(n =>
    (ts.isVariableStatement(n) && (n.getText(ast).includes('useViagem(carregarId)') || n.declarationList.declarations.some(d => d.name.getText(ast) === 'erroAbrirViagem'))) ||
    (ts.isFunctionDeclaration(n) && n.name?.text === 'cancelarAberturaViagem'))
  let notice: ts.JsxSelfClosingElement | undefined, cancel: ts.JsxElement | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'QueryNotice' && node.getText(ast).includes('error={erroAbrirViagem}')) notice = node
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'button' && node.getText(ast).includes('Manter planejamento atual')) cancel = node
    ts.forEachChild(node, visit)
  }
  visit(page)
  const js = ts.transpileModule(declarations.map(n => n.getText(ast)).join('\n')
    + `\n;({ notice: ${notice?.getText(ast) ?? 'null'}, cancel: ${cancel?.getText(ast) ?? 'null'} });`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const view = vm.runInNewContext(js, context) as {
    notice: ReactElement<{ onRetry(): Promise<unknown> }> | null; cancel: ReactElement<{ onClick(): void }> | null
  }
  return { ...view, context, cfg, retries: () => retries }
}

test('failed saved-trip lookup exposes retry and keeps save explicitly blocked until opening is resolved', async () => {
  const v = opening(undefined, new Error('synthetic offline'))
  const html = renderToStaticMarkup(v.notice)
  assert.match(html, /role="alert"/)
  assert.match(html, /planejamento atual foi preservado/)
  assert.match(html, /Tentar novamente/)
  await v.notice!.props.onRetry()
  assert.equal(v.retries(), 1)
  const panelSource = readFileSync(new URL('../components/mapa/PainelViagem.tsx', import.meta.url), 'utf8')
  const panelAst = ts.createSourceFile('PainelViagem.tsx', panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let guard: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(panelAst) === 'button' && node.getText(panelAst).includes('onClick={p.onSalvar}')) {
      const prop = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(panelAst) === 'disabled') as ts.JsxAttribute
      if (prop.initializer && ts.isJsxExpression(prop.initializer)) guard = prop.initializer.expression
    }
    ts.forEachChild(node, visit)
  }
  visit(panelAst)
  assert.ok(guard)
  assert.equal(vm.runInNewContext(guard.getText(panelAst), { p: { salvando: false, carregando: false, salvarBloqueado: true, cfg: { nome: 'Plano A' } } }), true)
})

test('missing or inaccessible saved trip can be cancelled without losing the current draft', () => {
  const v = opening(null, null)
  const html = renderToStaticMarkup(v.notice)
  assert.match(html, /role="alert"/)
  assert.match(html, /não foi encontrada|não está disponível/)
  assert.ok(v.cancel)
  v.cancel.props.onClick()
  assert.equal(v.context.carregarId, null)
  assert.equal(v.context.cfgViagem, v.cfg)
})
