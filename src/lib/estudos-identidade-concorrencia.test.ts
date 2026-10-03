import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function pageActions(page: string) {
  const path = new URL(`../pages/${page}.tsx`, import.meta.url)
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const newName = page === 'ProducaoPropria' ? 'novo' : 'novaProposta'
  const names = [newName, 'duplicarAtual', 'salvar', 'abrirDoHistorico', 'duplicarDoHistorico']
  const expressions = new Map<string, ts.Expression>()
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) expressions.set(node.name.text, node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(expressions.size, names.length, 'executa os callbacks reais das páginas')
  const reads = new Map<string, ReturnType<typeof deferred<{ id: string; codigo: string; dados: unknown } | null>>>()
  const read = (id: string) => {
    const response = deferred<{ id: string; codigo: string; dados: unknown } | null>()
    reads.set(id, response)
    return response.promise
  }
  const original = { marker: 'original', produto: { especie: 'bovinos' }, identificacao: { vendedorNome: 'QA' } }
  const state = { input: original as unknown, id: 'original-id' as string | null, saved: null as { onSuccess: (row: { id: string; codigo: string }) => void } | null }
  const mutation = { isPending: false, mutate: (_payload: unknown, callbacks: typeof state.saved) => { state.saved = callbacks } }
  const context: Record<string, any> = {
    exports: {}, input: original, config: {}, profile: { id: 'conta-A', display_name: 'QA' },
    estudoId: state.id, simulacaoId: state.id, salvarEstudo: mutation, salvarSimulacao: mutation,
    operacaoDocumentoRef: { current: 0 }, contaAtualRef: { current: 'conta-A' },
    resultado: { demanda: {}, atual: {}, producao: {}, comparacao: {}, dimensionamento: {}, retorno: {}, custos: {}, precos: {}, negociado: {} },
    setInput: (value: unknown) => { state.input = typeof value === 'function' ? value(state.input) : value; context.input = state.input },
    setEstudoId: (id: string | null) => { state.id = id; context.estudoId = id },
    setSimulacaoId: (id: string | null) => { state.id = id; context.simulacaoId = id },
    setCodigo: () => {}, setAba: () => {}, setFase: () => {}, setEtapaAtual: () => {}, setAviso: () => {},
    novoEstudo: () => ({ ...original, marker: 'novo' }), novaSimulacao: () => ({ ...original, marker: 'novo' }),
    normalizarInput: (value: unknown) => value, codigoProvisorio: () => 'QA', hojeISO: () => '2026-10-02',
    carregarLinha: read,
    supabase: { from: () => ({ select: () => ({ eq: (_field: string, id: string) => ({ maybeSingle: async () => ({ data: await read(id), error: null }) }) }) }) },
  }
  const compiled = ts.transpileModule([...expressions].map(([name, value]) => `export const ${name} = ${value.getText(source)};`).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  runInNewContext(compiled, context)
  const actions = context.exports as Record<string, (...args: unknown[]) => Promise<void> | void>
  const complete = (id: string) => reads.get(id)!.resolve({ id, codigo: id, dados: { ...original, marker: id } })
  return { actions, newName, context, state, complete }
}

for (const page of ['ProducaoPropria', 'VendaRacao']) {
  test(`${page}: abertura mais antiga não substitui a última selecionada`, async () => {
    const f = pageActions(page)
    const a = f.actions.abrirDoHistorico('A'), b = f.actions.abrirDoHistorico('B')
    f.complete('B'); await b
    f.complete('A'); await a
    assert.equal(f.state.id, 'B')
    assert.equal((f.state.input as { marker: string }).marker, 'B')
  })

  for (const action of ['novo', 'duplicarAtual', 'salvar']) {
    test(`${page}: ${action} invalida abertura de histórico ainda pendente`, async () => {
      const f = pageActions(page)
      const old = f.actions.abrirDoHistorico('A')
      f.actions[action === 'novo' ? f.newName : action]()
      if (action === 'salvar') f.state.saved!.onSuccess({ id: 'confirmado-id', codigo: 'confirmado' })
      f.complete('A'); await old
      assert.equal(f.state.id, action === 'salvar' ? 'confirmado-id' : null)
      assert.equal((f.state.input as { marker: string }).marker, action === 'novo' ? 'novo' : 'original')
    })
  }

  test(`${page}: troca de conta ignora resposta antiga de duplicação`, async () => {
    const f = pageActions(page)
    const old = f.actions.duplicarDoHistorico('A')
    f.context.contaAtualRef.current = 'conta-B'
    f.context.profile = { id: 'conta-B', display_name: 'Outra conta' }
    f.complete('A'); await old
    assert.equal(f.state.id, 'original-id')
    assert.equal((f.state.input as { marker: string }).marker, 'original')
  })

  test(`${page}: confirmação de Save da conta anterior não muda o documento atual`, () => {
    const f = pageActions(page)
    f.actions.salvar()
    f.context.contaAtualRef.current = 'conta-B'
    f.context.profile = { id: 'conta-B', display_name: 'Outra conta' }
    f.state.saved!.onSuccess({ id: 'id-conta-A', codigo: 'antigo' })
    assert.equal(f.state.id, 'original-id')
  })
}
