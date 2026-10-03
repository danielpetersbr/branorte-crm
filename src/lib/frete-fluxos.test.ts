import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { resolverDestino, resolverDestinoPorCidade } from './calcFrete'

// Run the real page handlers against controlled network responses, without
// mounting authenticated hooks or submitting any freight request.
function handlers(file: string, names: string[], context: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions: ts.FunctionDeclaration[] = []
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) functions.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(functions.length, names.length)
  const js = ts.transpileModule(functions.map(n => n.getText(ast).replace(/^export(?: default)? /, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(`${js}\n({${names.join(',')}})`, { AbortController, ...context })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

for (const page of ['FreteSolicitar', 'CotarFrete']) {
  test(`${page}: native draft fields cannot be edited while submitting`, () => {
    const source = readFileSync(new URL(`../pages/${page}.tsx`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === page)!
    let fields = 0
    function disabled(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
      const prop = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'disabled') as ts.JsxAttribute | undefined
      if (!prop) return false
      if (!prop.initializer) return true
      if (!ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) return false
      return vm.runInNewContext(prop.initializer.expression.getText(ast), { enviando: true }) === true
    }
    function visit(node: ts.Node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['input', 'textarea', 'select'].includes(node.tagName.getText(ast))) {
        fields++
        let locked = false
        for (let parent = node.parent; parent && parent !== component; parent = parent.parent) {
          if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(ast) === 'fieldset' && disabled(parent.openingElement)) locked = true
        }
        if (!locked) locked = disabled(node)
        assert.equal(locked, true, `${page} ${node.tagName.getText(ast)} allows changing the submitted draft`)
      }
      ts.forEachChild(node, visit)
    }
    visit(component)
    assert.ok(fields >= 3)
  })
}

test('a freight draft cannot reset or show completion while transporter enqueue is still pending', async () => {
  const queue = deferred<unknown>(), envioEmCurso = { current: false }
  let completed = false, reset = false
  const page = handlers('../pages/FreteSolicitar.tsx', ['enviar', 'novaSolicitacao'], {
    envioEmCurso, envioController: { current: null }, montado: { current: true },
    setEnviando() {}, setErro() {}, uf: 'SC', cidade: 'Grão Pará', clienteNome: 'Cliente fictício',
    valorNota: '100', parseBRL: () => 100, itens: [{ nome: 'Silo', qtd: 1 }], latLng: { lat: -28, lng: -49 },
    criar: { mutateAsync: async () => ({ id: 'synthetic', codigo: 'TESTE' }) }, enfileirar: { mutateAsync: () => queue.promise },
    origem: 'pagina', profile: null, params: new URLSearchParams(), distancia: 10, descricao: '',
    carga: { peso_kg: 100, comprimento_m: 1, largura_m: 1, altura_m: 1, indivisivel: false },
    volume: 1, caminhao: null, pisoAntt: null, obs: '', tipoCotacao: 'cotacao', urgente: false,
    setOkCodigo: () => { completed = true }, setOkSolicId() {}, setOkEnviado() {},
    transportadoras: { data: [{ id: 'synthetic-transporter', ativo: true, autorizado: true }] },
    invalidarDestino: () => { reset = true }, FORM_VAZIO: {},
    ...Object.fromEntries(['setItens', 'setForm', 'setUf', 'setCidade', 'setLatLng', 'setDistancia', 'setCalcMsg', 'setClienteNome', 'setDescricao', 'setObs', 'setValorNota', 'setTipoCotacao', 'setUrgente'].map(name => [name, () => {}])),
  })
  const pending = page.enviar()
  await Promise.resolve(); await Promise.resolve()
  const completionBeforeQueue = completed
  page.novaSolicitacao()
  const resetBeforeQueue = reset
  queue.resolve({ enfileirados: 1 })
  await pending
  assert.equal(completionBeforeQueue, false)
  assert.equal(resetBeforeQueue, false)
  assert.equal(completed, true)
  assert.equal(envioEmCurso.current, false)
})

test('a failed freight refusal stays actionable instead of confirming registration', async () => {
  let refused = false, message = ''
  const { recusar } = handlers('../pages/CotarFrete.tsx', ['recusar'], {
    confirm: () => true, token: 'synthetic-token', tokenAtual: { current: 'synthetic-token' },
    acaoEmCurso: { current: false }, montado: { current: true },
    supabase: { functions: { invoke: async () => ({ data: null, error: new Error('offline') }) } },
    setRecusado: (v: boolean) => { refused = v }, setErro: (v: string) => { message = v }, setEnviando: () => {},
  })
  await recusar()
  assert.equal(refused, false)
  assert.ok(message)
})

test('a rejected refusal domain response never confirms registration', async () => {
  let refused = false
  const { recusar } = handlers('../pages/CotarFrete.tsx', ['recusar'], {
    confirm: () => true, token: 'synthetic-token', tokenAtual: { current: 'synthetic-token' },
    acaoEmCurso: { current: false }, montado: { current: true },
    supabase: { functions: { invoke: async () => ({ data: { error: 'encerrada' }, error: null }) } },
    setRecusado: (v: boolean) => { refused = v }, setErro: () => {}, setEnviando: () => {},
  })
  await recusar()
  assert.equal(refused, false)
})

for (const action of ['enviar', 'recusar']) {
  test(`freight ${action} only confirms the explicit successful response`, async () => {
    let success = false
    const page = handlers('../pages/CotarFrete.tsx', [action], {
      confirm: () => true, token: 'synthetic-token', tokenAtual: { current: 'synthetic-token' },
      acaoEmCurso: { current: false }, montado: { current: true },
      valor: '100', prazo: '2', obs: '', parseMoeda: Number,
      supabase: { functions: { invoke: async () => ({ data: {}, error: null }) } },
      setRecusado: () => { success = true }, setEnviado: () => { success = true }, setErro() {}, setEnviando() {},
    })
    await page[action]()
    assert.equal(success, false)
  })
}

test('a freight destination response is discarded when the edited address invalidates its request', async () => {
  const lookup = deferred<unknown>(), control = { current: null as AbortController | null }
  let destination: unknown = null, km = ''
  const context = {
    cep: '88890-000', consultaDestino: control,
    setDestino: (v: unknown) => { destination = v }, setKmManual: (v: string) => { km = v },
    setLoadingDist: () => {}, setErrDist: () => {}, resolverDestino: () => lookup.promise,
  }
  const { buscarDistancia } = handlers('../pages/FreteCotacao.tsx', ['buscarDistancia'], context)
  const pending = buscarDistancia()
  control.current?.abort()
  lookup.resolve({ cidade: 'Grão Pará', uf: 'SC', distancia_km: 125 })
  await pending
  assert.equal(destination, null)
  assert.equal(km, '')
})

test('submitting twice while city lookup is pending creates only one freight request', async () => {
  const lookup = deferred<{lat: number; lng: number}>()
  let inserted = 0
  const context = {
    envioEmCurso: { current: false }, envioController: { current: null }, montado: { current: true },
    setEnviando: () => {}, setErro: () => {}, uf: 'SC', cidade: 'Grão Pará', clienteNome: 'Cliente fictício',
    valorNota: '100,00', parseBRL: () => 100, itens: [{ nome: 'Silo', qtd: 1 }], latLng: null,
    geocodificarCidade: () => lookup.promise,
    criar: { mutateAsync: async () => { inserted++; return { id: 'synthetic', codigo: 'TESTE' } } },
    origem: 'pagina', profile: null, params: new URLSearchParams(), distancia: null, descricao: '',
    carga: { peso_kg: 100, comprimento_m: 1, largura_m: 1, altura_m: 1, indivisivel: false },
    volume: 1, caminhao: null, pisoAntt: null, obs: '', tipoCotacao: 'cotacao', urgente: false,
    setOkCodigo: () => {}, setOkSolicId: () => {}, setOkEnviado: () => {}, transportadoras: { data: [] },
  }
  const { enviar } = handlers('../pages/FreteSolicitar.tsx', ['enviar'], context)
  const first = enviar(), second = enviar()
  lookup.resolve({ lat: -28.18, lng: -49.22 })
  await Promise.all([first, second])
  assert.equal(inserted, 1)
})

test('changing destination during city lookup prevents submitting coordinates of the previous city', async () => {
  const lookup = deferred<{lat: number; lng: number}>()
  const controller = { current: null as AbortController | null }
  let inserted = 0
  const { enviar } = handlers('../pages/FreteSolicitar.tsx', ['enviar'], {
    envioEmCurso: { current: false }, envioController: controller, montado: { current: true },
    setEnviando: () => {}, setErro: () => {}, uf: 'SC', cidade: 'Grão Pará', clienteNome: 'Cliente fictício',
    valorNota: '100,00', parseBRL: () => 100, itens: [{ nome: 'Silo', qtd: 1 }], latLng: null,
    geocodificarCidade: () => lookup.promise,
    criar: { mutateAsync: async () => { inserted++; return { id: 'synthetic', codigo: 'TESTE' } } },
    origem: 'pagina', profile: null, params: new URLSearchParams(), distancia: null, descricao: '',
    carga: { peso_kg: 100, comprimento_m: 1, largura_m: 1, altura_m: 1, indivisivel: false },
    volume: 1, caminhao: null, pisoAntt: null, obs: '', tipoCotacao: 'cotacao', urgente: false,
    setOkCodigo: () => {}, setOkSolicId: () => {}, setOkEnviado: () => {}, transportadoras: { data: [] },
  })
  const pending = enviar()
  controller.current?.abort()
  lookup.resolve({ lat: -28.18, lng: -49.22 })
  await pending
  assert.equal(inserted, 0)
})

test('catalogue audit surfaces failed count queries instead of reporting zero missing prices and photos', async () => {
  const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: null, data: null, error: new Error('offline') }).then(resolve) }
  for (const name of ['select', 'eq', 'is', 'in', 'lt']) chain[name] = () => chain
  const { usePrecosAudit } = handlers('../hooks/usePrecosBranorte.ts', ['usePrecosAudit'], {
    useQuery: (options: unknown) => options, supabase: { from: () => chain },
  })
  await assert.rejects(usePrecosAudit().queryFn(), /offline/)
})

test('cancelling CEP resolution stops before geocoding or routing the old address', async () => {
  const controller = new AbortController(), originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    assert.equal(init?.signal, controller.signal)
    controller.abort()
    return new Response(JSON.stringify({ localidade: 'Grão Pará', uf: 'SC', bairro: '', logradouro: '' }))
  }
  try {
    await assert.rejects(resolverDestino('88890-000', controller.signal), { name: 'AbortError' })
    assert.equal(calls.length, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('a cancelled city resolution does not downgrade cancellation to a manual-distance success', async () => {
  const controller = new AbortController(), originalFetch = globalThis.fetch
  controller.abort()
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('[]') }
  try {
    await assert.rejects(resolverDestinoPorCidade('Grão Pará', 'SC', controller.signal), { name: 'AbortError' })
    assert.equal(calls, 0)
  } finally { globalThis.fetch = originalFetch }
})
