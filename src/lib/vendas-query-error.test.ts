import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryNotice } from '../components/ui/QueryNotice'

function realFunction(file: string, name: string, context: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!
  const js = ts.transpileModule(fn.getText(ast).replace(/^export(?: default)? /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  return vm.runInNewContext(`${js}\n${name}`, {
    React: { createElement }, QueryNotice, useState: (value: unknown) => [value, () => {}],
    useMemo: (fn: () => unknown) => fn(), PageLoading: () => createElement('p', {}, 'loading'), ...context,
  })
}

for (const page of ['Orcamentos', 'OrcamentosConversao']) {
  test(`${page} exposes a retryable error instead of an endless loading state`, () => {
    const query = { data: undefined, isLoading: false, isFetching: false, error: new Error('offline'), refetch() {} }
    const render = realFunction(`../pages/${page}.tsx`, page, {
      useOrcamentoStats: () => query, useOrcamentosConversao: () => query,
      useLocation: () => ({ pathname: '/orcamentos' }), useVendors: () => ({}), usePipelineVendedor: () => ({}),
    })
    const html = renderToStaticMarkup(createElement(render))
    assert.match(html, /role="alert"/)
    assert.match(html, /Tentar novamente/)
    assert.match(html, /<h1/)
    assert.doesNotMatch(html, />loading</)
  })
}

test('sales dashboard preserves query failure and retry in its public hook result', () => {
  const error = new Error('offline'), refetch = () => {}
  const hook = realFunction('../hooks/useControleDashboard.ts', 'useControleVendas', {
    useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, error, refetch }),
    ORIGEM_TODAS: 'Todas',
  })
  const result = hook('mes')
  assert.equal(result.error, error)
  assert.equal(result.refetch, refetch)
})

test('freight catalogue failure is an actionable error, never a confirmed empty catalogue', () => {
  const failure = { data: undefined, isLoading: false, isFetching: false, error: new Error('offline'), refetch() {} }
  const ready = { data: [], isLoading: false, isFetching: false, error: null, refetch() {} }
  const context: Record<string, unknown> = {
    useTiposCaminhao: () => ready, useAnttVigente: () => ready, useModeloBranorte: () => ready,
    useTransportadoras: () => ready, useFreteCatalogoItens: () => failure,
    useMunicipiosUF: () => ready, useFreteBaseItem: () => ({ ...ready, data: null }),
    useMediaHistorica: () => ({ ...ready, data: null }), useSalvarCotacao: () => ({}),
    useRef: (value: unknown) => ({ current: value }), useEffect() {},
    crypto: { randomUUID: () => 'synthetic' }, UFS_BR: [], CAT_ORDEM: [], CAT_LABELS: {},
    DESCONTO_RETORNO_MAX_PCT: 25, MODOS_CARGA_LABELS: {},
    Link: (props: Record<string, unknown>) => createElement('a', {}, props.children as never),
  }
  const source = readFileSync(new URL('../pages/FreteCotacao.tsx', import.meta.url), 'utf8')
  const icons = source.match(/import\s*\{([^}]+)\}\s*from 'lucide-react'/)![1].split(',').map(s => s.trim()).filter(Boolean)
  for (const icon of icons) context[icon] = () => createElement('span')
  const render = realFunction('../pages/FreteCotacao.tsx', 'FreteCotacao', context)
  const html = renderToStaticMarkup(createElement(render))
  assert.match(html, /role="alert"/)
  assert.match(html, /Tentar novamente/)
  assert.doesNotMatch(html, /Itens de frete cadastrados \(0\)/)
  assert.doesNotMatch(html, /Nenhum item de frete cadastrado ainda/)
})

test('price reference failure preserves its title and blocks sync instead of presenting an empty official catalogue', () => {
  const render = realFunction('../pages/PrecosBranorte.tsx', 'PrecosBranorte', {
    useCan: () => () => true,
    usePrecosBranorte: () => ({ data: undefined, isLoading: false, isFetching: false, error: new Error('offline'), refetch() {} }),
    useCatalogoMotores: () => ({ data: [] }), GRUPOS: [], GRUPO_SOBRA: 'Outros',
    MotorCtx: { Provider: (props: { children: never }) => createElement('div', {}, props.children) },
    BookOpen: () => createElement('span'), Search: () => createElement('span'), Input: () => createElement('input'),
    BotaoSincronizarModelos: () => createElement('button', {}, 'Sincronizar templates'), PainelAuditoria: () => null,
  })
  const html = renderToStaticMarkup(createElement(render))
  assert.match(html, /Tabela de Preços Branorte/)
  assert.match(html, /role="alert"/)
  assert.match(html, /Tentar novamente/)
  assert.doesNotMatch(html, /0 equipamentos em 0 categorias/)
  assert.doesNotMatch(html, /Sincronizar templates/)
})

test('saving an existing contract never writes over signed status when the status read fails', async () => {
  let writes = 0
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq']) chain[name] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: new Error('status unavailable') })
  chain.update = () => { writes++; return { eq: async () => ({ error: null }) } }
  const hook = realFunction('../hooks/useContratos.ts', 'useSalvarContrato', {
    useQueryClient: () => ({ invalidateQueries() {} }), useMutation: (options: unknown) => options,
    supabase: { from: () => chain }, linhaDe: () => ({ status: 'gerado' }),
  })
  await assert.rejects(hook().mutationFn({ id: 12, dados: {}, status: 'gerado' }), /status unavailable/)
  assert.equal(writes, 0)
})

test('proposal label filtering never exposes all proposals while the label IDs are unavailable', () => {
  const source = readFileSync(new URL('../pages/OrcamentosSalvos.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let grouped: ts.VariableStatement | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'grouped')) grouped = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(grouped)
  const js = ts.transpileModule(grouped.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    data: [{ id: 1, numero: '2026 - 0001' }, { id: 2, numero: '2026 - 0002' }],
    busca: '', filtroStatus: '', filtroVendedor: '', filtroEtiqueta: 'aberto', idsEtiqueta: undefined,
    loadingEtiqueta: true, erroEtiqueta: null, useMemo: (fn: () => unknown) => fn(),
  }
  assert.equal(vm.runInNewContext(`${js}\ngrouped.length`, context), 0)
  assert.equal(vm.runInNewContext(`${js}\ngrouped.length`, { ...context, loadingEtiqueta: false, erroEtiqueta: new Error('offline') }), 0)
  assert.equal(vm.runInNewContext(`${js}\ngrouped.length`, { ...context, loadingEtiqueta: false, idsEtiqueta: new Set([2]) }), 1)
})

for (const page of ['CatalogoAdmin', 'MotoresAdmin', 'PrecosBranorte']) {
  test(`${page} keeps cached editor reconciliation paths during a failed background refresh`, () => {
    const marker = () => createElement('input', { defaultValue: 'unsaved draft' })
    let error: Error | null = null
    const query = () => ({ data: [], isLoading: false, isFetching: false, error, refetch() {} })
    const context: Record<string, unknown> = {
      useMemo: (fn: () => unknown) => fn(),
      useCatalogoItemsAdmin: query, useMotoresAdmin: query, usePrecosBranorte: () => ({ ...query(), data: [{ categoria: 'SYNTHETIC', subcategoria: null }] }),
      useStatsCatalogo: () => ({}), useToggleOficialCatalogo: () => ({}), useAlcanceMotores: () => ({}),
      useCan: () => () => true, useCatalogoMotores: () => ({ data: [] }),
      categoriasDoItems: () => [], subcategoriasDoItems: () => [], diametrosDoItems: () => [],
      PAGINA_INICIAL: 120, VIEW_MODE_KEY: 'synthetic', ABAS: [],
      CatalogoItemEditModal: marker, TabelaMotores: marker, TabelaMotorRedutor: marker, TabelaPorCategoria: marker,
      GRUPOS: [], GRUPO_SOBRA: 'Other', GRUPO_DE_CAT: {}, SUBCAT_ORDER: {}, CATS_MATRIZ: new Set(),
      CATEGORIA_LABEL: {}, SUBCATEGORIA_LABEL: {},
      MotorCtx: { Provider: (props: { children: never }) => createElement('div', {}, props.children) },
      BotaoSincronizarModelos: () => null, PainelAuditoria: () => null,
    }
    const source = readFileSync(new URL(`../pages/${page}.tsx`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        context[binding.name.text] ??= () => createElement('span')
      }
    }
    // Keep a price category selected so its actual editor subtree is mounted.
    let stateIndex = 0
    context.useState = (initial: unknown) => {
      const value = page === 'PrecosBranorte' && stateIndex === 2 ? 'Other' : typeof initial === 'function' ? initial() : initial
      stateIndex++
      return [value, () => {}]
    }
    // QueryNotice is the real component: mocks above are limited to SDK/hooks and unrelated children.
    context.QueryNotice = QueryNotice
    const render = realFunction(`../pages/${page}.tsx`, page, context)
    function editorPaths(node: unknown, path: unknown[] = []): unknown[][] {
      if (Array.isArray(node)) return node.flatMap((child, i) => editorPaths(child, [...path, i]))
      if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return []
      const element = node as { type: unknown; key: unknown; props: { children?: unknown } }
      const next = [...path, element.type, element.key]
      return element.type === marker ? [next] : editorPaths(element.props.children, next)
    }
    stateIndex = 0
    const before = editorPaths(render())
    assert.ok(before.length > 0, 'fixture must mount an editor before refresh')
    error = new Error('background refresh offline')
    stateIndex = 0
    const failed = render()
    assert.deepEqual(editorPaths(failed), before, 'cached editors must retain their parent types, keys and positions')
    assert.match(renderToStaticMarkup(failed), /role="alert"/)
    assert.match(renderToStaticMarkup(failed), /Tentar novamente/)
    error = null
    stateIndex = 0
    assert.deepEqual(editorPaths(render()), before, 'retry recovery must not remount cached editors')
  })
}
