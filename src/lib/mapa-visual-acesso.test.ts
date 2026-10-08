import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement, Fragment, type ReactElement } from 'react'
import { exigirAprovado, perfilAprovado } from '../../api/_lib/exigir-aprovado.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rotaCatalogo } from './catalogo-acesso'

type Element = ReactElement<Record<string, any>>
function extract(file: string, names: string[]) {
  const path = new URL(file, import.meta.url)
  const ast = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ''))
  assert.equal(nodes.length, names.length)
  return { ast, nodes, js: ts.transpileModule(nodes.map(node => node.getText(ast).replace(/^export (default )?/, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText }
}
const app = extract('../App.tsx', ['AppRoutes'])
const permissions = extract('../hooks/usePermissions.ts', ['useCan', 'useCatalogoPermissions'])

function routesFixture(pathname: string, options: { role?: string; approved?: boolean; loading?: boolean; profileError?: boolean; profileMissing?: boolean; profileId?: string; session?: boolean; geoDenied?: boolean; blocked?: boolean } = {}) {
  const role = options.role ?? 'mapa_visual'
  const calls: string[] = []
  const context: Record<string, any> = {
    React: { createElement, Fragment }, window: { location: { hostname: 'synthetic.invalid' } }, PORTAL_HOSTS: new Set(),
    useAuth: () => ({ session: options.session === false ? null : { user: { id: 'u1' } }, profile: options.profileError || options.profileMissing ? null : { id: options.profileId ?? 'u1', role, approved_at: options.approved === false ? null : 'approved' }, loading: !!options.loading, profileError: !!options.profileError }),
    useCan: () => () => true,
    useProducaoEspelhoPermissions: () => ({ override: true, loading: true, error: true }),
    useCatalogoPermissions: () => ({ permitido: true, loading: true, error: true }),
    useLocation: () => ({ pathname, search: '?modo=vendidos' }),
    useLocalizacaoObrigatoria: () => ({ exigida: !!options.geoDenied, estado: options.geoDenied ? 'denied' : 'ok', coords: null }),
    useTrilhaAcesso: () => ({ bloqueado: !!options.blocked }),
    decidirRotaProducaoFabrica: (path: string) => { calls.push('fabrica'); return path === '/controle/producao/fabrica' ? 'allow' : 'unrelated' },
    rotaCatalogo, rotaPedidosVendedorPermitida: () => false,
  }
  // Componentes JSX são placeholders; executamos os branches reais de AppRoutes.
  function tags(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[A-Z]/.test(node.tagName.getText(app.ast))) context[node.tagName.getText(app.ast)] = node.tagName.getText(app.ast)
    ts.forEachChild(node, tags)
  }
  app.nodes.forEach(tags)
  const component = vm.runInNewContext(app.js + '\nAppRoutes', context)
  return { calls, tree: component() as Element }
}

test('papel exclusivo redireciona toda rota privada antes das exceções de catálogo/fábrica', () => {
  for (const path of ['/', '/login', '/dashboard', '/mapa-visitas', '/mapa-representantes', '/minhas-visitas', '/perfil', '/controle/financeiro', '/controle/producao/fabrica', '/orcamentos/catalogo-admin', '/desconhecida', '/mapa-visual/extra']) {
    const f = routesFixture(path)
    assert.equal(f.tree.type, 'Navigate', path)
    assert.equal(f.tree.props.to, '/mapa-visual', path)
    assert.equal(f.tree.props.replace, true)
    assert.deepEqual(f.calls, [], path)
  }
})

test('sessão aprovada do papel exclusivo redireciona também rotas públicas', () => {
  for (const path of ['/sso', '/seja-representante', '/monte-sua-fabrica']) {
    const f = routesFixture(path)
    assert.equal(f.tree.type, 'Navigate', path)
    assert.equal(f.tree.props.to, '/mapa-visual', path)
    assert.equal(f.tree.props.replace, true)
    assert.deepEqual(f.calls, [])
  }
})

test('guarda antecipada não confunde loading, sessão/perfil ausentes, UID divergente ou sem aprovação', () => {
  for (const options of [
    { loading: true }, { session: false }, { profileMissing: true }, { profileError: true },
    { profileId: 'other' }, { approved: false }, { role: 'pending' }, { role: 'admin' }, { role: 'vendor' },
  ]) assert.equal(routesFixture('/sso', options).tree.type, 'SsoLanding', JSON.stringify(options))
})

test('mapa exclusivo mantém aprovação, erro de perfil, loading, GPS e horário', () => {
  for (const [options, type] of [
    [{ approved: false }, 'PendenteOuTransportadora'], [{ profileError: true }, 'ProfileLoadError'], [{ loading: true }, 'PageLoading'],
    [{ geoDenied: true }, 'LocalizacaoObrigatoria'], [{ blocked: true }, 'AcessoBloqueado'],
  ] as const) assert.equal(routesFixture('/mapa-visual', options).tree.type, type)
  assert.equal(routesFixture('/mapa-visual').tree.type, 'Routes')
})

test('papéis existentes mantêm mapa visual e suas guardas anteriores', () => {
  for (const role of ['admin', 'vendor', 'mapa', 'representante']) {
    assert.equal(routesFixture('/mapa-visual', { role }).tree.type, 'Routes', role)
    assert.equal(routesFixture('/mapa-visitas', { role }).tree.type, 'Routes', role)
  }
  assert.equal(routesFixture('/dashboard', { role: 'consultor' }).tree.props.to, '/producao-propria')
})

test('catálogo e can negam papel exclusivo mesmo com row/override true e não consultam override', () => {
  let role = 'mapa_visual'
  const queries: any[] = []
  const context = {
    useAuth: () => ({ session: { user: { id: 'u1' } }, profile: { id: 'u1', role, approved_at: 'approved' }, loading: false, profileError: false }),
    useRolePermissions: () => ({ data: [{ role, permissions: { 'catalogo.editar': true, 'menu.dashboard': true } }], isPending: false, isError: false }),
    useQuery: (options: any) => { queries.push(options); return { data: { userId: 'u1', permitido: true }, isPending: false, isError: false } },
    useProducaoEspelhoPermissions: () => ({}), CHAVE_CATALOGO: 'catalogo.editar', CHAVE_NOVO_PEDIDO: 'menu.novo_pedido', FALLBACK: {},
    permissaoCatalogo: (approved: boolean, ready: boolean, legacy: boolean, override?: boolean) => approved && ready && (override ?? legacy),
    canComExcecaoFabrica: (_key: string, _factory: unknown, legacy: () => boolean) => legacy(), permissaoNovoPedido: () => true,
  }
  const functions = vm.runInNewContext(permissions.js + '\n({useCan,useCatalogoPermissions})', context)
  assert.equal(functions.useCatalogoPermissions().permitido, false)
  assert.equal(queries[0].enabled, false)
  const can = functions.useCan()
  for (const key of ['catalogo.editar', 'menu.dashboard', 'menu.novo_pedido', 'menu.producao_fabrica']) assert.equal(can(key), false)
  role = 'vendor'
  assert.equal(functions.useCatalogoPermissions().permitido, true)
  assert.equal(functions.useCan()('menu.dashboard'), true)
})

test('API CRM nega papel exclusivo depois do lookup, mantendo aprovação e legados', async () => {
  for (const role of ['mapa_visual', 'admin', 'vendor', 'mapa', 'representante', 'consultor', 'financeiro']) {
    const reads: string[] = []
    const profile = { role, approved_at: 'approved', vendor_id: null }
    const supa = { auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) }, from: (table: string) => {
      reads.push(table)
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: profile, error: null }) }
      return q
    } } as unknown as SupabaseClient
    assert.equal(perfilAprovado(profile), true)
    const result = await exigirAprovado(supa, 'synthetic')
    if (role === 'mapa_visual') assert.deepEqual(result, { ok: false, status: 403, error: 'sem_permissao' })
    else assert.equal(result.ok, true, role)
    assert.deepEqual(reads, ['user_profiles'])
  }
})

function serviceFixture(role: string) {
  const reads: string[] = []
  const crm = { auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) }, from: (table: string) => {
    reads.push(table)
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'user_profiles'
      ? { role, approved_at: 'approved', vendor_id: 'v1', display_name: 'Synthetic' } : { name: 'SYNTHETIC' }, error: null }) }
    return q
  } }
  return { crm, reads }
}

test('gate financeiro rejeita papel exclusivo mesmo com vínculo vendedor válido; preserva escopos legados', async () => {
  const { js } = extract('../../api/_lib/financeiro-core.ts', ['resolverEscopo'])
  for (const role of ['mapa_visual', 'admin', 'financeiro', 'vendor', 'mapa', 'representante']) {
    const f = serviceFixture(role)
    const resolver = vm.runInNewContext(js + '\nresolverEscopo', {
      CRM_URL: 'https://synthetic.invalid', CRM_SVC: 'synthetic', createClient: () => f.crm, PAPEIS_GESTORES: new Set(['admin', 'financeiro']),
    })
    const result = await resolver('Bearer synthetic')
    if (role === 'mapa_visual') {
      assert.equal(result.status, 403)
      assert.equal(result.error, 'sem_permissao')
      assert.deepEqual(f.reads, ['user_profiles'])
    } else {
      assert.equal(result.role, role)
      assert.equal(result.vendedores === null, ['admin', 'financeiro'].includes(role))
    }
  }
})

test('handler real de criação nega papel exclusivo antes de corpo/controle; legados continuam validados', async () => {
  const { js } = extract('../../api/controle-criar-pedido.ts', ['handler'])
  for (const role of ['mapa_visual', 'admin', 'vendor', 'mapa']) {
    const f = serviceFixture(role)
    let status = 0
    let body: any
    let clients = 0
    const res = { status(code: number) { status = code; return res }, json(value: unknown) { body = value; return res }, setHeader() {} }
    const handler = vm.runInNewContext(js + '\nhandler', {
      CRM_URL: 'https://synthetic.invalid', CRM_SVC: 'synthetic', createClient: () => { clients++; return f.crm },
    })
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: {} }, res)
    assert.equal(status, role === 'mapa_visual' ? 403 : 400, role)
    if (role === 'mapa_visual') assert.equal(body.error, 'sem_permissao')
    assert.equal(clients, 1)
    assert.deepEqual(f.reads, ['user_profiles'])
  }
})
