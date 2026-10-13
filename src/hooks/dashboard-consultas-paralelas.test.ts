import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function harness() {
  const text = readFileSync(new URL('./useDashboard.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('useDashboard.ts', text, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'useDashboard')!
  const js = ts.transpileModule(`${fn.getText(ast).replace(/^export /, '')}\nuseDashboard()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const calls: string[] = []
  let resolveNames!: (value: Map<string, string>) => void
  const names = new Promise<Map<string, string>>(resolve => { resolveNames = resolve })
  const rows = [{ telefone: '5511999999999' }]
  const rpc = (name: string, params?: unknown) => ({ abortSignal(signal: AbortSignal) {
    calls.push(name)
    assert.ok(signal instanceof AbortSignal)
    if (name === 'orcamentos_por_telefone_canon') {
      assert.deepEqual(JSON.parse(JSON.stringify(params)), { p_canons: ['5511999999999'] })
      return Promise.resolve({ data: [{ fone_canon: '5511999999999', ultimo_valor: 320, ultimo_em: '2026-10-12T12:00:00Z' }] })
    }
    if (name === 'dashboard_fone_situacao') return Promise.resolve({ data: [{ fone_canon: '5511999999999', situacao: 'vendido' }] })
    return Promise.resolve({ data: rows })
  } })
  const options = vm.runInNewContext(js, {
    Map, Set, Date, useQuery: (o: unknown) => o, useCallback: (fn: unknown) => fn,
    useQueryClient: () => ({ fetchQuery: () => { calls.push('criativo-nomes'); return names } }),
    agregarPorPreset: () => {}, fetchCriativoNomes: () => {},
    decodeDashboardSnapshot: (value: unknown) => value, foneCanon: (value: string) => value,
    supabase: { rpc }, supabaseAuditoria: { rpc },
  })
  return { options, calls, rows, resolveNames }
}

test('enriquecimento por telefone não espera o catálogo de criativos; resultado completo permanece idêntico', async () => {
  const h = harness()
  const result = h.options.queryFn({ signal: new AbortController().signal })
  await new Promise(resolve => setImmediate(resolve))
  const startedBeforeNames = h.calls.includes('orcamentos_por_telefone_canon') && h.calls.includes('dashboard_fone_situacao')
  const names = new Map([['A1', 'Campanha']])
  h.resolveNames(names)
  const data = await result
  assert.ok(startedBeforeNames, 'consultas independentes precisam iniciar enquanto os criativos ainda estão pendentes')
  assert.equal(data.rows, h.rows)
  assert.equal(data.criativoNomes, names)
  assert.equal(data.orcValorByCanon.get('5511999999999'), 320)
  assert.equal(data.orcEmByCanon.get('5511999999999'), Date.parse('2026-10-12T12:00:00Z'))
  assert.ok(data.fechados.has('5511999999999'))
})

test('cancelamento não publica resultado parcial enquanto os complementos estão pendentes', async () => {
  const h = harness()
  const controller = new AbortController()
  const result = h.options.queryFn({ signal: controller.signal })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  h.resolveNames(new Map())
  await assert.rejects(result, { name: 'AbortError' })
})
