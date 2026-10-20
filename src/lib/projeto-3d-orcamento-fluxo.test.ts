import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as transfer from './projeto-3d-orcamento'
import * as integration from './projeto-3d-orcamento-integracao'
import { acharMotorCompativel, valorPorVoltagem } from './motor-do-preco'

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
  const context = vm.createContext(values)
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context
}
const page = source('../pages/OrcamentoMontar.tsx')
const modal = source('../components/FinalizarMontarModal.tsx')
const hook = source('../hooks/useOrcamentoBuilder.ts')

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

test('moinho 30 CV monofásico sem motor compatível continua pendente e mostra erro local do painel', () => {
  const original = transfer.materializeProjeto3DOrcamento(payload)[0]
  const catalogItem = { id: 21, categoria: 'MOINHO', nome_curto: 'TRITURADOR 30 CV', specs: [], motor_padrao_cv: 30, motor_padrao_polos: 2, motor_padrao_qtd: 1, preco_branorte_id: 77, valor: 32061, ativo: true, funcao_opcoes: [], motores_extras: [] }
  const resolver = source('../components/orcamento/Projeto3DOrcamentoResolver.tsx')
  const button = find(resolver, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(resolver) === 'button' && node.getText(resolver).includes('Aplicar preço')) as ts.JsxElement
  const event = button.openingElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(resolver) === 'onClick') as ts.JsxAttribute
  const handler = (event.initializer as ts.JsxExpression).expression!.getText(resolver)
  let error = ''
  let mutations = 0
  const context = run(`${fn(page, 'motorJaInclusoNoItem')}\n${fn(page, 'criarItemCatalogo')}\n${fn(page, 'vincularLinhaProjeto3D')}\nvar onVincular = vincularLinhaProjeto3D; var click = ${handler}`, {
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
