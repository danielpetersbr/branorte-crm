import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as transfer from './projeto-3d-orcamento'
import * as integration from './projeto-3d-orcamento-integracao'
import { acharMotorCompativel, valorPorVoltagem } from './motor-do-preco'
import { nomeComercialMoegaDescarga } from './projeto-3d-catalogo-match'

const editorOrigin = 'https://branorte-configurador-3d.vercel.app'
const payload = transfer.parseProjeto3DOrcamentoPayload({ version: 1, exportId: 'export_1234567890', projectId: 'project-b', projectName: 'Layout B', clientName: 'Cliente enviado', items: [
  { sourceId: 'a', floorId: 'floor-2', floorName: 'Mezanino', kind: 'equipment', catalogId: 'cad-unknown', sequence: 1, name: 'Balança Eletrônica - Trifásico', quantity: 1, specifications: ['Medida literal'] },
  { sourceId: 'b', floorId: 'floor-1', floorName: 'Térreo', kind: 'manual', catalogId: null, sequence: 2, name: 'Motor 3 CV 2 polos', quantity: 4, specifications: ['Motor avulso listado'] },
  { sourceId: 'c', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment', catalogId: 'cad-unknown', sequence: 3, name: 'Balança Eletrônica - Trifásico', quantity: 2, specifications: [] },
] })

function source(path: string) {
  const file = new URL(path, import.meta.url)
  return ts.createSourceFile(path, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function find(ast: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let match: ts.Node | undefined
  function walk(node: ts.Node) { if (!match && predicate(node)) match = node; if (!match) ts.forEachChild(node, walk) }
  walk(ast)
  assert.ok(match, 'nó de produção esperado deve existir')
  return match
}
function fn(ast: ts.SourceFile, name: string) { return find(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast).replace(/^export\s+/, '') }
function variable(ast: ts.SourceFile, name: string) { return find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration }
function effect(ast: ts.SourceFile, marker: string) {
  const call = find(ast, node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes(marker)) as ts.CallExpression
  return call.arguments[0].getText(ast)
}
function run(code: string, values: Record<string, unknown>) {
  const context = vm.createContext({ nomeComercialMoegaDescarga, ...values })
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context
}
const page = source('../pages/OrcamentoMontar.tsx')
const modal = source('../components/FinalizarMontarModal.tsx')
const hook = source('../hooks/useOrcamentoBuilder.ts')

test('nova transferência hidrata acessórios descritivos, mas reload prioriza o bloco editado no rascunho', () => {
  const withAccessories = { ...payload, accessories: [{ sourceId: 'mouth-1', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment' as const, catalogId: 'mouth-cad', sequence: 1, name: 'Boca de entrada', quantity: 2, specifications: ['160 × 600 × 600 × 30°'] }] }
  const callback = effect(page, 'materializeProjeto3DOrcamento(transfer3D)')
  function hydrate(recovered: unknown) {
    let accessoryState: unknown = null
    let restored: unknown = null
    let accessoryWrites = 0
    const context = run(`var hydrate = ${callback}`, {
      ...transfer, import3dToken: withAccessories.exportId, editingId: null, loadingItems: false, loadingMotores: false, loadingPrecos: false, items: [], motores: [], precos: [], importedTokenRef: { current: null }, transfer3D: withAccessories,
      autoVincularProjeto3D: (rows: unknown[]) => rows,
      window: { localStorage: {} }, readProjeto3DDraft: () => recovered,
      setCarrinho() {}, setClienteDados() {}, setInitialModal() {}, setAcessorios(value: unknown) { accessoryState = value; accessoryWrites++ },
      aplicarRascunho(value: unknown) { restored = value }, isApplyingUndoRef: { current: false }, setHistoryStack() {}, draft: { dismissRecovered() {} }, setHydrated3DToken() {}, setImport3DError() {},
    })
    context.hydrate()
    return { accessoryState, restored, accessoryWrites }
  }
  const created = hydrate(null)
  assert.deepEqual(created.accessoryState, transfer.materializeProjeto3DAcessorios(withAccessories))
  const edited = { carrinho: transfer.materializeProjeto3DOrcamento(withAccessories), acessorios: { pct: 9, items: ['Descrição conferida'], valorFixo: 900 }, clienteDados: { nome: 'Cliente editado' } }
  const recovered = hydrate(edited)
  assert.equal((recovered.restored as typeof edited).acessorios, edited.acessorios)
  assert.equal((recovered.restored as typeof edited).clienteDados, edited.clienteDados)
  assert.equal((recovered.restored as typeof edited).carrinho, edited.carrinho)
  assert.equal(recovered.accessoryWrites, 0, 'a transferência original não sobrescreve edição de acessórios recuperada')
})

test('reabrir bloco descritivo zero de origem 3D mantém zero sem clamp de 1% nem default de 5%', () => {
  const cfg = transfer.materializeProjeto3DAcessorios({ ...payload, accessories: [{ sourceId: 'mouth-1', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment', catalogId: 'mouth-cad', sequence: 1, name: 'Boca de entrada', quantity: 2, specifications: [] }] })!
  Object.assign(cfg, { pct: 0, valorFixo: 0 }) // orçamento legado, anterior ao padrão de 15%
  let accessories: any = null
  const context = run(fn(page, 'carregarDoModelo'), { carrinho: [], items: [], precos: [], motores: [], montarMapaFotosTransportador: () => new Map(), console: { log() {} }, setCarrinho() {}, setAcessorios(value: unknown) { accessories = value }, setVoltagem() {}, stripSufixoVoltagem: (name: string) => name })
  context.carregarDoModelo({ itens: [{ __full: true, uid: 'one', nome: 'Moinho', qtd: 1, valor: 100_000, specs: [] }], motores: [], acessorios: { items: cfg.items, valor: 0, origem_projeto3d: cfg.origem_projeto3d }, voltagem: 'trifasico' })
  assert.equal(accessories.pct, 0)
  assert.equal(accessories.valorFixo, 0)
  assert.deepEqual(accessories.origem_projeto3d, cfg.origem_projeto3d)
  const memo = variable(page, 'valorAcessorios').initializer as ts.CallExpression
  const calculated = run(`var result = (${memo.arguments[0].getText(page)})()`, { acessorios: accessories, carrinho: [{ uid: 'one', valor: 100_000, qtd: 1 }] }).result
  assert.equal(calculated, 0)
})

test('snapshot e payload persistido retêm origem e descrições de acessórios sem cobrança', () => {
  const cfg = transfer.materializeProjeto3DAcessorios({ ...payload, accessories: [{ sourceId: 'mouth-1', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment', catalogId: 'mouth-cad', sequence: 1, name: 'Boca de descarga', quantity: 3, specifications: ['Ø160 mm'] }] })!
  const component = find(page, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'FinalizarMontarModal') as ts.JsxSelfClosingElement
  const attr = component.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(page) === 'snapshot') as ts.JsxAttribute
  const expression = (attr.initializer as ts.JsxExpression).expression!
  const object = (ts.isAsExpression(expression) ? expression.expression : expression) as ts.ObjectLiteralExpression
  const property = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(page) === 'acessorios') as ts.PropertyAssignment
  const snapshotAccessories = run(`var result = ${property.initializer.getText(page)}`, { acessoriosFinal: cfg, valorAcessoriosFinal: 0 }).result
  const savedProperty = find(modal, node => ts.isPropertyAssignment(node) && node.name.getText(modal) === 'acessorios' && node.initializer.getText(modal).includes('snapshot.acessorios') && node.initializer.getText(modal).includes('valor: snapshot.acessorios.valor')) as ts.PropertyAssignment
  const saved = run(`var result = ${savedProperty.initializer.getText(modal)}`, { snapshot: { acessorios: snapshotAccessories } }).result
  assert.equal(saved.valor, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.items)), cfg.items)
  assert.deepEqual(saved.origem_projeto3d, cfg.origem_projeto3d)
  const draft = { version: 1, saved_at: new Date().toISOString(), data: { projeto3DExportId: payload.exportId, carrinho: [], acessorios: cfg } }
  const recovered = integration.readProjeto3DDraft(payload.exportId, { getItem: () => JSON.stringify(draft) })
  assert.deepEqual(recovered?.acessorios, cfg)
})

test('FINAME conserva acessórios 3D somente no banco, mantendo preview null e totais intactos', () => {
  const cfg = transfer.materializeProjeto3DAcessorios({ ...payload, accessories: [{ sourceId: 'mouth-1', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment', catalogId: 'mouth-cad', sequence: 1, name: 'Boca de entrada', quantity: 2, specifications: ['160 × 600 × 600 × 30°'] }] })!
  const component = find(page, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'FinalizarMontarModal') as ts.JsxSelfClosingElement
  const attr = component.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(page) === 'snapshot') as ts.JsxAttribute
  const expression = (attr.initializer as ts.JsxExpression).expression!
  const object = (ts.isAsExpression(expression) ? expression.expression : expression) as ts.ObjectLiteralExpression
  const auxiliary = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(page) === 'acessoriosProjeto3D') as ts.PropertyAssignment | undefined
  assert.ok(auxiliary, 'snapshot precisa conservar a origem bruta mesmo quando FINAME oculta o bloco')
  const raw = run(`var result = ${auxiliary.initializer.getText(page)}`, { acessorios: cfg }).result
  const savedProperty = find(modal, node => ts.isPropertyAssignment(node) && node.name.getText(modal) === 'acessorios' && node.initializer.getText(modal).includes('snapshot.acessorios') && node.initializer.getText(modal).includes('valor: snapshot.acessorios.valor')) as ts.PropertyAssignment
  const snapshot = { acessorios: null, acessoriosProjeto3D: raw, totalEquip: 90_000, totalMotores: 5_000, totalGeral: 95_000 }
  const saved = run(`var result = ${savedProperty.initializer.getText(modal)}`, { snapshot }).result
  assert.equal(saved.valor, 0, 'valor FINAME já está nos equipamentos e não pode ser cobrado novamente')
  assert.deepEqual(JSON.parse(JSON.stringify(saved.items)), cfg.items)
  assert.deepEqual(saved.origem_projeto3d, cfg.origem_projeto3d)
  const previewProperty = find(modal, node => ts.isPropertyAssignment(node) && node.name.getText(modal) === 'acessorios' && node.initializer.getText(modal).includes('pct: snapshot.acessorios.pct')) as ts.PropertyAssignment
  assert.equal(run(`var result = ${previewProperty.initializer.getText(modal)}`, { snapshot }).result, null)
  assert.deepEqual([snapshot.totalEquip, snapshot.totalMotores, snapshot.totalGeral], [90_000, 5_000, 95_000])
})

test('remover uma descrição duplicada no modal preserva a outra peça acessória', () => {
  let selected = ['Boca de descarga · Qtde: 1', 'Boca de descarga · Qtde: 1', 'Cano · Qtde: 2']
  const context = run(fn(page, 'removerSel'), { setSelecionados(callback: (rows: string[]) => string[]) { selected = callback(selected) } })
  context.removerSel(0)
  assert.deepEqual(selected, ['Boca de descarga · Qtde: 1', 'Cano · Qtde: 2'])
})

test('cálculo do vínculo usa preço oficial por voltagem e mesmo motor do catálogo', () => {
  const catalogItem = { id: 21, categoria: 'MOINHO', nome_curto: 'Moinho oficial', specs: ['Acionamento: 3 CV'], motor_padrao_cv: 3, motor_padrao_polos: 4, motor_padrao_qtd: 1, valor: 10, usa_inversor: false, preco_branorte_id: 55, funcao_opcoes: [], motores_extras: [] }
  const official = { id: 55, valor_equipamento: 2000, valor_com_motor_trif: 2600, valor_com_motor_mono: 3100 }
  const context = run(`${fn(page, 'motorJaInclusoNoItem')}\n${fn(page, 'criarItemCatalogo')}`, { gerarUid: () => 'new', voltagem: 'trifasico', precos: [official], motores: [{ cv: 3, polos: 4, valor: 600 }], acharMotorCompativel: (motors: any[]) => motors[0], valorPorVoltagem })
  const calculated = context.criarItemCatalogo(catalogItem)
  assert.equal(calculated.valor, 2600)
  assert.equal(calculated.preco_branorte_id, 55)
  assert.equal(calculated.motor_valor_unit, 0, 'motor do preço oficial já está incluso')
  const [original] = transfer.materializeProjeto3DOrcamento(payload)
  const resolved = integration.resolverVinculoProjeto3D(original, calculated, { motorIncluso: true })
  assert.equal(resolved.nome, payload.items[0].name)
  assert.equal(resolved.uid, original.uid)
  assert.equal(resolved.qtd, original.qtd)
  assert.equal(resolved.valor, 2600)
})

test('nova moega adicionada manualmente mantém cadastro, preço, foto e motor com o título comercial de descarga', () => {
  const catalogItem = {
    id: 750, categoria: 'MOEGA', nome_curto: 'CAIXA ENTRADA MOEGA COM HELICODE', nome_completo: 'CAIXA ENTRADA MOEGA COM HELICODE',
    ativo: true, is_oficial: true, specs: ['Comprimento: 3,0 metros.', 'Largura 1,0 m', 'Acionamento 2,0 CV por motorredutor (incluso)'],
    motor_padrao_cv: 2, motor_padrao_polos: 4, motor_padrao_qtd: 1, valor: 31234, foto_url: '/moega-grade.png',
    usa_inversor: false, preco_branorte_id: null, funcao_opcoes: [], motores_extras: [],
  }
  const before = JSON.stringify(catalogItem)
  const context = run(`${fn(page, 'motorJaInclusoNoItem')}\n${fn(page, 'criarItemCatalogo')}`, { gerarUid: () => 'new', voltagem: 'trifasico', precos: [], motores: [{ cv: 2, polos: 4, valor: 600 }], acharMotorCompativel: (motors: any[]) => motors[0], valorPorVoltagem })
  const created = context.criarItemCatalogo(catalogItem)
  assert.equal(created.nome, 'MOEGA DE DESCARGA 3 X 1 M')
  assert.equal(created.nome_custom, null)
  assert.equal(created.catalogo_id, catalogItem.id)
  assert.equal(created.valor, catalogItem.valor)
  assert.equal(created.valor_original, catalogItem.valor)
  assert.equal(created.foto_url, catalogItem.foto_url)
  assert.equal(created.specs, catalogItem.specs)
  assert.equal(created.motor_cv, 2)
  assert.equal(created.motor_valor_unit, 0, 'motorredutor da ficha continua incluso')
  const withFunction = context.criarItemCatalogo(catalogItem, 'Descarga da carreta')
  assert.equal(withFunction.nome_custom, 'MOEGA DE DESCARGA 3 X 1 M (Descarga da carreta)')
  assert.equal(JSON.stringify(catalogItem), before, 'o catálogo original não deve ser regravado ou renomeado')
})

test('moinho 30 CV monofásico sem motor compatível continua pendente e mostra erro local do painel', () => {
  const original = transfer.materializeProjeto3DOrcamento(payload)[0]
  const catalogItem = { id: 21, categoria: 'MOINHO', nome_curto: 'TRITURADOR 30 CV', specs: [], motor_padrao_cv: 30, motor_padrao_polos: 2, motor_padrao_qtd: 1, preco_branorte_id: 77, valor: 32061, ativo: true, funcao_opcoes: [], motores_extras: [] }
  const resolver = source('../components/orcamento/Projeto3DOrcamentoResolver.tsx')
  const button = find(resolver, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(resolver) === 'button' && node.getText(resolver).includes('Aplicar preço')) as ts.JsxElement
  const event = button.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(resolver) === 'onClick') as ts.JsxAttribute
  const handler = (event.initializer as ts.JsxExpression).expression!.getText(resolver)
  let error = ''
  let mutations = 0
  const context = run(`${fn(page, 'motorJaInclusoNoItem')}\n${fn(page, 'criarItemCatalogo')}\n${fn(page, 'precificarLinhaProjeto3D')}\n${fn(page, 'vincularLinhaProjeto3D')}\nvar onVincular = vincularLinhaProjeto3D; var click = ${handler}`, {
    ...integration, Error, item: original, selected: catalogItem, carrinho: [original], voltagem: 'monofasico', gerarUid: () => 'discard',
    precos: [{ id: 77, valor_equipamento: 32061, valor_com_motor_trif: 44919, valor_com_motor_mono: null }],
    motores: [{ cv: 30, polos: 2, voltagem: 'trifasico', valor: 12858 }], acharMotorCompativel, valorPorVoltagem,
    setCarrinho() { mutations++ }, setError(value: string) { error = value }, setEditing() { throw new Error('falha deve manter a conferência aberta') },
  })
  context.click()
  assert.match(error, /motor.*voltagem.*Trifásico.*manual/)
  assert.equal(mutations, 0)
  assert.equal(integration.temPendenciasProjeto3D([original]), true)
  const unresolved = context.criarItemCatalogo(catalogItem)
  assert.equal(unresolved.motor_valor_unit, 0)
  assert.throws(() => integration.resolverVinculoProjeto3D(original, unresolved), /motor.*voltagem/)
  assert.equal(integration.resolverManualProjeto3D(original, 0).origem_projeto3d.resolution, 'manual', 'zero exige confirmação manual explícita')
})

test('snapshot, persistência e reabertura mantêm motor avulso, balanças, duplicatas e sequência de todos os pisos', () => {
  const imported = transfer.materializeProjeto3DOrcamento(payload).map(row => integration.resolverManualProjeto3D(row, 250))
  const component = find(page, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'FinalizarMontarModal') as ts.JsxSelfClosingElement
  const snapshotAttr = component.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(page) === 'snapshot') as ts.JsxAttribute
  const snapshotExpression = (snapshotAttr.initializer as ts.JsxExpression).expression!
  const snapshot = (ts.isAsExpression(snapshotExpression) ? snapshotExpression.expression : snapshotExpression) as ts.ObjectLiteralExpression
  const itens = snapshot.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(page) === 'itens') as ts.PropertyAssignment
  const mapped = run(`var result = ${itens.initializer.getText(page)}`, { carrinhoFinal: imported }).result
  const dbExpression = variable(modal, 'itensDb').initializer!.getText(modal)
  const persisted = run(`var result = ${dbExpression}`, { itensNorm: mapped, letraItem: (index: number) => String.fromCharCode(65 + index) }).result
  const normalized = run(`const SUFIXO_VOLTAGEM_RE = /\s+[-–—]\s*(mono|tri)f[aá]sicos?\.?\s*$/i; ${fn(hook, 'stripSufixoVoltagem')} ${fn(hook, 'suffixVoltagemNosItens')}`, {}).suffixVoltagemNosItens(persisted, 'trifasico', [])
  let restored: any[] = []
  const context = run(fn(page, 'carregarDoModelo'), { carrinho: [], items: [], precos: [], motores: [], montarMapaFotosTransportador: () => new Map(), console: { log() {} }, setCarrinho: (rows: any[]) => { restored = rows }, setAcessorios() {}, setVoltagem() {}, stripSufixoVoltagem: () => { throw new Error('não deve normalizar nome de origem 3D') } })
  context.carregarDoModelo({ itens: normalized, motores: [], acessorios: null, voltagem: 'trifasico' })
  assert.deepEqual(JSON.parse(JSON.stringify(restored.map(row => [row.uid, row.nome, row.qtd, row.origem_projeto3d.floorId, row.origem_projeto3d.sequence]))), imported.map(row => [row.uid, row.nome, row.qtd, row.origem_projeto3d.floorId, row.origem_projeto3d.sequence]))
  assert.deepEqual(JSON.parse(JSON.stringify(restored.map(row => row.origem_projeto3d))), imported.map(row => row.origem_projeto3d))
})

test('efeito real de balança não remove nem adiciona itens ao importar lista 3D', () => {
  const callback = effect(page, 'const BALANCA_RE')
  const context = run(`var apply = ${callback}`, { precos: [], carrinho: transfer.materializeProjeto3DOrcamento(payload), setCarrinho() { throw new Error('não pode mover balança') }, setComponentesExtras() { throw new Error('não pode criar extra') } })
  context.apply()
  const automatic = run(fn(page, 'autoAdicionarBalancaSeCompacta'), { carrinho: transfer.materializeProjeto3DOrcamento(payload), setComponentesExtras() { throw new Error('não pode criar balança automática') } })
  automatic.autoAdicionarBalancaSeCompacta('Caçamba de Pesagem', 'CACAMBA_PESAGEM')
})

test('modal real bloqueia emissão antes de qualquer número, PDF ou gravação quando há linha pendente', async () => {
  let message = ''
  const context = run(fn(modal, 'handleGerar'), { snapshot: { itens: transfer.materializeProjeto3DOrcamento(payload) }, temPendenciasProjeto3D: integration.temPendenciasProjeto3D, setErro: (value: string) => { message = value } })
  await context.handleGerar({ salvarNaPasta: true })
  assert.match(message, /3D.*catálogo.*manual/)
})

test('proposta IA não reconstrói linhas 3D e o chat apresenta a orientação sem marcar proposta aplicada', async () => {
  const original = transfer.materializeProjeto3DOrcamento(payload)
  const before = JSON.stringify(original)
  const chat = source('../components/orcamento/OrcamentoAIChat.tsx')
  let message = ''
  let applied = false
  const context = run(`${fn(page, 'handleApplyAIProposal')}\n${fn(chat, 'apply')}`, {
    carrinho: original, proposal: { id: 'ai-1', status: 'pronta' },
    applyProposal() { throw new Error('a IA tentou reconstruir as linhas importadas') },
    setApplying() {}, setLocalError(value: string) { message = value }, setAppliedProposalId() { applied = true },
    recordEvent() { throw new Error('proposta bloqueada não pode marcar evento applied') },
  })
  context.onApplyProposal = context.handleApplyAIProposal
  await context.apply()
  assert.match(message, /lista 3D.*catálogo.*manual/)
  assert.equal(applied, false)
  assert.equal(JSON.stringify(original), before)
})

test('receiver embutido valida origem e source, busca cliente do projeto atual e só navega depois do ACK', async () => {
  const projectPage = source('../pages/Projeto3D.tsx')
  const messages: any[] = []
  const timers: Array<() => void> = []
  const destinations: string[] = []
  const stored = new Map<string, string>()
  const frame = { postMessage: (message: any, origin: string) => { assert.equal(origin, editorOrigin); messages.push(message) } }
  const lookedUp: string[] = []
  const context = run(`var onMsg = ${variable(projectPage, 'onMsg').initializer!.getText(projectPage)}`, {
    CONFIGURADOR_ORIGIN: editorOrigin, frameRef: { current: { contentWindow: frame } }, catalogSessionRef: { current: {} }, catalogo3dSessionReply: () => null,
    ...transfer, fetchConfiguradorProjetoMetaAtual: async (project: { id: string }) => { lookedUp.push(project.id); return { cliente_nome: 'Cliente B verificado', contact_id: '11111111-1111-4111-8111-111111111111' } },
    window: { sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 100); timers.push(callback) } }, navigate: (url: string) => destinations.push(url),
  })
  const data = { type: 'branorte:budget:create', requestId: 'request-1', payload: { ...payload, contactId: '22222222-2222-4222-8222-222222222222' } }
  context.onMsg({ origin: 'https://evil.example', source: frame, data })
  context.onMsg({ origin: editorOrigin, source: {}, data })
  assert.equal(stored.size, 0)
  context.onMsg({ origin: editorOrigin, source: frame, data })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(lookedUp, ['project-b'])
  assert.equal(messages[0].ok, true)
  assert.equal(messages[0].token, payload.exportId)
  assert.equal(destinations.length, 0)
  timers[0]()
  assert.deepEqual(destinations, [`/orcamentos/montar?import3d=${payload.exportId}`])
  const saved = transfer.readProjeto3DOrcamentoTransfer(payload.exportId, { getItem: (key: string) => stored.get(key) ?? null })
  assert.equal(saved?.clientName, 'Cliente B verificado')
  assert.equal(saved?.contactId, '11111111-1111-4111-8111-111111111111')
})

test('popup real anuncia prontidão, aceita somente o opener verificado e confirma armazenamento integral', async () => {
  const messages: any[] = []
  const stored = new Map<string, string>()
  let listener: (event: object) => void = () => {}
  let received: transfer.Projeto3DOrcamentoPayload | null = null
  const opener = { postMessage(message: any, origin: string) { assert.equal(origin, editorOrigin); messages.push(message) } }
  const browserStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }
  const context = run(`var start = ${effect(page, 'mensagemPopupProjeto3DValida')}`, {
    ...transfer, ...integration, CONFIGURADOR_ORIGIN: editorOrigin, import3dToken: payload.exportId, editingId: null, receber3d: true, profile: { id: 'vendor-1' },
    fetchConfiguradorProjetoMetaAtual: async () => ({ cliente_nome: 'Cliente verificado', contact_id: null }),
    window: { opener, sessionStorage: browserStorage, localStorage: { getItem: () => null }, addEventListener(_type: string, callback: typeof listener) { listener = callback }, removeEventListener() {}, setInterval(_callback: unknown, ms: number) { assert.equal(ms, 500); return 1 }, setTimeout(_callback: unknown, ms: number) { assert.equal(ms, 20_000); return 2 }, clearInterval() {}, clearTimeout() {} },
    setTransfer3D: (value: transfer.Projeto3DOrcamentoPayload) => { received = value }, setImport3DError() {},
  })
  const cleanup = context.start()
  assert.equal(messages[0].type, 'branorte:budget:ready')
  const data = { type: 'branorte:budget:transfer', payload }
  listener({ origin: 'https://evil.example', source: opener, data })
  listener({ origin: editorOrigin, source: {}, data })
  listener({ origin: editorOrigin, source: opener, data: { ...data, payload: { ...payload, exportId: 'export_other12345' } } })
  assert.equal(stored.size, 0)
  listener({ origin: editorOrigin, source: opener, data })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages[1].type, 'branorte:budget:received')
  assert.equal(messages[1].exportId, payload.exportId)
  assert.equal((received as transfer.Projeto3DOrcamentoPayload | null)?.items.length, payload.items.length)
  assert.equal((received as transfer.Projeto3DOrcamentoPayload | null)?.clientName, 'Cliente verificado')
  listener({ origin: editorOrigin, source: opener, data })
  assert.equal(messages.length, 2, 'reenvio não duplica recebimento')
  cleanup()
})
