import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

const source = readFileSync(new URL('../pages/Disparos.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('Disparos.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function expression(name: string) {
  let value: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(value, `declaração ${name} precisa existir`)
  return value.getText(ast)
}

function evaluate(code: string, context: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

function harness(row: Record<string, unknown> | null = { ativa: false, auto_prospec_ativa: true, funil_auto_ativa: true, funil_dry_run: false }, error: unknown = null) {
  const calls: unknown[][] = []
  const query = {
    select(fields: string) { calls.push(['select', fields]); return query },
    eq(field: string, value: unknown) { calls.push(['eq', field, value]); return query },
    maybeSingle() { return Promise.resolve({ data: row, error }) },
  }
  const supabase = { from(table: string) { calls.push(['from', table]); return query } }
  const options: any[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useQuery' && node.getText(ast).includes("from('wa_avaliacao_config')")) {
      options.push(evaluate(node.getText(ast), { useQuery: (value: unknown) => value, supabase }))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { options, calls, supabase, setRow(value: Record<string, unknown>) { row = value } }
}

test('as quatro flags usam uma leitura conjunta, id=1 e atualização a cada 15s', async () => {
  const h = harness()
  assert.equal(h.options.length, 1, 'configuração compartilhada precisa ter uma única query')
  assert.equal(h.options[0].refetchInterval, 15_000)
  const data = await h.options[0].queryFn()
  assert.deepEqual(JSON.parse(JSON.stringify(data)), { avaliacaoAtiva: false, prospecAtiva: true, funilAtiva: true, funilDryRun: false })
  assert.equal(h.calls.filter(c => c[0] === 'from').length, 1)
  assert.ok(h.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === 1))
  const fields = String(h.calls.find(c => c[0] === 'select')?.[1]).split(',').map(s => s.trim()).sort()
  assert.deepEqual(fields, ['ativa', 'auto_prospec_ativa', 'funil_auto_ativa', 'funil_dry_run'])
})

test('flags ausentes preservam opt-in do funil e defaults anteriores; leitura falha não vira configuração válida', async () => {
  const defaults = harness({})
  assert.equal(defaults.options.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(await defaults.options[0].queryFn())), { avaliacaoAtiva: true, prospecAtiva: true, funilAtiva: false, funilDryRun: true })
  const missing = harness(null)
  await assert.rejects(missing.options[0].queryFn())
  const broken = harness(null, new Error('sem acesso'))
  await assert.rejects(broken.options[0].queryFn(), /sem acesso/)
})

test('cada toggle global invalida a leitura compartilhada e publica imediatamente as flags atualizadas', async () => {
  for (const name of ['toggleAvaliacao', 'toggleProspec', 'toggleFunil', 'toggleFunilDryRun']) {
    const h = harness()
    assert.equal(h.options.length, 1)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const observer = new QueryObserver(qc, h.options[0])
    const unsubscribe = observer.subscribe(() => {})
    try {
      await qc.fetchQuery(h.options[0])
      h.setRow({ ativa: true, auto_prospec_ativa: false, funil_auto_ativa: false, funil_dry_run: true })
      const mutation = evaluate(expression(name), { useMutation: (value: unknown) => value, qc, supabase: h.supabase })
      await mutation.onSuccess()
      assert.deepEqual(JSON.parse(JSON.stringify(observer.getCurrentResult().data)), { avaliacaoAtiva: true, prospecAtiva: false, funilAtiva: false, funilDryRun: true }, `${name} precisa atualizar todas as flags`)
      assert.equal(h.calls.filter(c => c[0] === 'from').length, 2)
    } finally { unsubscribe(); qc.clear() }
  }
})
