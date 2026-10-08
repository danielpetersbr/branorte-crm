import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { passaEtiqueta, SEM_CONVERSA, SEM_WHATSAPP } from './mapa-etiquetas'
import { passaPeriodo } from './periodo'
import { foneCanon } from './fone-canon'
import * as helpers from './mapa-visitas-regras'
import { filtrarVisitasWhatsApp } from './visitas-whatsapp'

// Execute the page's real filter expressions without authenticated hooks or a DOM.
const source = readFileSync(new URL('../pages/MapaVisitas.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('MapaVisitas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MapaVisitas') as ts.FunctionDeclaration
const statements = [...ast.statements, ...page.body!.statements]
const declaration = (name: string) => statements.find(n =>
  (ts.isFunctionDeclaration(n) && n.name?.text === name) ||
  (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name)))
const point = (patch: Record<string, unknown> = {}) => ({
  cli_key: 'a', cliente: 'João', cidade: 'São Paulo', uf: 'SP', telefone: '11999990001', fone: null,
  numeros: '2026 - 0001', vendedor: 'ANA', vendido: false, total: 50000, data_recente: null,
  n_orcamentos: 1, n_vendas: 0, lat: -23.55, lng: -46.63, precisao: 'cidade', ...patch,
})
const row = (patch: Record<string, unknown> = {}) => ({
  numero: '2026 - 0001', cliente: 'João', cidade: 'São Paulo', uf: 'SP', vendedor: 'ANA',
  vendido: false, total: 50000, data_emissao: null, equipamento: 'Misturador', lat: null, lng: null, ...patch,
})
function evaluate(names: string[], result: string, patch: Record<string, unknown> = {}) {
  const context = {
    ...helpers, busca: '', buscaProcessada: '', vendedorSel: '', ufSel: '', vendFiltro: 'todos',
    visitaFiltro: 'todos', periodo: 'tudo', marc: {}, etiquetasSel: new Set(), showOrc: true, showVis: true,
    showLista: true, orcPontos: [point()], lista: [row()], visitas: [], comCoord: [],
    loadingLista: false, loadingListaQuery: false, loadingOrc: false, loadingEtiquetasMapa: false, loadingMarcacoes: false,
    errorListaQuery: null, errorOrc: null, errorEtiquetasMapa: null, errorMarcacoes: null,
    byVendId: new Map(), globId: new Map(), etiqPorCliente: new Map(),
    useMemo: (fn: () => unknown) => fn(), passaPeriodoRegra: passaPeriodo, passaEtiqueta, foneCanon, filtrarVisitasWhatsApp, soMarcados: false,
    passaEtq: () => true, etiqDoPonto: () => SEM_CONVERSA, etiquetasDaVisita: () => SEM_CONVERSA,
    LIMITE_ESTRELA: 100000, LIMITE_DIAMANTE: 300000, ...patch,
  }
  const snippets = ['LISTA_VAZIA', 'PONTOS_VAZIOS', 'VISITAS_VAZIAS', 'ufKey', 'normTxt', 'chaveMarc', 'passaFiltro', 'passaPeriodo', 'passaVisita', 'passaEtq', ...names]
    .flatMap(name => declaration(name)?.getText(ast) ?? [])
  const js = ts.transpileModule(`${snippets.join('\n')}\n${result}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(js, context)
}
const searchNames = ['buscaVisitas', 'buscaOrcamentos', 'buscaLista', 'clientesDaLista', 'termo', 'visSemBusca', 'orcSemBusca', 'visFiltradas', 'orcBase', 'orcFiltrados', 'precisaClientesLista', 'loadingLista', 'errorLista', 'listaFiltrada']

test('accentless search finds the same São Paulo points and proposals as autocomplete', () => {
  assert.equal(evaluate(searchNames, 'orcFiltrados.length + listaFiltrada.length', { busca: 'sao paulo', buscaProcessada: 'sao paulo' }), 2)
})

test('visitas de quem já comprou não entram no filtro só orçados', () => {
  const visita = { id: 'v', nome: 'João', telefone: '11999990001', cidade: 'São Paulo', estado: 'SP', vendedor_nome: 'ANA', interesse: null, lat: -23.55, lng: -46.63, vendido: true }
  assert.equal(evaluate(searchNames, 'visFiltradas.length', { comCoord: [visita], vendFiltro: 'orcados' }), 0)
  assert.equal(evaluate(searchNames, 'visFiltradas.length', { comCoord: [visita], vendFiltro: 'vendidos' }), 1)
  assert.equal(evaluate(['visitasSelecionadas'], 'visitasSelecionadas.length', { visitas: [visita], vendFiltro: 'orcados' }), 0)
  assert.equal(evaluate(['visitasSelecionadas'], 'visitasSelecionadas.length', { visitas: [visita], vendFiltro: 'vendidos' }), 1)
})

test('proposal table inherits seller filter while retaining rows without coordinates', () => {
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { vendedorSel: 'BRUNO' }), 0)
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { vendedorSel: 'ANA' }), 1)
})

test('proposal table resolves visit marker using the linked client phone', () => {
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { visitaFiltro: 'visitados' }), 0)
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', {
    visitaFiltro: 'visitados', marc: { '11999990001': { visitado: true } },
  }), 1)
})

test('unlocated and unmatched proposals remain listed when client filters are off', () => {
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { orcPontos: [], lista: [row({ cliente: 'Legado sem cidade', cidade: null, uf: null })] }), 1)
})

test('city suggestions honor seller and enabled layers before the search itself', () => {
  const names = [...searchNames, 'cidadesIndex', 'sugestoesCidade']
  assert.equal(evaluate(names, 'sugestoesCidade.length', { busca: 'sao', buscaProcessada: 'sao', vendedorSel: 'BRUNO' }), 0)
  assert.equal(evaluate(names, 'sugestoesCidade.length', { busca: 'sao', buscaProcessada: 'sao', showOrc: false, showVis: false }), 0)
})

test('repainting identical coordinates preserves the user camera', () => {
  let fit: ts.IfStatement | undefined
  const visit = (n: ts.Node) => {
    if (ts.isIfStatement(n) && n.thenStatement.getText(ast).includes('map.fitBounds(bounds')) fit = n
    ts.forEachChild(n, visit)
  }
  visit(page)
  assert.ok(fit)
  const js = ts.transpileModule(fit.expression.getText(ast), {}).outputText
  const context = {
    bounds: [[-23.55, -46.63]], centro: null, modoViagemRef: { current: false },
    geometria: { chave: 'same coordinates' }, ultimaGeometriaEnquadradaRef: { current: 'same coordinates' },
  }
  assert.equal(vm.runInNewContext(js, context), false)
  context.ultimaGeometriaEnquadradaRef.current = ''
  assert.equal(vm.runInNewContext(js, context), true)
})

test('city selection applies its UF immediately even after a different state was selected', () => {
  const selected: Record<string, unknown> = {}
  evaluate(['handleSelecionarCidade'], "handleSelecionarCidade({ cidade: 'Bom Jesus', uf: 'PI' })", {
    ufSel: 'RS', setBusca: (v: string) => { selected.busca = v },
    setBuscaProcessada: (v: string) => { selected.processada = v },
    setUfSel: (v: string) => { selected.uf = v }, setSugAberta: (v: boolean) => { selected.aberta = v },
  })
  assert.deepEqual(selected, { busca: 'Bom Jesus', processada: 'Bom Jesus', uf: 'PI', aberta: false })
})

test('selecting a city with no UF uses the no-state bucket rather than all states', () => {
  let uf = ''
  evaluate(['handleSelecionarCidade'], "handleSelecionarCidade({ cidade: 'Sem UF', uf: '' })", {
    setBusca() {}, setBuscaProcessada() {}, setSugAberta() {}, setUfSel: (v: string) => { uf = v },
  })
  assert.equal(uf, '—')
})

test('proposal labels use the linked client rather than treating an unmatched phone as a known no-WhatsApp client', () => {
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { etiquetasSel: new Set([SEM_WHATSAPP]) }), 1)
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { etiquetasSel: new Set(['VENDIDO']) }), 0)
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', {
    orcPontos: [], etiquetasSel: new Set([SEM_WHATSAPP]),
  }), 0)
})

test('city counts combine enabled layers but count the same client phone once', () => {
  const visita = { id: 'v', nome: 'João', telefone: '11999990001', cidade: 'São Paulo', estado: 'SP', vendedor_nome: 'ANA', interesse: null, lat: -23.55, lng: -46.63 }
  const names = [...searchNames, 'cidadesIndex', 'sugestoesCidade']
  assert.equal(evaluate(names, 'sugestoesCidade[0].n', { busca: 'sao', buscaProcessada: 'sao', comCoord: [visita] }), 1)
  assert.equal(evaluate(names, 'sugestoesCidade[0].n', { busca: 'sao', buscaProcessada: 'sao', comCoord: [visita], showOrc: false }), 1)
})

test('matching proposals does not attach visit/label identity from an ambiguous homonymous client', () => {
  const a = point({ numeros: '2026 - 0001' })
  const b = point({ cli_key: 'b', numeros: '2026 - 0002', telefone: '11999990002' })
  const resolve = helpers.indexarClientesDaLista!([a, b] as any)
  assert.deepEqual(resolve(row({ numero: 'unmatched' }) as any), [])
  assert.equal(resolve(row({ numero: '2026-0002' }) as any)[0], b)
})

test('a proposal number absent from the located client never inherits that homonym visit marker', () => {
  const resolve = helpers.indexarClientesDaLista([point({ numeros: '2026 - 0001' })] as any)
  assert.deepEqual(resolve(row({ numero: '2026 - 0002' }) as any), [])
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', {
    lista: [row({ numero: '2026 - 0002' })], visitaFiltro: 'visitados',
    marc: { '11999990001': { visitado: true } },
  }), 0)
})

test('an unidentified proposal is not silently classified as an unvisited client', () => {
  assert.equal(evaluate(searchNames, 'listaFiltrada.length', { orcPontos: [], visitaFiltro: 'pendentes' }), 0)
})

test('table waits for client filter metadata but not for unrelated metadata', () => {
  assert.equal(evaluate(searchNames, 'loadingLista', { visitaFiltro: 'visitados', loadingMarcacoes: true }), true)
  assert.equal(evaluate(searchNames, 'loadingLista', { etiquetasSel: new Set(['VENDIDO']), loadingEtiquetasMapa: true }), true)
  assert.equal(evaluate(searchNames, 'loadingLista', { loadingMarcacoes: true, loadingEtiquetasMapa: true }), false)
})

test('retry after a client-metadata failure reloads the dependencies used by the table filter', async () => {
  const chamadas: string[] = []
  const query = (nome: string) => () => { chamadas.push(nome); return Promise.resolve({}) }
  await evaluate(['precisaClientesLista', 'refetchLista'], 'refetchLista()', {
    visitaFiltro: 'visitados', etiquetasSel: new Set(['VENDIDO']),
    refetchLista: query('lista'), refetchListaQuery: query('lista'), refetchOrc: query('clientes'),
    refetchMarcacoes: query('marcacoes'), refetchEtiquetasMapa: query('etiquetas'),
  })
  assert.deepEqual(chamadas, ['lista', 'clientes', 'marcacoes', 'etiquetas'])
})

test('nearest-city calculation skips lone pins and handles a new stack without rebuilding the coordinate index', () => {
  const cache = helpers.criarCacheLimitesMapa!()
  assert.equal(cache(helpers.geometriaDosPontos!([[0, 0], [0, 1]])).size, 0)
  const stacked = cache(helpers.geometriaDosPontos!([[0, 0], [0, 0], [0, 1]]))
  assert.equal(stacked.get('0.00000,0.00000'), 55660)
  const same = cache(helpers.geometriaDosPontos!([[0, 1], [0, 0], [0, 0], [0, 0]]))
  assert.equal(same, stacked, 'same cities reuse nearest-neighbor work despite order/count changes')
  const moved = cache(helpers.geometriaDosPontos!([[0, 0], [0, 0], [0, 0.5]]))
  assert.equal(moved.get('0.00000,0.00000'), 27830)
})
