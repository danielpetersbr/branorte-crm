import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createElement, Fragment, type ReactElement } from 'react'
import ts from 'typescript'
import { cn } from '../../lib/utils'
import { isNavigationItemActive } from './navigation-active'

type Element = ReactElement<Record<string, any>>

function load(file: string, names: string[], context: Record<string, unknown>) {
  const path = new URL(file, import.meta.url)
  assert.ok(existsSync(path), `Componente acessível ausente: ${file}`)
  const text = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations: string[] = []
  const icons: Record<string, unknown> = {}
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      declarations.push(node.getText(ast).replace(/^export /, ''))
    }
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
      declarations.push(`const ${node.getText(ast)};`)
    }
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.getText(ast) === "'lucide-react'") {
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        bindings.elements.forEach(icon => { icons[icon.name.text] = () => null })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const js = ts.transpileModule(`${declarations.join('\n')}\n({${names.join(',')}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  return vm.runInNewContext(js, { React: { createElement, Fragment }, cn, ...icons, ...context })
}

function elements(tree: unknown, predicate: (el: Element) => boolean): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate))
  if (!tree || typeof tree !== 'object' || !('type' in tree) || !('props' in tree)) return []
  const el = tree as Element
  return [...(predicate(el) ? [el] : []), ...elements(el.props.children, predicate)]
}

function label(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(label).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? label((tree as Element).props.children) : ''
}

function layout(role = 'admin', allowed: (key: string) => boolean = () => true) {
  const state: unknown[] = []
  const effects: Array<{ fn: () => void | (() => void); deps: unknown[] }> = []
  let resize: (() => void) | undefined
  const viewport = { matches: false, addEventListener(_name: string, fn: () => void) { resize = fn }, removeEventListener() { resize = undefined } }
  let cursor = 0
  const NavLink = () => null, ModalDialog = () => null
  const { Layout } = load('./Layout.tsx', ['MENUS_RESTRITOS', 'NAV_SECTIONS', 'NAV_GROUPS', 'MOBILE_NAV', 'fmtCount', 'Layout'], {
    NavLink, ModalDialog, Outlet: () => null, Suspense: () => null, ErrorBoundary: () => null,
    RoadmapFAB: () => null, GenerationOverlay: () => null, LembretesNotifier: () => null, PageLoading: () => null,
    isNavigationItemActive, useLocation: () => ({ pathname: '/', search: '' }),
    useAuth: () => ({ profile: { id: 'qa-local', role, email: 'qa@example.invalid', approved_at: '2026-10-03' }, signOut() {} }),
    useCan: () => allowed, useAtendimentosTotalMenu: () => ({ data: 0 }),
    useDarkMode: () => [false, () => {}], useCollapsed: () => [false, () => {}], useAiDrawerOpen: () => false,
    useOpenGroups: () => [new Proxy({}, { get: () => true }), () => {}, () => {}],
    window: { matchMedia: () => viewport },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { effects.push({ fn, deps }) }, useRef: (current: unknown) => ({ current }),
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
  })
  const render = () => { cursor = 0; effects.length = 0; return Layout() }
  const open = () => {
    const trigger = elements(render(), el => el.type === 'button' && label(el.props.children) === 'Mais')[0]
    assert.ok(trigger, 'o celular precisa de um caminho para o menu completo')
    trigger.props.onClick()
    const dialog = elements(render(), el => el.type === ModalDialog)[0]
    assert.ok(dialog, 'Mais abre um diálogo navegável')
    return dialog
  }
  return { render, open, NavLink, ModalDialog, effects, viewport, resize: () => resize?.() }
}

test('Mais permite alcançar mapa, novo pedido, produção e agenda pelo mesmo menu autorizado', () => {
  const f = layout()
  const dialog = f.open()
  const links = elements(dialog, el => el.type === f.NavLink)
  for (const to of ['/mapa-visitas', '/controle/novo-pedido', '/controle/producao/fabrica', '/agenda']) {
    assert.ok(links.some(link => link.props.to === to), `destino alcançável: ${to}`)
  }
  const pedido = links.find(link => link.props.to === '/controle/novo-pedido')!
  pedido.props.onClick()
  assert.equal(elements(f.render(), el => el.type === f.ModalDialog).length, 0, 'navegar fecha o menu')
})

test('Mais respeita permissão negada, adminOnly e roles sem esconder destinos permitidos', () => {
  const f = layout('vendor', key => !['menu.producao_fabrica', 'menu.novo_pedido', 'menu.admin_usuarios', 'menu.admin_permissoes'].includes(key))
  const links = elements(f.open(), el => el.type === f.NavLink)
  const destinos = links.map(link => link.props.to)
  assert.ok(destinos.includes('/mapa-visitas'))
  assert.ok(destinos.includes('/agenda'))
  assert.ok(!destinos.includes('/controle/producao/fabrica'))
  assert.ok(!destinos.includes('/controle/novo-pedido'))
  assert.ok(!destinos.includes('/admin/usuarios'))
  assert.ok(!destinos.includes('/admin/permissoes'))
  assert.ok(!destinos.includes('/mapa-representantes'), 'adminOnly permanece restrito mesmo com can=true')
  const marketing = layout('marketing')
  const destinosMarketing = elements(marketing.open(), el => el.type === marketing.NavLink).map(link => link.props.to)
  assert.ok(destinosMarketing.includes('/mapa-visitas'))
  assert.ok(!destinosMarketing.includes('/whatsapp'), 'roles permanece restrito mesmo com can=true')
})

test('contas externas mantêm seu menu restrito sem montar Mais do CRM', () => {
  for (const role of ['mapa', 'representante', 'consultor']) {
    const f = layout(role)
    const tree = f.render()
    assert.equal(elements(tree, el => el.type === 'button' && label(el.props.children) === 'Mais').length, 0)
    assert.ok(elements(tree, el => el.type === f.NavLink && el.props.to === '/producao-propria').length > 0)
  }
})

test('menu Mais usa IDs de painéis diferentes do menu desktop', () => {
  const f = layout()
  f.open()
  const panels = elements(f.render(), el => typeof el.props.id === 'string')
  const ids = panels.map(el => el.props.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('redimensionar o menu aberto para desktop fecha o diálogo e remove o listener', () => {
  const f = layout()
  f.open()
  const effect = f.effects.find(effect => effect.deps.length === 1 && effect.deps[0] === true)
  assert.ok(effect)
  const cleanup = effect.fn() as () => void
  f.viewport.matches = true
  f.resize()
  assert.equal(elements(f.render(), el => el.type === f.ModalDialog).length, 0)
  cleanup()
  f.viewport.matches = false
  f.resize()
  assert.equal(elements(f.render(), el => el.type === f.ModalDialog).length, 0)
})

function agenda(name: 'FormModal' | 'DrawerDia') {
  const ModalDialog = () => null
  const { [name]: render } = load('../../pages/Agenda.tsx', [name], {
    ModalDialog, Input: () => null, Toggle: () => null, inputCls: '', TIPOS: ['tarefa'], TIPO_META: { tarefa: { Icon: () => null, label: 'Tarefa', tone: '' } },
    parseLocalDateTime: () => new Date(2026, 9, 3), LinhaItem: () => null,
  })
  return { render, ModalDialog }
}

test('Agenda abre formulário modal com foco inicial no título e bloqueia cancelamento ao gravar', () => {
  const f = agenda('FormModal')
  const form = { titulo: 'Rascunho', descricao: '', tipo: 'tarefa', data: '2026-10-03', hora: '', lembrete_min: 0 }
  for (const salvando of [false, true]) {
    const tree = f.render({ form, setForm() {}, onSalvar() {}, onExcluir() {}, onFechar() {}, salvando, excluindo: false })
    assert.equal(tree.type, f.ModalDialog, 'a agenda deve usar abertura modal real')
    assert.equal(tree.props.locked, salvando)
    assert.ok(elements(tree, el => el.props['data-dialog-initial-focus'] !== undefined).length > 0)
  }
})

test('detalhes do dia são um diálogo com botão Fechar nomeado', () => {
  const f = agenda('DrawerDia')
  const tree = f.render({ diaKey: '2026-10-03', itens: [], onFechar() {}, onEditar() {}, onNovo() {}, onToggle() {} })
  assert.equal(tree.type, f.ModalDialog)
  assert.ok(tree.props.label.includes('Dia'))
  assert.ok(elements(tree, el => el.type === 'button' && /Fechar/.test(el.props['aria-label'] ?? '')).length > 0)
})

test('falha de salvar ou excluir fica dentro do diálogo inerte, preserva draft e limpa ao tentar de novo', () => {
  const f = agenda('FormModal')
  let erroForm: string | null = null, fechamentos = 0
  const options = load('../../pages/Agenda.tsx', ['salvar', 'excluir'], {
    useMutation: (options: unknown) => options,
    setErroForm: (value: string | null) => { erroForm = value }, setForm: () => { fechamentos++ }, push() {}, invalidar() {},
  })
  for (const acao of ['salvar', 'excluir']) {
    options[acao].onError(new Error('offline'))
    assert.match(erroForm!, /Tente novamente/i)
    assert.equal(fechamentos, 0)
    const tree = f.render({ form: { titulo: 'Rascunho', tipo: 'tarefa' }, erro: erroForm, setForm() {}, onSalvar() {}, onExcluir() {}, onFechar() {}, salvando: false, excluindo: false })
    assert.ok(elements(tree, el => el.props.role === 'alert').some(el => label(el.props.children).includes('offline')))
    options[acao].onMutate()
    assert.equal(erroForm, null)
  }
})

test('falha de concluir item também fica acessível dentro dos detalhes do dia', () => {
  const f = agenda('DrawerDia')
  const tree = f.render({ diaKey: '2026-10-03', itens: [], erro: 'Falha ao atualizar. Tente novamente.', onFechar() {}, onEditar() {}, onNovo() {}, onToggle() {} })
  assert.ok(elements(tree, el => el.props.role === 'alert').length > 0)
})

function dialog(locked: boolean) {
  let opened = 0, closed = 0, restored = 0, focused = 0, dismissals = 0
  let effect: (() => void | (() => void)) | undefined
  const node = {
    open: false,
    showModal() { opened++; this.open = true }, close() { closed++; this.open = false },
    querySelector: () => ({ focus() { focused++ } }),
  }
  const { ModalDialog } = load('./ModalDialog.tsx', ['ModalDialog'], {
    useRef: () => ({ current: node }), useEffect: (fn: typeof effect) => { effect = fn },
    document: { activeElement: { isConnected: true, focus() { restored++ } } },
  })
  const tree = ModalDialog({ label: 'Teste', locked, onClose() { dismissals++ }, children: null })
  return { tree, runEffect: () => effect!(), counts: () => ({ opened, closed, restored, focused, dismissals }) }
}

test('diálogo usa showModal, foca o alvo inicial e devolve foco ao fechar', () => {
  const f = dialog(false)
  assert.equal(f.tree.type, 'dialog')
  const cleanup = f.runEffect() as () => void
  assert.equal(f.counts().opened, 1)
  assert.equal(f.counts().focused, 1)
  cleanup()
  assert.equal(f.counts().closed, 1)
  assert.equal(f.counts().restored, 1)
})

test('Escape respeita gravação em andamento e sincroniza fechamento com React', () => {
  for (const locked of [false, true]) {
    const f = dialog(locked)
    let prevented = false
    f.tree.props.onCancel({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(f.counts().dismissals, locked ? 0 : 1)
  }
})

function password(error: unknown, rejected = false) {
  let currentError = error, calls = 0, changed = 0, pending = false
  let message: { ok: boolean; text: string } | null = null
  const clear: string[] = []
  const { changePwd } = load('../../pages/Perfil.tsx', ['changePwd'], {
    profile: { email: 'qa-local@example.invalid' }, oldPwd: 'atual-teste', newPwd: 'nova-senha-teste', confirmPwd: 'nova-senha-teste',
    setSavingPwd: (value: boolean) => { pending = value }, setPwdMsg: (value: typeof message) => { message = value },
    setOldPwd: () => { clear.push('atual') }, setNewPwd: () => { clear.push('nova') }, setConfirmPwd: () => { clear.push('confirmacao') },
    supabase: { auth: {
      async signInWithPassword() { calls++; if (rejected && currentError) throw currentError; return { error: currentError } },
      async updateUser() { changed++; return { error: null } },
    } },
  })
  return { run: () => changePwd({ preventDefault() {} }), retry: () => { currentError = null }, state: () => ({ message, pending, calls, changed, clear }) }
}

for (const error of [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, { status: 503, code: 'unexpected_failure', message: 'Unavailable' }]) {
  test(`falha ${error.status} ao confirmar senha orienta retry sem culpar senha nem limpar campos`, async () => {
    const f = password(error)
    await f.run()
    assert.ok(f.state().message?.text.match(/Tente novamente/i))
    assert.ok(!f.state().message?.text.match(/Senha atual incorreta/))
    assert.equal(f.state().pending, false)
    assert.equal(f.state().changed, 0)
    assert.deepEqual(f.state().clear, [])
    f.retry(); await f.run()
    assert.equal(f.state().changed, 1)
    assert.equal(f.state().message?.ok, true)
  })
}

test('credencial comprovadamente inválida ainda informa senha incorreta', async () => {
  const f = password({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })
  await f.run()
  assert.match(f.state().message!.text, /Senha atual incorreta/)
  assert.equal(f.state().changed, 0)
})

test('exceção de conexão libera o botão para tentar novamente e preserva os campos', async () => {
  const f = password(new TypeError('Failed to fetch'), true)
  await f.run()
  assert.equal(f.state().pending, false)
  assert.match(f.state().message!.text, /Tente novamente/i)
  assert.deepEqual(f.state().clear, [])
})
