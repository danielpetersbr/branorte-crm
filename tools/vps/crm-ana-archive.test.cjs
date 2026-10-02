const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR, 'background.js'), 'utf8')
const helper = bg.slice(bg.indexOf('// >>> CRM ANA CONTROL 35'), bg.indexOf('// <<< CRM ANA CONTROL 35'))
const parsed = ts.createSourceFile('private.js', bg, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const actual = name => { const n = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(n, name); return bg.slice(n.getStart(parsed), n.end) }
const marker = '2026-10-02T12:00:00Z', cutoff = Date.parse(marker) / 1000
const action = () => ({ id: 42, chat_id: '123@lid', payload: { etiqueta: 'RESOLVIDOS', crm_close: { conversation_id: 'synthetic', marker, label_id: '22' } } })
function harness(options = {}) {
  const events = [], gateCalls = [], writes = [], state = { arq_ana_base: { kept: 40 } }
  const chat = { id: { _serialized: options.wrongChat ? '999@lid' : '123@lid' }, archive: !!options.alreadyArchived, t: cutoff - 10 }
  const messages = options.messages || [{ id: { fromMe: false, id: 'OLD1' }, type: 'chat', t: cutoff - 10 }]
  const window = { WPP: { isReady: true, conn: { getStreamData: () => ({ mode: 'MAIN' }) }, chat: {
    get: async () => chat, getMessages: async () => messages,
    archive: async id => { assert.equal(id, '123@lid'); events.push('archive'); if (options.archiveThrows) throw new Error('synthetic_failure'); if (!options.unconfirmed) chat.archive = true; if (options.duringArchive) messages.push({ id: { fromMe: false, id: 'NEW1' }, type: 'chat', t: cutoff }); return { archive: true } },
    unarchive: async () => { events.push('unarchive'); if (options.undoFails || (options.undoFailsOnce && !options.undoAttempted++)) throw new Error('synthetic_undo'); chat.archive = false },
  } } }
  let fakeNow = 0
  const ctx = vm.createContext({ window, Map, Set, Date: options.unconfirmed ? class extends Date { static now() { return fakeNow += 1000 } } : Date,
    AbortController, setTimeout: options.unconfirmed ? fn => setTimeout(fn, 1) : setTimeout, clearTimeout,
    _arqAnaRodando: !!options.busy, ARQ_ANA_TIPOS_AVISO: ['notification'], HUB_ENDPOINT: 'https://synthetic.invalid', SHARED_SECRET: 'synthetic-only',
    IA_FUNIL_ETAPAS: ['PROSPECCAO'],
    fetch: async (_url, init) => { const body = JSON.parse(init.body); gateCalls.push(body); events.push('gate'); if (gateCalls.length === 3 && options.finalNetwork) throw new TypeError('network'); return { ok: true, json: async () => !body.close ? (options.latestReason ? { allowed: false, reason: options.latestReason } : { allowed: true, reason: 'available' }) : (gateCalls.length >= 2 && options.stale) || (gateCalls.length >= 3 && options.finalStale) ? { allowed: false, reason: 'stale_crm_close' } : { allowed: true, reason: 'current_crm_close', label_id: '22', label_name: 'RESOLVIDOS' } } },
    listarLabelsWa: async () => [{ id: '22', name: 'RESOLVIDOS' }, { id: '4', name: 'PROSPECÇÃO' }],
    aplicarLabelEmChat: async () => { events.push('label'); return options.labelFails ? { ok: false, erro: 'label_failure' } : { ok: true } },
    getWaTabPronta: async () => options.noTab ? null : 7,
    arqAnaNaPagina: async (_tab, fn, args) => fn(...args),
    chrome: { storage: { local: { get: async () => state, set: async value => { if (options.storageFails) throw new Error('storage'); writes.push(value); Object.assign(state, value) } } } },
  })
  vm.runInContext(helper + '\n' + actual('arqAnaPaginaArquivar') + '\n' + actual('arqAnaDecidir'), ctx)
  return { ctx, events, gateCalls, writes, state, chat, run: () => ctx.crmApplyCloseLabel(action()) }
}
test('CRM closure applies label, freshly validates generation, archives and confirms the actual WA state before success', async () => {
  const h = harness(); const r = await h.run(); assert.equal(r.ok, true); assert.equal(h.chat.archive, true)
  assert.deepEqual(h.events, ['gate', 'label', 'gate', 'archive', 'gate']); assert.equal(h.gateCalls.length, 3)
  assert.ok(h.state.arq_ana_base['123@lid'] >= cutoff); assert.equal(h.state.arq_ana_base.kept, 40); assert.equal(h.ctx._arqAnaRodando, false)
})
test('a failed label never archives and does not acknowledge successful closure', async () => {
  const h = harness({ labelFails: true }); const r = await h.run(); assert.equal(r.ok, false); assert.equal(h.chat.archive, false); assert.ok(!h.events.includes('archive')); assert.equal(h.writes.length, 0)
})
test('manual CRM reopen during archival undoes archive before stale terminal ACK and never persists baseline', async () => {
  const h = harness({ finalStale: true }); const r = await h.run()
  assert.equal(r.ignored, true); assert.equal(h.chat.archive, false); assert.ok(h.events.includes('unarchive')); assert.equal(h.state.arq_ana_base['123@lid'], undefined)
})
test('failed unarchive compensation is retryable and cannot acknowledge a stale closure', async () => {
  const h = harness({ finalStale: true, undoFails: true }); const r = await h.run()
  assert.equal(r.ok, false); assert.equal(r.ignored, undefined); assert.match(r.erro, /wpp/); assert.equal(h.state.arq_ana_base['123@lid'], undefined)
})
test('final gate outage does not acknowledge success or persist baseline after archival', async () => {
  const h = harness({ finalNetwork: true }); const r = await h.run()
  assert.equal(r.ok, false); assert.match(r.erro, /wpp/); assert.equal(h.chat.archive, true); assert.equal(h.writes.length, 0)
})
test('failed compensation persists exact action proof and the next stale retry completes undo and cleans it', async () => {
  const h = harness({ finalStale: true, undoFailsOnce: true, undoAttempted: 0 }); const first = await h.run()
  assert.equal(first.ok, false); assert.equal(h.chat.archive, true)
  assert.equal(h.state.crm_archive_undo['42'].chat_id, '123@lid'); assert.equal(h.state.crm_archive_undo['42'].marker, marker)
  const second = await h.run(); assert.equal(second.ignored, true); assert.equal(h.chat.archive, false)
  assert.equal(h.state.crm_archive_undo['42'], undefined); assert.equal(h.state.arq_ana_base['123@lid'], undefined)
})
test('stale command without compensation proof never unarchives a manual archive', async () => {
  const h = harness({ stale: true, alreadyArchived: true }); const r = await h.run()
  assert.equal(r.ignored, true); assert.equal(h.chat.archive, true); assert.ok(!h.events.includes('unarchive'))
})
test('natural action cycle drains failed compensation even when canceled action will not be redelivered', async () => {
  const h = harness({ finalStale: true, undoFailsOnce: true, undoAttempted: 0 }); await h.run()
  await h.ctx.crmDrainArchiveUndo()
  assert.equal(h.chat.archive, false); assert.equal(h.state.crm_archive_undo['42'], undefined)
  const flow = actual('cicloFluxoAcoes')
  assert.ok(flow.indexOf('crmDrainArchiveUndo()') < flow.indexOf('fetch(FLUXO_ENGINE_ENDPOINT'))
})
test('compensation drain preserves a current permitted closure and failed service lookup proof', async () => {
  for (const throws of [false, true]) {
    const h = harness({ finalStale: true, undoFailsOnce: true, undoAttempted: 0 }); await h.run()
    h.ctx.fetch = async () => { if (throws) throw new TypeError('network'); return { ok: true, json: async () => ({ allowed: true, reason: 'current_crm_close' }) } }
    await h.ctx.crmDrainArchiveUndo()
    assert.equal(h.chat.archive, true); assert.ok(h.state.crm_archive_undo['42'])
  }
})
test('compensation proof from another action identity or marker never permits undo', async () => {
  const h = harness({ stale: true, alreadyArchived: true })
  h.state.crm_archive_undo = { '42': { action_id: '42', chat_id: '999@lid', marker, conversation_id: 'synthetic', label_id: '22' } }
  await h.run(); assert.equal(h.chat.archive, true); assert.ok(!h.events.includes('unarchive'))
})
test('a newer completed closure preserves its archive and clears only the exact old compensation proof', async () => {
  for (const latestReason of ['crm_closed_until_inbound', 'crm_ana_blocked', 'legacy_ia_blocked']) {
    const h = harness({ finalStale: true, undoFailsOnce: true, undoAttempted: 0 }); await h.run()
    h.state.crm_archive_undo.other = { action_id: 'other' }
    h.ctx.fetch = async (_url, init) => ({ ok: true, json: async () => JSON.parse(init.body).close ? { allowed: false, reason: 'stale_crm_close' } : { allowed: false, reason: latestReason } })
    await h.ctx.crmDrainArchiveUndo()
    assert.equal(h.chat.archive, true); assert.equal(h.state.crm_archive_undo['42'], undefined); assert.ok(h.state.crm_archive_undo.other)
    assert.equal(h.events.filter(e => e === 'unarchive').length, 1)
  }
})
test('normal gate outage after stale finalization persists proof before lookup and recovers on retry or drain', async () => {
  for (const drain of [false, true]) {
    const h = harness({ finalStale: true }), originalFetch = h.ctx.fetch
    let failNormal = true
    h.ctx.fetch = async (url, init) => { if (!JSON.parse(init.body).close && failNormal) { failNormal = false; throw new TypeError('network') } return originalFetch(url, init) }
    const first = await h.run(); assert.equal(first.ok, false); assert.equal(h.chat.archive, true)
    assert.equal(h.state.crm_archive_undo['42'].marker, marker)
    vm.runInContext('_crmAnaGateRetryUntil.clear()', h.ctx) // advance the bounded failure retry without sleeping
    if (drain) await h.ctx.crmDrainArchiveUndo()
    else assert.equal((await h.run()).ignored, true)
    assert.equal(h.chat.archive, false); assert.equal(h.state.crm_archive_undo['42'], undefined)
  }
})
test('inbound/reopen generation change between label and archive prevents archival', async () => {
  const h = harness({ stale: true }); const r = await h.run(); assert.equal(r.ignored, true); assert.ok(!h.events.includes('archive')); assert.equal(h.writes.length, 0)
})
test('fresh customer speech on WA prevents archival even before the database has ingested it', async () => {
  const h = harness({ messages: [{ id: { fromMe: false, id: 'NEW1' }, type: 'chat', t: cutoff + 1 }] }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /cliente_falou_depois/); assert.ok(!h.events.includes('archive'))
})
test('archive failure remains retryable and never reports WPP success', async () => {
  const h = harness({ archiveThrows: true }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /wpp/); assert.equal(h.writes.length, 0); assert.equal(h.ctx._arqAnaRodando, false)
})
test('already archived retries are idempotent without another archive command', async () => {
  const h = harness({ alreadyArchived: true }); const r = await h.run(); assert.equal(r.ok, true); assert.ok(!h.events.includes('archive')); assert.ok(h.state.arq_ana_base['123@lid'] >= cutoff)
})
test('WA-JS returning archive:true does not count as success until chat.archive is actually true', async () => {
  const h = harness({ unconfirmed: true }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /wpp.*archive/); assert.equal(h.writes.length, 0)
})
test('archive baseline prevents the existing first-view unarchiver from undoing this closure', async () => {
  const h = harness(); await h.run(); const r = h.ctx.arqAnaDecidir([{ id: '123@lid', t: cutoff - 10, cli: cutoff - 10, eu: 0 }], h.state.arq_ana_base, cutoff + 20, 86400, false, {})
  assert.equal(r.desarquivar.length, 0)
})
test('a new customer message after archival still unarchives through the existing lifecycle', async () => {
  const h = harness(); await h.run(); const r = h.ctx.arqAnaDecidir([{ id: '123@lid', t: cutoff + 2, cli: cutoff + 2, eu: 0 }], h.state.arq_ana_base, cutoff + 20, 86400, false, {})
  assert.deepEqual(Array.from(r.desarquivar), ['123@lid'])
})
test('legacy archive cycle busy state defers CRM archival without altering its guard or acknowledging success', async () => {
  const h = harness({ busy: true }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /wpp.*busy/); assert.ok(!h.events.includes('archive')); assert.equal(h.ctx._arqAnaRodando, true)
})
test('storage persistence failure does not silently allow the legacy cycle to undo a reported success', async () => {
  const h = harness({ storageFails: true }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /wpp/); assert.equal(h.ctx._arqAnaRodando, false)
})
test('missing WA tab never acknowledges closure archival', async () => {
  const h = harness({ noTab: true }); const r = await h.run(); assert.equal(r.ok, false); assert.ok(!h.events.includes('archive'))
})
test('customer arrival during archive, including equal-second timestamps, undoes archival and reports failure', async () => {
  const h = harness({ duringArchive: true }); const r = await h.run(); assert.equal(r.ok, false); assert.match(r.erro, /cliente_falou_durante_archive/)
  assert.equal(h.chat.archive, false); assert.deepEqual(h.events.slice(-2), ['archive', 'unarchive']); assert.equal(h.writes.length, 0)
})
test('unknown chat identity or message direction fails closed before archival', async () => {
  for (const options of [{ wrongChat: true }, { messages: [{ id: { id: 'UNKNOWN1' }, type: 'chat', t: cutoff - 10 }] }, { messages: [] }]) {
    const h = harness(options); const r = await h.run(); assert.equal(r.ok, false); assert.ok(!h.events.includes('archive'))
  }
})
