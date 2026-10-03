import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function submit(page: string, context: Record<string, unknown>) {
  const source = readFileSync(new URL(`../pages/pedido-venda/${page}.tsx`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration: ts.VariableStatement | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'onSubmit')) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${js}\nonSubmit`, {
    setLoading() {}, reset() {}, setArquivo() {}, fileToBase64: async () => 'synthetic',
    vendedorPrincipalPedido: () => 'Vendedor fictício', identidadeVendedor: { fixo: true },
    destinoAposCriarPedido: () => '/synthetic-order', console: { log() {}, warn() {}, error() {} },
    valorTotalNumerico: 100, checklistCompras: {}, isChecklistEmpty: () => true, validarChecklistProjeto: () => null,
    paymentPlan: { parcelas: [{ valor: { tipo: 'fixo', fixo: 100 } }] }, arquivo: { name: 'synthetic.docx' },
    ...context,
  })
}

function boundaries(result: unknown, uploadError: Error | null = null) {
  const writes: unknown[] = [], successes: string[] = [], warnings: string[] = [], errors: string[] = [], navigations: string[] = []
  return {
    writes, successes, warnings, errors, navigations,
    context: {
      navigate: (to: string) => navigations.push(to),
      toast: { success: (text: string) => successes.push(text), warning: (text: string) => warnings.push(text), error: (text: string) => errors.push(text) },
      supabase: {
        rpc: async () => ({ data: 'TESTE-0001', error: null }),
        storage: { from: () => ({ upload: async () => ({ error: uploadError }), getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/synthetic.docx' } }) }) },
        functions: { invoke: async () => result },
        from: (table: string) => {
          const query: Record<string, unknown> = {}
          for (const name of ['select', 'eq', 'order', 'limit']) query[name] = () => query
          query.insert = (payload: unknown) => { if (table === 'pedidos_venda') writes.push(payload); return query }
          query.single = async () => ({ data: table === 'pedidos_venda' ? { id: 'synthetic-order' } : null, error: null })
          query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
          return query
        },
      },
    },
  }
}
const input = { cliente: 'Cliente fictício', vendedor: 'Vendedor fictício', data_venda: '2026-10-02', produto: 'Silo', motivo: 'Garantia fictícia' }

test('warranty order is not inserted when its mandatory document upload fails', async () => {
  const fake = boundaries({ data: { ok: true }, error: null }, new Error('storage offline'))
  await submit('PedidoGarantia', fake.context)(input)
  assert.equal(fake.writes.length, 0)
  assert.equal(fake.navigations.length, 0)
  assert.equal(fake.successes.length, 0)
  assert.equal(fake.errors.length, 1)
})

for (const page of ['PedidoSimples', 'PedidoGarantia']) {
  for (const result of [{ data: null, error: new Error('offline') }, { data: { ok: false, error: 'app2_failed' }, error: null }, { data: {}, error: null }]) {
    test(`${page}: unconfirmed factory delivery warns while preserving the already saved order`, async () => {
      const fake = boundaries(result)
      await submit(page, fake.context)(input)
      assert.equal(fake.writes.length, 1)
      assert.equal(fake.navigations.length, 1)
      assert.equal(fake.warnings.length, 1)
      assert.equal(fake.successes.length, 0)
      assert.equal(fake.errors.length, 0, 'delivery failure must not suggest recreating the saved order')
    })
  }
}
