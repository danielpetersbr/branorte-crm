import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as React from 'react'
import ts from 'typescript'

function declarations(file: string, names: string[]) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text ?? ''))
    .map(s => s.getText(ast).replace(/^export /, '')).join('\n')
}

function queriesFor(aba: string) {
  const js = ts.transpileModule(`${declarations('../pages/AdminAcessos.tsx', ['AdminAcessos', 'useUsuarios'])}\nAdminAcessos()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  let cursor = 0
  const queries: Record<string, boolean> = {}
  vm.runInNewContext(js, {
    React, Map, useState: (initial: unknown) => [cursor++ === 0 ? aba : initial, () => {}], useMemo: (fn: () => unknown) => fn(),
    useQuemEstaOnline: (enabled = true) => { queries.online = enabled; return {} },
    useAcessoEventos: (_params: unknown, enabled = true) => { queries.trilha = enabled; return {} },
    useQuery: (options: any) => { queries.usuarios = options.enabled ?? true; return {} },
    Button: () => null, Card: () => null, PainelSessoes: () => null, PainelJanelas: () => null,
    PageLoading: () => null, ShieldAlert: () => null, Select: () => null, Input: () => null,
  })
  return queries
}

for (const [aba, expected] of [
  ['online', { online: true, trilha: false, usuarios: false }],
  ['trilha', { online: false, trilha: true, usuarios: true }],
  ['sessoes', { online: false, trilha: false, usuarios: false }],
  ['janelas', { online: false, trilha: false, usuarios: true }],
] as const) {
  test(`Acessos / ${aba}: carrega apenas consultas consumidas pela aba atual`, () => {
    assert.deepEqual(queriesFor(aba), expected)
  })
}

test('gates chegam ao React Query sem entrar na cache key dos filtros nem reduzir polling ativo', () => {
  const code = `${declarations('./useAcesso.ts', ['useAcessoEventos', 'useQuemEstaOnline'])}\n({ useAcessoEventos, useQuemEstaOnline })`
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const hooks = vm.runInNewContext(js, { useQuery: (options: unknown) => options })
  const params = { dias: 7, rota: '/contatos', email: 'qa@example.invalid' }
  assert.equal(hooks.useAcessoEventos(params, false).enabled, false)
  assert.equal(hooks.useAcessoEventos(params, true).enabled, true)
  assert.equal(hooks.useAcessoEventos(params, true).queryKey[1], params)
  assert.equal(hooks.useQuemEstaOnline(false).enabled, false)
  assert.equal(hooks.useQuemEstaOnline(true).refetchInterval, 60000)
  assert.equal(hooks.useQuemEstaOnline().enabled, true)
})
