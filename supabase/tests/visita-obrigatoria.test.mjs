// Somente Postgres descartável e handler local; não usa credenciais nem rede.
// node supabase/tests/visita-obrigatoria.test.mjs [caminho/node_modules]
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const runtime = process.argv[2]
const { PGlite } = await import(runtime
  ? pathToFileURL(resolve(runtime, '@electric-sql/pglite/dist/index.js')).href
  : '@electric-sql/pglite')
const db = new PGlite()
let handler

// Adaptador de transporte: executa o upsert real no Postgres em memória, incluindo
// defaults, constraints e triggers. O handler continua sendo a fonte de produção.
class Query {
  constructor() { this.operation = 'read'; this.columns = '*'; this.filters = [] }
  select(columns = '*') { this.columns = columns; return this }
  eq(column, value) { this.filters.push([column, value]); return this }
  upsert(row) { this.operation = 'upsert'; this.row = row; return this }
  delete() { this.operation = 'delete'; return this }
  then(resolve, reject) { return this.execute().then(resolve, reject) }
  async maybeSingle() {
    const result = await this.execute()
    return { ...result, data: result.data?.[0] ?? null }
  }
  async execute() {
    try {
      const params = this.filters.map(([, value]) => value)
      const where = this.filters.length
        ? ' where ' + this.filters.map(([column], i) => `${column}=$${i + 1}`).join(' and ')
        : ''
      let result
      if (this.operation === 'upsert') {
        const keys = Object.keys(this.row)
        result = await db.query(`insert into cliente_dados_visita(${keys.join(',')})
          values(${keys.map((_, i) => '$' + (i + 1)).join(',')})
          on conflict(telefone) do update set ${keys.filter(k => k !== 'telefone').map(k => `${k}=excluded.${k}`).join(',')}
          returning *`, keys.map(k => this.row[k]))
      } else if (this.operation === 'delete') {
        result = await db.query('delete from cliente_dados_visita' + where + ' returning *', params)
      } else {
        result = await db.query('select ' + this.columns + ' from cliente_dados_visita' + where, params)
      }
      return { data: result.rows, error: null }
    } catch (error) { return { data: null, error: { message: error.message } } }
  }
}

before(async () => {
  await db.exec(`create schema private;
    create table cliente_dados_visita(
      id uuid primary key default gen_random_uuid(), telefone text not null unique,
      nome text, cidade text, estado text, interesse text, vendedor_nome text,
      etiquetas text[], lat double precision, lng double precision,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      valor_negociando numeric, visitar boolean not null default true, qualificacao jsonb);
    insert into cliente_dados_visita(telefone,nome,visitar) values
      ('11999990001','Pode antigo',true),('11999990002','Sem permissão antigo',false);`)
  const migrationDir = new URL('../migrations/', import.meta.url)
  const migration = readdirSync(migrationDir).find(n => n.endsWith('_cliente_visita_obrigatoria.sql'))
  assert.ok(migration, 'migration gerada pela CLI deve existir')
  await db.exec(readFileSync(new URL(migration, migrationDir), 'utf8'))
  const source = readFileSync(new URL('../functions/cliente-dados/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '')
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(script, {
    Deno: { env: { get: key => key === 'WA_SYNC_SHARED_SECRET' ? 'local-test-only' : 'local' }, serve: fn => { handler = fn } },
    createClient: () => ({ from: table => {
      assert.equal(table, 'cliente_dados_visita')
      return new Query()
    } }), Request, Response, URL, TextEncoder,
  })
})
after(async () => { await db.close() })

async function flags(telefone) {
  const { rows } = await db.query('select * from cliente_dados_visita where telefone=$1', [telefone])
  return { visitar: rows[0].visitar, visita_obrigatoria: rows[0].visita_obrigatoria }
}
async function request(method, payload, search = '') {
  const response = await handler(new Request('https://local.test/cliente-dados' + search, {
    method, headers: { authorization: 'Bearer local-test-only', 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }))
  return { status: response.status, data: await response.json() }
}

test('existing rows preserve Pode visitar and start with obrigatório=false', async () => {
  assert.deepEqual(await flags('11999990001'), { visitar: true, visita_obrigatoria: false })
  assert.deepEqual(await flags('11999990002'), { visitar: false, visita_obrigatoria: false })
})
test('database marking obrigatório promotes Pode visitar', async () => {
  await db.query('update cliente_dados_visita set visita_obrigatoria=true where telefone=$1', ['11999990002'])
  assert.deepEqual(await flags('11999990002'), { visitar: true, visita_obrigatoria: true })
})
test('legacy database unmarking Pode visitar clears obrigatório', async () => {
  await db.query('update cliente_dados_visita set visitar=false where telefone=$1', ['11999990002'])
  assert.deepEqual(await flags('11999990002'), { visitar: false, visita_obrigatoria: false })
})
test('database insert normalizes contradictory false Pode visitar', async () => {
  await db.exec("insert into cliente_dados_visita(telefone,visitar,visita_obrigatoria) values ('11999990003',false,true)")
  assert.deepEqual(await flags('11999990003'), { visitar: false, visita_obrigatoria: false })
})
test('CHECK blocks inconsistent flags even with normalization trigger disabled', async () => {
  await db.exec('begin; alter table cliente_dados_visita disable trigger cliente_dados_visita_normalizar;')
  try {
    await assert.rejects(db.exec("insert into cliente_dados_visita(telefone,visitar,visita_obrigatoria) values ('11999990009',false,true)"), { code: '23514' })
  } finally { await db.exec('rollback') }
})
test('POST marks obrigatório and promotes an existing false Pode visitar', async () => {
  const response = await request('POST', { telefone: '11999990003', visita_obrigatoria: true })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990003'), { visitar: true, visita_obrigatoria: true })
})
test('unrelated POST preserves both flags and existing customer data', async () => {
  await request('POST', { telefone: '11999990003', nome: 'Nome preservado', cidade: 'Curitiba', estado: 'PR' })
  const response = await request('POST', { telefone: '11999990003', interesse: 'Misturador' })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990003'), { visitar: true, visita_obrigatoria: true })
  assert.equal(response.data.dados.nome, 'Nome preservado')
  assert.equal(response.data.dados.cidade, 'Curitiba')
})
test('legacy POST unmarking Pode visitar clears omitted obrigatório', async () => {
  const response = await request('POST', { telefone: '11999990003', visitar: false })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990003'), { visitar: false, visita_obrigatoria: false })
})
test('explicit false Pode visitar wins contradictory mandatory POST', async () => {
  const response = await request('POST', { telefone: '11999990003', visitar: false, visita_obrigatoria: true })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990003'), { visitar: false, visita_obrigatoria: false })
})
test('unmarking only obrigatório preserves Pode visitar', async () => {
  await request('POST', { telefone: '11999990003', visita_obrigatoria: true })
  const response = await request('POST', { telefone: '11999990003', visita_obrigatoria: false })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990003'), { visitar: true, visita_obrigatoria: false })
})
test('legacy POST insertion keeps existing defaults', async () => {
  const response = await request('POST', { telefone: '11999990004', nome: 'Novo legado' })
  assert.equal(response.status, 200)
  assert.deepEqual(await flags('11999990004'), { visitar: true, visita_obrigatoria: false })
})
test('POST rejects nonboolean mandatory without changing flags', async () => {
  for (const visita_obrigatoria of ['true', 1, null]) {
    const response = await request('POST', { telefone: '11999990004', visita_obrigatoria })
    assert.equal(response.status, 400)
    assert.deepEqual(await flags('11999990004'), { visitar: true, visita_obrigatoria: false })
  }
})
test('GET all and GET phone return the new flag without changing the allowed filter', async () => {
  await request('POST', { telefone: '11999990004', visita_obrigatoria: true })
  const all = await request('GET', undefined, '?all=1&visitar=1')
  assert.equal(all.status, 200)
  assert.equal(all.data.lista.find(c => c.telefone === '11999990004').visita_obrigatoria, true)
  assert.ok(all.data.lista.every(c => c.visitar === true))
  const single = await request('GET', undefined, '?telefone=11999990004')
  assert.equal(single.data.dados.visita_obrigatoria, true)
})
test('missing bearer authorization still rejects the request', async () => {
  const response = await handler(new Request('https://local.test/cliente-dados?all=1'))
  assert.equal(response.status, 401)
})
