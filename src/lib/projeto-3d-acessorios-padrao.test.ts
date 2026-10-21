import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import JSZip from 'jszip'
import { autoVincularProjeto3D } from './projeto-3d-auto-vinculo'
import { montarItensFiname } from './finame'
import { gerarOrcamentoCustomDocx } from './orcamento-custom-docx'
import { readProjeto3DDraft } from './projeto-3d-orcamento-integracao'
import { materializeProjeto3DAcessorios, materializeProjeto3DOrcamento, parseProjeto3DOrcamentoPayload } from './projeto-3d-orcamento'

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function find(ast: ts.SourceFile, predicate: (entry: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined
  function visit(entry: ts.Node) { if (!found && predicate(entry)) found = entry; if (!found) ts.forEachChild(entry, visit) }
  visit(ast)
  assert.ok(found, 'o fluxo real esperado deve existir')
  return found
}
function run(code: string, values: Record<string, unknown>) {
  const context = vm.createContext(values)
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context
}
const page = source('../pages/OrcamentoMontar.tsx')
const modal = source('../components/FinalizarMontarModal.tsx')
function memo(name: string) {
  const declaration = find(page, entry => ts.isVariableDeclaration(entry) && entry.name.getText(page) === name) as ts.VariableDeclaration
  return (declaration.initializer as ts.CallExpression).arguments[0].getText(page)
}
const payload = parseProjeto3DOrcamentoPayload({
  version: 1, exportId: 'accessories_1234567890', projectId: 'project-test', projectName: 'Linha de produção', clientName: 'Cliente teste',
  items: [{ sourceId: 'main', floorId: 'ground', floorName: 'Térreo', kind: 'equipment', catalogId: 'cad-transportador', sequence: 1, name: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M', quantity: 2, specifications: [] }],
  accessories: [{ sourceId: 'inlet', floorId: 'ground', floorName: 'Térreo', kind: 'equipment', catalogId: 'cad-boca', sequence: 1, name: 'Boca de entrada', quantity: 3, specifications: ['Ø160 mm'] }],
})
const fresh = () => materializeProjeto3DAcessorios(payload)!
function calculate(acessorios: unknown, carrinho: unknown[]) {
  return run(`var result = (${memo('valorAcessorios')})()`, {
    acessorios, carrinho,
    // Separate motors must never become the base of the accessory percentage.
    motoresAgrupados: [{ valor_total: 90000 }], motoresAvulsos: [{ valor: 90000 }],
  }).result as number
}

test('padrão de 15% usa equipamento vezes quantidade, exclui brindes e itens dispensados sem cobrar por peça acessória', () => {
  const cfg = { ...fresh(), excludedItemUids: ['excluded'] }
  assert.equal(cfg.pct, 15)
  assert.equal(cfg.valorFixo, null)
  const result = calculate(cfg, [
    { uid: 'a', valor: 10000, qtd: 2 }, { uid: 'b', valor: 5000, qtd: 1 },
    { uid: 'gift', valor: 2000, qtd: 4, brinde: true },
    { uid: 'included', valor: 3000, qtd: 3, incluso: true },
    { uid: 'client', valor: 4000, qtd: 2, por_conta_cliente: true },
    { uid: 'excluded', valor: 6000, qtd: 1 },
  ])
  assert.equal(result, 3750, '15% de R$25.000; as três bocas não multiplicam a cobrança')
})

test('mesma configuração recalcula ao mudar o equipamento e arredonda para cima sem valor fixo antigo', () => {
  const cfg = fresh()
  assert.equal(calculate(cfg, [{ uid: 'a', valor: 10000, qtd: 2 }]), 3000)
  assert.equal(calculate(cfg, [{ uid: 'a', valor: 10000, qtd: 5 }]), 7500)
  assert.equal(calculate(cfg, [{ uid: 'a', valor: 10001, qtd: 1 }]), 1501)
  assert.equal(cfg.valorFixo, null)
})

test('reabrir transferência prioriza percentual ou valor fixo editados, inclusive rascunho histórico zero', () => {
  const hydration = find(page, entry => ts.isCallExpression(entry) && entry.expression.getText(page) === 'useEffect'
    && !!entry.arguments[0]?.getText(page).includes('importedTokenRef.current === import3dToken')) as ts.CallExpression
  for (const edited of [{ ...fresh(), pct: 7 }, { ...fresh(), pct: 0, valorFixo: 0 }, { ...fresh(), pct: 15, valorFixo: 900 }]) {
    const data = { projeto3DExportId: payload.exportId, carrinho: materializeProjeto3DOrcamento(payload), acessorios: edited, voltagem: 'trifasico' }
    const storage = { getItem: () => JSON.stringify({ version: 1, saved_at: new Date().toISOString(), data }) }
    let restored: any = null
    const context = run(`var hydrate = ${hydration.arguments[0].getText(page)}`, {
      import3dToken: payload.exportId, editingId: null, loadingItems: false, loadingMotores: false, loadingPrecos: false,
      items: [], catalogo3D: [], motores: [], precos: [], importedTokenRef: { current: null }, transfer3D: payload,
      window: { localStorage: storage }, readProjeto3DDraft, autoVincularProjeto3D,
      aplicarRascunho(value: unknown) { restored = value },
      precificarLinhaProjeto3D() { throw new Error('não há catálogo nesta recuperação') },
      setAcessorios() { throw new Error('o padrão novo não pode substituir configuração recuperada') },
      isApplyingUndoRef: { current: false }, setHistoryStack() {}, draft: { dismissRecovered() {} }, setHydrated3DToken() {}, setImport3DError() {},
    })
    context.hydrate()
    assert.deepEqual(restored.acessorios, edited)
    assert.equal(calculate(restored.acessorios, [{ uid: 'a', valor: 10000, qtd: 2 }]), edited.valorFixo && edited.valorFixo > 0 ? 900 : edited.pct === 0 ? 0 : 1400)
  }
})

test('FINAME embute os acessórios de 15% uma única vez e não emite bloco adicional', () => {
  const result = run(`var result = (${memo('finameTransform')})()`, {
    finameMode: true, valorAcessoriosExib: 3000, totalComponentesExtras: 0, finameTipoOverride: {}, finameAlvoTotal: null, finameAcrescimoUids: [], montarItensFiname,
    carrinhoExib: [
      { uid: 'a', nome: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M', categoria: 'TRANSPORTADOR', qtd: 1, valor: 10000, specs: [] },
      { uid: 'b', nome: 'MISTURADOR VERTICAL 1900 LITROS', categoria: 'MISTURADOR', qtd: 1, valor: 10000, specs: [] },
    ],
    motoresAgrupadosExib: [{ item_uid: 'a', valor_total: 3000 }, { item_uid: 'b', valor_total: 4000 }],
  }).result
  assert.deepEqual(Array.from(result.bloqueios), [])
  assert.equal(result.itens.length, 2)
  assert.equal(result.totalGeral, 30000, 'R$20.000 de equipamentos + R$7.000 de motores + R$3.000 de acessórios')
  assert.equal(result.itens.reduce((sum: number, item: any) => sum + item.valor * item.qtd, 0), 30000)
})

test('snapshot, gravação e Word usam o valor de acessórios calculado sem aplicar novamente os 15%', async () => {
  const cfg = fresh()
  const value = calculate(cfg, [{ uid: 'a', valor: 10000, qtd: 2 }])
  const component = find(page, entry => ts.isJsxSelfClosingElement(entry) && entry.tagName.getText(page) === 'FinalizarMontarModal') as ts.JsxSelfClosingElement
  const attribute = component.attributes.properties.find(entry => ts.isJsxAttribute(entry) && entry.name.getText(page) === 'snapshot') as ts.JsxAttribute
  const expression = (attribute.initializer as ts.JsxExpression).expression!
  const snapshot = (ts.isAsExpression(expression) ? expression.expression : expression) as ts.ObjectLiteralExpression
  const accessoryProperty = snapshot.properties.find(entry => ts.isPropertyAssignment(entry) && entry.name.getText(page) === 'acessorios') as ts.PropertyAssignment
  const accessories = run(`var result = ${accessoryProperty.initializer.getText(page)}`, { acessoriosFinal: cfg, valorAcessoriosFinal: value }).result
  const savedProperty = find(modal, entry => ts.isPropertyAssignment(entry) && entry.name.getText(modal) === 'acessorios'
    && entry.initializer.getText(modal).includes('valor: snapshot.acessorios.valor')) as ts.PropertyAssignment
  const saved = run(`var result = ${savedProperty.initializer.getText(modal)}`, { snapshot: { acessorios: accessories } }).result
  assert.equal(saved.valor, 3000)
  assert.deepEqual(saved.items, cfg.items)
  const blob = await gerarOrcamentoCustomDocx({
    numero: 'TESTE', dataEmissao: '20/10/2026', cliente: { nome: 'Cliente teste' }, voltagem: 'trifasico',
    itens: [{ letra: 'A', qtd: 2, nome: payload.items[0].name, specs: [], valor: 10000 }],
    motores: [{ cv: 3, polos: 4, qtd: 1, valor_unit: 7000, valor_total: 7000 }],
    acessorios: accessories, totalEquip: 23000, totalMotores: 7000, totalProposta: 30000,
  })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await zip.file('word/document.xml')!.async('string')
  const paragraphs = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paragraph => (paragraph.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map(text => text.replace(/<[^>]+>/g, '')).join(''))
  assert.equal(paragraphs.filter(paragraph => paragraph.includes('— ACESSÓRIOS')).length, 1)
  assert.equal(paragraphs.filter(paragraph => paragraph.includes('Boca de entrada') && paragraph.includes('Qtde: 3')).length, 1)
  assert.ok(paragraphs.some(paragraph => paragraph.includes('3.000,00')))
  const tables = xml.match(/<w:tbl[ >][\s\S]*?<\/w:tbl>/g) ?? []
  assert.ok(tables.some(table => table.includes('VALOR TOTAL DE EQUIPAMENTOS') && table.includes('23.000,00')))
  assert.ok(paragraphs.some(paragraph => paragraph.includes('VALOR TOTAL DA PROPOSTA') && paragraph.includes('30.000,00')))
})
