const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/wa-contact-hub/index.ts'), 'utf8')
function hub(result = { data: { allowed: true, reason: 'available' }, error: null }) {
  const calls = []; let handler
  const ctx = vm.createContext({ Response, Request, URL, console: { warn() {} }, exports: {},
    require: name => name.includes('supabase-js') ? { createClient: () => ({ rpc: async (...args) => { calls.push(args); return result } }) } : {},
    Deno: { env: { get: name => name === 'WA_SYNC_SHARED_SECRET' ? 'synthetic-secret' : 'synthetic-service' }, serve: fn => { handler = fn } },
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, ctx)
  return { calls, run: (body, auth = 'synthetic-secret', method = 'POST') => handler(new Request('https://synthetic.invalid/wa-contact-hub/ana-automation-gate', { method, headers: { authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })) }
}
test('hub gate retains shared auth and never calls RPC for unauthorized callers', async () => {
  const h = hub(); assert.equal((await h.run({ vendedor_nome: 'ANA', chat_id: '123@lid' }, 'bad')).status, 401); assert.equal(h.calls.length, 0)
})
test('normal ANA gate is a service RPC and only sends the exact chat ID', async () => {
  const h = hub(); const r = await h.run({ vendedor_nome: 'ANA', chat_id: '123@lid' }); assert.equal(r.status, 200); assert.equal((await r.json()).allowed, true)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['crm_ana_automation_gate', { p_chat_id: '123@lid' }]])
})
test('unknown sellers, groups, missing IDs and oversized requests cannot invoke gates', async () => {
  for (const body of [{ vendedor_nome: 'DANIEL', chat_id: '123@lid' }, { vendedor_nome: 'ANA', chat_id: '123@g.us' }, { vendedor_nome: 'ANA' }, { vendedor_nome: 'ANA', chat_id: '123@lid', extra: 'x'.repeat(3000) }]) {
    const h = hub(); const r = await h.run(body); assert.ok([400, 413].includes(r.status)); assert.equal(h.calls.length, 0)
  }
})
test('closure generation goes only through its own service-only RPC, never the AI allowance', async () => {
  const close = { conversation_id: 'synthetic', marker: '2026-10-02T12:00:00Z', label_id: '22' }
  const h = hub({ data: { allowed: true, reason: 'matching', label_id: '22', label_name: 'RESOLVIDOS' }, error: null }); const r = await h.run({ vendedor_nome: 'ANA', chat_id: '123@lid', close })
  assert.equal(r.status, 200); assert.equal((await r.json()).label_id, '22'); assert.equal(h.calls[0][0], 'crm_ana_close_label_gate'); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])), { p_chat_id: '123@lid', p_close: close })
})
test('valid denials remain denials while DB/shape failures are 503 and fail closed', async () => {
  const denied = hub({ data: { allowed: false, reason: 'human_hold' }, error: null }); const r = await denied.run({ vendedor_nome: 'ANA', chat_id: '123@lid' }); assert.equal(r.status, 200); assert.equal((await r.json()).allowed, false)
  for (const result of [{ data: null, error: { message: 'private SQL details' } }, { data: {}, error: null }, { data: { allowed: 'true' }, error: null }]) {
    const h = hub(result); const r = await h.run({ vendedor_nome: 'ANA', chat_id: '123@lid' }); assert.equal(r.status, 503); assert.equal((await r.json()).allowed, false)
  }
})
