import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { nomeArquivoContrato } from './contrato/contrato-blocos'
import { exportacaoPertenceAoContexto } from '../components/controle/vendas-original/calculos'
import { capturaMapaPDF, exigirEvolucaoAnualPDF } from '../components/controle/vendas-original/pdf-graficos'

function pagina(path: string) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function importsIniciais(ast: ts.SourceFile) {
  return ast.statements.filter(ts.isImportDeclaration)
    .filter(statement => !statement.importClause?.isTypeOnly)
    .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)
}

function handlerDaExportacao(ast: ts.SourceFile) {
  let handler: ts.ArrowFunction | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'exportarPDF' && node.initializer && ts.isArrowFunction(node.initializer)) handler = node.initializer
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.ok(handler, 'a exportação permanece no handler existente')
  return handler
}

function importsDaExportacao(ast: ts.SourceFile) {
  const handler = handlerDaExportacao(ast)
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push((node.arguments[0] as ts.StringLiteral).text)
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return imports
}

test('Pedidos carrega jsPDF e tabela somente ao exportar', () => {
  const ast = pagina('../pages/ControlePedidos.tsx')
  assert.ok(!importsIniciais(ast).includes('jspdf'), 'abrir pedidos não deve importar jsPDF')
  assert.ok(!importsIniciais(ast).includes('jspdf-autotable'))
  assert.ok(importsDaExportacao(ast).includes('jspdf'))
  assert.ok(importsDaExportacao(ast).includes('jspdf-autotable'))
})

test('Vendas carrega relatório e captura do mapa somente ao exportar', () => {
  const ast = pagina('../pages/controle/ControleVendasOriginal.tsx')
  const report = '@/components/controle/vendas-original/relatorio-pdf'
  assert.ok(!importsIniciais(ast).includes(report), 'abrir vendas não deve importar o gerador PDF')
  assert.ok(!importsIniciais(ast).includes('html2canvas'))
  assert.ok(importsDaExportacao(ast).includes(report))
  assert.ok(importsDaExportacao(ast).includes('html2canvas'))
})

test('Contrato usa o helper de nome sem carregar o renderizador Word', () => {
  const imports = importsIniciais(pagina('../pages/ContratoMontar.tsx'))
  assert.ok(!imports.includes('@/lib/contrato/contrato-docx'), 'contrato PDF não deve importar docx por um helper')
  assert.ok(imports.includes('@/lib/contrato/contrato-blocos'))
  assert.equal(typeof nomeArquivoContrato, 'function')
})

function exportacaoVendas(load: (name: string) => Promise<unknown>) {
  const ast = pagina('../pages/controle/ControleVendasOriginal.tsx')
  const source = handlerDaExportacao(ast).getText(ast).replace(/\bimport\(/g, '__load(')
  const js = ts.transpileModule(`(${source})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const states: boolean[] = [], errors: string[] = []
  const authAtual = { current: 'usuario' }, analiseAtual = { current: 'consulta' }
  const context = {
    Error, __load: load, loading: false, exportingPDF: false, authContexto: 'usuario', pedidos: [{}],
    contextoAnalise: 'consulta', geracaoPedidos: { current: 1 }, geracaoAno: { current: 1 },
    montado: { current: true }, authAtual, analiseAtual, bloqueioAtualRef: { current: null },
    exportacaoPertenceAoContexto, capturaMapaPDF, exigirEvolucaoAnualPDF,
    estadoEvolucaoAnual: { carregando: false, erro: null, contexto: 'consulta', contextoConsulta: 'consulta' },
    setExportingPDF: (value: boolean) => states.push(value), pdfToast: { current: null },
    sonnerToast: { loading: () => 1, dismiss: () => {}, success: () => {}, error: (value: string) => errors.push(value) },
    periodoFiltro: 'ano-atual', anoAtual: 2026, vendedorFiltro: 'todos', valorMinimoFiltro: 0,
    valorTotal: 100, totalVendas: 1, ticketMedio: 100, vendasFisicas: [{}], pedidosAtivos: [], pedidosFiltrados: [],
    metaGeral: 200, vendasPorVendedor: [], dadosVendasPorMes: [], dadosFabricas: [], dadosEquipamentos: [],
    tempoMedioPorVendedor: [], dadosEstados: [], dadosTodasOrigens: [], dadosConversoesRapidas: [], dadosTempoConversao: [],
    isAdmin: false, mapaRef: { current: {} }, format: () => '13-10-2026',
  }
  return { run: vm.runInNewContext(js, context) as () => Promise<void>, states, errors, authAtual, analiseAtual }
}

test('falha ao carregar biblioteca de vendas encerra espera e informa erro sem exportar', async () => {
  const names: string[] = []
  const h = exportacaoVendas(async name => { names.push(name); throw Error('Falha ao carregar biblioteca') })
  assert.deepEqual(names, [])
  await h.run()
  assert.equal(names.length, 2)
  assert.deepEqual(h.states, [true, false])
  assert.deepEqual(h.errors, ['Falha ao carregar biblioteca'])
})

test('troca de filtros durante carregamento das bibliotecas impede captura e arquivo', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let captures = 0, renders = 0
  const h = exportacaoVendas(async name => {
    await pending
    return name === 'html2canvas'
      ? { default: () => { captures++; return {} } }
      : { criarRelatorioVendasPDF: () => { renders++; return {} } }
  })
  const running = h.run()
  h.analiseAtual.current = 'outro-filtro'
  release()
  await running
  assert.equal(captures, 0)
  assert.equal(renders, 0)
  assert.deepEqual(h.states, [true, false])
  assert.deepEqual(h.errors, ['A sessão ou os filtros mudaram. Gere o relatório novamente.'])
})

test('exportação adiada preserva séries, imagem do mapa e nome do arquivo', async () => {
  const saved: string[] = []
  let input: Record<string, unknown> | undefined
  const h = exportacaoVendas(async name => name === 'html2canvas'
    ? { default: async () => ({ width: 300, height: 200, toDataURL: () => 'data:image/jpeg;base64,mapa' }) }
    : { criarRelatorioVendasPDF: async (value: Record<string, unknown>, validate: () => void) => {
      validate()
      input = value
      return { save: (name: string) => saved.push(name) }
    } })
  await h.run()
  assert.equal(input?.valorTotal, 100)
  assert.equal(input?.totalRegistros, 1)
  assert.equal(input?.periodo, 'Ano de 2026')
  assert.deepEqual(JSON.parse(JSON.stringify(input?.mapa)), { imagem: 'data:image/jpeg;base64,mapa', largura: 300, altura: 200 })
  assert.deepEqual(saved, ['relatorio-vendas-premium-13-10-2026.pdf'])
  assert.deepEqual(h.states, [true, false])
  assert.deepEqual(h.errors, [])
})
