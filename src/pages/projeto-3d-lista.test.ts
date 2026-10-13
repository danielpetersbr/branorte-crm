import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

function listOptions(showLista?: boolean, fromPage = true) {
  const source = readFileSync(new URL('../hooks/useConfiguradorProjetos.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('useConfiguradorProjetos.ts', source, ts.ScriptTarget.Latest, true)
  const hook = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useConfiguradorProjetos')!
  const js = ts.transpileModule(hook.getText(ast).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let requests = 0
  const rows = Array.from({ length: 120 }, (_, index) => ({
    id: String(index), nome: `Projeto ${index}`, contact_id: null, cliente_nome: null,
    created_by_nome: null, created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T11:00:00Z',
  }))
  const query = {
    select: (columns: string) => {
      assert.equal(columns, 'id,nome,contact_id,cliente_nome,created_by_nome,created_at,updated_at')
      return query
    },
    order: (column: string, options: { ascending: boolean }) => {
      assert.equal(column, 'updated_at')
      assert.equal(options.ascending, false)
      return Promise.resolve({ data: rows, error: null })
    },
  }
  const context = vm.createContext({
    showLista, KEY: ['configurador-projetos'], useQuery: (options: unknown) => options,
    supabase: { from: (table: string) => {
      assert.equal(table, 'configurador_projetos')
      requests++
      return query
    } },
  })
  vm.runInContext(js, context)
  let invocation = 'useConfiguradorProjetos()'
  if (fromPage) {
    const page = readFileSync(new URL('./Projeto3D.tsx', import.meta.url), 'utf8')
    const pageAst = ts.createSourceFile('Projeto3D.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const fn = pageAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Projeto3D') as ts.FunctionDeclaration
    for (const statement of fn.body!.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && ts.isCallExpression(declaration.initializer)
          && declaration.initializer.expression.getText(pageAst) === 'useConfiguradorProjetos') {
          invocation = declaration.initializer.getText(pageAst)
        }
      }
    }
  }
  const options = vm.runInContext(invocation, context)
  return { options, rows, requests: () => requests }
}

async function observe(list: ReturnType<typeof listOptions>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const observer = new QueryObserver(client, list.options)
  const unsubscribe = observer.subscribe(() => {})
  await new Promise(resolve => setImmediate(resolve))
  const result = observer.getCurrentResult()
  unsubscribe()
  client.clear()
  return result
}

test('lista CRM fechada não inicia consulta de projetos', async () => {
  const list = listOptions(false)
  await observe(list)
  assert.equal(list.requests(), 0)
})

test('abrir lista CRM consulta e preserva todos os projetos sem encurtar a lista', async () => {
  const list = listOptions(true)
  const result = await observe(list)
  assert.equal(list.requests(), 1)
  assert.equal(result.data, list.rows)
  assert.equal((result.data as unknown[]).length, 120)
  assert.deepEqual(Array.from(list.options.queryKey), ['configurador-projetos'])
})

test('consumidores sem argumento continuam consultando a lista completa', async () => {
  const list = listOptions(undefined, false)
  const result = await observe(list)
  assert.equal(list.requests(), 1)
  assert.equal(result.data, list.rows)
})
