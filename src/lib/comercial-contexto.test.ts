import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement, type ReactElement } from 'react'
import { QueryClient, QueryObserver, type QueryObserverOptions } from '@tanstack/react-query'
import { QueryNotice } from '../components/ui/QueryNotice'
import { digitosDaBusca } from './wa-funil'

// Run the actual query options, filter and rendered event handlers with synthetic
// data. No Supabase client, browser session or persisted record is used.
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function find(ast: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined
  function visit(node: ts.Node) {
    if (!result && predicate(node)) result = node
    if (!result) ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, 'Expected source node exists')
  return result
}

function evaluate(text: string, name: string, context: Record<string, unknown>) {
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return vm.runInNewContext(js + '\n' + name, context)
}

function realFunction(file: string, name: string, context: Record<string, unknown>) {
  const ast = source(file)
  const declaration = find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  return evaluate(declaration.getText(ast).replace(/^export\s+(default\s+)?/, ''), name, context)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

type SoldData = { contacts: { id: string; ano: string }[]; total: number; coberturaLimitada: boolean }
const sold = (ano: string, total: number): SoldData => ({ contacts: [{ id: 'cliente-' + ano, ano }], total, coberturaLimitada: false })
const filters = (ano: string) => ({ search: '', vendor_id: '', estado: '', ano, mes: '', page: 0 })
function soldOptions(ano: string): QueryObserverOptions<SoldData> {
  const options = realFunction('../pages/Vendidos.tsx', 'useSoldContacts', { useQuery: (value: unknown) => value })
  return { ...options(filters(ano)), retry: false }
}

test('Vendidos aguarda o novo recorte sem apresentar linhas e contagem do ano anterior', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const next = deferred<SoldData>()
  const observer = new QueryObserver(client, { ...soldOptions('2026'), queryFn: async () => sold('2026', 17) })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await observer.refetch()
    observer.setOptions({ ...soldOptions('2025'), queryFn: () => next.promise })
    assert.equal(observer.getCurrentResult().data, undefined)
    assert.equal(observer.getCurrentResult().isLoading, true)
    next.resolve(sold('2025', 2))
    await observer.refetch()
    assert.equal(observer.getCurrentResult().data?.contacts[0].ano, '2025')
    assert.equal(observer.getCurrentResult().data?.total, 2)
  } finally {
    next.resolve(sold('2025', 2))
    unsubscribe()
    client.clear()
  }
})

test('Vendidos mantém o cache do mesmo recorte se sua atualização falhar', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let offline = false
  const observer = new QueryObserver(client, { ...soldOptions('2026'), queryFn: async () => {
    if (offline) throw new Error('offline')
    return sold('2026', 17)
  } })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await observer.refetch()
    offline = true
    await observer.refetch()
    assert.equal(observer.getCurrentResult().data?.total, 17)
    assert.equal(observer.getCurrentResult().isError, true)
  } finally {
    unsubscribe()
    client.clear()
  }
})

function areaFilter(busca: string, etapa = '') {
  const ast = source('../pages/AreaVendedor.tsx')
  const normalizer = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'normalizar')
  const normalizar = evaluate('const ' + normalizer.getText(ast), 'normalizar', {})
  const filter = find(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === 'area.clientes.filter') as ts.CallExpression
  return evaluate('const filter = ' + filter.arguments[0].getText(ast), 'filter', {
    busca, etapa, normalizar, digitosDaBusca,
    buscaNormalizada: normalizar(busca), buscaDigitos: digitosDaBusca(busca),
  })
}

const cliente = (phone: string, name = 'João Cliente 42') => ({ etapas: ['FOLLOW UP'], chat: { contact_name: name, phone } })
for (const query of ['(46) 98765-4321', '+55 46 98765 4321', '46987654321']) {
  test('Área do vendedor encontra telefone digitado como ' + query, () => {
    const filter = areaFilter(query)
    assert.equal(filter(cliente('5546987654321')), true)
    assert.equal(filter(cliente('+55 (46) 98765-4321')), true)
  })
}

test('Área do vendedor preserva busca por nome, acento e texto com números', () => {
  assert.equal(areaFilter('joao')(cliente('5546987654321')), true)
  assert.equal(areaFilter('Cliente 42')(cliente('5546987654321')), true)
  assert.equal(areaFilter('Cliente 42')(cliente('5542000000000', 'Outro')), false)
})

test('Área do vendedor preserva o filtro de etapa junto com telefone formatado', () => {
  assert.equal(areaFilter('(46) 98765-4321', 'VENDIDO')(cliente('5546987654321')), false)
})

type NodeElement = { type: unknown; props: Record<string, any> }
function elements(node: unknown, predicate: (element: NodeElement) => boolean): NodeElement[] {
  if (Array.isArray(node)) return node.flatMap(item => elements(item, predicate))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<Record<string, any>>
  return [...(predicate(element) ? [element] : []), ...elements(element.props.children, predicate)]
}

function panelFixture() {
  const ast = source('../pages/RelatorioLider.tsx')
  const declaration = find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === 'RelatorioLider')
  let team = 'esquadrao'
  let slot = 0
  const state: any[] = []
  const refs: any[] = []
  const effects: { deps: unknown[]; run: () => void }[] = []
  const tasks: (() => void)[] = []
  const writes: { data: any; callbacks?: any }[] = []
  const mutation = {
    error: null as Error | null, variables: undefined as any, isPending: false,
    mutate(data: any, callbacks?: any) {
      mutation.variables = data
      mutation.error = null
      mutation.isPending = true
      writes.push({ data, callbacks })
    },
    reset() { mutation.error = null; mutation.variables = undefined; mutation.isPending = false },
  }
  const query = (data: unknown) => ({ data, error: null, isLoading: false, isFetching: false, refetch() {} })
  const context: Record<string, any> = {
    React: { createElement }, QueryNotice, Date, Map, Set,
    useSearchParams: () => [new URLSearchParams({ time: team }), () => {}],
    useState(initial: any) {
      const key = slot++
      if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial
      return [state[key], (value: any) => { state[key] = typeof value === 'function' ? value(state[key]) : value }]
    },
    useRef(initial: unknown) { const key = slot++; return refs[key] ??= { current: initial } },
    useMemo(fn: () => unknown) { slot++; return fn() },
    useEffect(run: () => void, deps: unknown[]) {
      const key = slot++
      if (!effects[key] || deps.some((value, index) => !Object.is(value, effects[key].deps[index]))) tasks.push(run)
      effects[key] = { deps, run }
    },
    usePainelTime: () => query([]), useSerieTime: () => query([]),
    useVendasTime: () => query({ vendido: 0, pedidos: 0 }), useAtencaoTime: () => query([]),
    useOrcamentosTime: () => query([]),
    useQuentesTime: () => query(['A', 'B'].map(id => ({
      chat_id: 'cliente-' + id, cliente: 'Cliente ' + id, vendedor_nome: 'Vendedor fictício',
      status: null, dias_parado: 1, ultima_foi_minha: false, anotado_por: null, anotado_em: null,
    }))),
    useMarcarAndamento: () => mutation,
    TIMES: [
      { slug: 'esquadrao', nome: 'Equipe A', membros: [] },
      { slug: 'los-melhores', nome: 'Equipe B', membros: [] },
    ],
    META_LIGACOES_PESSOA_DIA: 10, META_VENDA_TIME_MES: 833000, diasUteis: () => 20,
    COR_LIGACAO: '', COR_ORCAMENTO: '', fmtDia: () => '', brl: String,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '), quandoAnotado: () => '',
    localStorage: { getItem: () => null, setItem() {} },
  }
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      const tag = node.tagName.text
      if (/^[A-Z]/.test(tag) && !(tag in context)) context[tag] = () => null
    }
    ts.forEachChild(node, visit)
  }
  visit(declaration)
  const renderPage = evaluate(declaration.getText(ast).replace(/^export\s+/, ''), 'RelatorioLider', context)
  function render() {
    slot = 0
    const tree = renderPage()
    tasks.splice(0).forEach(run => run())
    return tree
  }
  function actions() {
    const tile = elements(render(), element => element.type === context.Tile && element.props.label === 'Quentes agora')[0]
    tile.props.onClick()
    return elements(render(), element => element.type === context.BotoesAndamento)
  }
  function notice() {
    return elements(render(), element => element.type === QueryNotice && !!element.props.error)[0]
  }
  function finish(index: number, error?: Error) {
    const write = writes[index]
    mutation.isPending = false
    mutation.error = error ?? null
    if (error) write.callbacks?.onError?.(error, write.data)
    else write.callbacks?.onSuccess?.(null, write.data)
    write.callbacks?.onSettled?.(null, error ?? null, write.data)
  }
  return { actions, notice, finish, writes, switchTeam(value: string) { team = value; render() } }
}

test('Painel do time descarta erro e retry de uma marcação ao mudar de equipe', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.finish(0, new Error('offline'))
  const retry = panel.notice().props.onRetry
  panel.switchTeam('los-melhores')
  assert.equal(panel.notice(), undefined)
  retry()
  assert.equal(panel.writes.length, 1)
})

test('Painel do time ignora falha tardia de A depois de trocar A→B→A', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.switchTeam('los-melhores')
  panel.switchTeam('esquadrao')
  panel.finish(0, new Error('offline tardio'))
  assert.equal(panel.notice(), undefined)
})

test('Painel do time identifica o registro com falha e repete apenas sua marcação', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.finish(0, new Error('offline'))
  const notice = panel.notice()
  assert.match(notice.props.message, /Cliente A/)
  notice.props.onRetry()
  assert.equal(panel.writes.length, 2)
  assert.equal(panel.writes[1].data.chave, 'cliente-A')
  assert.equal(panel.writes[1].data.time_slug, 'esquadrao')
})

test('Painel do time não repete erro de A depois de uma marcação nova no registro B', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.finish(0, new Error('offline'))
  const retry = panel.notice().props.onRetry
  panel.actions()[1].props.onMarcar('aguardando_cliente')
  retry()
  assert.equal(panel.writes.length, 2)
  assert.equal(panel.writes[1].data.chave, 'cliente-B')
})

test('Painel do time bloqueia cliques simultâneos e libera retry depois da falha', () => {
  const panel = panelFixture()
  const action = panel.actions()[0].props.onMarcar
  action('negociando')
  action('negociando')
  assert.equal(panel.writes.length, 1)
  panel.finish(0, new Error('offline'))
  panel.notice().props.onRetry()
  assert.equal(panel.writes.length, 2)
})

test('Painel do time não reutiliza um retry antigo depois de sua tentativa concluir', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.finish(0, new Error('offline'))
  const retry = panel.notice().props.onRetry
  retry()
  panel.finish(1)
  retry()
  assert.equal(panel.writes.length, 2)
  assert.equal(panel.notice(), undefined)
})

test('Painel do time aguarda a escrita pendente ao trocar de equipe, sem herdar seu erro', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.switchTeam('los-melhores')
  panel.actions()[1].props.onMarcar('aguardando_cliente')
  assert.equal(panel.writes.length, 1)
  panel.finish(0, new Error('offline tardio'))
  assert.equal(panel.notice(), undefined)
  panel.actions()[1].props.onMarcar('aguardando_cliente')
  assert.equal(panel.writes.length, 2)
  assert.equal(panel.writes[1].data.time_slug, 'los-melhores')
})

test('Painel do time não inicia outra escrita no mesmo registro ao voltar à equipe A', () => {
  const panel = panelFixture()
  panel.actions()[0].props.onMarcar('negociando')
  panel.switchTeam('los-melhores')
  panel.switchTeam('esquadrao')
  panel.actions()[0].props.onMarcar('aguardando_cliente')
  assert.equal(panel.writes.length, 1)
  panel.finish(0)
  panel.actions()[0].props.onMarcar('aguardando_cliente')
  assert.equal(panel.writes.length, 2)
  assert.equal(panel.notice(), undefined)
})
