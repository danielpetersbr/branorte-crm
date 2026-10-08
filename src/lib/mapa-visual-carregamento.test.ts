import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement, type ReactElement } from 'react'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { modoMapaVisual, selecionarMapaVisual } from './mapa-visual'
import { todasAsLinhas } from './rpc-paginado'

type Element = ReactElement<Record<string, any>>
function elements(node: unknown, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(n => elements(n, predicate))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  return [...(predicate(element) ? [element] : []), ...elements(element.props.children, predicate)]
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : ''
}
const pending = () => ({ isPending: true, isError: false, data: undefined, error: null, refetch() {} })
const resumo = { vendidos: 7, orcados: 11, visitas: 5, visitas_no_mapa: 3, visitas_sem_localizacao: 2 }

// Execute the real page and its event handlers without Leaflet or a browser.
function pageFixture(initialMode: string | null = null, role = 'vendor') {
  const file = new URL('../pages/MapaVisual.tsx', import.meta.url)
  const ast = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && ['MapaVisual', 'CategoriaMapaVisual', 'LauncherMapaVisual'].includes(node.name?.text ?? '')
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'CATEGORIAS'))
  let mode = initialMode
  const calls: string[] = []
  const retries: string[] = []
  const states: Record<string, any> = { resumo: { ...pending(), data: resumo, isPending: false, isStale: false }, visitas: pending(), orcamentos: pending() }
  const context = {
    React: { createElement }, Link: 'a', ArrowLeft: 'ArrowLeft', CheckCircle2: 'CheckCircle2', ChevronRight: 'ChevronRight',
    FileText: 'FileText', Map: 'Map', MapPin: 'MapPin', LoaderCircle: 'LoaderCircle', MapaLimpo: 'MapaLimpo',
    NUMERO: new Intl.NumberFormat('pt-BR'), modoMapaVisual, selecionarMapaVisual,
    useMemo: (fn: () => unknown) => fn(),
    useAuth: () => ({ profile: { role } }),
    useSearchParams: () => [new URLSearchParams(mode ? { modo: mode } : {}), (params: { modo?: string }) => { mode = params.modo ?? null }],
    useOrcamentosMapa: () => { calls.push('orcamentos'); return states.orcamentos },
    useVisitas: () => { calls.push('visitas'); return states.visitas },
    useMapaVisualResumo: (enabled = true) => { if (enabled) calls.push('resumo'); return { ...states.resumo, refetch: () => retries.push('resumo') } },
    useMapaVisualPontos: (modo: string) => {
      const source = modo === 'visitas' ? 'visitas' : 'orcamentos'
      calls.push(source)
      return { ...states[source], refetch: () => retries.push(source) }
    },
  }
  const js = ts.transpileModule(declarations.map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const component = vm.runInNewContext(js + '\nMapaVisual', context) as () => Element
  return {
    calls, retries, states,
    mode: () => mode,
    render() {
      calls.length = 0
      const element = component()
      return typeof element.type === 'function' ? (element.type as Function)(element.props) as Element : element
    },
  }
}

test('menu busca somente o resumo e permite escolher sem aguardar queries de pontos desativadas', () => {
  const fixture = pageFixture()
  const tree = fixture.render()
  assert.deepEqual(fixture.calls, ['resumo'])
  const cards = elements(tree, e => e.type === 'button' && /^Vendidos:|^Orçados:|^Visitas:/.test(e.props['aria-label']))
  assert.deepEqual(cards.map(c => c.props['aria-label']), ['Vendidos: 7', 'Orçados: 11', 'Visitas: 5'])
  assert.ok(cards.every(c => c.props.disabled === false))
  assert.match(text(tree).replace(/\s+/g, ' '), /3 no mapa · 2 sem localização/)
  cards[2].props.onClick()
  assert.equal(fixture.mode(), 'visitas')
  fixture.render()
  assert.deepEqual(fixture.calls, ['visitas'])
})

test('papel exclusivo não oferece mapa completo e preserva escolha das três categorias', () => {
  for (const mode of ['vendidos', 'orcados', 'visitas']) {
    const fixture = pageFixture(null, 'mapa_visual')
    const tree = fixture.render()
    assert.equal(elements(tree, e => e.type === 'a' && e.props.to === '/mapa-visitas').length, 0)
    const cards = elements(tree, e => e.type === 'button' && /^Vendidos:|^Orçados:|^Visitas:/.test(e.props['aria-label']))
    assert.equal(cards.length, 3)
    cards[['vendidos', 'orcados', 'visitas'].indexOf(mode)].props.onClick()
    assert.equal(fixture.mode(), mode)
    const back = elements(fixture.render(), e => e.type === 'button' && e.props['aria-label'] === 'Voltar às categorias')[0]
    back.props.onClick()
    assert.equal(fixture.mode(), null)
  }
  for (const role of ['admin', 'vendor', 'mapa', 'representante']) {
    assert.equal(elements(pageFixture(null, role).render(), e => e.type === 'a' && e.props.to === '/mapa-visitas').length, 1, role)
  }
})

for (const [mode, source] of [['vendidos', 'orcamentos'], ['orcados', 'orcamentos'], ['visitas', 'visitas']] as const) {
  test(`${mode} permanece na categoria durante carregamento e erro, com tentar novamente e voltar`, () => {
    const fixture = pageFixture(mode)
    let tree = fixture.render()
    assert.deepEqual(fixture.calls, [source])
    assert.match(text(tree), /Carregando/)
    assert.doesNotMatch(text(tree), /Selecione um mapa/)
    fixture.states[source] = { ...pending(), isPending: false, isError: true, error: new Error('Prazo de carregamento excedido.') }
    tree = fixture.render()
    assert.match(text(tree), /Prazo de carregamento excedido/)
    const retry = elements(tree, e => e.type === 'button' && text(e) === 'Tentar novamente')[0]
    assert.ok(retry)
    retry.props.onClick()
    assert.deepEqual(fixture.retries, [source])
    const back = elements(tree, e => e.type === 'button' && e.props['aria-label'] === 'Voltar às categorias')[0]
    back.props.onClick()
    assert.equal(fixture.mode(), null)
    fixture.render()
    assert.deepEqual(fixture.calls, ['resumo'])
  })
}

test('falha no resumo não inventa contadores zero e permite repetir a leitura', () => {
  const fixture = pageFixture()
  fixture.states.resumo = { ...pending(), isPending: false, isError: true, error: new Error('Sem conexão') }
  const tree = fixture.render()
  const cards = elements(tree, e => e.type === 'button' && /^Vendidos:|^Orçados:|^Visitas:/.test(e.props['aria-label']))
  assert.ok(cards.every(c => !c.props.disabled && /indisponível/.test(c.props['aria-label'])))
  assert.equal(cards.length, 3)
  assert.doesNotMatch(text(tree), /\b0\b/)
  elements(tree, e => e.type === 'button' && text(e) === 'Tentar novamente')[0].props.onClick()
  assert.deepEqual(fixture.retries, ['resumo'])
})

test('pode escolher antes do resumo e bloqueia zero apenas quando confirmado por resumo fresco', () => {
  const fixture = pageFixture()
  fixture.states.resumo = pending()
  let tree = fixture.render()
  let cards = elements(tree, e => e.type === 'button' && /^Vendidos:|^Orçados:|^Visitas:/.test(e.props['aria-label']))
  assert.ok(cards.every(c => !c.props.disabled))
  fixture.states.resumo = { ...pending(), isPending: false, isStale: false, data: { ...resumo, visitas_no_mapa: 0, visitas_sem_localizacao: 5 } }
  tree = fixture.render()
  cards = elements(tree, e => e.type === 'button' && /^Visitas:/.test(e.props['aria-label']))
  assert.equal(cards[0].props.disabled, true)
  assert.match(text(tree), /Nenhum cliente com localização/)
  fixture.states.resumo.isStale = true
  cards = elements(fixture.render(), e => e.type === 'button' && /^Visitas:/.test(e.props['aria-label']))
  assert.equal(cards[0].props.disabled, false)
})

function hooksFixture(rows: Record<string, any>[] = [], options: { hang?: boolean; hangFrom?: number; timeoutMs?: number; fail?: boolean; cache?: QueryClient; state?: Record<string, any> } = {}) {
  const file = new URL('../hooks/useMapaVisual.ts', import.meta.url)
  const ast = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const requests: { rpc: string; filters: [string, string, unknown][]; range?: [number, number]; signal?: AbortSignal }[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const effects: (() => void)[] = []
  const supabase = { rpc(name: string) {
    const request = { rpc: name, filters: [] as [string, string, unknown][], range: undefined as [number, number] | undefined, signal: undefined as AbortSignal | undefined }
    const builder = {
      eq(field: string, value: unknown) { request.filters.push(['eq', field, value]); return builder },
      lte(field: string, value: unknown) { request.filters.push(['lte', field, value]); return builder },
      or(expression: string) { request.filters.push(['or', expression, undefined]); return builder },
      range(de: number, ate: number) { request.range = [de, ate]; return builder },
      abortSignal(signal: AbortSignal) { request.signal = signal; return builder },
      then(resolve: Function, reject: Function) {
        requests.push(request)
        if (options.hang || options.hangFrom != null && (request.range?.[0] ?? 0) >= options.hangFrom) return new Promise(() => {})
        if (options.fail) return Promise.resolve({ data: null, error: new Error('offline') }).then(resolve as any, reject as any)
        let filtered = rows
        for (const [op, field, value] of request.filters) {
          filtered = filtered.filter(r => op === 'eq' ? r[field] === value
            : op === 'lte' ? r[field] <= (value as number) : r.vendido === true || r.n_vendas > 0)
        }
        return Promise.resolve({ data: request.range ? filtered.slice(request.range[0], request.range[1] + 1) : [resumo], error: null, count: filtered.length }).then(resolve as any, reject as any)
      },
    }
    return builder
  } }
  const context = {
    useQuery: (query: any) => ({ ...query, ...options.state }),
    useQueryClient: () => options.cache,
    useEffect: (effect: () => void) => effects.push(effect),
    supabase, todasAsLinhas, selecionarMapaVisual, AbortController,
    setTimeout(fn: () => void, ms: number) {
      const timer = setTimeout(fn, options.timeoutMs ?? ms)
      timers.add(timer)
      return timer
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { clearTimeout(timer); timers.delete(timer) },
  }
  const js = ts.transpileModule(ast.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const hooks = vm.runInNewContext(js + '\n({ useMapaVisualResumo, useMapaVisualPontos, comPrazoMapaVisual, validarResumoMapaVisual })', context)
  return { ...hooks, requests, timers, runEffects: () => effects.forEach(effect => effect()) }
}

const quote = (key: string, sold = false, sales = 0) => ({ cli_key: key, cliente: key, vendido: sold, n_vendas: sales,
  telefone: null, fone: null, vendedor: 'Marcela', uf: 'RO', cidade: 'Porto Velho', total: 0, data_recente: null, lat: -8, lng: -63 })
const visit = (id: string, marked = true, sold = false, sales = 0) => ({ id, nome: id, visitar: marked, vendido: sold, n_vendas: sales,
  telefone: null, vendedor_nome: 'Marcela', estado: 'RO', cidade: 'Porto Velho', interesse: 'Retroescavadeira', valor_negociando: 0, lat: -8, lng: -63 })

test('busca só a categoria no servidor antes de paginar e preserva seleção e detalhes', async () => {
  const quotes = [quote('sem-venda'), quote('vendido', true), quote('conversao-por-venda', false, 2), { ...quote('sem-coord'), lat: null }]
  const visits = [visit('pode'), { ...visit('para'), visita_obrigatoria: true }, visit('nao-marcado', false), visit('vendido', true, true), visit('convertido', true, false, 1), { ...visit('sem-coord'), lat: null }]
  for (const [mode, rows] of [['vendidos', quotes], ['orcados', quotes], ['visitas', visits]] as const) {
    const hooks = hooksFixture(rows)
    const opts = hooks.useMapaVisualPontos(mode)
    const data = await opts.queryFn({ signal: new AbortController().signal })
    const selected = opts.select(data)
    const expected = selecionarMapaVisual(quotes as any, visits as any)[mode]
    assert.deepEqual(JSON.parse(JSON.stringify(selected)), JSON.parse(JSON.stringify(expected)))
    const request = hooks.requests[0]
    assert.equal(request.rpc, mode === 'visitas' ? 'mapa_visual_visitas' : 'mapa_orcamentos_v2')
    const filters = mode === 'vendidos' ? [['or', 'vendido.eq.true,n_vendas.gt.0', undefined]]
      : mode === 'visitas' ? [['eq', 'visitar', true], ['eq', 'vendido', false], ['lte', 'n_vendas', 0]]
        : [['eq', 'vendido', false], ['lte', 'n_vendas', 0]]
    assert.deepEqual(Array.from(request.filters, f => Array.from(f)), filters)
    assert.deepEqual(Array.from(request.range!), [0, 4999])
    assert.equal(request.signal?.aborted, false)
    assert.ok(opts.queryKey.includes(mode), 'sold and quoted caches must be separate')
    assert.equal(hooks.timers.size, 0)
  }
})

test('contagem filtrada evita segunda página de clientes que pertencem à outra categoria', async () => {
  const rows = Array.from({ length: 6011 }, (_, i) => quote(String(i), i < 1869))
  const hooks = hooksFixture(rows)
  const opts = hooks.useMapaVisualPontos('vendidos')
  const data = await opts.queryFn({ signal: new AbortController().signal })
  assert.equal(data.length, 1869)
  assert.equal(hooks.requests.length, 1)
})

test('prazo total encerra transporte travado, aborta todas as páginas e limpa timer/listener', async () => {
  const hooks = hooksFixture([], { hang: true, timeoutMs: 15 })
  const parent = new AbortController()
  const opts = hooks.useMapaVisualPontos('visitas')
  await assert.rejects(opts.queryFn({ signal: parent.signal }), /demorou demais/)
  assert.equal(hooks.requests[0].signal?.aborted, true)
  assert.equal(hooks.timers.size, 0)
  const reason = hooks.requests[0].signal?.reason
  parent.abort(new Error('saída posterior'))
  assert.equal(hooks.requests[0].signal?.reason, reason)
})

test('desmontar observador TanStack cancela o transporte e cache quente evita refetch na reentrada', async () => {
  const hung = hooksFixture([], { hang: true })
  const client = new QueryClient()
  const observer = new QueryObserver(client, hung.useMapaVisualPontos('visitas'))
  const unsubscribe = observer.subscribe(() => {})
  await new Promise(resolve => setImmediate(resolve))
  unsubscribe()
  assert.equal(hung.requests[0].signal?.aborted, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hung.timers.size, 0)
  client.clear()
  const cached = hooksFixture([visit('pode')])
  const cacheClient = new QueryClient()
  const first = new QueryObserver(cacheClient, cached.useMapaVisualPontos('visitas'))
  const stop = first.subscribe(() => {})
  await first.refetch()
  stop()
  const second = new QueryObserver(cacheClient, cached.useMapaVisualPontos('visitas'))
  const stopAgain = second.subscribe(() => {})
  assert.equal(second.getCurrentResult().data?.pontos.length, 1)
  assert.equal(cached.requests.length, 1)
  stopAgain()
  cacheClient.clear()
})

test('resumo rejeita vazio, valores inválidos ou contagem incoerente sem inventar zeros', async () => {
  const hooks = hooksFixture()
  assert.deepEqual(hooks.validarResumoMapaVisual([resumo]), resumo)
  for (const data of [null, [], [resumo, resumo], [{ ...resumo, vendidos: null }], [{ ...resumo, orcados: -1 }], [{ ...resumo, visitas: 6 }]]) {
    assert.throws(() => hooks.validarResumoMapaVisual(data), /conferir as quantidades/)
  }
  const opts = hooks.useMapaVisualResumo()
  assert.deepEqual(await opts.queryFn({ signal: new AbortController().signal }), resumo)
  assert.equal(hooks.requests[0].rpc, 'mapa_visual_resumo')
  assert.equal(hooks.timers.size, 0)
})

test('marcações e mudanças de localização invalidam também o resumo', async () => {
  for (const [file, names] of [
    ['../hooks/useVisitas.ts', ['useDefinirVisita', 'useGeocodarVisitas', 'useGeocodarCidades', 'useDefinirCidadeVisita']],
    ['../hooks/useViagens.ts', ['useSalvarLocalizacaoCliente', 'useCorrigirLocalDaParada']],
  ] as const) {
    const url = new URL(file, import.meta.url)
    const ast = ts.createSourceFile(file, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const name of names) {
      const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
      assert.ok(fn, name)
      const invalidated: string[] = []
      const js = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
      const options = vm.runInNewContext(js + `\n${name}()`, {
        useQueryClient: () => ({ invalidateQueries: ({ queryKey }: { queryKey: string[] }) => invalidated.push(queryKey[0]) }),
        useMutation: (opts: unknown) => opts,
      })
      await options.onSuccess()
      assert.ok(invalidated.includes('mapa-visual-resumo'), name)
    }
  }
})

test('resumo com acesso negado descarta somente caches visuais inativos; falha de rede os preserva', () => {
  for (const [error, remove] of [[{ code: '42501' }, true], [{ status: 401 }, true], [{ status: 403 }, true], [{ code: 'PGRST301' }, true], [{ code: 'PGRST116' }, false], [new Error('offline'), false]] as const) {
    const cache = new QueryClient()
    const sold = ['orcamentos-mapa', 'visual', 'vendidos']
    const active = ['visitas', 'visual', 'visitas']
    const original = ['orcamentos-mapa']
    for (const key of [sold, active, original]) cache.setQueryData(key, ['old'])
    const observer = new QueryObserver(cache, { queryKey: active, staleTime: Infinity })
    const stop = observer.subscribe(() => {})
    const hooks = hooksFixture([], { cache, state: { isError: true, error } })
    hooks.useMapaVisualResumo()
    hooks.runEffects()
    assert.equal(cache.getQueryData(sold) === undefined, remove)
    assert.ok(cache.getQueryData(active), 'active error screen must not lose its own query')
    assert.ok(cache.getQueryData(original), 'original map cache remains untouched')
    stop()
    cache.clear()
  }
})

test('resumo fresco sem pontos descarta o cache correspondente antes de um link direto; resumo obsoleto não apaga', () => {
  for (const isStale of [false, true]) {
    const cache = new QueryClient()
    const visits = ['visitas', 'visual', 'visitas']
    const sold = ['orcamentos-mapa', 'visual', 'vendidos']
    cache.setQueryData(visits, [visit('antigo')])
    cache.setQueryData(sold, [quote('vendido', true)])
    const hooks = hooksFixture([], { cache, state: { isSuccess: true, isStale, data: { ...resumo, visitas_no_mapa: 0, visitas_sem_localizacao: 5 } } })
    hooks.useMapaVisualResumo()
    hooks.runEffects()
    assert.equal(cache.getQueryData(visits) === undefined, !isStale)
    assert.ok(cache.getQueryData(sold))
    cache.clear()
  }
})

test('nova resposta de resumo descarta pontos anteriores mesmo com contagem positiva; resumo cached anterior conserva reentrada', () => {
  for (const updatedAt of [999, 1000, 1001]) {
    const cache = new QueryClient()
    const sold = ['orcamentos-mapa', 'visual', 'vendidos']
    cache.setQueryData(sold, [quote('UF-revogada', true)], { updatedAt })
    const hooks = hooksFixture([], { cache, state: { isSuccess: true, isStale: false, data: resumo, dataUpdatedAt: 1000 } })
    hooks.useMapaVisualResumo()
    hooks.runEffects()
    assert.equal(cache.getQueryData(sold) === undefined, updatedAt <= 1000)
    cache.clear()
  }
})

test('prazo inclui primeira página e restantes, cancelando o mesmo signal compartilhado', async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => quote(String(i), true))
  const hooks = hooksFixture(rows, { hangFrom: 5000, timeoutMs: 20 })
  const opts = hooks.useMapaVisualPontos('vendidos')
  await assert.rejects(opts.queryFn({ signal: new AbortController().signal }), /demorou demais/)
  assert.equal(hooks.requests.length, 3)
  assert.ok(hooks.requests.every(r => r.signal === hooks.requests[0].signal && r.signal?.aborted))
  assert.equal(hooks.timers.size, 0)
})

test('categoria pronta entrega pontos ao mapa; vazia permanece na categoria com voltar', () => {
  const fixture = pageFixture('visitas')
  const category = selecionarMapaVisual([], [visit('pode')] as any).visitas
  fixture.states.visitas = { ...pending(), isPending: false, data: category }
  let tree = fixture.render()
  assert.equal(elements(tree, e => e.type === 'MapaLimpo')[0].props.pontos, category.pontos)
  fixture.states.visitas.data = { pontos: [], total: 5, semLocalizacao: 5 }
  tree = fixture.render()
  assert.match(text(tree), /Nenhum cliente com localização/)
  assert.doesNotMatch(text(tree), /Selecione um mapa/)
  assert.equal(elements(tree, e => e.type === 'button' && e.props['aria-label'] === 'Voltar às categorias').length, 1)
})

test('acesso negado nos pontos descarta outras categorias e resumo sem remover query ativa', () => {
  const cache = new QueryClient()
  const active = ['orcamentos-mapa', 'visual', 'vendidos']
  const other = ['visitas', 'visual', 'visitas']
  const summary = ['mapa-visual-resumo']
  cache.setQueryData(active, [quote('atual', true)])
  cache.setQueryData(other, [visit('anterior')])
  cache.setQueryData(summary, resumo)
  const observer = new QueryObserver(cache, { queryKey: active, staleTime: Infinity })
  const stop = observer.subscribe(() => {})
  const hooks = hooksFixture([], { cache, state: { isError: true, error: { code: '42501' } } })
  hooks.useMapaVisualPontos('vendidos')
  hooks.runEffects()
  assert.equal(cache.getQueryData(other), undefined)
  assert.equal(cache.getQueryData(summary), undefined)
  assert.ok(cache.getQueryData(active))
  stop()
  cache.clear()
})
