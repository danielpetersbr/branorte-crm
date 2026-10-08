// Postgres descartável; usa a RPC e as migrations reais, sem conexão externa.
// node supabase/tests/mapa-visitas-obrigatoria.test.mjs [caminho/node_modules]
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.argv[2]
const { PGlite } = await import(runtime
  ? pathToFileURL(resolve(runtime, '@electric-sql/pglite/dist/index.js')).href
  : '@electric-sql/pglite')
const db = new PGlite()
const IDS = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003']

before(async () => {
  await db.exec(`create schema private;
    create role authenticated; create role anon; create role service_role bypassrls;
    create function public.papel_restrito() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.restrito',true),''),'false')::boolean $$;
    create function public.papel_mapa() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.mapa',true),''),'false')::boolean $$;
    create table public.cliente_dados_visita(
      id uuid primary key,telefone text,nome text,cidade text,estado text,interesse text,
      visitar boolean not null default true,vendedor_nome text,etiquetas text[],valor_negociando numeric,
      lat double precision,lng double precision,created_at timestamptz not null);
    alter table public.cliente_dados_visita enable row level security;
    grant select on public.cliente_dados_visita to authenticated,service_role;
    create policy cliente_dados_visita_read on public.cliente_dados_visita for select to authenticated using(true);
    create policy bloqueia_papel_restrito_leitura on public.cliente_dados_visita as restrictive
      for select to authenticated using((not public.papel_restrito()) or (visitar is true and public.papel_mapa()));
    -- O auxiliar privilegiado pode devolver mais IDs; a RPC invoker ainda precisa
    -- respeitar a RLS da tabela base e não deixar contatos invisíveis vazarem.
    create function public.mapa_conversoes()
      returns table(tipo text,chave text,vendido boolean,n_vendas integer,total numeric)
      language sql stable security definer set search_path='' as $$
      select 'visita'::text,id::text,(nome='Obrigatório'),case when nome='Obrigatório' then 2 else 0 end,valor_negociando
      from public.cliente_dados_visita $$;
    insert into public.cliente_dados_visita values
      ('${IDS[0]}','11999990001','Pode','Curitiba','PR','Misturador',true,'ANA',array['1'],100,-25,-49,'2026-10-01'),
      ('${IDS[1]}','11999990002','Obrigatório','Curitiba','PR','Fábrica',true,'ANA',array['2'],200,-25,-49,'2026-10-03'),
      ('${IDS[2]}','11999990003','Não pode','Curitiba','PR',null,false,'ANA',null,null,null,null,'2026-10-02');`)
  const migrations = new URL('../migrations/', import.meta.url)
  const schema = readdirSync(migrations).find(n => n.endsWith('_cliente_visita_obrigatoria.sql'))
  await db.exec(readFileSync(new URL(schema, migrations), 'utf8'))
  await db.query('update public.cliente_dados_visita set visita_obrigatoria=true where id=$1', [IDS[1]])
  const baseline = readFileSync(new URL('20261008115033_mapa_conversao_cliente.sql', migrations), 'utf8')
  const originalRpc = baseline.slice(baseline.indexOf('create or replace function public.mapa_visitas_clientes()'), baseline.indexOf('-- Atualiza as três bases'))
  await db.exec(originalRpc)
  const migration = readdirSync(migrations).find(n => n.endsWith('_mapa_visitas_obrigatoria.sql'))
  assert.ok(migration)
  await db.exec(readFileSync(new URL(migration, migrations), 'utf8'))
})
after(async () => { await db.close() })

async function asAuthenticated(restrito, mapa, query = 'select * from public.mapa_visitas_clientes()') {
  await db.exec(`set role authenticated; set test.restrito='${restrito}'; set test.mapa='${mapa}';`)
  try { return (await db.query(query)).rows } finally { await db.exec('reset role') }
}

test('RPC delivers separate mandatory flags and preserves the old fields and ordering', async () => {
  const rows = await asAuthenticated(false, false)
  assert.equal(rows.find(r => r.id === IDS[0]).visita_obrigatoria, false)
  assert.equal(rows.find(r => r.id === IDS[1]).visita_obrigatoria, true)
  assert.deepEqual(rows.map(r => r.id), [IDS[1], IDS[2], IDS[0]])
  assert.deepEqual(Object.keys(rows[0]), ['id','telefone','nome','cidade','estado','interesse','visitar',
    'vendedor_nome','etiquetas','valor_negociando','lat','lng','created_at','vendido','n_vendas','visita_obrigatoria'])
  assert.equal(rows[0].vendedor_nome, 'ANA')
  assert.equal(rows[0].vendido, true)
  assert.equal(rows[0].n_vendas, 2)
  assert.deepEqual(rows[0].etiquetas, ['2'])
  assert.equal(Number(rows[0].valor_negociando), 200)
})
test('approved restricted map access still sees only allowed visits, including mandatory ones', async () => {
  const rows = await asAuthenticated(true, true)
  assert.deepEqual(rows.map(r => r.id), [IDS[1], IDS[0]])
  assert.deepEqual(rows.map(r => r.visita_obrigatoria), [true, false])
})
test('restricted nonmap access still sees no visits', async () => {
  assert.deepEqual(await asAuthenticated(true, false), [])
})
test('legacy consumers selecting old fields remain compatible', async () => {
  const rows = await asAuthenticated(false, false, 'select id,visitar from public.mapa_visitas_clientes()')
  assert.deepEqual(rows[0], { id: IDS[1], visitar: true })
})
test('anonymous callers are denied execution and service_role retains access', async () => {
  await db.exec('set role anon')
  try { await assert.rejects(db.query('select * from public.mapa_visitas_clientes()'), { code: '42501' }) }
  finally { await db.exec('reset role') }
  await db.exec('set role service_role')
  try {
    const rows = (await db.query('select * from public.mapa_visitas_clientes()')).rows
    assert.equal(rows.length, 3)
    assert.equal(rows[0].visita_obrigatoria, true)
  } finally { await db.exec('reset role') }
})
