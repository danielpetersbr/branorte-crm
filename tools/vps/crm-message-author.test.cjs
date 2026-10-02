const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR || __dirname, 'background.js'), 'utf8')

function queue({ first = { ok: true }, fallback = { ok: true }, media = null } = {}) {
  const patches = [], calls = []
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, Date, Blob,
    FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,AQID'; this.onload() } },
    HUB_ENDPOINT: 'https://hub.invalid', SHARED_SECRET: 'test-only', _filaQuente: 0,
    chrome: { storage: { local: { get: async key => typeof key === 'string' ? {} : { vendedor_nome: 'ANA' } } }, notifications: { create() {} } },
    podeAutomatizar: () => true, escolherAbaWaTab: async () => ({ tabId: 7 }), cadenciaAnaPara: () => false,
    enviarTexto: async () => { calls.push('text'); return first },
    enviarTextoParaNumero: async () => { calls.push('fallback'); return fallback },
    crmDownloadMedia: async () => new Blob(['photo'], { type: 'image/jpeg' }),
    crmEnviarMidia: async () => { calls.push('media'); return media },
    fetch: async (_url, init) => {
      if (init?.method === 'PATCH') { patches.push(JSON.parse(init.body)); return { ok: true } }
      return { ok: true, json: async () => ({ items: [{
        id: 'scheduled-test', crm_request_id: 'crm-test', scheduled_at: '2020-01-01',
        chat_id: '123@lid', contato_numero: '5511999991111', body: 'synthetic', urgente: true,
        media_url: media ? 'https://storage.invalid/photo' : null, media_type: media ? 'image' : null,
      }] }) }
    },
  })
  const start = bg.indexOf('async function _processarAgendamentosCorpo()')
  const end = bg.indexOf('async function processarLembretes()', start)
  assert.ok(start >= 0 && end > start)
  vm.runInContext(bg.slice(start, end), context)
  return { calls, patches, run: () => context._processarAgendamentosCorpo() }
}

test('CRM text retains the exact WPP ID returned by the normal transport', async () => {
  const id = 'true_123@lid_TESTHASH'
  const h = queue({ first: { ok: true, id } }); await h.run()
  assert.deepEqual(h.calls, ['text'])
  assert.equal(h.patches.at(-1).status, 'sent'); assert.equal(h.patches.at(-1).wa_msg_id, id)
})

test('CRM text retains only the successful LID fallback WPP ID', async () => {
  const id = 'true_123@lid_FALLBACKHASH'
  const h = queue({ first: { ok: false, erro: 'No LID for user' }, fallback: { ok: true, id } }); await h.run()
  assert.deepEqual(h.calls, ['text', 'fallback'])
  assert.equal(h.patches.at(-1).status, 'sent'); assert.equal(h.patches.at(-1).wa_msg_id, id)
})

test('CRM does not invent an ID when text confirmation has no nonempty string', async () => {
  for (const id of [undefined, null, '', '  ', 123, {}]) {
    const h = queue({ first: { ok: true, id } }); await h.run()
    assert.equal(h.patches.at(-1).wa_msg_id, null)
  }
  const failed = queue({ first: { ok: false, id: 'UNCONFIRMED', erro: 'failed' } }); await failed.run()
  assert.equal(failed.patches.at(-1).status, 'failed'); assert.equal(failed.patches.at(-1).wa_msg_id, undefined)
})

test('CRM media keeps its existing wa_msg_id and text IDs are trimmed safely', async () => {
  const h = queue({ media: { ok: true, wa_msg_id: 'true_123@lid_MEDIAHASH', id: 'OTHER' } }); await h.run()
  assert.deepEqual(h.calls, ['media']); assert.equal(h.patches.at(-1).wa_msg_id, 'true_123@lid_MEDIAHASH')
  const text = queue({ first: { ok: true, id: '  TEXTHASH  ' } }); await text.run()
  assert.equal(text.patches.at(-1).wa_msg_id, 'TEXTHASH')
})
