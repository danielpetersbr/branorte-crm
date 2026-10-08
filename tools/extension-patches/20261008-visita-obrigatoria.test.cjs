const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const extensionDir = process.env.BRANORTE_EXTENSION_DIR || __dirname

function visitaFixture({ dados = { visitar: true }, getOk = true, atrasarGet = false } = {}) {
  const source = fs.readFileSync(extensionDir + '/wa-sidebar.js', 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('  async function setupVisitaCard(')
  const end = source.indexOf('\n\n  // ----- Perfil Branorte CRM', start)
  const nodes = new Map()
  for (const name of ['wrap','nome','cidade','estado','interesse','valor','visitar','visita-obrigatoria','save','status','del']) {
    nodes.set('bsb-cv-'+name, { style: {}, dataset: {}, value: '', checked: false, textContent: '', addEventListener(event, fn) { this[event] = fn } })
  }
  const bodies = []
  let liberarGet = null, liberarPost = null, atrasarPost = false, postOk = true
  const ctx = vm.createContext({
    document: { getElementById: id => nodes.get(id) },
    chatAtivo: { id: '5549999999999@c.us', labels: [] }, window: {},
    wireCidadeAutocomplete() {}, formatValorBR: () => '', parseValorBR: () => null, mostrarToast() {},
    DADOS_VISITA_ENDPOINT: 'https://fixture.invalid', SECRET: 'fixture',
    chrome: { storage: { local: { get: async () => ({ vendedor_nome: 'DANIEL' }) } } },
    fetch: async (_url, options) => {
      if (options.method === 'POST') {
        bodies.push(JSON.parse(options.body))
        return { json: () => atrasarPost ? new Promise(resolve => { liberarPost = () => resolve({ ok: postOk }) }) : Promise.resolve({ ok: postOk }) }
      }
      return { json: () => atrasarGet ? new Promise(resolve => { liberarGet = () => resolve({ ok: getOk, dados }) }) : Promise.resolve({ ok: getOk, dados }) }
    },
  })
  vm.runInContext(source.slice(start,end),ctx)
  return {
    nodes, bodies, setup: () => ctx.setupVisitaCard('5549999999999','Cliente'),
    toggle(name, checked) { const node = nodes.get('bsb-cv-'+name); node.checked = checked; node.change?.() },
    salvar: () => nodes.get('bsb-cv-save').click(),
    liberarGet: () => liberarGet(), liberarPost: () => liberarPost(),
    atrasarPost(value) { atrasarPost = value }, postOk(value) { postOk = value },
  }
}

test('cadastro novo salva pode visitar desmarcado e obrigatória falsa', async () => {
  const f = visitaFixture({ dados: null })
  await f.setup()
  await f.salvar()
  assert.equal(f.bodies[0].visitar, false)
  assert.equal(f.bodies[0].visita_obrigatoria, false)
})

test('obrigatória marca pode visitar; desmarcar pode visitar limpa obrigatória', async () => {
  const f = visitaFixture({ dados: { visitar: false, visita_obrigatoria: false } })
  await f.setup()
  f.toggle('visita-obrigatoria', true)
  assert.equal(f.nodes.get('bsb-cv-visitar').checked, true)
  await f.salvar()
  assert.equal(f.bodies[0].visitar, true)
  assert.equal(f.bodies[0].visita_obrigatoria, true)
  f.toggle('visitar', false)
  assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, false)
  await f.salvar()
  assert.equal(f.bodies[1].visitar, false)
  assert.equal(f.bodies[1].visita_obrigatoria, false)
})

test('desmarcar obrigatória mantém permissão de visita', async () => {
  const f = visitaFixture({ dados: { visitar: true, visita_obrigatoria: true } })
  await f.setup()
  assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, true)
  f.toggle('visita-obrigatoria', false)
  await f.salvar()
  assert.equal(f.bodies[0].visitar, true)
  assert.equal(f.bodies[0].visita_obrigatoria, false)
})

test('salvar outros campos preserva as duas marcações atuais do banco', async () => {
  for (const dados of [{ visitar: true, visita_obrigatoria: true }, { visitar: false }, { visitar: null }]) {
    const f = visitaFixture({ dados })
    await f.setup()
    assert.equal(f.nodes.get('bsb-cv-visitar').checked, dados.visitar !== false)
    assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, dados.visita_obrigatoria === true)
    f.nodes.get('bsb-cv-interesse').value = 'Outro interesse'
    await f.salvar()
    assert.equal(f.bodies[0].interesse, 'Outro interesse')
    assert.equal(Object.hasOwn(f.bodies[0], 'visitar'), false)
    assert.equal(Object.hasOwn(f.bodies[0], 'visita_obrigatoria'), false)
  }
})

test('GET tardio não desfaz marcação de obrigatória feita durante carregamento', async () => {
  const f = visitaFixture({ dados: { visitar: false, visita_obrigatoria: false }, atrasarGet: true })
  const carregando = f.setup()
  await new Promise(resolve => setImmediate(resolve))
  f.toggle('visita-obrigatoria', true)
  f.liberarGet()
  await carregando
  assert.equal(f.nodes.get('bsb-cv-visitar').checked, true)
  assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, true)
  await f.salvar()
  assert.equal(f.bodies[0].visitar, true)
  assert.equal(f.bodies[0].visita_obrigatoria, true)
})

test('GET tardio não restaura obrigatória após desmarcar pode visitar', async () => {
  const f = visitaFixture({ dados: { visitar: true, visita_obrigatoria: true }, atrasarGet: true })
  const carregando = f.setup()
  await new Promise(resolve => setImmediate(resolve))
  f.toggle('visitar', false)
  f.liberarGet()
  await carregando
  assert.equal(f.nodes.get('bsb-cv-visitar').checked, false)
  assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, false)
  await f.salvar()
  assert.equal(f.bodies[0].visitar, false)
  assert.equal(f.bodies[0].visita_obrigatoria, false)
})

test('GET sem confirmação não grava defaults sobre marcações existentes', async () => {
  const f = visitaFixture({ dados: null, getOk: false })
  await f.setup()
  await f.salvar()
  assert.equal(Object.hasOwn(f.bodies[0], 'visitar'), false)
  assert.equal(Object.hasOwn(f.bodies[0], 'visita_obrigatoria'), false)
  f.toggle('visita-obrigatoria', true)
  await f.salvar()
  assert.equal(f.bodies[1].visitar, true)
  assert.equal(f.bodies[1].visita_obrigatoria, true)
})

test('POST tardio conserva edição nova e o próximo salvar envia as duas marcações', async () => {
  const f = visitaFixture({ dados: { visitar: true, visita_obrigatoria: false } })
  await f.setup()
  f.toggle('visita-obrigatoria', true)
  f.atrasarPost(true)
  const salvando = f.salvar()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.bodies[0].visita_obrigatoria, true)
  f.toggle('visitar', false)
  f.atrasarPost(false)
  f.liberarPost()
  await salvando
  assert.equal(f.nodes.get('bsb-cv-visitar').checked, false)
  assert.equal(f.nodes.get('bsb-cv-visita-obrigatoria').checked, false)
  await f.salvar()
  assert.equal(f.bodies[1].visitar, false)
  assert.equal(f.bodies[1].visita_obrigatoria, false)
  await f.salvar()
  assert.equal(Object.hasOwn(f.bodies[2], 'visitar'), false)
  assert.equal(Object.hasOwn(f.bodies[2], 'visita_obrigatoria'), false)
})

test('falha no POST preserva obrigatória editada para nova gravação', async () => {
  const f = visitaFixture()
  await f.setup()
  f.toggle('visita-obrigatoria', true)
  f.postOk(false)
  await f.salvar()
  f.postOk(true)
  await f.salvar()
  assert.equal(f.bodies[1].visitar, true)
  assert.equal(f.bodies[1].visita_obrigatoria, true)
})

async function autosaveInteresse({ dados = { visitar: true, visita_obrigatoria: true }, getOk = true, httpOk = true, falharGet = false } = {}) {
  const source = fs.readFileSync(extensionDir + '/wa-sidebar.js', 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('  async function autoSalvarInteressePerfil(')
  const end = source.indexOf('\n\n  // ===== Modelos prontos:', start)
  const bodies = []
  const ctx = vm.createContext({
    chatAtivo: { id: '5549999999999@c.us', number: '5549999999999', labels: [] },
    nomeClienteDoChat: () => 'Cliente', mostrarToast() {},
    document: { getElementById: () => null }, SECRET: 'fixture',
    chrome: { storage: { local: { get: async () => ({ vendedor_nome: 'DANIEL' }) } } },
    fetch: async (_url, options) => {
      if (options.method === 'POST') {
        bodies.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ ok: true }) }
      }
      if (falharGet) throw new Error('rede indisponível')
      return { ok: httpOk, json: async () => ({ ok: getOk, dados }) }
    },
  })
  vm.runInContext(source.slice(start,end),ctx)
  await ctx.autoSalvarInteressePerfil({ perfilSugerido: { interesse: 'Moinho' } })
  return bodies
}

test('autosave de interesse não grava após falha de rede no GET', async () => {
  assert.deepEqual(await autosaveInteresse({ falharGet: true }), [])
})

test('autosave de interesse não grava após GET recusado ou sem confirmação', async () => {
  assert.deepEqual(await autosaveInteresse({ getOk: false }), [])
  assert.deepEqual(await autosaveInteresse({ httpOk: false }), [])
})

test('autosave de interesse preserva marcações de visita em cadastro existente', async () => {
  const bodies = await autosaveInteresse()
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].interesse, 'Moinho')
  assert.equal(Object.hasOwn(bodies[0], 'visitar'), false)
  assert.equal(Object.hasOwn(bodies[0], 'visita_obrigatoria'), false)
})

test('autosave de interesse só inicializa marcações falsas após confirmar cadastro novo', async () => {
  const bodies = await autosaveInteresse({ dados: null })
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].visitar, false)
  assert.equal(bodies[0].visita_obrigatoria, false)
})

test('salvar cadastro preserva mudança do mapa; editar a caixinha continua salvando', async () => {
  const source = fs.readFileSync(extensionDir + '/wa-sidebar.js', 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('  async function setupVisitaCard(')
  const end = source.indexOf('\n\n  // ----- Perfil Branorte CRM', start)
  for (const existente of [true, false]) {
    const nodes = new Map()
    for (const name of ['wrap','nome','cidade','estado','interesse','valor','visitar','save','status','del']) {
      nodes.set('bsb-cv-'+name, { style: {}, dataset: {}, value: '', checked: false, textContent: '', addEventListener(event, fn) { this[event] = fn } })
    }
    const bodies = []
    let liberarResposta = null
    let atrasarResposta = false
    const ctx = vm.createContext({
      document: { getElementById: id => nodes.get(id) },
      chatAtivo: { id: '5549999999999@c.us', labels: [] }, window: {},
      wireCidadeAutocomplete() {}, formatValorBR: () => '', parseValorBR: () => null, mostrarToast() {},
      DADOS_VISITA_ENDPOINT: 'https://fixture.invalid', SECRET: 'fixture',
      chrome: { storage: { local: { get: async () => ({ vendedor_nome: 'DANIEL' }) } } },
      fetch: async (_url, options) => {
        if (options.method === 'POST') {
          bodies.push(JSON.parse(options.body))
          return { json: () => atrasarResposta ? new Promise(resolve => { liberarResposta = () => resolve({ ok: true }) }) : Promise.resolve({ ok: true }) }
        }
        return { json: async () => ({ ok: true, dados: existente ? { visitar: true } : null }) }
      },
    })
    vm.runInContext(source.slice(start,end),ctx)
    await ctx.setupVisitaCard('5549999999999','Cliente')
    const checkbox = nodes.get('bsb-cv-visitar'), salvar = nodes.get('bsb-cv-save')
    await salvar.click()
    assert.equal(Object.hasOwn(bodies[0],'visitar'), !existente)
    if (!existente) assert.equal(bodies[0].visitar,false)
    await salvar.click()
    assert.equal(Object.hasOwn(bodies[1],'visitar'),false, 'segundo salvar não deve restaurar marcação antiga')
    checkbox.checked = true
    checkbox.change()
    await salvar.click()
    assert.equal(bodies[2].visitar,true, 'edição explícita deve ser enviada')
    checkbox.checked = false
    checkbox.change()
    atrasarResposta = true
    const salvando = salvar.click()
    await new Promise(resolve => setImmediate(resolve))
    checkbox.checked = true
    checkbox.change()
    atrasarResposta = false
    liberarResposta()
    await salvando
    await salvar.click()
    assert.equal(bodies[4].visitar,true, 'mudança durante gravação deve continuar pendente para salvar')
  }
})

test('ícone é instalado mesmo com o mapa antigo presente e não duplica no rail', () => {
  const source = fs.readFileSync(extensionDir + '/wa-sidebar.js', 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('  function injetarBotoesAcaoRail()')
  const end = source.indexOf('\n  // Botões de SISTEMAS no rail esquerdo', start)
  const nodes = new Map()
  const group = { children: [] }
  nodes.set('bsb-rail-grupo', group)
  nodes.set('bsb-rail-mapa-wrap', { parentElement: group })
  const sent = []
  const ctx = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: () => ({
      addEventListener(event, fn) { this[event] = fn }, setAttribute() {}, appendChild(btn) { this.btn = btn },
    }) },
    bsbPorNoGrupo: el => { nodes.set(el.id, el); el.parentElement = group; group.children.push(el) },
    chrome: { runtime: { sendMessage: message => sent.push(message) } },
  })
  vm.runInContext(source.slice(start, end), ctx)
  ctx.injetarBotoesAcaoRail()
  const wrap = nodes.get('bsb-rail-visitas-wrap')
  assert.ok(wrap, 'atalho deve existir no rail')
  wrap.btn.click({ preventDefault() {}, stopPropagation() {} })
  assert.equal(sent[0].action, 'open-visitas')
  ctx.injetarBotoesAcaoRail()
  assert.equal(group.children.filter(el => el.id === 'bsb-rail-visitas-wrap').length, 1)
})

test('atalho abre o mapa de visitas com filtro e identidade do vendedor', async () => {
  const source = fs.readFileSync(extensionDir + '/background.js', 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('async function handleSidebarAction(action)')
  const end = source.indexOf('\n  return { ok: true }\n}', start) + '\n  return { ok: true }\n}'.length
  for (const vendedor of ['DANIEL', 'Ana & João', '']) {
    const tabs = []
    const ctx = vm.createContext({ URLSearchParams, chrome: {
      storage: { local: { get: async () => ({ vendedor_nome: vendedor }) } },
      tabs: { create: async args => { tabs.push(args) } },
    } })
    vm.runInContext(source.slice(start, end), ctx)
    await ctx.handleSidebarAction('open-visitas')
    assert.equal(tabs.length, 1)
    const url = new URL(tabs[0].url)
    assert.equal(url.origin, 'https://branorte-crm.vercel.app')
    assert.equal(url.pathname, '/mapa-visitas')
    assert.equal(url.searchParams.get('origem'), 'whatsapp')
    assert.equal(url.searchParams.get('vendedor') || '', vendedor)
  }
})
