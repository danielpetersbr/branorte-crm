import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { isNavigationItemActive } from '../components/layout/navigation-active'
import * as identidade from '../lib/projeto-3d-identidade'
import * as catalogSession from '../lib/catalogo3d-session'

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function run(source: string, values: Record<string, unknown>) {
  const js = ts.transpileModule(source.replace('const result =', 'var result ='), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText
  const context = vm.createContext({ React, exports: {}, ...values })
  vm.runInContext(js, context)
  return context
}

function routes() {
  const ast = parse('../App.tsx')
  const result: any[] = []
  const walk = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'Route') {
      const path = node.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'path') as ts.JsxAttribute | undefined
      if (path?.initializer && ts.isStringLiteral(path.initializer) && path.initializer.text.startsWith('/projeto-3d')) {
        result.push(run(`const result = ${node.getText(ast)}`, { Route: 'route', Projeto3D: 'projeto3d' }).result)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(ast)
  return result
}

function page(props = {}, initial: Record<string, unknown> = {}, auth: { session: any; profile: any } = { session: null, profile: { role: 'vendor', id: 'vendedor-1' } }) {
  const ast = parse('./Projeto3D.tsx')
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Projeto3D') as ts.FunctionDeclaration
  const names: string[] = []
  const refNames: string[] = []
  const icons: Record<string, unknown> = {}
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const name of statement.importClause.namedBindings.elements) icons[name.name.text] = 'icon'
    }
  }
  for (const statement of fn.body!.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isArrayBindingPattern(declaration.name) && declaration.initializer && ts.isCallExpression(declaration.initializer)
          && declaration.initializer.expression.getText(ast) === 'useState') names.push(declaration.name.elements[0].getText(ast))
      if (declaration.initializer && ts.isCallExpression(declaration.initializer)
          && declaration.initializer.expression.getText(ast) === 'useRef') refNames.push(declaration.name.getText(ast))
    }
  }
  const states = { ...initial }
  const messages: any[] = []
  const saves: any[] = []
  const saveCallbacks: any[] = []
  const cleanups: Array<() => void> = []
  let listener: (event: object) => void
  const contentWindow = { postMessage(message: any) {
    messages.push(message)
    if (message.type === 'branorte:new') queueMicrotask(() => listener({ origin: 'https://branorte-configurador-3d.vercel.app', source: contentWindow, data: { type: 'branorte:loaded', requestId: message.requestId, ok: true } }))
  } }
  const refs: any[] = []
  const namedRefs: Record<string, any> = {}
  let stateIndex = 0
  let refIndex = 0
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  const context = run(code, { ...icons, ...identidade, ...catalogSession,
    window: { setTimeout(fn: () => void, ms: number) { return setTimeout(fn, ms).unref() }, clearTimeout, addEventListener(_type: string, handler: typeof listener) { listener = handler }, removeEventListener() {} },
    useState(value: unknown) { const name = names[stateIndex++]; if (!(name in states)) states[name] = value; return [states[name], (next: unknown) => { states[name] = next }] },
    useRef(value: unknown) { const index = refIndex++; refs[index] ??= { current: index === 0 ? { contentWindow } : value }; namedRefs[refNames[index]] = refs[index]; return refs[index] },
    useEffect(effect: () => unknown) { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void) },
    useLayoutEffect(effect: () => void) { effect() }, useCallback: (fn: unknown) => fn,
    useAuth: () => auth, useQueryClient: () => ({}),
    useConfiguradorProjetos: () => ({}), useDeletarConfiguradorProjeto: () => ({}), useBuscarContatos: () => ({}),
    useSalvarConfiguradorProjeto: () => ({ isPending: false, mutate(input: unknown, callbacks: unknown) { saves.push(input); saveCallbacks.push(callbacks) } }),
  })
  const render = () => { stateIndex = 0; refIndex = 0; return context.exports.Projeto3D(props) }
  const receive = (data: unknown, origin = catalogSession.CONFIGURADOR_ORIGIN, source: unknown = contentWindow) => listener({ data, origin, source })
  return { render, states, messages, saves, saveCallbacks, refs: namedRefs, receive, unmount: () => cleanups.forEach(cleanup => cleanup()) }
}

function find(tree: any, match: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return null
  if (match(tree)) return tree
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = find(child, match)
    if (found) return found
  }
  return null
}

test('menu Layout 3D seleciona apenas Meus Layouts na sua rota e mantém a mesma permissão', () => {
  const ast = parse('../components/layout/Layout.tsx')
  const statement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === 'NAV_GROUPS')) as ts.VariableStatement
  const initializer = statement.declarationList.declarations[0].initializer!
  const iconNames = new Set<string>()
  const walk = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'icon') iconNames.add(node.initializer.getText(ast)); ts.forEachChild(node, walk) }
  walk(initializer)
  const groups = run(`const result = ${initializer.getText(ast)}`, Object.fromEntries([...iconNames].map(name => [name, 'icon']))).result
  const items = groups.find((group: any) => group.id === 'layout-3d').items
  assert.deepEqual(Array.from(items, (item: any) => item.label), ['Fazer Layout', 'Meus Layouts'])
  assert.deepEqual(Array.from(items.filter((item: any) => isNavigationItemActive(item.to, '/projeto-3d/meus', '', item.end)), (item: any) => item.label), ['Meus Layouts'])
  assert.equal(items.every((item: any) => item.permKey === 'menu.projeto_3d'), true)
})

test('rotas abrem iframe diretamente em criar ou meus e remontam a página ao trocar', () => {
  const definitions = routes()
  assert.equal(definitions.length, 2)
  const iframeUrls = definitions.map(route => {
    const view = page(route.props.element.props)
    return new URL(find(view.render(), element => element.type === 'iframe').props.src)
  })
  assert.equal(iframeUrls[0].searchParams.get('entry'), 'new')
  assert.equal(iframeUrls[1].searchParams.get('entry'), 'mine')
  assert.notEqual(definitions[0].props.element.key, definitions[1].props.element.key)
})

test('formulário parent rejeita cliente vazio antes de pedir criação', async () => {
  const view = page({}, { showLista: true, novoNomeAberto: true, novoNome: 'Galpão', novoClienteNome: '   ' })
  const form = find(view.render(), element => element.type === 'form')
  await form.props.onSubmit({ preventDefault() {} })
  assert.equal(view.messages.some(message => message.type === 'branorte:new'), false)
})

test('formulário parent transmite cliente e nome de projeto como campos distintos', async () => {
  const view = page({}, { showLista: true, novoNomeAberto: true, novoNome: '  Galpão  ', novoClienteNome: '  Maria Silva ' })
  const form = find(view.render(), element => element.type === 'form')
  form.props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  const message = view.messages.find(message => message.type === 'branorte:new')
  assert.equal(message.name, 'Galpão')
  assert.equal(message.clientName, 'Maria Silva')
})

test('modal manual aceita cliente livre sem contato cadastrado e mantém cliente do JSON', () => {
  const view = page({}, { saveOpen: true, saveNome: 'Layout', saveContactNome: 'Maria', saveContactId: null })
  let tree = view.render()
  const input = find(tree, element => element.type === 'input' && element.props['aria-label'] === 'Nome do cliente')
  assert.ok(input)
  input.props.onChange({ target: { value: 'Cliente Livre' } })
  tree = view.render()
  view.refs.projetoDataRef.current = { id: 'layout-1', clientName: 'Maria' }
  const button = find(tree, element => element.type === 'button' && element.props.onClick?.name === 'confirmarSalvar')
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  assert.equal(view.saves[0].cliente_nome, 'Cliente Livre')
  assert.equal(view.saves[0].contact_id, null)
})

test('salvamento manual sincroniza metadados com identidade do JSON atual para o próximo autosave', () => {
  const view = page({}, { saveOpen: true, projetoId: 'row-anterior', saveNome: 'Novo nome', saveContactNome: 'Nova cliente' })
  const tree = view.render()
  view.refs.projetoDataRef.current = { id: 'layout-atual', name: 'Nome anterior', clientName: 'Cliente anterior', floors: [{ id: 'piso-original' }] }
  find(tree, element => element.type === 'button' && element.props.onClick?.name === 'confirmarSalvar').props.onClick()
  view.saveCallbacks[0].onSuccess({ id: 'row-atual', nome: 'Novo nome', cliente_nome: 'Nova cliente' })
  const message = view.messages.find(message => message.type === 'branorte:metadata')
  assert.ok(message)
  assert.equal(message.id, 'layout-atual')
  assert.equal(message.name, 'Novo nome')
  assert.equal(message.clientName, 'Nova cliente')
  assert.equal('project' in message, false)
  assert.equal(view.refs.projetoDataRef.current.floors[0].id, 'piso-original')
})

test('ponte usa a sessão atualizada, recusa outra conta e limpa o acesso ao sair', () => {
  const id = '9cf979c3-17cc-4aee-b692-ff9d1eea5540'
  const auth = { session: { user: { id }, access_token: 'first-token', expires_at: Math.floor(Date.now() / 1000) + 60 } as any, profile: { id, role: 'admin', approved_at: '2026-10-01T00:00:00Z' } }
  const view = page({}, {}, auth)
  const iframeUrl = () => new URL(find(view.render(), element => element.type === 'iframe').props.src)
  const request = { type: 'branorte:catalog:session', requestId: 'current-session' }
  assert.equal(iframeUrl().searchParams.get('adm'), '1')
  view.receive(request)
  assert.equal(view.messages.at(-1).accessToken, 'first-token')

  auth.session = { ...auth.session, access_token: 'renewed-token' }
  view.render()
  assert.equal(view.messages.at(-1).type, 'branorte:catalog:changed')
  view.receive(request)
  assert.equal(view.messages.at(-1).accessToken, 'renewed-token')

  const messageCount = view.messages.length
  view.receive(request, 'https://evil.example')
  view.receive(request, catalogSession.CONFIGURADOR_ORIGIN, {})
  assert.equal(view.messages.length, messageCount)

  auth.session = { ...auth.session, user: { id: 'another-admin' } }
  auth.profile = { ...auth.profile, id: 'another-admin' }
  assert.equal(iframeUrl().searchParams.get('adm'), '0')
  assert.equal(view.messages.at(-1).type, 'branorte:catalog:clear')
  view.receive(request)
  assert.equal(view.messages.at(-1).accessToken, null)

  auth.session = null
  view.render()
  assert.equal(view.messages.at(-1).type, 'branorte:catalog:clear')
  view.receive(request)
  assert.equal(view.messages.at(-1).accessToken, null)
  view.unmount()
  assert.equal(view.messages.at(-1).type, 'branorte:catalog:clear')
  assert.equal('accessToken' in view.messages.at(-1), false)
})
