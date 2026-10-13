import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as React from 'react'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

function counterOptions(enabled?: boolean) {
  const source = readFileSync(new URL('../../hooks/useAtendimentos.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('useAtendimentos.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useAtendimentosTotalMenu')!
  const js = ts.transpileModule(`${fn.getText(ast).replace(/^export /, '')}\nuseAtendimentosTotalMenu(enabled)`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let requests = 0
  const query = {
    select: () => query, eq: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ count: 12, error: null })),
  }
  const options = vm.runInNewContext(js, {
    enabled, useQuery: (value: unknown) => value,
    getCurrentVendorFirstName: async () => 'GUSTAVO',
    applyBaseFilters: (value: unknown, _filters: unknown, vendor: string) => {
      assert.equal(vendor, 'GUSTAVO')
      return value
    },
    supabaseAuditoria: { from: (table: string) => {
      assert.equal(table, 'atendimentos_por_cliente')
      requests++
      return query
    } },
  })
  return { options, requests: () => requests }
}

function layoutOptions(profile: Record<string, unknown> | null, permitted: boolean) {
  const source = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  let counter: ReturnType<typeof counterOptions> | undefined
  let counterCalls = 0
  const noop = () => null
  const modules: Record<string, unknown> = {
    react: { ...React, useEffect: noop, useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, noop] },
    'react-router-dom': { useLocation: () => ({ pathname: '/', search: '' }), NavLink: noop, Outlet: noop },
    'lucide-react': new Proxy({}, { get: () => noop }),
    '@/hooks/useAuth': { useAuth: () => ({ profile, signOut: noop }) },
    '@/hooks/usePermissions': { useCan: () => (key: string) => key === 'menu.atendimentos' && permitted },
    '@/hooks/useDarkMode': { useDarkMode: () => [false, noop] },
    '@/hooks/useAtendimentos': { useAtendimentosTotalMenu: (enabled?: boolean) => {
      counterCalls++
      counter = counterOptions(enabled)
      return { data: undefined }
    } },
    '@/lib/utils': { cn: () => '' },
    '@/lib/browser-preferences': { readBrowserPreference: () => null },
    './navigation-active': { isNavigationItemActive: () => false },
  }
  const exports: Record<string, any> = {}
  vm.runInNewContext(js, { exports, React, require: (name: string) => modules[name] ?? new Proxy({}, { get: () => noop }) })
  exports.Layout()
  assert.equal(counterCalls, 1, 'o hook permanece montado uma vez em todos os perfis')
  assert.ok(counter)
  return counter
}

async function observe(counter: ReturnType<typeof counterOptions>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const observer = new QueryObserver(client, counter.options)
  const unsubscribe = observer.subscribe(() => {})
  await new Promise(resolve => setImmediate(resolve))
  const result = observer.getCurrentResult()
  unsubscribe()
  client.clear()
  return result
}

const approved = { id: 'u1', role: 'vendor', approved_at: '2026-10-01', email: 'vendedor@example.com', display_name: 'Gustavo' }

test('menus restritos não consultam o contador mesmo com permissão de Atendimentos', async () => {
  for (const role of ['mapa', 'representante', 'consultor']) {
    const counter = layoutOptions({ ...approved, role }, true)
    await observe(counter)
    assert.equal(counter.requests(), 0, role)
  }
})

test('permissão ausente e perfil não aprovado não consultam o contador', async () => {
  for (const [profile, permitted] of [[approved, false], [{ ...approved, approved_at: null }, true], [null, true]] as const) {
    const counter = layoutOptions(profile, permitted)
    await observe(counter)
    assert.equal(counter.requests(), 0)
  }
})

test('menu completo autorizado continua mostrando o total filtrado e mantém o cache e polling', async () => {
  const counter = layoutOptions(approved, true)
  const result = await observe(counter)
  assert.equal(counter.requests(), 1)
  assert.equal(result.data, 12)
  assert.deepEqual(Array.from(counter.options.queryKey), ['atendimentos-total-menu'])
  assert.equal(counter.options.staleTime, 600000)
  assert.equal(counter.options.refetchInterval, 600000)
  assert.equal(counter.options.refetchIntervalInBackground, false)
  assert.equal(counter.options.refetchOnWindowFocus, false)
  assert.equal(counter.options.retry, false)
})

test('demais consumidores sem parâmetro mantêm a consulta habilitada', async () => {
  const counter = counterOptions()
  await observe(counter)
  assert.equal(counter.requests(), 1)
})
