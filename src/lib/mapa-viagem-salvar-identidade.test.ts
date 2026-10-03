import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the real planner callbacks with deferred persistence, never the SDK.
const source = readFileSync(new URL('../pages/MapaVisitas.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('MapaVisitas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MapaVisitas') as ts.FunctionDeclaration
const statements = page.body!.statements
const js = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

function fixture(id: string | null = null) {
  const persisted: Array<Record<string, unknown>> = [], alerts: string[] = []
  const pending = deferred<{ id: string; foraDoPlano: string[] }>()
  const context: Record<string, any> = {
    cfgViagem: { nome: 'Plano A', dias: 1 }, paradas: [{ id: 'stop-a' }], prog: { dias: [] }, viagemStatus: 'rascunho',
    viagemId: id, viagemSalvaEm: null, carregarId: null, salvandoViagem: false,
    viagemContextoRef: { current: 0 }, salvandoViagemRef: { current: false }, viagemMontadaRef: { current: true },
    viagemSnapshotRef: { current: '' }, viagemSnapshotSalvoRef: { current: null },
    CONFIG_PADRAO: { nome: '', dias: 1 }, geometriasRef: { current: [] },
    useMemo: (fn: () => unknown) => fn(),
    salvarViagemMut: { mutateAsync: (input: Record<string, unknown>) => { persisted.push(input); return pending.promise } },
    window: { confirm: () => true, alert: (message: string) => alerts.push(message) },
    setTrechos() {}, setGeoTrechos() {}, setProvedorRota() {}, setAbrirSalvas() {}, setModoViagem() {},
  }
  for (const [setter, state] of Object.entries({
    setCfgViagemState: 'cfgViagem', setParadas: 'paradas', setViagemId: 'viagemId',
    setViagemStatus: 'viagemStatus', setViagemSalvaEm: 'viagemSalvaEm', setCarregarId: 'carregarId', setSalvandoViagem: 'salvandoViagem',
  })) context[setter] = (value: unknown) => { context[state] = typeof value === 'function' ? value(context[state]) : value }
  const sandbox = vm.createContext(context)
  const functions = statements.filter(n => ts.isFunctionDeclaration(n) && ['salvarViagem', 'novaViagem', 'abrirViagem'].includes(n.name?.text ?? ''))
  const setCfg = statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'setCfgViagem'))!
  let open: ts.JsxAttribute | undefined
  let load: ts.ArrowFunction | undefined
  let clearSaved: ts.ArrowFunction | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ViagensSalvas') {
      open = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'onAbrir') as ts.JsxAttribute
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && ts.isArrowFunction(node.arguments[0])) {
      const callback = node.arguments[0]
      if (callback.body.getText(ast).includes('viagemCarregada.id !== carregarId')) load = callback
      if (callback.body.getText(ast).includes('viagemSnapshotSalvoRef.current')) clearSaved = callback
    }
    ts.forEachChild(node, visit)
  }
  visit(page)
  assert.ok(open?.initializer && ts.isJsxExpression(open.initializer) && open.initializer.expression)
  assert.ok(load)
  const snapshot = statements.filter(n =>
    (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'viagemSnapshot')) ||
    (ts.isExpressionStatement(n) && n.expression.getText(ast).startsWith('viagemSnapshotRef.current =')))
  vm.runInContext(js(functions.map(n => n.getText(ast)).join('\n') + '\n' + setCfg.getText(ast)
    + `\nconst openSaved = ${open.initializer.expression.getText(ast)};`
    + `\nconst applyLoaded = ${load.getText(ast)};`
    + `\nfunction renderSnapshot() { ${snapshot.map(n => n.getText(ast)).join('\n;')} ; ${clearSaved ? `(${clearSaved.getText(ast)})();` : ''} }`
    + '\nglobalThis.callbacks = {salvarViagem, novaViagem, openSaved, applyLoaded, setCfgViagem, renderSnapshot};'), sandbox)
  const callbacks = context.callbacks as {
    salvarViagem(): Promise<void>; novaViagem(): void; openSaved(id: string): void;
    applyLoaded(): void; setCfgViagem(patch: Record<string, unknown>): void; renderSnapshot(): void;
  }
  callbacks.renderSnapshot()
  return { context, callbacks, pending, persisted, alerts }
}

test('creating a new draft during save never attaches the previous trip ID or saved marker', async () => {
  const f = fixture('trip-a'), saving = f.callbacks.salvarViagem()
  f.callbacks.novaViagem()
  f.callbacks.renderSnapshot()
  const newConfig = f.context.cfgViagem
  f.pending.resolve({ id: 'trip-a', foraDoPlano: [] })
  await saving
  assert.equal(f.persisted.length, 1)
  assert.equal((f.persisted[0].cfg as { nome: string }).nome, 'Plano A')
  assert.equal(f.context.viagemId, null)
  assert.equal(f.context.viagemSalvaEm, null)
  assert.equal(f.context.cfgViagem, newConfig)
  assert.equal(f.context.paradas.length, 0)
})

test('opening trip B during save keeps the loaded trip B identity and draft intact', async () => {
  const f = fixture('trip-a'), saving = f.callbacks.salvarViagem()
  f.callbacks.openSaved('trip-b')
  f.context.viagemCarregada = { id: 'trip-b', cfg: { nome: 'Plano B' }, paradas: [{ id: 'stop-b' }], status: 'pronta' }
  f.callbacks.applyLoaded()
  f.callbacks.renderSnapshot()
  f.pending.resolve({ id: 'trip-a', foraDoPlano: [] })
  await saving
  assert.equal(f.context.viagemId, 'trip-b')
  assert.equal(f.context.cfgViagem.nome, 'Plano B')
  assert.equal(f.context.paradas[0].id, 'stop-b')
  assert.equal(f.context.viagemSalvaEm, null)
})

test('editing an unsaved trip during save preserves edits and confirmed ID without claiming the new snapshot was saved', async () => {
  const f = fixture(), saving = f.callbacks.salvarViagem()
  f.callbacks.setCfgViagem({ nome: 'Plano A editado' })
  f.callbacks.renderSnapshot()
  f.pending.resolve({ id: 'new-trip-a', foraDoPlano: [] })
  await saving
  assert.equal((f.persisted[0].cfg as { nome: string }).nome, 'Plano A')
  assert.equal(f.context.cfgViagem.nome, 'Plano A editado')
  assert.equal(f.context.viagemId, 'new-trip-a', 'next save must update the confirmed trip rather than create another')
  assert.equal(f.context.viagemSalvaEm, null)
})

test('duplicate save callbacks before React renders persist one snapshot and release the lock', async () => {
  const f = fixture(), first = f.callbacks.salvarViagem(), second = f.callbacks.salvarViagem()
  assert.equal(f.persisted.length, 1)
  f.pending.resolve({ id: 'new-trip-a', foraDoPlano: [] })
  await Promise.all([first, second])
  assert.equal(f.context.viagemId, 'new-trip-a')
  assert.ok(f.context.viagemSalvaEm)
  assert.equal(f.context.salvandoViagemRef.current, false)
  assert.equal(f.context.salvandoViagem, false)
})

test('an unmounted planner never applies a confirmed save or displays its alerts', async () => {
  const f = fixture(), saving = f.callbacks.salvarViagem()
  f.context.viagemMontadaRef.current = false
  f.pending.resolve({ id: 'new-trip-a', foraDoPlano: ['Synthetic stop'] })
  await saving
  assert.equal(f.context.viagemId, null)
  assert.equal(f.context.viagemSalvaEm, null)
  assert.equal(f.alerts.length, 0)
  assert.equal(f.context.salvandoViagemRef.current, false)
})

test('failure from a previous trip never interrupts the new draft with a stale error', async () => {
  const f = fixture('trip-a'), saving = f.callbacks.salvarViagem()
  f.callbacks.novaViagem()
  f.callbacks.renderSnapshot()
  f.pending.reject(new Error('Synthetic trip A failure'))
  await saving
  assert.equal(f.alerts.length, 0)
  assert.equal(f.context.viagemId, null)
  assert.equal(f.context.salvandoViagem, false)
})

test('editing a previously confirmed snapshot clears its saved marker', async () => {
  const f = fixture(), saving = f.callbacks.salvarViagem()
  f.pending.resolve({ id: 'new-trip-a', foraDoPlano: [] })
  await saving
  assert.ok(f.context.viagemSalvaEm)
  f.callbacks.setCfgViagem({ nome: 'Alteração depois de salvar' })
  f.callbacks.renderSnapshot()
  assert.equal(f.context.viagemSalvaEm, null)
})
