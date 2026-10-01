const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const popupFile = process.env.CRM_POPUP_FILE || path.join(__dirname, 'popup.js')
const source = fs.readFileSync(popupFile, 'utf8')
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
function harness(fetcher) {
  let now = 100000, timerId = 0
  const timers = new Map(), requests = [], nodes = new Map()
  const cfg = { vendedor_nome: 'ANA', branorte_install_id: 'test-install', last_heartbeat_at: now }
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, handlers: {}, value: '', textContent: '', innerHTML: '', disabled: false, addEventListener(type, callback) { this.handlers[type] = callback }, querySelector: name => node(id + name), focus() {} })
    return nodes.get(id)
  }
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const context = vm.createContext({
    document: { getElementById: node, addEventListener() {} }, navigator: { userAgentData: { platform: 'Linux' } }, console,
    Date: ClockDate, AbortController, confirm: () => true, alert() {},
    chrome: { runtime: { getManifest: () => ({ version: '1.70.28' }), getURL: value => value, sendMessage: async () => ({}) }, tabs: { create() {} }, storage: { local: { get: async () => ({ ...cfg }), set: async values => Object.assign(cfg, values) }, sync: { get: async () => ({}), set: async () => {} } } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      requests.push({ action: body.action, vendor: body.vendedor_nome })
      return fetcher ? fetcher(body, init) : { json: async () => ({ ok: true, marcado: true, sou_central: body.action !== 'liberar' }) }
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: now + delay, period: 0 }); return id },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, period) => { const id = ++timerId; timers.set(id, { callback, due: now + period, period }); return id },
    clearInterval: id => timers.delete(id),
  })
  vm.runInContext(source, context)
  return { context, requests, nodes, cfg, node, advance: async ms => {
    const target = now + ms
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
      if (!due) break
      now = due[1].due
      if (due[1].period) due[1].due += due[1].period; else timers.delete(due[0])
      due[1].callback(); await settle()
    }
    now = target; await settle()
  } }
}
test('an open popup keeps live local stats current without querying central election every second', async () => {
  const h = harness(); await settle()
  assert.equal(h.requests.length, 1, 'Check role immediately on initial open')
  h.cfg.last_count = 7; await h.advance(1000)
  assert.match(h.node('stats').innerHTML, /7/)
  await h.advance(58000)
  assert.equal(h.requests.length, 1)
  await h.advance(1000)
  assert.equal(h.requests.length, 2, 'Periodic network reconciliation remains once per minute')
})
test('overlapping role refreshes share the same pending HTTP operation', async () => {
  let resolve
  const response = new Promise(done => { resolve = done })
  const h = harness(async () => response); await settle()
  const refreshes = Array.from({ length: 10 }, () => h.context.carregarCentral('ANA'))
  await settle(); assert.equal(h.requests.length, 1)
  resolve({ json: async () => ({ ok: true, marcado: true, sou_central: true }) })
  await Promise.all(refreshes)
  assert.match(h.node('central-status').innerHTML, /CENTRAL/)
})
test('a hung role check aborts at its deadline and can recover on the next refresh', async () => {
  let recovered = false
  const h = harness(async (body, init) => {
    if (recovered) return { json: async () => ({ ok: true, marcado: true, sou_central: true }) }
    return new Promise((resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }); await settle()
  await h.advance(10000)
  assert.match(h.node('central-status').innerHTML, /checar/)
  recovered = true; await h.advance(50000)
  assert.equal(h.requests.length, 2)
  assert.match(h.node('central-status').innerHTML, /CENTRAL/)
})
test('manual central claim is followed by an uncached authoritative role check', async () => {
  const h = harness(); await settle()
  await h.node('marcarCentral').handlers.click(); await settle()
  assert.deepEqual(h.requests.map(request => request.action), ['status', 'marcar', 'status'])
})
test('manual central release is followed by an uncached authoritative role check', async () => {
  const h = harness(); await settle()
  await h.node('liberarCentral').handlers.click(); await settle()
  assert.deepEqual(h.requests.map(request => request.action), ['status', 'liberar', 'status'])
})
test('switching seller forces a fresh role lookup instead of reusing another seller cache', async () => {
  const h = harness(); await settle()
  h.cfg.vendedor_nome = 'DANIEL'; await h.advance(1000)
  assert.deepEqual(h.requests.map(request => request.vendor), ['ANA', 'DANIEL'])
})
test('a pre-claim role response cannot overwrite the new role while the authoritative follow-up is pending', async () => {
  let oldRole, newRole, statusCalls = 0
  const h = harness(async body => {
    if (body.action === 'marcar') return { json: async () => ({ ok: true, marcado: true, sou_central: true }) }
    statusCalls++
    return new Promise(resolve => { if (statusCalls === 1) oldRole = resolve; else newRole = resolve })
  }); await settle()
  const claim = h.node('marcarCentral').handlers.click(); await settle()
  assert.match(h.node('central-status').innerHTML, /CENTRAL/)
  oldRole({ json: async () => ({ ok: true, marcado: true, sou_central: false }) }); await settle()
  assert.match(h.node('central-status').innerHTML, /CENTRAL/)
  assert.deepEqual(h.requests.map(request => request.action), ['status', 'marcar', 'status'])
  newRole({ json: async () => ({ ok: true, marcado: true, sou_central: false }) }); await claim
  assert.match(h.node('central-status').innerHTML, /PASSIVO/)
})
test('a late response for another seller cannot repaint the currently selected seller', async () => {
  let oldRole
  const h = harness(async body => {
    if (body.vendedor_nome === 'ANA') return new Promise(resolve => { oldRole = resolve })
    return { json: async () => ({ ok: true, marcado: true, sou_central: false }) }
  }); await settle()
  h.cfg.vendedor_nome = 'DANIEL'; await h.advance(1000)
  assert.match(h.node('central-status').innerHTML, /PASSIVO/)
  oldRole({ json: async () => ({ ok: true, marcado: true, sou_central: true }) }); await settle()
  assert.match(h.node('central-status').innerHTML, /PASSIVO/)
})
