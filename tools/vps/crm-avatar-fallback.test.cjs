const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR, 'background.js'), 'utf8')
function harness({ model, hydrate, ids = ['actual@lid'], pn } = {}) {
  const uploads = [], reads = [], queries = []
  const ctx = vm.createContext({ _crmAvatarDiag: null, Date, URL, AbortSignal, console: { info() {} },
    AVATAR_ENDPOINT: 'https://avatars.invalid', SHARED_SECRET: 'test-key',
    setTimeout: (fn, ms) => { if (ms === 150) fn(); else return setTimeout(fn, 5) }, clearTimeout,
    window: { WPP: { contact: { getProfilePictureUrl: async () => undefined, getPnLidEntry: async () => pn ? ({ phoneNumber: { _serialized: pn } }) : undefined },
      whatsapp: { WidFactory: { createWid: id => ({ _serialized: id }) }, ProfilePicThumbStore: {
        find: async wid => { reads.push(wid._serialized); return typeof model === 'function' ? model(wid._serialized) : model },
        findQuery: async wid => { queries.push(wid._serialized); return hydrate ? hydrate(wid._serialized) : undefined },
      } },
    } },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } },
    fetch: async (_url, init) => { const b = JSON.parse(init.body); if (b.fotos) uploads.push(b.fotos)
      return { status: 200, ok: true, json: async () => b.fotos ? { saved: b.fotos.length, checked: b.fotos.length } : { precisam_foto: ids.map(chat_id => ({ chat_id, phone: 'DO-NOT-INFER-THIS-PHONE' })) } }
    },
  })
  const start = bg.indexOf('async function sincronizarAvatars(')
  vm.runInContext(bg.slice(start, bg.indexOf('// ============================================================================', start)), ctx)
  return { ctx, uploads, reads, queries, run: () => ctx.sincronizarAvatars('ANA', 7) }
}
test('raw eurl and preview fields recover real cached URLs when derived getters are undefined', async () => {
  for (const field of ['eurl', 'previewEurl']) {
    const url = 'https://pps.whatsapp.net/PRIVATE-avatar'
    const h = harness({ model: { [field]: url } }); await h.run()
    assert.equal(h.uploads[0]?.[0].pic_url, url)
    assert.equal(h.queries.length, 0)
    assert.equal(h.ctx._crmAvatarDiag[field === 'eurl' ? 'raw_eurl' : 'raw_preview'], 1)
    assert.doesNotMatch(JSON.stringify(h.ctx._crmAvatarDiag), /PRIVATE|https:|actual@lid|DO-NOT/)
  }
})
test('hydration is feature checked and bounded to three calls in a 15-contact batch', async () => {
  const h = harness({ ids: Array.from({ length: 15 }, (_, i) => i + '@lid'), hydrate: async () => ({ imgFull: 'https://scontent.fbcdn.net/photo' }) })
  await h.run(); assert.equal(h.queries.length, 3); assert.equal(h.uploads[0]?.length, 3)
  assert.equal(h.ctx._crmAvatarDiag.hydrate_attempts, 3); assert.equal(h.ctx._crmAvatarDiag.hydrate_urls, 3)
})
test('hydration timeout and undefined results do not clear cached photos', async () => {
  const h = harness({ hydrate: async () => new Promise(() => {}) }); await h.run()
  assert.equal(h.uploads.length, 0); assert.equal(h.ctx._crmAvatarDiag.hydrate_timeouts, 1)
  const unresolved = harness(); await unresolved.run(); assert.equal(unresolved.uploads.length, 0)
})
test('CDN guard rejects lookalike hosts, insecure protocol and URL credentials', async () => {
  for (const eurl of ['http://pps.whatsapp.net/a', 'https://whatsapp.net.evil.invalid/a', 'https://evilwhatsapp.net/a', 'https://user:pass@pps.whatsapp.net/a', 'https://private.invalid/a']) {
    const h = harness({ model: { eurl } }); await h.run(); assert.equal(h.uploads.length, 0)
  }
})
test('PN fallback requires official mapping and never derives a Wid from backend phone', async () => {
  const pn = 'confirmed@c.us'
  const h = harness({ pn, model: id => id === pn ? { eurl: 'https://pps.whatsapp.net/pn' } : undefined })
  await h.run(); assert.equal(h.uploads[0]?.length, 1); assert.equal(h.ctx._crmAvatarDiag.pn_fallback_url, 1)
  assert.ok(h.reads.includes(pn)); assert.ok(!h.reads.some(id => id.includes('DO-NOT')))
  const absent = harness(); await absent.run(); assert.deepEqual([...new Set(absent.reads)], ['actual@lid'])
})
test('missing Store exports and failed lookup preserve the legacy undefined contract', async () => {
  const h = harness(); delete h.ctx.window.WPP.whatsapp; await h.run()
  assert.equal(h.uploads.length, 0); assert.equal(h.ctx._crmAvatarDiag.hydrate_attempts, 0)
})
test('empty string cannot clear a photo and getter errors can still use a real cached URL', async () => {
  const empty = harness(); empty.ctx.window.WPP.contact.getProfilePictureUrl = async () => ''
  await empty.run(); assert.equal(empty.uploads.length, 0)
  const failed = harness({ model: { eurl: 'https://pps.whatsapp.net/recovered' } })
  failed.ctx.window.WPP.contact.getProfilePictureUrl = async () => { throw new Error('PRIVATE') }
  await failed.run(); assert.equal(failed.uploads[0]?.[0].pic_url, 'https://pps.whatsapp.net/recovered')
  assert.equal(failed.ctx._crmAvatarDiag.exceptions, 1)
})
