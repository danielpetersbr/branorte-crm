import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

test('budget numbering triggers folder scan after subscription and always removes its channel', async () => {
  const source = readFileSync(new URL('../hooks/useOrcamentoBuilder.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'obterProximoNumero')!
  const js = ts.transpileModule(fn.getText(ast).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let subscribed: ((status: string) => void) | undefined, scans = 0, removed = 0
  const timers = new Map<number, () => void>()
  const channel = {
    subscribe(callback?: (status: string) => void) { subscribed = callback; return channel },
    async send(message: {event: string}) { assert.equal(message.event, 'scan-now'); scans++; return 'ok' },
  }
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'lt', 'order', 'limit']) chain[key] = () => chain
    chain.maybeSingle = async () => ({ data: table === 'pasta_orcamento_index' ? { ultimo_sequencial: 878 } : { sequencial: 880 }, error: null })
    return chain
  }
  const numbering = vm.runInNewContext(`${js}\nobterProximoNumero`, {
    SEQ_ABSURDO: 10000, supabase: { from, channel: () => channel, removeChannel: async () => { removed++ } },
    setTimeout: (callback: () => void) => { const id = timers.size + 1; timers.set(id, callback); return id },
    clearTimeout: (id: number) => timers.delete(id),
  })
  const number = await numbering()
  assert.equal(number.sequencial, 881)
  assert.equal(scans, 0)
  subscribed?.('SUBSCRIBED')
  await Promise.resolve()
  assert.equal(scans, 1)
  for (const timer of [...timers.values()]) timer()
  await Promise.resolve()
  assert.equal(removed, 1)
})
