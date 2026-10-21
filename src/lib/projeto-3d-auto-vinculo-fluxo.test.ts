import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as transfer from './projeto-3d-orcamento'
import * as integration from './projeto-3d-orcamento-integracao'
import { valorPorVoltagem } from './motor-do-preco'
import { nomeComercialMoegaDescarga } from './projeto-3d-catalogo-match'

const source = readFileSync(new URL('../pages/OrcamentoMontar.tsx', import.meta.url), 'utf8')
const page = ts.createSourceFile('OrcamentoMontar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function node(predicate: (entry: ts.Node) => boolean) {
  let result: ts.Node | undefined
  function walk(entry: ts.Node) { if (predicate(entry)) result ??= entry; ts.forEachChild(entry, walk) }
  walk(page)
  assert.ok(result)
  return result!
}
function fn(name: string) { return node(entry => ts.isFunctionDeclaration(entry) && entry.name?.text === name).getText(page) }
const call = node(entry => ts.isCallExpression(entry) && entry.expression.getText(page) === 'useEffect' && !!entry.arguments[0]?.getText(page).includes('importedTokenRef.current === import3dToken')) as ts.CallExpression
const hydrateCode = call.arguments[0].getText(page)
const payload = transfer.parseProjeto3DOrcamentoPayload({ version: 1, exportId: 'automatic_1234567890', projectId: 'project-test', projectName: 'Teste', clientName: 'Validação', items: [{ sourceId: 'mill', floorId: 'floor-1', floorName: 'Térreo', kind: 'equipment', catalogId: 'branorte_bnmm_20cv_com_base', sequence: 1, name: 'MOINHO MARTELO 20 CV', quantity: 2, specifications: ['COM BASE'] }] })

function hydrate(options: { loadingPrecos?: boolean; recovered?: any } = {}) {
  let cart: any[] = []
  let restored: any = null
  let written = false
  const voltageCalls: string[] = []
  const values = {
    ...transfer, import3dToken: payload.exportId, editingId: null, loadingItems: false, loadingMotores: false, loadingPrecos: options.loadingPrecos ?? false,
    items: [{ id: 5 }], catalogo3D: [{ id: 5 }], motores: [], precos: [], voltagem: 'trifasico', importedTokenRef: { current: null }, transfer3D: payload,
    window: { localStorage: {} }, readProjeto3DDraft: () => options.recovered ?? null,
    autoVincularProjeto3D(rows: any[], _catalog: unknown, price: (line: any, catalog: any) => any) { return rows.map(row => price(row, { id: 5 })) },
    precificarLinhaProjeto3D(row: any, item: any, voltage: string) { voltageCalls.push(voltage); return { ...row, catalogo_id: item.id, valor: voltage === 'monofasico' ? 3100 : 2600, origem_projeto3d: { ...row.origem_projeto3d, resolution: 'vinculado' } } },
    setCarrinho(rows: any[]) { cart = rows; written = true }, aplicarRascunho(value: unknown) { restored = value; written = true },
    setClienteDados() {}, setInitialModal() {}, setAcessorios() {}, isApplyingUndoRef: { current: false }, setHistoryStack() {}, draft: { dismissRecovered() {} }, setHydrated3DToken() {}, setImport3DError() {},
  }
  const context = vm.createContext(values)
  vm.runInContext(ts.transpileModule(`var hydrate = ${hydrateCode}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  context.hydrate()
  return { cart, restored, written, voltageCalls, token: values.importedTokenRef.current }
}

test('hidratação aguarda preços antes de marcar token como aplicado', () => {
  const result = hydrate({ loadingPrecos: true })
  assert.equal(result.written, false)
  assert.equal(result.token, null)
})

test('nova transferência aplica catálogo no carregamento mantendo quantidade e origem', () => {
  const result = hydrate()
  assert.equal(result.cart[0].catalogo_id, 5)
  assert.equal(result.cart[0].qtd, 2)
  assert.equal(result.cart[0].origem_projeto3d.resolution, 'vinculado')
  assert.deepEqual(result.voltageCalls, ['trifasico'])
})

test('rascunho antigo pendente usa voltagem recuperada sem perder acessórios editados', () => {
  const recovered = { carrinho: transfer.materializeProjeto3DOrcamento(payload), voltagem: 'monofasico', acessorios: { pct: 9, items: ['Acessório conferido'] } }
  const result = hydrate({ recovered })
  assert.equal(result.restored.carrinho[0].catalogo_id, 5)
  assert.equal(result.restored.carrinho[0].valor, 3100)
  assert.equal(result.restored.acessorios, recovered.acessorios)
  assert.deepEqual(result.voltageCalls, ['monofasico'])
})

test('factory aceita voltagem explícita mesmo antes de aplicar estado do rascunho', () => {
  const context = vm.createContext({ gerarUid: () => 'new', voltagem: 'trifasico', precos: [{ id: 55, valor_equipamento: 2000, valor_com_motor_trif: 2600, valor_com_motor_mono: 3100 }], motores: [], acharMotorCompativel: () => null, valorPorVoltagem, nomeComercialMoegaDescarga })
  vm.runInContext(ts.transpileModule(`${fn('motorJaInclusoNoItem')}\n${fn('criarItemCatalogo')}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const priced = context.criarItemCatalogo({ id: 5, categoria: 'MOINHO', nome_curto: 'TRITURADOR DE GRÃOS 20 CV', specs: [], preco_branorte_id: 55, funcao_opcoes: [], foto_url: '/catalog-photo.png' }, undefined, 'monofasico')
  assert.equal(priced.valor, 3100)
  assert.equal(priced.foto_url, '/catalog-photo.png')
})

test('vínculo automático e manual compartilham validação comercial de preços e motores', () => {
  assert.match(fn('vincularLinhaProjeto3D'), /precificarLinhaProjeto3D/)
  const code = fn('precificarLinhaProjeto3D')
  assert.match(code, /resolverVinculoProjeto3D/)
  assert.match(code, /agruparMotores/)
})
