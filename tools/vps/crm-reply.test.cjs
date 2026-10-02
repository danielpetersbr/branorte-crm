const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const dir = process.env.CRM_EXT_DIR
const agent = fs.readFileSync(path.join(dir, 'bsb-detect-chat.js'), 'utf8')
const bg = fs.readFileSync(path.join(dir, 'background.js'), 'utf8')
const quoted = { id: { _serialized: 'false_123@lid_ABC123', id: 'ABC123', remote: { _serialized: '123@lid' }, fromMe: false }, type: 'chat' }
function resident({ models = [quoted], history = [], outcome, lookupFailure } = {}) {
  const calls = [], reads = []
  const chat = {
    getMessageById: async id => { reads.push(id); if (lookupFailure) throw new Error('lookup failed'); return [...models, ...history].find(m => m.id._serialized === id) },
    getMessages: async id => { assert.equal(id, '123@lid'); return history },
    sendTextMessage: async (...args) => { calls.push(['text', ...args]); return outcome || { id: 'true_123@lid_SENT123', sendMsgResult: Promise.resolve() } },
    sendFileMessage: async (...args) => { calls.push(['media', ...args]); return outcome || { id: 'true_123@lid_SENT123', sendMsgResult: Promise.resolve() } },
  }
  const window = { WPP: { isReady: true, chat, whatsapp: { MsgStore: { getModelsArray: () => models } } } }
  const ctx = vm.createContext({ window, Map, Set, Date, atob, setTimeout, clearTimeout })
  const methods = agent.slice(agent.indexOf('    crmLive: async'), agent.indexOf('    lerEtiquetas:'))
  vm.runInContext('globalThis.FNS = ({' + methods + '})', ctx)
  return { ctx, calls, reads, methods: ctx.FNS, window }
}
const text = (overrides = {}) => ({ requestId: 'request-test', chatId: '123@lid', body: 'Synthetic reply', replyMsgId: 'ABC123', replyFromMe: false, ...overrides })
const media = (type = 'image', overrides = {}) => ({ ...text(), mediaType: type, filename: 'synthetic.' + type, dataUrl: 'data:' + ({ image: 'image/jpeg', audio: 'audio/webm', video: 'video/mp4', document: 'application/pdf' }[type]) + ';base64,AQID', ...overrides })
test('quoted text resolves the actual serialized message ID without constructing one from a hash', async () => {
  const h = resident(); assert.equal(typeof h.methods.crmSendText, 'function')
  const r = await h.methods.crmSendText(text())
  assert.equal(r.ok, true); assert.equal(r.wa_msg_id, 'true_123@lid_SENT123')
  assert.equal(h.calls[0][3].quotedMsg, quoted.id._serialized)
  assert.ok(h.reads.every(id => id === quoted.id._serialized))
})
test('quoted image/audio/video/document retain type and exact quote while uncited media stays unchanged', async () => {
  for (const type of ['image', 'audio', 'video', 'document']) {
    const h = resident(); const r = await h.methods.crmSendMedia(media(type))
    assert.equal(r.ok, true); assert.equal(h.calls[0][3].quotedMsg, quoted.id._serialized)
    assert.equal(h.calls[0][3].type, type)
    await h.methods.crmSendMedia(media(type, { requestId: 'uncited', replyMsgId: null }))
    assert.equal(h.calls[1][3].quotedMsg, undefined)
  }
})
test('cross-chat, fromMe mismatch, malformed and missing quotes fail before any send', async () => {
  for (const p of [text({ replyMsgId: 'false_999@lid_ABC123' }), text({ replyFromMe: true }), text({ replyMsgId: '' }), text({ replyMsgId: 'UNKNOWN123' })]) {
    const h = resident(); const r = await h.methods.crmSendText(p)
    assert.equal(r.ok, false); assert.equal(r.quoteError, true); assert.equal(h.calls.length, 0)
  }
  const h = resident({ models: [{ ...quoted, id: { ...quoted.id, _serialized: 'false_999@lid_ABC123', remote: { _serialized: '999@lid' } } }] })
  const r = await h.methods.crmSendMedia(media()); assert.equal(r.ok, false); assert.equal(h.calls.length, 0)
})
test('official lookup or WPP quote rejection never retries as an uncited send', async () => {
  const lookup = resident({ lookupFailure: true }); const a = await lookup.methods.crmSendText(text({ replyMsgId: quoted.id._serialized }))
  assert.equal(a.ok, false); assert.equal(lookup.calls.length, 0)
  const h = resident(); h.window.WPP.chat.sendFileMessage = async (...args) => { h.calls.push(args); throw new Error('invalid_quoted_msg') }
  const b = await h.methods.crmSendMedia(media()); assert.equal(b.ok, false); assert.equal(h.calls.length, 1)
  await h.methods.crmSendMedia(media()); assert.equal(h.calls.length, 1)
})
test('history hydration resolves an actual model and text singleflight retains confirmation', async () => {
  let release
  const upload = new Promise(resolve => { release = resolve })
  const h = resident({ models: [], history: [quoted], outcome: { id: 'true_123@lid_SENT123', sendMsgResult: upload } })
  const a = h.methods.crmSendText(text()), b = h.methods.crmSendText(text())
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(h.calls.length, 1); release(); assert.equal((await a).ok, true); assert.equal((await b).ok, true)
  await h.methods.crmSendText(text()); assert.equal(h.calls.length, 1)
})
test('uncited CRM text has no quote option and missing confirmation fails uncertainly', async () => {
  const h = resident({ outcome: { id: 'LOCAL123' } })
  const r = await h.methods.crmSendText(text({ replyMsgId: null }))
  assert.equal(h.calls[0][3].quotedMsg, undefined); assert.equal(r.ok, false); assert.equal(r.timeout, true)
})
test('quote lookup timeout cannot send later when a stalled lookup finally resolves', async () => {
  let release
  const h = resident({ models: [] })
  h.window.WPP.chat.getMessages = async () => await new Promise(resolve => { release = resolve })
  h.ctx.setTimeout = (fn, ms) => setTimeout(fn, ms === 8000 ? 5 : ms)
  const r = await h.methods.crmSendText(text())
  assert.equal(r.ok, false); assert.equal(r.quoteError, true); assert.equal(h.calls.length, 0)
  release([quoted]); for (let i = 0; i < 15; i++) await Promise.resolve()
  assert.equal(h.calls.length, 0)
})
function queue({ reply = 'ABC123', mediaType = null, seller = 'ANA', result = { ok: true, wa_msg_id: 'SENT123' } } = {}) {
  const sends = [], patches = []
  const ctx = vm.createContext({ Date, Blob, console: { log() {}, warn() {}, error() {} }, AbortSignal,
    HUB_ENDPOINT: 'https://hub.invalid', SHARED_SECRET: 'test-only', _filaQuente: 0,
    FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,AQID'; this.onload() } },
    chrome: { storage: { local: { get: async key => typeof key === 'string' ? {} : { vendedor_nome: seller } } }, notifications: { create() {} } },
    podeAutomatizar: () => true, escolherAbaWaTab: async () => ({ tabId: 7 }), cadenciaAnaPara: () => false,
    crmEnviarTexto: async (...args) => { sends.push(['quoted', ...args]); return result },
    enviarTexto: async (...args) => { sends.push(['legacy', ...args]); return { ok: true, id: 'LEGACY' } },
    enviarTextoParaNumero: async () => { sends.push(['UNQUOTED FALLBACK']); return { ok: true } },
    crmEnviarMidia: async (...args) => { sends.push(['media', ...args]); return result },
    enviarMidia: async () => { sends.push(['legacy-media']); return { ok: true } },
    crmDownloadMedia: async () => new Blob(['test'], { type: 'image/jpeg' }),
    fetch: async (_url, init) => {
      if (init?.method === 'PATCH') { patches.push(JSON.parse(init.body)); return { ok: true } }
      return { ok: true, json: async () => ({ items: [{ id: 1, crm_request_id: 'req', scheduled_at: '2020-01-01', chat_id: '123@lid', contato_numero: '5511999991111', body: 'Synthetic', urgente: true, reply_msg_id: reply, reply_from_me: false, media_type: mediaType, media_url: mediaType ? 'https://storage.invalid/file' : null }] }) }
    },
  })
  const start = bg.indexOf('async function _processarAgendamentosCorpo()')
  vm.runInContext(bg.slice(start, bg.indexOf('async function processarLembretes()', start)), ctx)
  return { sends, patches, run: () => ctx._processarAgendamentosCorpo() }
}
test('queue propagates quote metadata to CRM text and all media types, keeping unquoted legacy behavior', async () => {
  const t = queue(); await t.run(); assert.equal(t.sends[0][0], 'quoted'); assert.equal(t.sends[0][2].replyMsgId, 'ABC123')
  for (const type of ['image', 'audio', 'video', 'document']) {
    const h = queue({ mediaType: type }); await h.run(); assert.equal(h.sends[0][2].replyMsgId, 'ABC123'); assert.equal(h.sends[0][2].replyFromMe, false)
  }
  const old = queue({ seller: 'DANIEL' }); await old.run(); assert.equal(old.sends[0][0], 'legacy')
  const uncited = queue({ reply: null }); await uncited.run(); assert.equal(uncited.sends[0][0], 'legacy')
})
test('failed quote is terminal and never falls back to unquoted text', async () => {
  const h = queue({ result: { ok: false, quoteError: true, erro: 'No LID for user' } }); await h.run()
  assert.deepEqual(h.sends.map(s => s[0]), ['quoted']); assert.equal(h.patches.at(-1).status, 'failed')
})
