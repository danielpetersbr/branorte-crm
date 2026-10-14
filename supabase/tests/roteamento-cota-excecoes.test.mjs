// PostgreSQL descartável. Só fixtures sintéticas; nenhuma conexão/alteração na produção.
// node supabase/tests/roteamento-cota-excecoes.test.mjs [runtime/node_modules]
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
const migrations = new URL('../migrations/', import.meta.url)
const adminId = '00000000-0000-0000-0000-000000000001'
const vendorId = '00000000-0000-0000-0000-000000000002'
const ownerId = '00000000-0000-0000-0000-000000000003'
let originalCota, originalEder, originalRouting

async function rows(sql, params = []) { return (await db.query(sql, params)).rows }
async function rpc(nome, ignorar) {
  return rows('select * from public.roteamento_cota_definir($1,$2)', [nome, ignorar])
}
async function transaction(fn, role = 'authenticated', uid = adminId) {
  await db.exec(`begin; set local role ${role};`)
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid ?? ''])
  try { return await fn() } finally { await db.exec('rollback') }
}
async function denied(sql, params = [], role = 'authenticated', uid = vendorId, code = '42501') {
  await assert.rejects(transaction(() => rows(sql, params), role, uid), e => e.code === code)
}
async function cota(nome) { return Number((await rows('select public.cota_fator($1) as fator', [nome]))[0].fator) }

before(async () => {
  await db.exec(`
    create schema private; create schema auth;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant usage on schema private to authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.user_profiles(id uuid primary key,role text not null);
    insert into public.user_profiles values
      ('${adminId}','admin'),('${vendorId}','vendor'),('${ownerId}','owner');
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select coalesce((select role in ('admin','owner') from public.user_profiles where id=auth.uid()),false) $$;
    create table public.vendors(name text primary key,ativo boolean not null default true);
    create table public.vendor_dispatch_status(vendedor_nome text primary key,online boolean,bloqueado boolean,share_percent numeric);
    insert into public.vendors(name) values ('EDER'),('LUCAS'),('EDILSON JR'),('IGOR'),('ZERO');
    insert into public.vendor_dispatch_status values
      ('EDER',true,false,20),('LUCAS',true,false,20),('EDILSON JR',false,false,20),
      ('IGOR',true,true,20),('ZERO',true,false,0);
    grant select on public.vendor_dispatch_status to authenticated;
    create table public.outbound_rota_config(id int primary key,cota_ativa boolean,cota_verde int,cota_zero int,cota_volta numeric,cota_sync_max_min int);
    insert into public.outbound_rota_config values(1,true,15,60,0.8,120);
    create table public.outbound_cota_estado(vendedor_nome text primary key,cortado boolean);
    insert into public.outbound_cota_estado values('LUCAS',true),('EDER',true);
    create table public.wa_chat_labels(vendedor_nome text,updated_at timestamptz);
    insert into public.wa_chat_labels select name,now() from public.vendors;
    create table public.vendor_parados_topo(vendedor_nome text primary key,parados bigint);
    insert into public.vendor_parados_topo values('EDER',100),('LUCAS',59),('EDILSON',90),('IGOR',80),('ZERO',70);
    create table private.outbound_cota_excecoes(
      vendedor_nome text primary key,inicio_em timestamptz not null default now(),
      expira_em timestamptz not null,motivo text not null,
      constraint cota_excecao_nome_canonico check(vendedor_nome=upper(btrim(vendedor_nome)) and vendedor_nome<>''),
      constraint cota_excecao_prazo_valido check(expira_em>inicio_em)
    );
    alter table private.outbound_cota_excecoes enable row level security;
    grant select,insert,update,delete on private.outbound_cota_excecoes to service_role;
    insert into private.outbound_cota_excecoes values('EDER',now()-interval '5 days',now()+interval '10 days','Exceção temporária sintética preservada');
  `)
  // O cálculo anterior é a migration real + o ramo de exceção já existente na
  // base em 14/10. A migration nova não substitui nem altera esse cálculo.
  const legacy = readFileSync(new URL('20260804_cota_sync_velho_nao_ressuscita.sql', migrations), 'utf8')
  const branch = `
  if exists(select 1 from private.outbound_cota_excecoes e
    where e.vendedor_nome=primeiro and e.inicio_em<=now() and e.expira_em>now()) then return 1; end if;
  `
  await db.exec(legacy.replace('  -- Estado de corte ANTES', branch + '\n  -- Estado de corte ANTES'))
  originalCota = await rows("select pg_get_functiondef('public.cota_fator(text)'::regprocedure) as definition")
  originalEder = await rows('select * from private.outbound_cota_excecoes')
  originalRouting = await rows(`select jsonb_build_object(
    'status',(select jsonb_agg(to_jsonb(s) order by vendedor_nome) from public.vendor_dispatch_status s),
    'corte',(select jsonb_agg(to_jsonb(e) order by vendedor_nome) from public.outbound_cota_estado e),
    'parados',(select jsonb_agg(to_jsonb(p) order by vendedor_nome) from public.vendor_parados_topo p),
    'config',(select to_jsonb(c) from public.outbound_rota_config c)) as snapshot`)
  const filename = readdirSync(migrations).find(n => n.endsWith('_roteamento_ignorar_parados_por_vendedor.sql'))
  assert.ok(filename)
  await db.exec(readFileSync(new URL(filename, migrations), 'utf8'))
})
after(() => db.close())

test('a migração não altera a exceção temporária, o cálculo ou os controles existentes', async () => {
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'), originalEder)
  assert.deepEqual(await rows("select pg_get_functiondef('public.cota_fator(text)'::regprocedure) as definition"), originalCota)
  assert.equal((await rows('select count(*)::int as n from private.outbound_cota_excecoes'))[0].n, 1)
})

test('a lista mostra temporária vigente e demais vendedores desligados, sem metadata privada', async () => {
  await transaction(async () => {
    const result = await rows('select * from public.roteamento_cota_excecoes()')
    assert.equal(result.length, 5)
    assert.equal(result.find(r => r.vendedor_nome === 'EDER').ignorar_parados, true)
    assert.equal(result.find(r => r.vendedor_nome === 'EDER').temporario, true)
    assert.equal(result.find(r => r.vendedor_nome === 'LUCAS').ignorar_parados, false)
    assert.deepEqual(Object.keys(result[0]), ['vendedor_nome', 'ignorar_parados', 'expira_em', 'temporario'])
  })
})

test('ativar libera somente a cota; desligar restaura corte/histerese e mantém 59 parados', async () => {
  await transaction(async () => {
    assert.equal(await cota('LUCAS'), 0)
    assert.deepEqual(await rpc(' lucas ', true), [{vendedor_nome:'LUCAS',ignorar_parados:true,expira_em:null,temporario:false}])
    assert.equal(await cota('LUCAS'), 1)
    assert.deepEqual(await rpc('LUCAS', false), [{vendedor_nome:'LUCAS',ignorar_parados:false,expira_em:null,temporario:false}])
    assert.equal(await cota('LUCAS'), 0)
  })
  const snapshot = await rows(`select jsonb_build_object(
    'status',(select jsonb_agg(to_jsonb(s) order by vendedor_nome) from public.vendor_dispatch_status s),
    'corte',(select jsonb_agg(to_jsonb(e) order by vendedor_nome) from public.outbound_cota_estado e),
    'parados',(select jsonb_agg(to_jsonb(p) order by vendedor_nome) from public.vendor_parados_topo p),
    'config',(select to_jsonb(c) from public.outbound_rota_config c)) as snapshot`)
  assert.deepEqual(snapshot, originalRouting)
})

test('duplo clique ON/OFF é idempotente e nunca cria mais de uma exceção', async () => {
  await transaction(async () => {
    const results = await Promise.all([rpc('LUCAS',true),rpc('LUCAS',true)])
    assert.deepEqual(results[0],results[1])
    assert.equal((await rows('select * from public.roteamento_cota_excecoes() where vendedor_nome=\'LUCAS\''))[0].ignorar_parados,true)
    await Promise.all([rpc('LUCAS',false),rpc('LUCAS',false)])
    assert.equal((await rows('select * from public.roteamento_cota_excecoes() where vendedor_nome=\'LUCAS\''))[0].ignorar_parados,false)
  })
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'),originalEder)
})

test('liberar vendedor offline, bloqueado ou peso zero não muda esses controles', async () => {
  await transaction(async () => {
    await rpc('EDILSON JR',true); await rpc('IGOR',true); await rpc('ZERO',true)
    assert.equal(await cota('EDILSON JR'),1)
    const eligible=await rows(`select vendedor_nome from public.vendor_dispatch_status
      where online and not bloqueado and share_percent>0 and public.cota_fator(vendedor_nome)>0 order by 1`)
    assert.deepEqual(eligible,[{vendedor_nome:'EDER'}])
  })
})

test('nome completo canônico funciona e não trata cadastro desconhecido como vendedor', async () => {
  await transaction(async () => {
    assert.equal((await rpc(' edilson   jr ',true))[0].vendedor_nome,'EDILSON JR')
    assert.equal(await cota('EDILSON JR'),1)
  })
  for(const name of ['','INVENTADO',null,'EDILSON'])
    await denied('select * from public.roteamento_cota_definir($1,true)',[name],'authenticated',adminId,'22023')
  await denied('select * from public.roteamento_cota_definir(\'LUCAS\',null)',[],'authenticated',adminId,'22023')
})

test('colisão futura de primeiros nomes é recusada antes de alterar exceções',async()=>{
  await db.exec('begin')
  try{
    await db.exec("insert into public.vendors values('EDILSON OUTRO',true); insert into public.vendor_dispatch_status values('EDILSON OUTRO',true,false,10)")
    await db.exec('set local role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[adminId])
    await assert.rejects(rpc('EDILSON JR',true),e=>e.code==='22023')
  }finally{await db.exec('rollback')}
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'),originalEder)
})

test('OFF conserva registro, motivo e início da exceção temporária',async()=>{
  await transaction(async()=>{
    assert.equal((await rpc('EDER',false))[0].ignorar_parados,false)
    assert.equal(await cota('EDER'),0)
  })
  await db.exec('begin')
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[adminId])
    await rpc('EDER',false)
    const record=(await rows("select * from private.outbound_cota_excecoes where vendedor_nome='EDER'"))[0]
    assert.equal(record.motivo,originalEder[0].motivo)
    assert.deepEqual(record.inicio_em,originalEder[0].inicio_em)
    assert.ok(record.expira_em<=new Date())
  }finally{await db.exec('rollback')}
})

test('ON explícito transforma temporária em até-desativar, sem alterar outros vendedores',async()=>{
  await transaction(async()=>{
    assert.deepEqual(await rpc('EDER',true),[{vendedor_nome:'EDER',ignorar_parados:true,expira_em:null,temporario:false}])
    assert.equal((await rows('select * from public.roteamento_cota_excecoes() where vendedor_nome=\'LUCAS\''))[0].ignorar_parados,false)
  })
})

test('OFF também cancela uma exceção futura sem violar prazo válido',async()=>{
  await db.exec('begin')
  try{
    await db.exec("insert into private.outbound_cota_excecoes values('LUCAS',now()+interval '1 day',now()+interval '2 days','Programada sintética')")
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[adminId])
    assert.equal((await rpc('LUCAS',false))[0].ignorar_parados,false)
    const r=(await rows("select inicio_em<expira_em as valido,expira_em<=now() as encerrada,motivo from private.outbound_cota_excecoes where vendedor_nome='LUCAS'"))[0]
    assert.deepEqual(r,{valido:true,encerrada:true,motivo:'Programada sintética'})
  }finally{await db.exec('rollback')}
})

test('exceção expirada não aparece ativa nem temporária; ON pode renovar',async()=>{
  await db.exec('begin')
  try{
    await db.exec("insert into private.outbound_cota_excecoes values('LUCAS',now()-interval '2 days',now()-interval '1 day','Expirada sintética')")
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[adminId])
    assert.deepEqual((await rows("select * from public.roteamento_cota_excecoes() where vendedor_nome='LUCAS'"))[0],
      {vendedor_nome:'LUCAS',ignorar_parados:false,expira_em:null,temporario:false})
    assert.equal(await cota('LUCAS'),0)
    assert.equal((await rpc('LUCAS',true))[0].ignorar_parados,true)
    assert.equal(await cota('LUCAS'),1)
  }finally{await db.exec('rollback')}
})

test('vendedor não consegue ler, ativar ou desativar exceções de ninguém',async()=>{
  await denied('select * from public.roteamento_cota_excecoes()')
  await denied('select * from public.roteamento_cota_definir(\'LUCAS\',true)')
  await denied('select * from public.roteamento_cota_definir(\'EDER\',false)')
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'),originalEder)
})

test('anon, service_role e chamada sem usuário não podem usar as novas RPCs',async()=>{
  for(const role of ['anon','service_role']){
    await denied('select * from public.roteamento_cota_excecoes()',[],role,null)
    await denied('select * from public.roteamento_cota_definir(\'LUCAS\',true)',[],role,adminId)
  }
  await denied('select * from public.roteamento_cota_definir(\'LUCAS\',true)',[],'authenticated',null)
})

test('acesso direto à tabela privada continua negado para admin autenticado',async()=>{
  for(const sql of [
    'select * from private.outbound_cota_excecoes',
    "update private.outbound_cota_excecoes set expira_em='infinity' where vendedor_nome='EDER'",
    "insert into private.outbound_cota_excecoes values('LUCAS',now(),'infinity','Bypass')",
    "delete from private.outbound_cota_excecoes where vendedor_nome='EDER'"
  ]) await denied(sql,[],'authenticated',adminId)
})

test('owner reconhecido por is_admin pode usar RPC; claims de vendor não viram admin',async()=>{
  await transaction(async()=>assert.equal((await rpc('LUCAS',true))[0].ignorar_parados,true),'authenticated',ownerId)
  await assert.rejects(transaction(async()=>{
    await db.exec("select set_config('request.jwt.claims','{\"role\":\"admin\",\"user_metadata\":{\"role\":\"admin\"}}',true)")
    await rpc('LUCAS',true)
  },'authenticated',vendorId),e=>e.code==='42501')
})

test('todos os testes têm rollback: EDER e quantidade final de exceções permanecem originais',async()=>{
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'),originalEder)
  assert.equal((await rows('select count(*)::int as n from private.outbound_cota_excecoes'))[0].n,1)
})

test('script pós-migration usa somente leitura/negações e rollback sem mudar exceções',async()=>{
  await db.exec(readFileSync(new URL('./roteamento-cota-excecoes-verificacao.sql',import.meta.url),'utf8'))
  assert.deepEqual(await rows('select * from private.outbound_cota_excecoes'),originalEder)
})
