const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR, 'background.js'), 'utf8')
function harness({ ids = ['photo', 'unknown', 'empty', 'throw', 'timeout'], lookupStatus = 200, uploadStatus = 200 } = {}) {
  const posts = [], lookups = []
  const ctx = vm.createContext({ _crmAvatarDiag: null, Date, console: { info() {} }, AbortSignal,
    AVATAR_ENDPOINT: 'https://avatars.invalid', SHARED_SECRET: 'test-key',
    setTimeout: (fn, delay) => { if (delay === 150) fn(); else return setTimeout(fn, 5) }, clearTimeout,
    window: { WPP: { contact: {
      getPnLidEntry: async () => ({ phoneNumber: { _serialized: 'private-mapping@c.us' } }),
      getProfilePictureUrl: async (id, full = true) => {
        lookups.push([id, full])
        if (id === 'timeout' && full) return new Promise(() => {})
        if (id === 'throw') throw Object.assign(new TypeError('PRIVATE client URL https://private.invalid/secret'), { code: 'ERR_LOOKUP' })
        if (id === 'unknown' && full) return undefined
        if (id === 'empty' && full) return null
        return 'https://PRIVATE.invalid/client-avatar'
      },
    } } },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); posts.push(body)
      const status = body.fotos ? uploadStatus : lookupStatus
      return { status, ok: status === 200, json: async () => body.fotos ? { checked: 2, saved: 1 } : { precisam_foto: ids.map(chat_id => ({ chat_id, phone: 'PRIVATE-phone' })) } }
    },
  })
  const start = bg.indexOf('async function sincronizarAvatars(')
  vm.runInContext(bg.slice(start, bg.indexOf('// ============================================================================', start)), ctx)
  return { ctx, posts, lookups, run: seller => ctx.sincronizarAvatars(seller || 'ANA', 7) }
}
test('avatar diagnostic classifies full results and bounded probes without publishing probe URLs', async () => {
  const h = harness(); await h.run(); const d = h.ctx._crmAvatarDiag
  assert.ok(d, 'ANA heartbeat diagnostic must be populated')
  assert.equal(d.asked, 5); assert.equal(d.full_url, 1); assert.equal(d.undefined, 1); assert.equal(d.null, 1)
  assert.equal(d.exceptions, 1); assert.equal(d.timeouts, 1); assert.equal(d.thumb_samples, 3)
  assert.equal(d.thumb_url, 2); assert.equal(d.thumb_errors, 1)
  assert.equal(d.pn_samples, 3); assert.equal(d.pn_url, 3)
  assert.equal(d.lookup_http, 200); assert.equal(d.upload_http, 200); assert.equal(d.checked, 2); assert.equal(d.saved, 1)
  assert.ok(d.finished_at); assert.equal(d.phase, 'done')
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE|https:|@c\.us|client|avatar_lookup_timeout/)
  assert.equal(h.posts[1].fotos.length, 2)
  assert.equal(h.posts[1].fotos[0].phone, 'PRIVATE-phone')
  assert.equal(h.posts[1].fotos[1].pic_url, null)
})
test('probe count is bounded at three and absent mapping never invents a phone', async () => {
  const h = harness({ ids: Array(15).fill('unknown') }); h.ctx.window.WPP.contact.getPnLidEntry = async () => undefined
  await h.run(); const d = h.ctx._crmAvatarDiag
  assert.equal(d.undefined, 15); assert.equal(d.thumb_samples, 3); assert.equal(d.pn_samples, 0)
  assert.equal(h.posts.length, 1); assert.equal(d.phase, 'no_photos')
  assert.equal(h.lookups.filter(([, full]) => full === false).length, 3)
})
test('diagnostic records HTTP failures and empty batches while leaving other sellers unchanged', async () => {
  const denied = harness({ lookupStatus: 401 }); await denied.run()
  assert.equal(denied.ctx._crmAvatarDiag.lookup_http, 401); assert.equal(denied.lookups.length, 0)
  const upload = harness({ ids: ['photo'], uploadStatus: 500 }); await upload.run()
  assert.equal(upload.ctx._crmAvatarDiag.upload_http, 500); assert.equal(upload.ctx._crmAvatarDiag.saved, 0)
  const empty = harness({ ids: [] }); await empty.run(); assert.equal(empty.ctx._crmAvatarDiag.phase, 'empty')
  const legacy = harness({ ids: ['unknown'] }); await legacy.run('DANIEL')
  assert.equal(legacy.ctx._crmAvatarDiag, null); assert.equal(legacy.posts[1].fotos[0].pic_checked, undefined)
})
test('safe diagnostic is included in existing ANA heartbeat overlays', () => {
  assert.ok((bg.match(/avatar: _crmAvatarDiag/g) || []).length >= 2)
  assert.ok(bg.includes("String(cfg.vendedor_nome).toUpperCase() === 'ANA' && _crmAvatarDiag"))
})
