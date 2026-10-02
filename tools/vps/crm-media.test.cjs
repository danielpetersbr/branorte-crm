const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const dir = process.env.CRM_EXT_DIR || __dirname
const bg = fs.readFileSync(path.join(dir, 'background.js'), 'utf8')
const agent = fs.readFileSync(path.join(dir, 'bsb-detect-chat.js'), 'utf8')
function resident(chat = {}) {
  const window = { WPP: { isReady: true, chat } }
  const context = vm.createContext({ window, Map, Date, atob, Set, FileReader: class { readAsDataURL(blob) { this.result = blob.data; this.onload() } } })
  const methods = agent.slice(agent.indexOf('    crmLive: async'), agent.indexOf('    lerEtiquetas:'))
  vm.runInContext('globalThis.methods = ({' + methods + '})', context)
  return { window, context, methods: context.methods }
}
const media = (changes = {}) => ({ requestId: 'request-1', chatId: '5511999991111@c.us', dataUrl: 'data:image/jpeg;base64,AQID', filename: '../foto.jpg', caption: 'Segue foto', mediaType: 'image', ...changes })
function worker(item, outcomes = {}, claim = true) {
  const patches = [], sends = [], text = []
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} }, Date, AbortSignal, Blob, FileReader: class { readAsDataURL(blob) { this.result = 'data:application/pdf;base64,AQID'; this.onload() } },
    HUB_ENDPOINT: 'https://hub.invalid', SHARED_SECRET: 'test-key', _filaQuente: 0,
    chrome: { storage: { local: { get: async keys => typeof keys === 'string' ? {} : { vendedor_nome: 'ANA' } } }, notifications: { create() {} } },
    podeAutomatizar: () => true, escolherAbaWaTab: async () => ({ tabId: 7 }), cadenciaAnaPara: () => false,
    resolverWidDoNumero: async () => ({ ok: true, wid: '123456789012345@lid' }),
    enviarTexto: async () => { text.push('normal'); return outcomes.text || { ok: true } },
    enviarTextoParaNumero: async () => { text.push('fallback'); return outcomes.text || { ok: true } },
    enviarMidia: async id => { sends.push(['legacy', id]); return outcomes.legacy || { ok: false, erro: 'No LID for user' } },
    crmEnviarMidia: async (id) => { sends.push(['crm', id]); return outcomes.crm || { ok: false, erro: 'No LID for user' } },
    crmDownloadMedia: async () => new Blob(['pdf'], { type: 'application/pdf' }),
    fetch: async (url, init) => {
      if (init?.method === 'PATCH') { const patch = JSON.parse(init.body); patches.push(patch); return { ok: patch.status !== 'sending' || claim } }
      if (url.startsWith('https://hub.invalid')) return { ok: true, json: async () => ({ items: [{ id: 1, scheduled_at: '2020-01-01', chat_id: '5511999991111@c.us', contato_numero: '5511999991111', body: 'anexo', media_url: 'https://storage.invalid/file', media_type: 'document', crm_request_id: 'request-1', ...item }] }) }
      return { ok: true, blob: async () => new Blob(['pdf']) }
    },
  })
  vm.runInContext(bg.slice(bg.indexOf('async function _processarAgendamentosCorpo()'), bg.indexOf('async function processarLembretes()')), context)
  return { patches, sends, text, run: () => context._processarAgendamentosCorpo() }
}
test('CRM attachment LID failures never fall back to text or mark sent', async () => {
  const h = worker({}); await h.run()
  assert.equal(h.sends.length, 2); assert.ok(h.sends.every(s => s[0] === 'crm'))
  assert.deepEqual(h.text, []); assert.equal(h.patches.at(-1).status, 'failed')
})
test('legacy attachment LID fallback remains unchanged', async () => {
  const h = worker({ crm_request_id: null }); await h.run()
  assert.deepEqual(h.text, ['fallback']); assert.equal(h.patches.at(-1).status, 'sent')
})
test('CRM missing attachment does not silently send its caption', async () => {
  const h = worker({ media_url: null }); await h.run()
  assert.deepEqual(h.text, []); assert.equal(h.patches.at(-1).status, 'failed')
})
test('failed claim does not attempt any send', async () => {
  const h = worker({}, {}, false); await h.run()
  assert.deepEqual(h.sends, []); assert.deepEqual(h.text, [])
})
test('CRM ambiguous timeout fails visibly without retry while legacy timeout stays sent', async () => {
  const h = worker({}, { crm: { ok: false, timeout: true } }); await h.run()
  assert.equal(h.sends.length, 1); assert.equal(h.patches.at(-1).status, 'failed')
  assert.match(h.patches.at(-1).error, /Confira no WhatsApp/)
  const old = worker({ crm_request_id: null }, { legacy: { timeout: true } }); await old.run()
  assert.equal(old.patches.at(-1).status, 'sent')
})
test('CRM success preserves returned WhatsApp ID in queue result', async () => {
  const h = worker({}, { crm: { ok: true, wa_msg_id: 'true_123@lid_HASH' } }); await h.run()
  assert.equal(h.patches.at(-1).wa_msg_id, 'true_123@lid_HASH'); assert.equal(h.patches.at(-1).error, null)
})
test('strict media sends once, sanitizes filename and retains WPP ID', async () => {
  const calls = []; let finish
  const h = resident({ sendFileMessage: async (...args) => { calls.push(args); return await new Promise(resolve => { finish = resolve }) } })
  assert.equal(typeof h.methods.crmSendMedia, 'function')
  const a = h.methods.crmSendMedia(media()), b = h.methods.crmSendMedia(media())
  await Promise.resolve(); finish({ id: 'true_5511999991111@c.us_HASH', ack: 0, sendMsgResult: Promise.resolve() })
  const result = await a; await b
  assert.equal(calls.length, 1); assert.equal(calls[0][2].filename, 'foto.jpg')
  assert.equal(calls[0][2].waitForAck, false); assert.equal(result.wa_msg_id, 'true_5511999991111@c.us_HASH')
  await h.methods.crmSendMedia(media()); assert.equal(calls.length, 1)
})
test('generic WebM audio stays an audio attachment, Ogg Opus gets PTT waveform', async () => {
  const calls = []; const h = resident({ sendFileMessage: async (...args) => { calls.push(args); return { id: 'HASH', sendMsgResult: Promise.resolve() } } })
  await h.methods.crmSendMedia(media({ dataUrl: 'data:audio/webm;base64,AQID', filename: 'audio.webm', mediaType: 'audio' }))
  assert.equal(calls[0][2].type, 'audio'); assert.notEqual(calls[0][2].isPtt, true)
  const ogg = Buffer.from('OggS' + '\0'.repeat(24) + 'OpusHead' + '\0'.repeat(12)).toString('base64')
  await h.methods.crmSendMedia(media({ requestId: 'request-2', dataUrl: 'data:audio/ogg;base64,' + ogg, filename: 'audio.ogg', mediaType: 'audio' }))
  assert.equal(calls[1][2].isPtt, true); assert.equal(calls[1][2].waveform, true)
})
test('strict media rejects wrong MIME, empty, oversized and never falls back after WPP error', async () => {
  let calls = 0; const h = resident({ sendFileMessage: async () => { calls++; throw new Error('server upload failed') } })
  const invalid = await h.methods.crmSendMedia(media({ dataUrl: 'data:audio/webm;base64,AQID' }))
  assert.equal(invalid.ok, false); assert.equal(calls, 0)
  const empty = await h.methods.crmSendMedia(media({ dataUrl: 'data:image/jpeg;base64,' }))
  assert.equal(empty.ok, false)
  const big = await h.methods.crmSendMedia(media({ dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(27962032) }))
  assert.equal(big.ok, false); assert.equal(calls, 0)
  const error = await h.methods.crmSendMedia(media()); assert.equal(error.ok, false); assert.equal(calls, 1)
  await h.methods.crmSendMedia(media()); assert.equal(calls, 1)
})
test('incoming media accepts 7MiB and bounds downloads using declared size', async () => {
  let count = 0
  const h = resident({ downloadMedia: async () => { count++; return { size: 7 * 1024 * 1024, data: 'data:image/jpeg;base64,AQID' } } })
  assert.equal(await h.methods.crmMedia({ chat_id: '123@lid', msg_id: 'HASH', size: 7 * 1024 * 1024 }), 'data:image/jpeg;base64,AQID')
  count = 0
  assert.equal(await h.methods.crmMedia({ chat_id: '123@lid', msg_id: 'BIG', size: 21 * 1024 * 1024 }), null)
  assert.equal(count, 0)
})
test('incoming hydrated model rejects oversized media before requesting its bytes', async () => {
  let downloads = 0
  const h = resident({ getMessages: async () => [{ id: { id: 'BIG' }, size: 21 * 1024 * 1024 }], downloadMedia: async () => { downloads++ } })
  assert.equal(await h.methods.crmMedia({ chat_id: '123@lid', msg_id: 'BIG' }), null)
  assert.equal(downloads, 0)
})
test('upload completion is required and rejected upload preserves locally registered ID', async () => {
  let finish, complete = false
  const upload = new Promise(resolve => { finish = resolve })
  const h = resident({ sendFileMessage: async () => ({ id: 'HASH', sendMsgResult: upload }) })
  const pending = h.methods.crmSendMedia(media()).then(value => { complete = true; return value })
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(complete, false)
  finish({ messageSendResult: 'OK' }); assert.equal((await pending).ok, true)
  const failed = resident({ sendFileMessage: async () => ({ id: 'LOCAL_ID', sendMsgResult: Promise.reject(new Error('upload failed')) }) })
  const result = await failed.methods.crmSendMedia(media())
  assert.equal(result.ok, false); assert.equal(result.wa_msg_id, 'LOCAL_ID')
})
test('WPP not ready returns retryable status without attempting upload', async () => {
  let attempts = 0; const h = resident({ sendFileMessage: async () => { attempts++ } }); h.window.WPP.isReady = false
  const result = await h.methods.crmSendMedia(media())
  assert.equal(result.notReady, true); assert.equal(attempts, 0)
})
test('resolved WhatsApp upload error is not reported as sent', async () => {
  const h = resident({ sendFileMessage: async () => ({ id: 'LOCAL_ID', sendMsgResult: Promise.resolve({ messageSendResult: 'ERROR_UPLOAD' }) }) })
  const result = await h.methods.crmSendMedia(media())
  assert.equal(result.ok, false); assert.equal(result.wa_msg_id, 'LOCAL_ID'); assert.equal(result.erro, 'ERROR_UPLOAD')
})
test('strict video and PDF document preserve media type and filename', async () => {
  const calls = []; const h = resident({ sendFileMessage: async (...args) => { calls.push(args); return { id: 'HASH', sendMsgResult: Promise.resolve() } } })
  await h.methods.crmSendMedia(media({ dataUrl: 'data:video/mp4;base64,AQID', mediaType: 'video', filename: 'video.mp4' }))
  await h.methods.crmSendMedia(media({ requestId: 'document', dataUrl: 'data:application/pdf;base64,AQID', mediaType: 'document', filename: 'C:\\folder\\proposta.pdf' }))
  assert.equal(calls[0][2].type, 'video'); assert.equal(calls[1][2].type, 'document')
  assert.equal(calls[1][2].filename, 'proposta.pdf'); assert.equal(calls[1][2].mimetype, 'application/pdf')
})
function helperContext(overrides = {}) {
  const context = vm.createContext({ console, Blob, AbortSignal, envioTravado: async () => false, ...overrides })
  const start = bg.indexOf('// CRM strict media transport.')
  assert.notEqual(start, -1)
  vm.runInContext(bg.slice(start, bg.indexOf('async function processarAgendamentos()', start)), context)
  return context
}
test('CRM downloads reject announced oversize without reading body and bound streamed bytes', async () => {
  let reads = 0, cancelled = 0
  const ctx = helperContext({ fetch: async () => ({ ok: true, headers: { get: () => '20971521' }, body: { cancel: async () => { cancelled++ }, getReader: () => { reads++ } } }) })
  await assert.rejects(ctx.crmDownloadMedia('https://storage.invalid/file'), /20 MiB/)
  assert.equal(reads, 0); assert.equal(cancelled, 1)
  const bounded = helperContext({ fetch: async (_url, init) => {
    assert.ok(init.signal instanceof AbortSignal)
    return { ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ value: { byteLength: 20971521 }, done: false }), cancel: async () => { cancelled++ }, releaseLock() {} }) } }
  } })
  await assert.rejects(bounded.crmDownloadMedia('https://storage.invalid/file'), /20 MiB/)
  assert.equal(cancelled, 2)
})
test('strict dispatch timeout is uncertain and never uses generic media fallback', async () => {
  let calls = 0
  const ctx = helperContext({ chamarAgenteNaAba: async (_tab, method, args, timeout) => {
    calls++; assert.equal(method, 'crmSendMedia'); assert.equal(timeout, 45000)
    assert.equal(args[0].requestId, 'trusted'); return undefined
  } })
  const result = await ctx.crmEnviarMidia('123@lid', { requestId: 'untrusted', dataUrl: 'test' }, 7, 'trusted')
  assert.equal(result.timeout, true); assert.equal(calls, 1)
})
test('CRM media awaits asynchronous send permission, allowing false and preventing true', async () => {
  let calls = 0, resolvePermission
  const ctx = helperContext({ envioTravado: async () => await new Promise(resolve => { resolvePermission = resolve }), chamarAgenteNaAba: async () => { calls++; return { ok: true, wa_msg_id: 'HASH' } } })
  const pending = ctx.crmEnviarMidia('123@lid', { dataUrl: 'test' }, 7, 'request')
  await Promise.resolve(); assert.equal(calls, 0)
  resolvePermission(false); assert.equal((await pending).ok, true); assert.equal(calls, 1)
  ctx.envioTravado = async () => true
  const blocked = await ctx.crmEnviarMidia('123@lid', { dataUrl: 'test' }, 7, 'blocked')
  assert.equal(blocked.ok, false); assert.equal(blocked.erro, 'cancelado'); assert.equal(calls, 1)
})
test('ANA avatar errors and undefined answers cannot clear cached photos; confirmed absence can', async () => {
  const posted = []
  const window = { WPP: { contact: { getProfilePictureUrl: async id => {
    if (id === 'throw') throw new Error('offline')
    if (id === 'unknown') return undefined
    return id === 'empty' ? null : 'https://avatar.invalid/photo'
  } } } }
  const ctx = vm.createContext({ console, window, AbortSignal, setTimeout: (fn, delay) => { if (delay === 150) fn() }, clearTimeout() {}, AVATAR_ENDPOINT: 'https://avatars.invalid', SHARED_SECRET: 'test-key',
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); if (body.fotos) posted.push(body.fotos)
      return { ok: true, json: async () => ({ precisam_foto: ['throw', 'unknown', 'empty', 'photo'].map(chat_id => ({ chat_id, phone: chat_id })) }) }
    },
  })
  const start = bg.indexOf('async function sincronizarAvatars(')
  vm.runInContext(bg.slice(start, bg.indexOf('// ============================================================================', start)), ctx)
  await ctx.sincronizarAvatars('ANA', 7)
  assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), [{ phone: 'empty', pic_url: null, pic_checked: true }, { phone: 'photo', pic_url: 'https://avatar.invalid/photo', pic_checked: true }])
  await ctx.sincronizarAvatars('DANIEL', 7)
  assert.equal(posted[1].length, 4); assert.equal(posted[1][0].pic_checked, undefined)
})
test('ID without upload promise is uncertain rather than sent', async () => {
  const h = resident({ sendFileMessage: async () => ({ id: 'LOCAL_ID' }) })
  const result = await h.methods.crmSendMedia(media())
  assert.equal(result.ok, false); assert.equal(result.timeout, true); assert.equal(result.wa_msg_id, 'LOCAL_ID')
})
test('ANA avatar cadence is independent from snapshot changes, bounded and single-flight', async () => {
  let now = 100000, calls = 0, finish
  const ctx = vm.createContext({ Date: { now: () => now }, podeAutomatizar: () => true,
    sincronizarAvatars: async () => { calls++; await new Promise(resolve => { finish = resolve }) },
  })
  const start = bg.indexOf('let _crmAvatarStarted')
  vm.runInContext(bg.slice(start, bg.indexOf('async function crmSyncMedia(', start)), ctx)
  const first = ctx.crmSyncAvatarsIfDue('ANA', 7); await Promise.resolve()
  now += 60001; await ctx.crmSyncAvatarsIfDue('ANA', 7); assert.equal(calls, 1)
  finish(); await first
  const second = ctx.crmSyncAvatarsIfDue('ANA', 7); await Promise.resolve()
  assert.equal(calls, 2); finish(); await second
  await ctx.crmSyncAvatarsIfDue('ANA', 7); assert.equal(calls, 2)
  now += 60001
  ctx.sincronizarAvatars = async () => { calls++; throw new Error('offline') }
  await ctx.crmSyncAvatarsIfDue('ANA', 7); assert.equal(calls, 3)
  now += 60001; await ctx.crmSyncAvatarsIfDue('ANA', 7); assert.equal(calls, 4)
  now += 60001; ctx.podeAutomatizar = () => false
  await ctx.crmSyncAvatarsIfDue('ANA', 7); assert.equal(calls, 4)
  ctx.podeAutomatizar = () => true; await ctx.crmSyncAvatarsIfDue('DANIEL', 7); assert.equal(calls, 4)
  const hook = bg.indexOf('void crmSyncAvatarsIfDue(cfg.vendedor_nome, tab.id)')
  const snapshotGate = bg.indexOf('if (fullKey === cfg.last_snapshot_key)')
  assert.ok(hook > 0 && hook < snapshotGate)
})
test('ANA avatar cursor advances before unsuccessful lookups and wraps after the final batch', async () => {
  const cfg = {}, requests = [], sequence = []
  let batch = 0
  const phones = ['5511999990001', '5511999990002']
  const ctx = vm.createContext({ console, AbortSignal, setTimeout: (fn, delay) => { if (delay === 150) fn() }, clearTimeout() {},
    window: { WPP: { contact: { getProfilePictureUrl: async () => undefined } } },
    AVATAR_ENDPOINT: 'https://avatars.invalid', SHARED_SECRET: 'test-key',
    chrome: { storage: { local: { get: async () => ({ ...cfg }), set: async value => { Object.assign(cfg, value); sequence.push('advance') } } }, scripting: { executeScript: async ({ func, args }) => { sequence.push('lookup'); return [{ result: await func(...args) }] } } },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body)); const phone = phones[batch++]
      return { ok: true, json: async () => ({ precisam_foto: phone ? [{ phone, chat_id: phone + '@c.us' }] : [], avatar_cursor: phone || null }) }
    },
  })
  const start = bg.indexOf('async function sincronizarAvatars(')
  vm.runInContext(bg.slice(start, bg.indexOf('// ============================================================================', start)), ctx)
  await ctx.sincronizarAvatars('ANA', 7); await ctx.sincronizarAvatars('ANA', 7); await ctx.sincronizarAvatars('ANA', 7)
  assert.equal(requests[0].avatar_cursor, null)
  assert.equal(requests[1].avatar_cursor, phones[0]); assert.equal(requests[2].avatar_cursor, phones[1])
  assert.equal(cfg.crm_avatar_cursor_ana, null)
  assert.deepEqual(sequence, ['advance', 'lookup', 'advance', 'lookup', 'advance'])
})
test('wrapper stamp satisfies the unchanged old auto-update guard without declaring BG_VERSAO twice', async () => {
  const shim = fs.readFileSync(path.join(dir, 'painel-worker.js'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  let imported = 0
  const ctx = vm.createContext({ Set, _autoUpdHash: () => 'test-hash',
    chrome: { tabs: { query: async () => [] }, storage: { local: { set: async () => {} } }, alarms: { onAlarm: { addListener() {} } } },
    _autoUpdLerManifest: async () => ({ man: manifest, versao: manifest.version, hash: 'test-hash' }),
    _autoUpdLerPasta: async file => file === 'painel-worker.js' ? shim : file === 'bsb-detect-chat.js' ? agent : true,
  })
  ctx.importScripts = file => { assert.equal(file, 'background.js'); imported++; vm.runInContext('const BG_VERSAO = ' + JSON.stringify(manifest.version), ctx) }
  vm.runInContext(shim, ctx); assert.equal(imported, 1)
  const start = bg.indexOf('async function _autoUpdConferirPasta()')
  vm.runInContext(bg.slice(start, bg.indexOf('function _autoUpdSetDiag(', start)), ctx)
  const check = await ctx._autoUpdConferirPasta()
  assert.equal(check.ok, true); assert.equal(check.versao, manifest.version)
})
