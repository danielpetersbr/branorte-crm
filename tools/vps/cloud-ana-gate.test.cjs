const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(process.env.CRM_ANA_EDGE_SOURCE, 'utf8')
const start = source.indexOf('    // CRM closure/takeover is authoritative before activation, media or the LLM.')
const end = source.indexOf("    if (action === 'duvidas_obsidian')", start)
const guard = source.slice(start, end)
function handler({allowed = true, fail = false, simulate = false, testing = false} = {}) {
  const calls = []
  const ctx = vm.createContext({SIMULAR: simulate, MODO_TESTE: testing, supa: {},
    ehPorteira: vendor => vendor === 'ANA',
    j: (body, status = 200) => ({body, status}),
    anaCrmGate: async (_, chat) => {calls.push(chat); if (fail) throw new Error('offline'); return {allowed, reason: 'crm_closed_until_inbound'}}})
  const fn = vm.runInContext(ts.transpile(`(async function(body, action) {${guard}\nreturn {continued:true}})`), ctx)
  return {fn, calls}
}
test('closed CRM contacts stop activation and response before downstream processing', async () => {
  assert.ok(start >= 0 && end > start, 'guard not found in actual candidate')
  const h = handler({allowed:false})
  for (const action of ['responder','ligar_se_for_lead','toggle']) {
    const result = await h.fn({chat_id:'exact@lid', vendedor_nome:'ANA', ativo:true}, action)
    assert.equal(result.continued, undefined)
    assert.equal(result.body.motivo || result.body.skip, 'crm_closed_until_inbound')
  }
  assert.deepEqual(h.calls, ['exact@lid','exact@lid','exact@lid'])
})
test('unavailable authorization fails closed without downstream processing', async () => {
  const result = await handler({fail:true}).fn({chat_id:'exact@lid',vendedor_nome:'ANA'},'responder')
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'crm_automation_gate_unavailable')
})
test('allowed customer reaches normal processing', async () => {
  assert.equal((await handler().fn({chat_id:'exact@lid',vendedor_nome:'ANA'},'responder')).continued,true)
})
test('stopping AI and another vendor do not depend on the ANA gate', async () => {
  const h=handler({fail:true})
  assert.equal((await h.fn({chat_id:'exact@lid',vendedor_nome:'ANA',ativo:false},'toggle')).continued,true)
  assert.equal((await h.fn({chat_id:'exact@lid',vendedor_nome:'OTHER'},'responder')).continued,true)
  assert.deepEqual(h.calls,[])
})
test('existing simulation and testing isolation never consult the live CRM gate', async () => {
  for (const config of [{simulate:true},{testing:true}]) {
    const h=handler({...config,fail:true})
    assert.equal((await h.fn({chat_id:'exact@lid',vendedor_nome:'ANA'},'responder')).continued,true)
    assert.deepEqual(h.calls,[])
  }
})
