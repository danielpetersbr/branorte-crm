import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function evaluate(source: string, context: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

const hooks = readFileSync(new URL('./useCampanhas.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('useCampanhas.ts', hooks, ts.ScriptTarget.Latest, true)
const hook = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'useSequenciasDisponiveis')!

test('sequências só consultam quando o modal está aberto e há vendedor; outros consumidores seguem habilitados', () => {
  const code = hook.getText(ast).replace(/^export /, '')
  for (const [nome, enabled, want] of [['EDER', false, false], ['EDER', true, true], [null, true, false]] as const) {
    const options = evaluate(`${code}; useSequenciasDisponiveis(nome, enabled)`, { nome, enabled, useQuery: (value: unknown) => value })
    assert.equal(options.enabled, want)
  }
  const defaults = evaluate(`${code}; useSequenciasDisponiveis('EDER')`, { useQuery: (value: unknown) => value })
  assert.equal(defaults.enabled, true)
})

test('modal fornece seu estado open à consulta mantendo o componente montado', () => {
  const modal = readFileSync(new URL('../components/NovaCampanhaModal.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('NovaCampanhaModal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let call: ts.CallExpression | undefined
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useSequenciasDisponiveis') call = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(call)
  for (const open of [false, true]) {
    const received = evaluate(call.getText(tree), { vendedor: 'EDER', open, useSequenciasDisponiveis: (nome: string, enabled = true) => ({ nome, enabled }) })
    assert.equal(received.enabled, open)
  }
})
