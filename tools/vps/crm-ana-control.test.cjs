const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR, 'background.js'), 'utf8')
const marker = '// >>> CRM ANA CONTROL 35'
const end = '// <<< CRM ANA CONTROL 35'
const helper = bg.includes(marker) ? bg.slice(bg.indexOf(marker), bg.indexOf(end)) : ''
const msg = (body, id, extra = {}) => ({ body, id, type: 'chat', fromMe: false, ...extra })
function context(options = {}) {
  const calls = [], applies = [], labels = [{ id: '22', name: 'RESOLVIDOS' }, { id: '4', name: 'PROSPECÇÃO' }, { id: '24', name: 'DANIEL' }, { id: '13', name: 'OUTROS ASSUNTOS' }]
  const ctx = vm.createContext({ URL, Set, Map, Date, JSON, AbortController, setTimeout, clearTimeout,
    HUB_ENDPOINT: 'https://synthetic.invalid/hub', SHARED_SECRET: 'synthetic-only', IA_FUNIL_ETAPAS: ['PROSPECCAO', 'NOVO LEAD'],
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); if (options.throws) throw new TypeError('network'); return { ok: options.httpOk !== false, json: async () => options.response || { allowed: true, reason: 'available', label_id: '22', label_name: 'RESOLVIDOS' } } },
    listarLabelsWa: async () => options.labels || labels,
    aplicarLabelEmChat: async (...args) => { applies.push(args); return options.applyResult || { ok: true } },
  })
  vm.runInContext(helper, ctx)
  return { ctx, calls, applies, labels }
}
test('a single greeting and two repeated greetings are never suppressed', () => {
  const h = context(); assert.equal(typeof h.ctx.crmAnaRepeatedNoncommercial, 'function')
  assert.equal(h.ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a')]), false)
  assert.equal(h.ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'b')]), false)
})
test('three distinct proven bare greetings may be ignored without an AI classification', () => {
  assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia!', 'b'), msg('Bom dia', 'c')]), true)
})
test('duplicate history entries do not prove repeated spam', () => {
  assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'a'), msg('bom dia', 'a')]), false)
})
test('commercial, question, number, human, order and advertisement proof always preserve a customer', () => {
  for (const body of ['bom dia, quanto custa?', 'quero ração', 'pedido', 'nota fiscal', 'R$ 200', 'oi 2', 'vendedor', 'preciso conversar', 'sim', 'https://catalogo.example']) {
    const h = context(); assert.equal(h.ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'b'), msg(body, 'c')]), false, body)
  }
  assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'b'), msg('bom dia', 'c', { ctwa: { sourceId: 'synthetic-ad' } })]), false)
})
test('unknown audio/photo/document/sticker/ciphertext/location are never guessed noncommercial', () => {
  for (const type of ['audio', 'ptt', 'image', 'document', 'video', 'sticker', 'ciphertext', 'location']) {
    assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'b'), msg('bom dia', 'c'), msg('', 'd', { type })]), false, type)
  }
})
test('unknown direction or type cannot prove repeated noncommercial messages', () => {
  for (const extra of [{ fromMe: null }, { fromMe: undefined }, { type: undefined }])
    assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg('bom dia', 'a'), msg('bom dia', 'b'), msg('bom dia', 'c', extra)]), false)
})
test('earlier commercial context and unknown text prevent suppression', () => {
  for (const body of ['misturador', 'vamos falar amanhã', 'trabalho com moagem', 'fazenda', 'bom dia amigo'])
    assert.equal(context().ctx.crmAnaRepeatedNoncommercial([msg(body, 'z'), msg('bom dia', 'a'), msg('bom dia', 'b'), msg('bom dia', 'c')]), false)
})
test('ANA automation gate sends no client text and obeys an explicit denial', async () => {
  const h = context({ response: { allowed: false, reason: 'human_hold' } })
  const r = await h.ctx.crmAnaAutomationGate('ANA', 'synthetic@lid')
  assert.equal(r.allowed, false); assert.equal(r.reason, 'human_hold')
  assert.deepEqual(h.calls, [{ vendedor_nome: 'ANA', chat_id: 'synthetic@lid' }])
})
test('other sellers bypass ANA gate and retain the legacy transport', async () => {
  const h = context({ throws: true }); assert.equal((await h.ctx.crmAnaAutomationGate('DANIEL', 'synthetic@lid')).allowed, true); assert.equal(h.calls.length, 0)
})
test('network, non200 and malformed gate answers fail closed without caching an allow', async () => {
  for (const options of [{ throws: true }, { httpOk: false }, { response: {} }, { response: { allowed: 'true' } }]) {
    const h = context(options); const r = await h.ctx.crmAnaAutomationGate('ANA', 'synthetic@lid')
    assert.equal(r.allowed, false); assert.equal(r.retry, true)
  }
})
test('gate outages have a bounded five-second retry without a permanent seen marker or cached allow', async () => {
  const h = context({ throws: true }); let now = 0
  h.ctx.Date = class extends Date { static now() { return now } }
  assert.equal((await h.ctx.crmAnaAutomationGate('ANA', '123@lid')).retry, true)
  now = 1000; assert.equal((await h.ctx.crmAnaAutomationGate('ANA', '123@lid')).allowed, false); assert.equal(h.calls.length, 1)
  now = 5001; await h.ctx.crmAnaAutomationGate('ANA', '123@lid'); assert.equal(h.calls.length, 2)
})
test('gate fetch aborts and fails closed at its bounded timeout', async () => {
  const h = context(); h.ctx.setTimeout = fn => setTimeout(fn, 1)
  h.ctx.fetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const r = await h.ctx.crmAnaAutomationGate('ANA', '123@lid'); assert.equal(r.allowed, false); assert.equal(r.retry, true)
})
const action = () => ({ chat_id: 'synthetic@lid', payload: { etiqueta: 'RESOLVIDOS', origem: 'crm_chat_resolve', crm_close: { conversation_id: 'synthetic-conversation', marker: '2026-10-02T12:00:00Z', label_id: '22' } } })
const parsed = ts.createSourceFile('private.js', bg, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
function actualFunction(name) {
  const node = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(node, name); return bg.slice(node.getStart(parsed), node.end)
}
function runtime(options = {}) {
  const h = context(options), reads = [], warnings = [], writes = []
  const state = { vendedor_nome: options.seller || 'ANA', enabled: true, ia_atendente_state: {}, lead_porta_vistos: {}, lead_porta_falhas: {} }
  Object.assign(h.ctx, {
    console: { log() {}, warn: (...a) => warnings.push(a), info() {} },
    podeAutomatizar: () => true, _iaAtdRodando: false, _iaAtdDesde: 0, _iaRodarDeNovo: false,
    _iaTsVisto: {}, _iaTsVistoEm: {}, _iaEspera: {}, _iaPronta: {}, _autoEnvioIds: new Set(), _autoEnvio: {},
    usaRespostaRapida: () => false, ligacaoPerdidaAnaPara: () => false, anuncioOrigemAnaPara: () => false,
    ultimaSemAvisoAnaPara: () => false, naoAbriuIaAnaPara: () => false, cadenciaAnaPara: () => false, portaFalaNovaAnaPara: () => false,
    _podaTsVisto() {}, getWaTabUtilizavel: async () => null, IA_ATD_MAX_POR_CICLO: 2, _portaAvisoUlt: null,
    _iaListaCache: { resp: { chats: [] } },
    listarChatsIa: async () => ({ ok: true, chats: [{ chat_id: '123@lid' }] }),
    buscarMensagens: async (...args) => { reads.push(args); return { ok: true, mensagens: options.messages || [] } },
    chrome: { storage: { local: { get: async () => state, set: async data => { writes.push(data); Object.assign(state, data) } } } },
  })
  vm.runInContext(actualFunction('cicloIaAtendente') + '\n' + actualFunction('verificarPortaLead'), h.ctx)
  return { ...h, state, reads, writes, warnings }
}
function flow(options = {}) {
  const h = runtime(options), acknowledgements = [], legacy = []
  const a = action(); delete a.payload.origem; a.id = 42 // exact minimum SQL-produced shape, without relying on an audit origin
  const gateFetch = h.ctx.fetch
  Object.assign(h.ctx, {
    _fluxoAcoesRodando: false, FLUXO_ENGINE_ENDPOINT: 'https://synthetic.invalid/flow',
    novoLeadVenceFilaPara: () => false,
    concluirAcaoFluxo: async (...args) => acknowledgements.push(args),
    aplicarEtiquetaIa: async (...args) => { legacy.push(args); return { ok: true } },
    fetch: async (url, init) => url === 'https://synthetic.invalid/flow' ? { json: async () => ({ ok: true, acoes: [a] }) } : gateFetch(url, init),
  })
  vm.runInContext(actualFunction('cicloFluxoAcoes'), h.ctx)
  return { ...h, acknowledgements, legacy }
}
test('CRM closure applies the exact existing server-confirmed label and preserves manual/vendor/neutral labels', async () => {
  const h = context(); const r = await h.ctx.crmApplyCloseLabel(action())
  assert.equal(r.ok, true); assert.equal(h.applies.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.applies[0])), ['synthetic@lid', '22', false, ['4']])
  assert.equal(h.calls[0].close.label_id, '22')
})
test('stale closure generation is ignored rather than applied or retried as a label', async () => {
  const h = context({ response: { allowed: false, reason: 'stale_crm_close' } }); const r = await h.ctx.crmApplyCloseLabel(action())
  assert.equal(r.ignored, true); assert.equal(h.applies.length, 0)
})
test('a catalog gap or rejected marker is an explicit error rather than a successful ignored label', async () => {
  for (const reason of ['closure_label_unavailable', 'invalid_marker']) {
    const h = context({ response: { allowed: false, reason } }); const r = await h.ctx.crmApplyCloseLabel(action())
    assert.equal(r.ok, false); assert.equal(r.ignored, undefined); assert.equal(h.applies.length, 0)
    assert.match(r.erro, reason === 'closure_label_unavailable' ? /wpp_crm_close_label_unavailable/ : /crm_close_rejected/)
  }
})
test('a missing or renamed label never creates a replacement or applies a guessed label', async () => {
  for (const labels of [[], [{ id: '22', name: 'OUTROS ASSUNTOS' }], [{ id: '99', name: 'RESOLVIDOS' }]]) {
    const h = context({ labels }); const r = await h.ctx.crmApplyCloseLabel(action()); assert.equal(r.ok, false); assert.equal(h.applies.length, 0)
  }
})
test('server mismatches and unverifiable closure checks never apply', async () => {
  for (const options of [{ throws: true }, { response: { allowed: true, label_id: '99', label_name: 'RESOLVIDOS' } }, { response: { allowed: true, label_id: '22', label_name: 'OUTROS ASSUNTOS' } }]) {
    const h = context(options); const r = await h.ctx.crmApplyCloseLabel(action()); assert.equal(r.ok, false); assert.equal(h.applies.length, 0)
  }
})
test('real WPP errors propagate without claiming label application success', async () => {
  const h = context({ applyResult: { ok: false, erro: 'wpp_not_ready' } }); const r = await h.ctx.crmApplyCloseLabel(action()); assert.equal(r.ok, false); assert.equal(r.erro, 'wpp_not_ready')
})
test('actual IA cycle denies before reading, transcribing, vision or generating and releases its flight guard', async () => {
  for (const options of [{ response: { allowed: false, reason: 'human_hold' } }, { throws: true }]) {
    const h = runtime(options); await h.ctx.cicloIaAtendente()
    assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 0); assert.equal(h.warnings.length, 0); assert.equal(h.ctx._iaAtdRodando, false)
    assert.equal(h.state.ia_atendente_state['123@lid'], undefined)
  }
})
test('actual IA cycle ignores proven repeated greetings before expensive work without inventing a permanent block', async () => {
  const h = runtime({ messages: [msg('bom dia', 'a'), msg('bom dia', 'b'), msg('bom dia', 'c')] })
  await h.ctx.cicloIaAtendente(); assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 1); assert.equal(h.warnings.length, 0)
  assert.equal(h.writes.length, 0); assert.equal(h.state.ia_atendente_state['123@lid'], undefined)
})
test('actual port denial or network failure neither activates nor burns the per-chat seen marker', async () => {
  for (const options of [{ response: { allowed: false, reason: 'paused' } }, { throws: true }]) {
    const h = runtime(options)
    await h.ctx.verificarPortaLead({ chats_etiquetas: [{ chat_id: '123@lid', last_message_at: new Date().toISOString() }] })
    assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 0); assert.equal(h.state.lead_porta_vistos['123@lid'], undefined); assert.equal(h.warnings.length, 0)
  }
})
test('other seller actual IA cycle retains message reads without calling ANA gates', async () => {
  const h = runtime({ seller: 'DANIEL' }); await h.ctx.cicloIaAtendente(); assert.equal(h.calls.length, 0); assert.equal(h.reads.length, 1); assert.equal(h.warnings.length, 0)
})
test('actual queue takes the exact SQL crm_close payload through the validated branch without origin dependency', async () => {
  const h = flow(); await h.ctx.cicloFluxoAcoes()
  assert.equal(h.legacy.length, 0); assert.equal(h.applies.length, 1); assert.equal(h.calls.length, 1); assert.equal(h.acknowledgements[0][1], true); assert.equal(h.warnings.length, 0)
})
test('actual queue cannot apply stale closures and does not acknowledge network failures as execution', async () => {
  for (const options of [{ response: { allowed: false, reason: 'stale_crm_close' } }, { throws: true }]) {
    const h = flow(options); await h.ctx.cicloFluxoAcoes(); assert.equal(h.applies.length, 0); assert.equal(h.legacy.length, 0); assert.equal(h.acknowledgements[0][1], false)
    assert.match(h.acknowledgements[0][2], options.throws ? /wpp_crm_gate_unavailable/ : /superada: crm_close_stale/); assert.equal(h.warnings.length, 0)
  }
})
test('other seller actual queue remains on the existing label path', async () => {
  const h = flow({ seller: 'DANIEL' }); await h.ctx.cicloFluxoAcoes(); assert.equal(h.legacy.length, 1); assert.equal(h.calls.length, 0); assert.equal(h.warnings.length, 0)
})
test('actual port and IA loop place the backend gates ahead of activation and paid media work', () => {
  const port = bg.slice(bg.indexOf('async function verificarPortaLead('), bg.indexOf('// >>>', bg.indexOf('async function verificarPortaLead(') + 100))
  assert.ok(port.indexOf('crmAnaAutomationGate') >= 0 && port.indexOf('crmAnaAutomationGate') < port.indexOf('await buscarMensagens'))
  const loop = bg.slice(bg.indexOf('async function cicloIaAtendente()'), bg.indexOf('async function enviarPassoMidia('))
  assert.ok(loop.indexOf('crmAnaAutomationGate') >= 0 && loop.indexOf('crmAnaAutomationGate') < loop.indexOf('await buscarMensagens'))
  assert.ok(loop.indexOf('crmAnaRepeatedNoncommercial(msgs)') >= 0 && loop.indexOf('crmAnaRepeatedNoncommercial(msgs)') < loop.indexOf('await transcreverAudioIa'))
  const flowStart = bg.indexOf('async function cicloFluxoAcoes()')
  const flow = bg.slice(flowStart, bg.indexOf('// >>> ARQUIVAR ANA', flowStart))
  assert.match(flow, /crmApplyCloseLabel\(a\)/)
  assert.match(flow, /const _crmClose = .*a\.payload\.crm_close/)
})
