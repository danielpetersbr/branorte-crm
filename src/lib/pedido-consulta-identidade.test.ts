import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loader(file: string, context: Record<string, unknown>, name = 'carregarPedido') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration: ts.VariableStatement | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name)) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  const js = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${js}\n${name}`, { AbortController, useCallback: (fn: unknown) => fn, console: { error() {} }, ...context })
}

for (const action of ['verPedidoDeVenda', 'baixarPedidoDeVenda']) {
  test(`PedidoDetalhe: late ${action} for A cannot open its document under B`, async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>(r => { resolve = r })
    const idAtual = { current: 'A' }, shown: unknown[] = [], actions: unknown[] = []
    const run = loader('../pages/pedido-venda/PedidoDetalhe.tsx', {
      id: 'A', idAtual, pedido: { id: 'A' }, viewingDoc: null,
      gerarPedidoRetroativo: () => pending, carregarPedido: async () => {},
      setPedidoVendaUrl: (value: unknown) => shown.push(value), setViewingDoc: (value: unknown) => shown.push(value),
      setAcaoEmCurso: (value: unknown) => actions.push(value),
      window: { open: (url: string) => shown.push(url) },
      toast: { loading: () => 'synthetic-toast', success() {}, error() {}, dismiss() {} },
    }, action)
    const request = run()
    idAtual.current = 'B'
    resolve('https://example.invalid/document-A.docx')
    await request
    assert.deepEqual(shown, [])
    assert.equal(actions.includes(null), false, 'old completion must not reset an action already started under B')
  })
}
for (const page of ['NovoPedido', 'PedidoDetalhe']) {
  test(`${page}: a late response for A cannot replace the active order B`, async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise(r => { resolve = r })
    let accepted: unknown = null
    const chain: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'abortSignal']) chain[key] = () => chain
    chain.single = chain.maybeSingle = () => pending
    const idAtual = { current: 'A' }, consultaPedido = { current: null as AbortController | null }
    const load = loader(`../pages/pedido-venda/${page}.tsx`, {
      id: 'A', idAtual, consultaPedido, supabase: { from: () => chain },
      setLoading() {}, setNaoEncontrado() {}, setNumeroOrcamento() {}, toast: { error() {} },
      setPedidoData: (value: unknown) => { accepted = value }, setPedido: (value: unknown) => { accepted = value },
      setEstadoPedido: (value: { data?: unknown }) => { if (value.data) accepted = value.data },
    })
    const request = load()
    idAtual.current = 'B'
    consultaPedido.current?.abort()
    resolve({ data: { id: 'A', numero_orcamento: 'A' }, error: null })
    await request
    assert.equal(accepted, null)
  })
}
