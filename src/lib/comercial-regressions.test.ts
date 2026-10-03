import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createSequentialSave } from './sequential-save'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function evaluate(source: string, context: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context)
}
function queryMock(data: unknown[] = []) {
  const calls: unknown[][] = []
  const result = { data, count: 0, error: null }
  const query = new Proxy({}, { get: (_, key) => key === 'then'
    ? (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    : (...args: unknown[]) => { calls.push([key, ...args]); return query } })
  return { calls, supabase: { from: (...args: unknown[]) => { calls.push(['from', ...args]); return query } } }
}

test('Pool clears conversation filters and restores them when closed', () => {
  const source = read('pages/Contacts.tsx')
  const callback = source.slice(source.indexOf('  const irParaPool = () => {'), source.indexOf('  // Busca só aplica'))
  const original = { vendor_id: 'v1', com_whatsapp: true, esperando_resposta: true, search: 'cliente', page: 3 }
  const context: Record<string, unknown> = { filters: { ...original }, poolAtivo: false, antesDoPool: null,
    setSearchInput: () => {},
    setAntesDoPool: (value: unknown) => { context.antesDoPool = value },
    setFilters: (update: (value: unknown) => unknown) => { context.filters = update(context.filters) },
  }
  evaluate(`${callback.replace('const irParaPool', 'var irParaPool')}; irParaPool()`, context)
  assert.equal((context.filters as typeof original).com_whatsapp, false)
  assert.equal((context.filters as typeof original).esperando_resposta, false)
  context.poolAtivo = true
  evaluate(`${callback.replace('const irParaPool', 'var irParaPool')}; irParaPool()`, context)
  assert.equal((context.filters as typeof original).com_whatsapp, true)
  assert.equal((context.filters as typeof original).esperando_resposta, true)
})

test('Vendidos uses a null owner for the unassigned option', async () => {
  const source = read('pages/Vendidos.tsx')
  const fn = source.slice(source.indexOf('function useSoldContacts('), source.indexOf('function useSoldStats('))
  const mock = queryMock()
  const options = evaluate(`${fn}; useSoldContacts({ search: '', vendor_id: 'unassigned', estado: '', ano: '', mes: '', page: 0 })`, { ...mock, useQuery: (value: unknown) => value, PAGE_SIZE: 50 })
  await options.queryFn()
  assert.ok(mock.calls.some(c => c[0] === 'is' && c[1] === 'vendor_id' && c[2] === null))
  assert.ok(!mock.calls.some(c => c[0] === 'eq' && c[1] === 'vendor_id' && c[2] === 'unassigned'))
})

test('Vendidos header counts the same accented origins as the list', async () => {
  const source = read('pages/Vendidos.tsx')
  const fn = source.slice(source.indexOf('function useSoldStats('), source.indexOf('export function Vendidos('))
  const mock = queryMock()
  const options = evaluate(`${fn}; useSoldStats()`, { ...mock, useQuery: (value: unknown) => value })
  await options.queryFn()
  assert.ok(mock.calls.some(c => c[0] === 'or' && c[1] === 'origin.ilike.Orcamento%,origin.ilike.Orçamento%'))
})

test('partially applied assignment invalidates the contact cache despite rejection', async () => {
  const source = read('hooks/useContacts.ts')
  const fn = source.slice(source.indexOf('export function useBulkAssign()')).replace('export function', 'function')
  const invalidated: unknown[] = []
  const query = queryMock([{ id: 'a' }])
  const options = evaluate(`${fn}; useBulkAssign()`, { ...query, useMutation: (value: unknown) => value, useQueryClient: () => ({ invalidateQueries: (value: unknown) => invalidated.push(value) }) })
  let failure: unknown
  try { await options.mutationFn({ contactIds: ['a', 'b'], vendorId: 'v1' }) } catch (e) { failure = e }
  assert.ok(failure)
  options.onError?.(failure)
  options.onSettled?.(undefined, failure)
  assert.ok(invalidated.some((value: any) => value.queryKey[0] === 'contacts'))
})

test('IA daily limit rejects zero, fractions and non-finite numbers before writing', async () => {
  const source = read('pages/IaAtendente.tsx').split('function SecaoConfig(')[1]
  const start = source.indexOf('  const salvar = useMutation({')
  const mutation = source.slice(start, source.indexOf('  return (', start))
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    const mock = queryMock()
    const options = evaluate(`${mutation}; salvar`, { ...mock, useMutation: (value: unknown) => value, form: { modelo_openai: 'a', modelo_fallback: 'b', tom: '', max_respostas_dia: limit, permitir_midia: true } })
    await assert.rejects(options.mutationFn())
    assert.equal(mock.calls.length, 0)
  }
})

test('an invalid automatic flow is persisted as an inactive draft', async () => {
  const source = read('pages/FluxosFunil.tsx')
  const editor = source.split('function EditorFluxo(')[1]
  const mutation = editor.slice(editor.indexOf('  const salvar = useMutation({'), editor.indexOf('  const noSelecionado ='))
  const mock = queryMock()
  const options = evaluate(`${mutation}; salvar`, { ...mock, useMutation: (value: unknown) => value,
    paraContrato: () => ({ nodes: [], edges: [] }), validarDefinicao: () => ['Falta Início'], nodes: [], edges: [], nome: 'Exemplo', modo: 'automatico', escopo: '', fluxo: { id: 1, ativo: true } })
  await options.mutationFn()
  const payload = mock.calls.find(c => c[0] === 'update')?.[1] as { ativo?: boolean; modo: string }
  assert.equal(payload.ativo, false)
  assert.equal(payload.modo, 'desativado')
})

test('a failure closing the current IA test session prevents creating another one', async () => {
  const source = read('hooks/useIaTeste.ts')
  const fn = source.slice(source.indexOf('export function useNovaSessao()'), source.indexOf('export function useReligarIa()')).replace('export function', 'function')
  let inserts = 0
  const builder = new Proxy({}, { get: (_, key) => key === 'then'
    ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: {}, error: new Error('offline') }).then(resolve)
    : () => { if (key === 'insert') inserts++; return builder } })
  const options = evaluate(`${fn}; useNovaSessao()`, { useMutation: (value: unknown) => value, useQueryClient: () => ({}), crypto: { randomUUID: () => 'novo' }, supabase: { from: () => builder } })
  await assert.rejects(options.mutationFn({ userId: 'u', vendedorNome: 'Teste', nomeContato: 'Cliente' }))
  assert.equal(inserts, 0)
})

for (const hook of ['useRegistrarInteracao', 'useReportarIaErrada']) test(`${hook}: retry only closes the finding after a successful insert`, async () => {
  const source = read('hooks/useSupervisaoVendedor.ts')
  const start = source.indexOf(`export function ${hook}(`)
  const next = source.indexOf('\nexport function ', start + 1)
  const fn = source.slice(start, next < 0 ? undefined : next).replace('export function', 'function')
  let inserts = 0, closes = 0, invalidations = 0
  const options = evaluate(`${fn}; ${hook}('v1')`, { useMutation: (value: unknown) => value, useRef: (current: unknown) => ({ current }),
    useQueryClient: () => ({ invalidateQueries: () => { invalidations++ } }), chaveAchados: () => ['supervisao', 'achados', 'v1'], RegistroParcialSupervisao: Error,
    supabase: { from: () => ({ insert: async () => { inserts++; return { error: null } } }), rpc: async () => ({ error: ++closes === 1 ? new Error('rede') : null }) } })
  const input = { achadoId: 1, chatId: 'c', vendedorId: 'v1', tipo: 'ligacao_feita', ocorridoEm: '2026-10-02T12:00:00Z', observacao: null, usuarioId: 'u',
    achado: { id: 1, regra_key: 'r', regra_versao: 1, camada: 'c', modelo: null, confianca: 1 }, motivo: 'contexto', detalhe: null }
  await assert.rejects(options.mutationFn(input))
  options.onSettled?.()
  assert.ok(invalidations > 0, 'the partial write must also refresh the cache')
  await options.mutationFn(input)
  assert.equal(inserts, 1)
  assert.equal(closes, 2)
})

test('calls reject inverted or invalid periods without inventing a previous window', () => {
  const source = read('hooks/useLigacoes.ts')
  const helpers = source.slice(source.indexOf('function meiaNoiteBRT('), source.indexOf('// ── Consultas')).replace(/export function/g, 'function')
  const api = evaluate(`${helpers}; ({ janelaAnterior, janelaValida })`, {})
  for (const window of [{ from: 'invalid', to: null }, { from: '2026-10-04T03:00:00Z', to: '2026-10-03T03:00:00Z' }, { from: '2026-10-03T03:00:00Z', to: '2026-10-03T03:00:00Z' }]) {
    assert.equal(api.janelaValida(window), false)
    assert.equal(api.janelaAnterior('custom', window), null)
  }
  const valid = { from: '2026-10-02T03:00:00Z', to: '2026-10-04T03:00:00Z' }
  assert.equal(api.janelaValida(valid), true)
  assert.equal(api.janelaAnterior('custom', valid).from, '2026-09-30T03:00:00.000Z')
  assert.equal(api.janelaAnterior('custom', valid).to, valid.from)
  assert.equal(api.janelaAnterior('tudo'), null)
})

test('an unavailable calls comparison remains unavailable instead of becoming zero', () => {
  const source = read('pages/Ligacoes.tsx')
  const start = source.indexOf('  const totAnt = useMemo(')
  const calculation = source.slice(start, source.indexOf('\n', start))
  const context = { anterior: { from: '2026-09-01' }, anteriorQuery: { isSuccess: false }, linhasAnt: [], somar: () => ({ fez: 0 }), useMemo: (fn: () => unknown) => fn() }
  assert.equal(evaluate(`(() => { ${calculation}; return totAnt })()`, context), null)
  context.anteriorQuery.isSuccess = true
  assert.equal(evaluate(`(() => { ${calculation}; return totAnt })()`, context).fez, 0)
})

function lazyNavigation() {
  const source = read('pages/dashboard/tabs.ts').slice(read('pages/dashboard/tabs.ts').indexOf('export function irPara(')).replace('export function', 'function')
  const observers: Array<{ callback: () => void; disconnected: boolean }> = []
  const timers: Array<{ callback: () => void; duration: number; cleared: boolean }> = []
  let target: unknown = null, scrolled = 0, focused = 0
  const context = {
    document: { body: {}, getElementById: () => target },
    MutationObserver: class {
      record: { callback: () => void; disconnected: boolean }
      constructor(callback: () => void) { this.record = { callback, disconnected: false }; observers.push(this.record) }
      observe() {}
      disconnect() { this.record.disconnected = true }
    },
    setTimeout: (callback: () => void, duration: number) => { timers.push({ callback, duration, cleared: false }); return timers.length - 1 },
    clearTimeout: (id: number) => { timers[id].cleared = true },
    requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
  }
  const navigate = evaluate(`let cancelarSalto; let abaDoSalto; ${source}; irPara`, context)
  return { navigate, observers, timers, mount: () => { target = { scrollIntoView: () => { scrolled++ }, setAttribute: () => {}, focus: () => { focused++ } } }, counts: () => [scrolled, focused] }
}

test('dashboard navigation waits for the actual lazy section then releases its observer', () => {
  const nav = lazyNavigation()
  nav.navigate(() => {}, 'funil', 'funil-resumo')
  assert.equal(nav.observers.length, 1)
  assert.equal(nav.timers[0].duration, 15000)
  nav.observers[0].callback()
  assert.deepEqual(nav.counts(), [0, 0])
  nav.mount()
  nav.observers[0].callback()
  assert.deepEqual(nav.counts(), [1, 1])
  assert.equal(nav.observers[0].disconnected, true)
  assert.equal(nav.timers[0].cleared, true)
})

test('dashboard navigation cancels older pending targets and times out without polling', () => {
  const nav = lazyNavigation()
  nav.navigate(() => {}, 'funil', 'funil-resumo')
  nav.navigate(() => {}, 'equipe', 'ranking')
  assert.equal(nav.observers[0].disconnected, true)
  assert.equal(nav.timers[0].cleared, true)
  nav.timers[1].callback()
  assert.equal(nav.observers[1].disconnected, true)
  assert.deepEqual(nav.counts(), [0, 0])
})

test('flow save acknowledges its captured snapshot while preserving edits made during the request', async () => {
  const editor = read('pages/FluxosFunil.tsx').split('function EditorFluxo(')[1]
  const mutation = editor.slice(editor.indexOf('  const salvar = useMutation({'), editor.indexOf('  const noSelecionado ='))
  let resolve!: (value: unknown) => void
  const response = new Promise(value => { resolve = value })
  const builder = { update: () => builder, eq: () => response }
  const context: Record<string, any> = { useMutation: (value: unknown) => value, supabase: { from: () => builder },
    paraContrato: (nodes: unknown[]) => ({ nodes: [...nodes], edges: [] }), validarDefinicao: () => [],
    nodes: [{ id: 'old' }], edges: [], nome: 'Original', modo: 'automatico', escopo: '', fluxo: { id: 1, ativo: true },
    qc: { invalidateQueries: () => {} }, push: () => {},
    setNome: (fn: (value: unknown) => unknown) => { context.nome = fn(context.nome) },
    setModo: (fn: (value: unknown) => unknown) => { context.modo = fn(context.modo) },
    setSalvo: (value: unknown) => { context.salvo = value },
  }
  const options = evaluate(`${mutation}; salvar`, context)
  const pending = options.mutationFn()
  context.nome = 'Edited while saving'
  context.modo = 'alertar'
  context.nodes = [{ id: 'new' }]
  resolve({ error: null })
  const result = await pending
  options.onSuccess(result)
  assert.equal(context.nome, 'Edited while saving')
  assert.equal(context.modo, 'alertar')
  const snapshot = JSON.parse(context.salvo)
  assert.equal(snapshot.nome, 'Original')
  assert.equal(snapshot.modo, 'automatico')
  assert.equal(snapshot.definicao.nodes[0].id, 'old')
})

test('IA partial sends report persisted input and refresh history without replaying the request', async () => {
  const source = read('hooks/useIaTeste.ts')
  const fn = source.slice(source.indexOf('export class MensagemTestePersistida'), source.indexOf('// Traduz o motivo técnico')).replace('export class', 'class').replace('export function', 'function')
  let inserts = 0, requests = 0
  const invalidations: string[] = []
  const builder = new Proxy({}, { get: (_, key) => key === 'then'
    ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: { texto: 'cliente', papel: 'cliente', t: 1 }, error: null }).then(resolve)
    : () => { if (key === 'insert') inserts++; return builder } })
  const options = evaluate(`${fn}; useEnviarTurno()`, { useMutation: (value: unknown) => value,
    useQueryClient: () => ({ invalidateQueries: ({ queryKey }: { queryKey: string[] }) => invalidations.push(queryKey[0]) }),
    supabase: { from: () => builder }, IA_EDGE_URL: 'https://invalid.example', IA_EDGE_SECRET: 'synthetic',
    fetch: async () => { requests++; throw new Error('offline') } })
  let failure: any
  try { await options.mutationFn({ chatId: 'teste:synthetic', vendedorNome: 'Teste', nomeContato: 'Cliente', texto: 'cliente', historico: [] }) } catch (error) { failure = error }
  assert.equal(failure?.mensagemPersistida, true)
  assert.equal(inserts, 1)
  assert.equal(requests, 1)
  options.onSettled?.(undefined, failure)
  assert.ok(invalidations.includes('ia-teste-msgs'))
  assert.equal(requests, 1)
})

test('sold contacts disclose the annual source cap without widening the query', async () => {
  const source = read('pages/Vendidos.tsx')
  const fn = source.slice(source.indexOf('function useSoldContacts('), source.indexOf('function useSoldStats('))
  for (const length of [10000, 9999]) {
    const mock = queryMock(Array.from({ length }, () => ({ contact_id: 'synthetic' })))
    const options = evaluate(`${fn}; useSoldContacts({ search: '', vendor_id: '', estado: '', ano: '2026', mes: '', page: 0 })`, { ...mock, useQuery: (value: unknown) => value, PAGE_SIZE: 50 })
    const result = await options.queryFn()
    assert.equal(result.coberturaLimitada, length === 10000)
    assert.ok(mock.calls.some(c => c[0] === 'limit' && c[1] === 10000))
  }
})

test('a failed serialized save does not block later edits', async () => {
  const queue = createSequentialSave()
  const calls: number[] = []
  const first = queue(async () => { calls.push(1); throw new Error('synthetic') })
  const second = queue(async () => { calls.push(2); return 20 })
  await assert.rejects(first)
  assert.equal(await second, 20)
  assert.deepEqual(calls, [1, 2])
})

test('dispatch weights wait for all earlier writes, including a partially failed group', async () => {
  const source = read('pages/Disparos.tsx')
  const component = source.slice(source.indexOf('function DistribuicaoGlobalCard('))
  const functions = component.slice(component.indexOf('  async function persistirUm('), component.indexOf('  function igualar('))
  const calls: string[] = []
  let completeSlow!: (value: unknown) => void
  const slow = new Promise(value => { completeSlow = value })
  const context = { saveInOrder: createSequentialSave(), setPendingSaves: () => {}, alert: () => {}, qc: { invalidateQueries: async () => {} },
    supabase: { from: () => ({ update: () => ({ eq: (_: string, name: string) => {
      calls.push(name)
      if (name === 'a') return Promise.reject(new Error('synthetic'))
      return name === 'b' ? slow : Promise.resolve({ error: null })
    } }) }) } }
  const api = evaluate(`${functions}; ({ persistirUm, persistirTodos })`, context)
  const group = api.persistirTodos({ a: 10, b: 20 })
  void group.catch(() => {})
  const latest = api.persistirUm('c', 30)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['a', 'b'])
  completeSlow({ error: null })
  await Promise.all([group, latest])
  assert.deepEqual(calls, ['a', 'b', 'c'])
})

test('manual funnel move action uses all underlying lead IDs and avoids duplicate same-stage writes', () => {
  const source = read('pages/Funil.tsx')
  const start = source.indexOf('  const onDropOnColuna =')
  const callback = source.slice(start, source.indexOf('  return (', start))
  const writes: unknown[] = []
  const context = { setDraggingId: () => {}, error: null, updateStatus: { isPending: false, mutate: (value: unknown) => writes.push(value) }, colunaDoLead: () => 'atendendo' }
  const move = evaluate(`${callback}; onDropOnColuna`, context)
  move('atendendo', { id: 'lead', auditoria_ids: ['a', 'b'] })
  move('sem_atribuir', { id: 'lead', auditoria_ids: ['a', 'b'] })
  assert.equal(writes.length, 0)
  move('fechou', { id: 'lead', auditoria_ids: ['a', 'b'] })
  assert.equal((writes[0] as any).status, 'fechou')
  assert.deepEqual(Array.from((writes[0] as any).auditoria_ids), ['a', 'b'])
  context.updateStatus.isPending = true
  move('negociando', { id: 'lead' })
  assert.equal(writes.length, 1)
})

test('keyboard and touch funnel selector invokes the same move callback only for valid stages', () => {
  const source = ts.createSourceFile('Funil.tsx', read('pages/Funil.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'select' && node.attributes.getText(source).includes('Mover ${lead.nome')) {
      const attr = node.attributes.properties.find(n => ts.isJsxAttribute(n) && n.name.getText(source) === 'onChange') as ts.JsxAttribute | undefined
      callback = attr && ts.isJsxExpression(attr.initializer!) ? attr.initializer.expression : undefined
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(callback, 'native stage selector must be reachable without drag and drop')
  const selected: string[] = []
  const change = evaluate(`(${callback.getText(source)})`, { STATUS_VENDEDOR_VALUES: ['atendendo', 'fechou'], onMove: (value: string) => selected.push(value) })
  change({ target: { value: 'invalid' } })
  change({ target: { value: 'fechou' } })
  assert.deepEqual(selected, ['fechou'])
})

test('unmounting the General tab cannot cancel lazy navigation owned by the Dashboard shell', () => {
  const file = ts.createSourceFile('tabs.ts', read('pages/dashboard/tabs.ts'), ts.ScriptTarget.Latest, true)
  const body = file.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(file).replace(/^export /, '')).join('\n')
  const dashboard = ts.createSourceFile('Dashboard.tsx', read('pages/Dashboard.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let shellArgs = ''
  function findShell(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(dashboard) === 'useDashboardTab') shellArgs = node.arguments.map(arg => arg.getText(dashboard)).join(',')
    ts.forEachChild(node, findShell)
  }
  findShell(dashboard)
  let owner = 'shell', target: unknown = null, scrolled = 0
  const cleanups = new Map<string, Array<() => void>>()
  const observers: Array<{ disconnected: boolean; notify: () => void }> = []
  const context = { URLSearchParams,
    useSearchParams: () => [new URLSearchParams('tab=geral'), () => {}],
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown) => { const result = fn(); if (typeof result === 'function') cleanups.set(owner, [...(cleanups.get(owner) ?? []), result as () => void]) },
    localStorage: { getItem: () => 'geral', setItem: () => {} }, window: { location: { search: '?tab=geral' } },
    document: { body: {}, getElementById: () => target }, setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: class {
      disconnected = false
      constructor(public callback: () => void) { observers.push(this) }
      observe() {}
      disconnect() { this.disconnected = true }
      notify() { if (!this.disconnected) this.callback() }
    },
  }
  const api = evaluate(`${body}; ({ useDashboardTab, irPara, mountShell: () => useDashboardTab(${shellArgs}) })`, context)
  api.mountShell()
  owner = 'general'
  const [, setTab] = api.useDashboardTab()
  api.irPara(setTab, 'funil', 'delayed-section')
  for (const cleanup of cleanups.get('general') ?? []) cleanup()
  assert.equal(observers[0].disconnected, false)
  target = { scrollIntoView: () => { scrolled++ }, setAttribute: () => {}, focus: () => {} }
  observers[0].notify()
  assert.equal(scrolled, 1)
  target = null
  api.irPara(setTab, 'equipe', 'another-delayed-section')
  for (const cleanup of cleanups.get('shell') ?? []) cleanup()
  assert.equal(observers[1].disconnected, true)
})
