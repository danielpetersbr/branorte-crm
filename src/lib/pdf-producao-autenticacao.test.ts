import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function endpoint(context: Record<string, unknown>) {
  const source = readFileSync(new URL('../../api/pdf-to-docx-producao.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('endpoint.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handler')!
  const js = ts.transpileModule(declaration.getText(ast).replace('export default ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(`${js}\nhandler`, {
    Buffer, SECRET: 'synthetic', SUPA_URL: 'https://example.invalid', SVC_KEY: 'synthetic',
    createClient: () => ({}), console: { log() {}, error() {} }, ...context,
  })
}

for (const scenario of [
  { name: 'missing JWT', authorization: undefined, expected: 401, access: { ok: true } },
  { name: 'unapproved CRM account', authorization: 'Bearer synthetic', expected: 403, access: { ok: false, status: 403, error: 'not_approved' } },
  { name: 'failed approval lookup', authorization: 'Bearer synthetic', expected: 500, access: { ok: false, status: 500, error: 'profile_lookup_failed' } },
]) {
  test(`production PDF conversion rejects ${scenario.name} before any paid request`, async () => {
    let calls = 0, status = 0
    const handler = endpoint({
      exigirAprovado: async () => scenario.access,
      fetch: async () => { calls++; throw new Error('paid network must not run') },
    })
    const res = {
      setHeader() {}, status(code: number) { status = code; return res },
      json() { return res }, send() { return res }, end() {},
    }
    await handler({ method: 'POST', headers: { authorization: scenario.authorization }, body: { pdfBase64: 'x'.repeat(120) } }, res)
    assert.equal(status, scenario.expected)
    assert.equal(calls, 0)
  })
}

test('approved CRM vendor keeps access to production conversion with price scrubbing', async () => {
  let token = '', calls = 0, status = 0, sent: unknown
  const sanitized = Buffer.from('synthetic sanitized document')
  const handler = endpoint({
    exigirAprovado: async (_client: unknown, jwt: string) => { token = jwt; return { ok: true, usuario: { role: 'vendedor' } } },
    fetch: async () => { calls++; return { ok: true, json: async () => ({ Files: [{ FileData: Buffer.from('synthetic').toString('base64') }] }) } },
    scrubDocxPrices: async () => ({ out: sanitized, removed: 1, leaks: [] }),
  })
  const res = {
    setHeader() {}, status(code: number) { status = code; return res },
    json(body: unknown) { sent = body; return res }, send(body: unknown) { sent = body; return res }, end() {},
  }
  await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-vendor' }, body: { pdfBase64: 'x'.repeat(120) } }, res)
  assert.equal(token, 'synthetic-vendor')
  assert.equal(status, 200)
  assert.equal(calls, 1)
  assert.equal(sent, sanitized)
})

function caller(context: Record<string, unknown>) {
  const source = readFileSync(new URL('../components/pedido-venda/PedidoForm.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('PedidoForm.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const crmImport = ast.statements.find(node => ts.isImportDeclaration(node) && node.importClause?.namedBindings?.getText(ast).includes('crmSupabase')) as ts.ImportDeclaration
  assert.equal((crmImport.moduleSpecifier as ts.StringLiteral).text, '@/lib/supabase')
  let statement: ts.VariableStatement | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'resp' && d.getText(ast).includes('/api/pdf-to-docx-producao'))) statement = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(statement)
  const block = statement.parent as ts.Block
  const end = block.statements.indexOf(statement)
  const start = block.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'pdfBase64'))
  assert.ok(start >= 0 && end >= start)
  const js = ts.transpileModule(block.statements.slice(start, end + 1).map(n => n.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(`(async () => { ${js}\nreturn resp })`, {
    fileToBase64: async () => 'synthetic-pdf', file: { name: 'synthetic.pdf' }, ...context,
  })
}

test('order PDF fallback sends the current CRM JWT to the same-origin conversion endpoint', async () => {
  let called = false
  const run = caller({
    crmSupabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-crm-jwt' } }, error: null }) } },
    supabase: { auth: { getSession() { throw new Error('control session must not be used') } } },
    fetch: async (url: string, options: RequestInit) => {
      called = true
      assert.equal(url, '/api/pdf-to-docx-producao')
      assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer synthetic-crm-jwt')
      assert.equal(JSON.parse(String(options.body)).filename, 'synthetic.pdf')
      return { ok: true }
    },
  })
  await run()
  assert.equal(called, true)
})

test('order PDF fallback without a CRM session never calls the paid endpoint', async () => {
  let calls = 0
  const run = caller({
    crmSupabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
    fetch: async () => { calls++; return { ok: true } },
  })
  await assert.rejects(run(), /Sessão Branorte expirada/)
  assert.equal(calls, 0)
})
