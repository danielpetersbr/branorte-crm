import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement, Fragment, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryNotice } from '../components/ui/QueryNotice'

const source = readFileSync(new URL('../pages/MapaVisitas.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('MapaVisitas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MapaVisitas') as ts.FunctionDeclaration

function view({ error = null as Error | null, pending = false, cached = false } = {}) {
  const cfg = { nome: 'Rascunho fictício que deve permanecer', dias: 1 }, paradas = [{ id: 'draft-stop' }]
  let retries = 0
  const query = () => ({ data: cached ? [] : undefined, error, isLoading: pending, isFetching: false, refetch: async () => { retries++ } })
  const context: Record<string, unknown> = {
    React: { createElement, Fragment }, QueryNotice,
    useVisitas: query, useOrcamentosMapa: query, useEtiquetasMapa: query, useMapaMarcacoes: query,
    VISITAS_VAZIAS: [], PONTOS_VAZIOS: [], MAPA_ETIQ_VAZIO: {}, MARCACOES_VAZIAS: {},
    showOrc: true, showVis: true, ufsVisiveis: [], orcFiltrados: [], visFiltradas: [], orcStats: { vendido: 0 }, semCoord: 0,
    cfgViagem: cfg, paradas, prog: { dias: [] }, trechos: new Map(), viagemId: 'draft-trip',
    modoViagem: true, viagemSheet: false, calculandoRota: false, provedorRota: null, escolhendoOrigem: false,
    salvandoViagem: false, viagemSalvaEm: null, gerandoPdf: false, viagemStatus: 'rascunho', carregandoViagem: false, carregarId: null,
    PainelViagem: () => createElement('div', { 'data-draft': 'preserved' }),
  }
  let desktop: ts.JsxElement | undefined, mobile: ts.JsxElement | undefined, notice: ts.JsxSelfClosingElement | undefined, planner: ts.JsxSelfClosingElement | undefined
  function visit(n: ts.Node) {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'p' && n.getText(ast).includes('clientes no mapa')) desktop = n
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'span' && n.getText(ast).includes('registros de visita`')) mobile = n
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'QueryNotice' && n.getText(ast).includes('error={erroFontesMapa}')) notice = n
    if (!planner && ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'PainelViagem') planner = n
    ts.forEachChild(n, visit)
  }
  visit(page)
  assert.ok(desktop && mobile && planner)
  // These are the real SDK result destructuring and presentation declarations.
  const queryStatements = page.body!.statements.filter(n => ts.isVariableStatement(n) &&
    /use(?:Visitas|OrcamentosMapa|EtiquetasMapa|MapaMarcacoes)\(\)/.test(n.getText(ast)))
  const displayNames = new Set(['fontesMapa', 'erroFontesMapa', 'carregandoFontesMapa', 'leituraMapaConfirmada', 'contagemClientesMapa', 'contagemVisitasMapa'])
  const displayStatements = page.body!.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => displayNames.has(d.name.getText(ast))))
  for (const attribute of planner.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      const expression = attribute.initializer.expression
      if (ts.isIdentifier(expression) && !(expression.text in context)) context[expression.text] = () => {}
    }
  }
  const js = ts.transpileModule(queryStatements.concat(displayStatements).map(n => n.getText(ast)).join('\n')
    + `\nconst desktop = ${desktop.getText(ast)}; const mobile = ${mobile.getText(ast)};`
    + `\nconst notice = ${notice?.getText(ast) ?? 'null'}; const planner = ${planner.getText(ast)};`
    + '\n({ desktop, mobile, notice, planner });', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const result = vm.runInNewContext(js, context) as { desktop: ReactElement; mobile: ReactElement; notice: ReactElement<{ onRetry(): Promise<unknown> }> | null; planner: ReactElement<{ cfg: unknown; paradas: unknown; viagemId: string }> }
  return { ...result, retries: () => retries, cfg, paradas, plannerNode: planner, noticeNode: notice }
}

test('failed map layers show a shared retry notice and unknown counts while preserving the cached trip editor', async () => {
  const v = view({ error: new Error('synthetic 503'), cached: true })
  const html = renderToStaticMarkup(createElement(Fragment, {}, v.desktop, v.mobile, v.notice))
  assert.match(html, /role="alert"/)
  assert.match(html, /Tentar novamente/)
  assert.doesNotMatch(html, /0 clientes|0 registros de visita/)
  assert.equal(v.planner.props.cfg, v.cfg)
  assert.equal(v.planner.props.paradas, v.paradas)
  assert.equal(v.planner.props.viagemId, 'draft-trip')
  // A shared notice must be outside the desktop-only header, so phones see it too.
  for (let n: ts.Node | undefined = v.noticeNode; n && n !== page; n = n.parent) {
    if (ts.isJsxElement(n)) assert.doesNotMatch(n.openingElement.getText(ast), /["'\s]hidden md:|md:hidden/)
  }
  // Source failures do not replace the page with an early-return error screen.
  assert.equal(page.body!.statements.filter(ts.isReturnStatement).length, 1)
  await v.notice!.props.onRetry()
  assert.equal(v.retries(), 4)
})

test('healthy empty map layers show confirmed zero counts, while initial pending layers remain unknown', () => {
  const healthy = view()
  const html = renderToStaticMarkup(createElement(Fragment, {}, healthy.desktop, healthy.mobile, healthy.notice))
  assert.match(html, /0 clientes no mapa/)
  assert.match(html, /0 registros de visita no mapa/)
  assert.doesNotMatch(html, /role="alert"/)
  const pending = view({ pending: true })
  const loadingHtml = renderToStaticMarkup(createElement(Fragment, {}, pending.desktop, pending.mobile))
  assert.doesNotMatch(loadingHtml, /0 clientes|0 registros de visita/)
})
