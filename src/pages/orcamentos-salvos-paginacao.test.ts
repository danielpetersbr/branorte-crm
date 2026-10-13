import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { semSeparadores } from '../lib/busca-numero-orcamento'

type Element = { type: string; props: Record<string, any> }
const source = readFileSync(new URL('./OrcamentosSalvos.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('OrcamentosSalvos.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'OrcamentosSalvos')!
const code = ts.transpileModule(`${component.getText(ast).replace(/^export /, '')}; OrcamentosSalvos`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText

const originals = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1, numero: `2026 - ${String(i + 1).padStart(4, '0')}`, numero_base: `base-${i}`,
  versao_alt: null, cliente_nome: `Cliente ${i + 1}`, vendedor_nome: i % 2 ? 'PEDRO' : 'EDER',
  status: i % 2 ? 'enviado' : 'rascunho', data_emissao: '2026-10-13', total_proposta: 100,
  modelo_basename: 'Fábrica', created_at: `2026-10-13T${String(i % 24).padStart(2, '0')}:00:00Z`,
}))
const fixture = [...originals, { ...originals[49], id: 1000, numero: '2026 - 0050 ALT1', versao_alt: 1 }]

function harness(rows = fixture) {
  let data = rows, cursor = 0, effectCursor = 0, dirty = false, tree: Element
  const states: any[] = [], dependencies: any[][] = [], effects: (() => void)[] = []
  const context = {
    React: { createElement(type: string, props: unknown, ...children: unknown[]) { return { type, props: { ...(props as object), children } } } },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as Function)() : initial
      return [states[index], (value: unknown) => {
        const next = typeof value === 'function' ? (value as Function)(states[index]) : value
        if (next !== states[index]) { states[index] = next; dirty = true }
      }]
    },
    useMemo: (calculate: Function) => calculate(),
    useEffect(effect: () => void, deps: any[]) {
      const index = effectCursor++, prev = dependencies[index]
      if (!prev || deps.some((value, i) => !Object.is(value, prev[i]))) effects.push(effect)
      dependencies[index] = deps
    },
    useOrcamentosGerados: () => ({ data, isLoading: false, error: null, isFetching: false }),
    useAuth: () => ({ profile: { role: 'admin' } }), useSearchParams: () => [new URLSearchParams()],
    useQuery: () => ({ data: new Set(data.map(row => row.id)), isLoading: false, error: null }),
    semSeparadores, ETIQUETA_PROP_OPCOES: [{ value: 'aberto', label: 'Em aberto' }],
    OrcamentoGroupRow: 'OrcamentoGroupRow', Link: 'Link', PageLoading: 'PageLoading', QueryNotice: 'QueryNotice',
    FileText: 'FileText', Search: 'Search',
  }
  const renderComponent = vm.runInNewContext(code, context)
  const render = () => {
    let attempts = 0
    do {
      assert.ok(attempts++ < 10, 'efeitos devem estabilizar sem loop de renderização')
      dirty = false; cursor = 0; effectCursor = 0; effects.length = 0
      tree = renderComponent()
      for (const effect of effects) effect()
    } while (dirty)
    return tree!
  }
  render()
  return { render, tree: () => tree!, setData(rows: typeof fixture) { data = rows; render() } }
}

function elements(tree: Element): Element[] {
  const nodes: Element[] = []
  function visit(value: any) {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object' && 'type' in value) { nodes.push(value); visit(value.props.children) }
  }
  visit(tree)
  return nodes
}
function text(value: any): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object') return text(value.props?.children)
  return value == null || typeof value === 'boolean' ? '' : String(value)
}
const groups = (tree: Element) => elements(tree).filter(node => node.type === 'OrcamentoGroupRow').map(node => node.props.group)
function button(tree: Element, label: string) {
  const node = elements(tree).find(node => node.type === 'button' && text(node) === label)
  assert.ok(node, `botão ${label} deve existir`)
  return node
}
function page(tree: Element) {
  const node = elements(tree).find(node => node.type === 'select' && node.props['aria-label'] === 'Página dos orçamentos')
  assert.ok(node, 'seletor de página deve existir')
  return node
}

test('120 grupos usam páginas de 50; pai e ALT permanecem juntos; próxima e anterior alcançam toda a lista', () => {
  const h = harness()
  assert.equal(groups(h.tree()).length, 50, 'somente 50 grupos devem montar linhas')
  assert.equal(groups(h.tree())[49].parent.id, 50)
  assert.equal(groups(h.tree())[49].alts[0].id, 1000)
  assert.equal(button(h.tree(), 'Anterior').props.disabled, true)
  button(h.tree(), 'Próxima').props.onClick(); h.render()
  assert.equal(groups(h.tree())[0].parent.id, 51)
  assert.equal(groups(h.tree()).length, 50)
  button(h.tree(), 'Próxima').props.onClick(); h.render()
  assert.equal(groups(h.tree()).length, 20)
  assert.equal(groups(h.tree())[19].parent.id, 120)
  assert.equal(button(h.tree(), 'Próxima').props.disabled, true)
  button(h.tree(), 'Anterior').props.onClick(); h.render()
  assert.equal(groups(h.tree())[0].parent.id, 51)
  page(h.tree()).props.onChange({ target: { value: '1' } }); h.render()
  assert.equal(groups(h.tree())[0].parent.id, 1)
})

test('busca pesquisa o último orçamento fora da primeira página e continua incluindo alternativas', () => {
  const h = harness()
  button(h.tree(), 'Próxima').props.onClick(); h.render()
  const search = () => elements(h.tree()).find(node => node.type === 'input')!
  search().props.onChange({ target: { value: '2026-0120' } }); h.render()
  assert.equal(groups(h.tree()).length, 1)
  assert.equal(groups(h.tree())[0].parent.id, 120)
  assert.equal(Number(page(h.tree()).props.value), 1)
  search().props.onChange({ target: { value: 'ALT1' } }); h.render()
  assert.equal(groups(h.tree())[0].parent.id, 1000, 'filtro de ALT mantém o agrupamento anterior')
})

test('mudança de qualquer filtro volta à página 1 mesmo quando há mais de uma página de resultados', () => {
  for (const filter of ['busca', 'status', 'vendedor', 'etiqueta'] as const) {
    const h = harness()
    button(h.tree(), 'Próxima').props.onClick(); h.render()
    const node = elements(h.tree()).find(node => filter === 'busca' ? node.type === 'input'
      : node.type === 'select' && (filter === 'vendedor' ? node.props.title === 'Filtrar por vendedor'
        : filter === 'etiqueta' ? node.props.title?.includes('estágio atual') : !node.props.title && !node.props['aria-label']))!
    node.props.onChange({ target: { value: { busca: 'Cliente', status: 'rascunho', vendedor: 'EDER', etiqueta: 'aberto' }[filter] } })
    h.render()
    assert.equal(Number(page(h.tree()).props.value), 1, `${filter} deve reiniciar a página`)
    assert.equal(groups(h.tree())[0].parent.id, 1)
  }
})

test('refetch que diminui o resultado ajusta a página e mantém contagem integral e controles acessíveis', () => {
  const h = harness()
  page(h.tree()).props.onChange({ target: { value: '3' } }); h.render()
  h.setData(fixture.slice(0, 60))
  assert.equal(Number(page(h.tree()).props.value), 2)
  assert.equal(groups(h.tree()).length, 10)
  assert.equal(groups(h.tree())[0].parent.id, 51)
  assert.ok(text(h.tree()).includes('60 orçamento(s) no sistema'))
  assert.ok(elements(h.tree()).some(node => node.type === 'nav' && node.props['aria-label'] === 'Paginação de orçamentos'))
  for (const control of [button(h.tree(), 'Anterior'), button(h.tree(), 'Próxima'), page(h.tree())]) {
    assert.match(control.props.className, /min-h-\[44px\]/)
  }
  h.setData([])
  assert.ok(text(h.tree()).includes('Nenhum orçamento encontrado'))
  h.setData(fixture)
  assert.equal(Number(page(h.tree()).props.value), 1)
  assert.ok(text(h.tree()).includes('121 orçamento(s) no sistema'), 'ALT também conta no total do header')
})
