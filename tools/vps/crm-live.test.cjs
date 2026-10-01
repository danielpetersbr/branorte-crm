const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = name => fs.readFileSync(path.join(process.env.CRM_EXT_DIR || __dirname, name), 'utf8')
const bg = source('background.js')
const agent = source('bsb-detect-chat.js')
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() }
function harness(overrides = {}) {
  const cfg = { vendedor_nome: 'ANA', enabled: true }
  const posts = [], writes = [], timers = new Map(), listeners = []
  let timerId = 0
  const context = vm.createContext({
    console, TextDecoder, AbortController, AbortSignal, Date, Set, Map,
    HUB_ENDPOINT: 'https://hub.invalid', MSGS_ENDPOINT: 'https://messages.invalid', SHARED_SECRET: 'test-key',
    chrome: { storage: { local: { get: async () => ({ ...cfg }), set: async value => writes.push(value) } }, runtime: { onMessage: { addListener: fn => listeners.push(fn) } } },
    podeAutomatizar: () => true,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    processarAgendamentos: async () => {},
    chamarAgenteNaAba: async () => ({ out: [] }),
    fetch: async (url, init) => { posts.push({ url, ...init }); return { ok: true, json: async () => ({ need_media: [] }) } },
    ...overrides,
  })
  vm.runInContext(bg.slice(bg.indexOf('// CRM live transport,'), bg.indexOf('async function marcarNaoLida(chatId)')), context)
  return { context, cfg, posts, writes, timers, listeners, runTimer: async delay => {
    const found = [...timers].find(([, timer]) => timer.delay === delay)
    assert.ok(found, `Expected timer at ${delay} ms`)
    timers.delete(found[0]); found[1].fn(); await settle()
  }, receive: chat => listeners[0]({ type: 'BRANORTE_CRM_MSG', chat }, { tab: { id: 7, url: 'https://web.whatsapp.com/' } }) }
}
function agentHarness(WPP = {}) {
  const events = []
  const window = { WPP, dispatchEvent: event => events.push(event) }
  const context = vm.createContext({ window, Set, Date, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail } }, setTimeout: fn => fn(), FileReader: class { readAsDataURL(blob) { this.result = blob.data; this.onload() } } })
  vm.runInContext(agent.slice(agent.indexOf('  const _MN_SIST'), agent.indexOf('  // Presenca lida pelo')), context)
  vm.runInContext(agent.slice(agent.indexOf('  async function lerMensagensFunil'), agent.indexOf('  // Corpo verbatim da func inline de buscarMensagens')), context)
  const methods = agent.slice(agent.indexOf('    crmLive: async'), agent.indexOf('    lerEtiquetas:'))
  vm.runInContext('globalThis.methods = ({' + methods + '})', context)
  return { context, window, events }
}
function message(fromMe, type = 'chat', hash = 'HASH') {
  return { id: { fromMe, remote: { _serialized: '5511999991111@c.us' }, _serialized: `${fromMe}_5511999991111@c.us_${hash}` }, type, t: 1750000000, body: 'oi' }
}
test('incoming and cellphone outgoing changes reach CRM once, while AI only sees incoming and ignores ciphertext', () => {
  const h = agentHarness()
  h.context._mnReceber(message(false))
  h.context._mnReceber(message(false))
  h.context._mnReceber(message(true, 'chat', 'OUT'))
  h.context._mnReceber(message(false, 'ciphertext', 'CIPHER'))
  h.context._mnReceber({ ...message(false, 'chat', 'GROUP'), id: { remote: { _serialized: '123@g.us' }, _serialized: 'group' } })
  assert.equal(h.events.length, 2)
  assert.equal(h.window.__bsbMsgNova.itens.length, 1)
  assert.equal(JSON.parse(h.events[1].detail).id, 'true_5511999991111@c.us_OUT')
})
test('LID lookup maps phone and canonical IDs without publishing image thumbnails as text', async () => {
  const h = agentHarness({ contact: { getPhoneFromLid: async () => '5511999991111@c.us' }, chat: { getMessages: async () => [message(false), { ...message(true, 'image', 'PHOTO'), body: 'a'.repeat(130), caption: '' }] } })
  const result = await h.context.methods.crmLive('12345678901234@lid')
  assert.equal(result.out[0].phone, '5511999991111')
  assert.equal(result.out[0].msg_id, 'HASH')
  assert.equal(result.out[1].body, '')
  assert.equal(result.out[1].from_me, true)
  assert.equal((await h.context.methods.crmLive('123@g.us')).out.length, 0)
})
test('live media falls back to the WA model when serialized and short IDs cannot download', async () => {
  const model = { ...message(false, 'image', 'PHOTO'), downloadMedia: async () => ({ size: 3, data: 'data:image/jpeg;base64,AQID' }) }
  const h = agentHarness({ chat: { downloadMedia: async id => { throw new Error('string ID unavailable') }, getMessages: async () => [model] } })
  assert.equal(await h.context.methods.crmMedia({ chat_id: '5511999991111@c.us', msg_id: 'PHOTO', from_me: false }), 'data:image/jpeg;base64,AQID')
})
test('queue wakeups serialize overlapping requests and preserve a second wakeup arriving during processing', async () => {
  let resolveFirst, calls = 0, active = 0, maxActive = 0
  const h = harness({ processarAgendamentos: async () => { calls++; active++; maxActive = Math.max(maxActive, active); if (calls === 1) await new Promise(resolve => { resolveFirst = resolve }); active-- } })
  const first = h.context.crmWakeQueue(); await settle()
  await h.context.crmWakeQueue(); await h.context.crmWakeQueue()
  resolveFirst(); await first
  assert.equal(calls, 2)
  assert.equal(maxActive, 1)
})
test('stream queue wakeups cannot start another seller or a disabled ANA worker', async () => {
  let calls = 0
  const h = harness({ processarAgendamentos: async () => { calls++ } })
  h.cfg.vendedor_nome = 'DANIEL'; await h.context.crmWakeQueue()
  h.cfg.vendedor_nome = 'ANA'; h.cfg.enabled = false; await h.context.crmWakeQueue()
  assert.equal(calls, 0)
})
test('failed fast history writes are retried and media from unrelated chats is not downloaded', async () => {
  let attempts = 0; const media = []
  const h = harness({
    chamarAgenteNaAba: async (tab, method, args) => { if (method === 'crmMedia') { media.push(args[0].msg_id); return null } return { out: [{ msg_id: 'PHOTO', tipo: 'image', chat_id: args[0] }, { msg_id: 'CIPHER', tipo: 'ciphertext', chat_id: args[0] }] } },
    fetch: async () => ({ ok: ++attempts > 1, status: 503, json: async () => ({ need_media: [{ msg_id: 'PHOTO' }, { msg_id: 'OTHER' }] }) }),
  })
  h.receive('5511999991111@c.us'); await h.runTimer(200)
  assert.equal(h.writes.length, 0)
  await h.runTimer(1500)
  assert.equal(h.writes.length, 1)
  assert.deepEqual(media, ['PHOTO'])
  assert.equal(attempts, 2)
})
test('ciphertext never enters a successful fast history POST', async () => {
  const h = harness({ chamarAgenteNaAba: async () => ({ out: [{ msg_id: 'HASH', tipo: 'chat' }, { msg_id: 'HIDDEN', tipo: 'ciphertext' }] }) })
  h.receive('5511999991111@c.us'); await h.runTimer(200)
  assert.deepEqual(JSON.parse(h.posts[0].body).mensagens.map(m => m.msg_id), ['HASH'])
})
test('fast history event does not accept other origins, groups or disabled ANA configuration', async () => {
  const h = harness()
  h.listeners[0]({ type: 'BRANORTE_CRM_MSG', chat: '5511999991111@c.us' }, { tab: { id: 7, url: 'https://untrusted.invalid/' } })
  h.receive('123@g.us')
  assert.equal(h.timers.size, 0)
  h.cfg.enabled = false; h.receive('5511999991111@c.us'); await h.runTimer(200)
  assert.equal(h.posts.length, 0)
})
test('a second message arriving during a history upload gets another flush without losing its chat', async () => {
  let resolveFirst, attempts = 0
  const h = harness({
    chamarAgenteNaAba: async (tab, method, args) => ({ out: [{ msg_id: 'HASH', tipo: 'chat', chat_id: args[0] }] }),
    fetch: async () => { attempts++; if (attempts === 1) await new Promise(resolve => { resolveFirst = resolve }); return { ok: true, json: async () => ({ need_media: [] }) } },
  })
  h.receive('5511999991111@c.us'); await h.runTimer(200)
  h.receive('5511999991111@c.us'); await h.runTimer(200)
  resolveFirst(); await settle(); await h.runTimer(1500)
  assert.equal(attempts, 2)
  assert.equal(h.writes.length, 2)
})
test('live media avoids converting a blob larger than the safe upload limit', async () => {
  const h = agentHarness({ chat: { downloadMedia: async () => ({ size: 6000001, data: 'too-large' }), getMessages: async () => [] } })
  assert.equal(await h.context.methods.crmMedia({ chat_id: '5511999991111@c.us', msg_id: 'BIG', from_me: false }), null)
})
test('fragmented SSE frames reconnect and wake the queue promptly, ignoring heartbeat comments', async () => {
  let calls = 0, reads = 0, h
  const chunks = ['event: rea', 'dy\r\ndata: {}\r\n\r', '\n: ping\n\nevent: wa', 'ke\ndata: {}\n\n']
  h = harness({ processarAgendamentos: async () => { calls++ }, fetch: async () => ({ ok: true, body: { getReader: () => ({ read: async () => { if (reads < chunks.length) return { done: false, value: new TextEncoder().encode(chunks[reads++]) }; h.cfg.enabled = false; return { done: true } } }) } }) })
  const run = h.context.crmStartStream(); await settle()
  assert.ok(calls >= 1 && calls <= 2)
  await h.runTimer(1000); await run
  assert.equal(h.timers.size, 0)
})
test('failed SSE authentication backs off rather than retrying in a tight loop', async () => {
  const h = harness({ fetch: async () => ({ ok: false, status: 401 }) })
  const run = h.context.crmStartStream(); await settle()
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 2000).length, 1)
  h.cfg.enabled = false; await h.runTimer(2000); await run
})
test('stream waits for central-role verification instead of permanently exiting during startup', async () => {
  let central = false, requests = 0
  const h = harness({ podeAutomatizar: () => central, fetch: async () => { requests++; return { ok: false, status: 503 } } })
  const run = h.context.crmStartStream(); await settle()
  assert.equal(requests, 0)
  assert.ok([...h.timers.values()].some(timer => timer.delay === 5000), 'Central verification must be retried')
  central = true; await h.runTimer(5000)
  assert.equal(requests, 1)
  h.cfg.enabled = false; await h.runTimer(2000); await run
})
test('an already-running fast loop restarts live transport after ANA is enabled again', async () => {
  let requests = 0
  const h = harness({ fetch: async () => { requests++; return { ok: true, body: { getReader: () => ({ read: async () => new Promise(() => {}) }) } } } })
  h.cfg.enabled = false
  Object.assign(h.context, { cicloIaAtendente: async () => {}, cicloConsultasInternas: async () => {}, naHora: () => false, filaQuente: () => false })
  vm.runInContext('let _iaFastLoopOn = false; let _iaAtdUltAtivos = 0;\n' + bg.slice(bg.indexOf('function startIaFastLoop()'), bg.indexOf('// CRM live transport,')), h.context)
  h.context.startIaFastLoop(); await settle()
  assert.equal(requests, 0)
  h.cfg.enabled = true; await h.runTimer(25000)
  assert.equal(requests, 1)
})
