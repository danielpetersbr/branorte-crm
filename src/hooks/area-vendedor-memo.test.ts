import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function area() {
  const text = readFileSync(new URL('./useAreaVendedor.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('area.ts', text, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useAreaVendedor')!
  const js = ts.transpileModule(`${fn.getText(ast).replace(/^export /, '')}\nuseAreaVendedor`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const state = { carteira: [{}], analises: [{}], role: 'admin', builds: 0 }
  let lastDeps: unknown[] | undefined, cached: unknown
  const render = vm.runInNewContext(js, {
    useAuth: () => ({ session: { user: { id: 'qa' } }, profile: { role: state.role, approved_at: '2026-10-01', vendor_id: 'v1' } }),
    useWaKanban: () => ({ data: state.carteira }),
    useQuery: (options: any) => ({ data: options.queryKey[1] === 'analises' ? state.analises : [] }),
    montarAreaClientes: (carteira: unknown, analises: unknown) => { state.builds++; return { carteira, analises } },
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      if (!lastDeps || deps.some((value, i) => !Object.is(value, lastDeps![i]))) { cached = fn(); lastDeps = [...deps] }
      return cached
    },
  }) as (nome: string, id: string, permitido: boolean) => any
  return { state, render: (permitido = true) => render('Fictício', 'v1', permitido) }
}

test('digitação/filtros na página não remontam carteira se dados e acesso não mudaram', () => {
  const h = area()
  const first = h.render()
  const second = h.render()
  assert.equal(first.clientes, second.clientes)
  assert.equal(h.state.builds, 1)
})

test('novos dados de carteira e análise recalculam os clientes imediatamente', () => {
  const h = area()
  const first = h.render().clientes
  h.state.carteira = [{ novo: true }]
  const second = h.render().clientes
  assert.notEqual(first, second)
  h.state.analises = [{ outra: true }]
  assert.notEqual(second, h.render().clientes)
})

test('revogar acesso do gestor remove análises da montagem mesmo com cache preenchido', () => {
  const h = area()
  const original = h.render().clientes
  h.state.role = 'vendor'
  const restricted = h.render().clientes
  assert.notEqual(original, restricted)
  assert.equal(restricted.analises.length, 0)
})
