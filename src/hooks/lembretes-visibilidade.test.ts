import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function notifier(hidden = false) {
  const text = readFileSync(new URL('./useLembretesDueNotifier.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('notifier.ts', text, ts.ScriptTarget.Latest, true)
  let pollCode = '', effectCode = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'poll') pollCode = node.initializer!.getText(ast)
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('window.setInterval(poll')) effectCode = node.arguments[0].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(pollCode && effectCode)
  let requests = 0, writes = 0, tick = () => {}, cleared = false
  let release: undefined | ((value: unknown) => void)
  const listeners = new Map<string, () => void>()
  const document = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string, fn: () => void) => { assert.equal(listeners.get(name), fn); listeners.delete(name) } }
  const chain: any = { then(resolve: (v: unknown) => void) { if (release === undefined) resolve({ data: [] }); else release = resolve } }
  for (const method of ['select', 'ilike', 'eq', 'not', 'lte', 'order', 'limit']) chain[method] = () => chain
  chain.update = () => { writes++; return { in: () => Promise.resolve({ error: null }) } }
  const code = `const poll = ${pollCode}; const effect = ${effectCode}; ({poll,effect})`
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const state: any[] = []
  const f = vm.runInNewContext(js, {
    document, Date, Set, console, useCallback: (fn: unknown) => fn,
    nome: 'Fictício', runningRef: { current: false }, nomeRef: { current: 'Fictício' }, pendingRef: { current: new Set() }, shownRef: { current: new Set() },
    setCards: (next: unknown) => { if (typeof next === 'function') state.push(next([])) }, setActionErrors: () => {}, setPendingIds: () => {},
    supabase: { from: () => { requests++; return chain } }, AGENDA_SELECT: 'id', likeExato: (value: string) => value,
    ymd: () => '2026-10-13', parseLocalDateTime: () => new Date('2026-10-12T12:00:00Z'), POLL_MS: 60000,
    window: { setInterval: (fn: () => void, delay: number) => { assert.equal(delay, 60000); tick = fn; return 1 }, clearInterval: (id: number) => { assert.equal(id, 1); cleared = true } },
  })
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  return { ...f, document, listeners, flush, state, tick: () => tick(), counts: () => ({ requests, writes, cleared }), defer: () => { release = () => {} }, resolve: (value: unknown) => release?.(value) }
}

test('aba oculta não consulta nem marca lembretes como vistos', async () => {
  const h = notifier(true)
  h.effect()
  h.tick()
  await h.flush()
  assert.equal(h.counts().requests, 0)
  assert.equal(h.counts().writes, 0)
})

test('retorno para a aba consulta imediatamente; polling ativo mantém 60 segundos e remove listeners ao sair', async () => {
  const h = notifier(true)
  const cleanup = h.effect()
  assert.equal(h.listeners.size, 1)
  h.document.visibilityState = 'visible'
  h.listeners.get('visibilitychange')!()
  await h.flush()
  assert.equal(h.counts().requests, 1)
  h.tick()
  await h.flush()
  assert.equal(h.counts().requests, 2)
  cleanup()
  assert.equal(h.listeners.size, 0)
  assert.equal(h.counts().cleared, true)
})

test('resposta iniciada visível mas recebida em aba oculta não consome o lembrete', async () => {
  const h = notifier()
  h.defer()
  const pending = h.poll()
  await h.flush()
  h.document.visibilityState = 'hidden'
  h.resolve({ data: [{ id: 1, data: '2026-10-12', hora: '12:00' }] })
  await pending
  assert.equal(h.counts().writes, 0)
  assert.equal(h.state.length, 0)
})
