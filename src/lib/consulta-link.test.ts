import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function leitura(response: { data: unknown; error: unknown }) {
  const file = new URL('../pages/Consulta.tsx', import.meta.url)
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let query: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'consultaQuery' && node.initializer && ts.isCallExpression(node.initializer)) {
      const options = node.initializer.arguments[0]
      if (ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'queryFn') as ts.PropertyAssignment | undefined
        query = property?.initializer
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(query, 'leitura usa o ID da query e aborta requisições anteriores')
  let selected: unknown, signalUsed: unknown
  const chain = { select: () => chain, eq: (_field: string, id: unknown) => { selected = id; return chain }, maybeSingle: async () => response, abortSignal: (signal: unknown) => { signalUsed = signal; return chain } }
  const context = { exports: {}, idFromUrl: 'consulta-B', supabase: { from: () => chain } }
  runInNewContext(ts.transpileModule(`export const read = ${query.getText(source)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { read: (context.exports as { read: (options: unknown) => Promise<unknown> }).read, selected: () => selected, signal: () => signalUsed }
}
test('consulta por link lê apenas o ID atual e respeita cancelamento da rota', async () => {
  const response = { data: { id: 'consulta-B' }, error: null }
  const query = leitura(response), signal = new AbortController().signal
  assert.equal(await query.read({ signal }), response.data)
  assert.equal(query.selected(), 'consulta-B')
  assert.equal(query.signal(), signal)
})
test('falha de leitura não é confundida com consulta inexistente', async () => {
  const query = leitura({ data: null, error: new Error('Conexão interrompida') })
  await assert.rejects(() => query.read({ signal: new AbortController().signal }), /Conexão interrompida/)
})
test('resposta com identidade diferente não é mostrada no link atual', async () => {
  const query = leitura({ data: { id: 'consulta-A' }, error: null })
  assert.equal(await query.read({ signal: new AbortController().signal }), null)
})
