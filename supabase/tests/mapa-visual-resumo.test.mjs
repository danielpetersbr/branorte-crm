// Fixtures reais de conversão + RPCs existentes em Postgres descartável, sem conexão externa.
// node supabase/tests/mapa-visual-resumo.test.mjs [caminho/node_modules]
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
let db, originalFunctions, originalAccess
const migrationDir = new URL('../migrations/',import.meta.url)
before(async () => {
  const original = new URL('./mapa-conversao.test.mjs',import.meta.url)
  const source = readFileSync(original,'utf8')
  const boundary = source.indexOf('const result=')
  assert.ok(boundary>0)
  const bootstrap = source.slice(0,boundary).replaceAll('import.meta.url',JSON.stringify(original.href))+'\nexport { db };'
  ;({ db } = await import('data:text/javascript;base64,'+Buffer.from(bootstrap).toString('base64')))
  await db.exec(readFileSync(new URL('20261008125602_mapa_orcamentos_acesso_unico.sql',migrationDir),'utf8'))
  for(const suffix of ['_cliente_visita_obrigatoria.sql','_mapa_visitas_obrigatoria.sql']) {
    const file = readdirSync(migrationDir).find(n=>n.endsWith(suffix))
    assert.ok(file)
    await db.exec(readFileSync(new URL(file,migrationDir),'utf8'))
  }
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table public.user_profiles(id uuid primary key,role text);
    create table public.usuario_ufs(user_id uuid,uf text);
    insert into public.user_profiles values
      ('00000000-0000-0000-0000-000000000001','admin'),
      ('00000000-0000-0000-0000-000000000099','pending');
    -- Mesma regra live: representante sem UF fecha; pending não ganha nova fronteira.
    create or replace function public.ufs_visiveis() returns text[] language sql stable security definer as $$
      select case when count(*)>0 then array_agg(upper(u.uf))
        when (select role from public.user_profiles where id=auth.uid())='representante'
          then array[]::text[] else null::text[] end
      from public.usuario_ufs u where u.user_id=auth.uid() $$;
    create or replace function public.papel_restrito() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.restrito',true),''),'false')::boolean $$;
    create or replace function public.papel_mapa() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.mapa',true),''),'false')::boolean $$;
    alter role service_role bypassrls;
    alter table public.cliente_dados_visita enable row level security;
    grant select on public.cliente_dados_visita to authenticated,service_role;
    grant usage on schema private to authenticated,service_role;
    create policy visita_read on public.cliente_dados_visita for select to authenticated using(true);
    create policy visita_restrita on public.cliente_dados_visita as restrictive for select to authenticated
      using(not public.papel_restrito() or (visitar is true and public.papel_mapa()));
    revoke all on function public.mapa_orcamentos_v2() from public,anon;
    grant execute on function public.mapa_orcamentos_v2() to authenticated,service_role;
    update public.mv_mapa_orcamentos set lat=-25,lng=-49;
    update public.cliente_dados_visita set visitar=true,lat=-25,lng=-49;
    insert into public.mv_mapa_orcamentos(cli_key,cliente,uf,lat,lng,vendido,n_vendas) values
      ('edge-zero','Zero','PR',0,0,false,0),
      ('edge-boundary','Boundary','PR',90,-180,false,1),
      ('edge-no-coords','No coords','PR',null,null,true,2),
      ('edge-invalid','Invalid','PR',91,0,false,0),
      ('edge-nan','NaN','PR','NaN',0,true,1),
      ('edge-infinity','Infinity','PR',0,'Infinity',false,0),
      ('edge-override','Override','MS',null,null,true,1);
    insert into public.cliente_localizacao values('edge-override',-20,-50,'endereco');
    insert into public.cliente_dados_visita(id,nome,estado,visitar,lat,lng) values
      ('00000000-0000-0000-0000-000000000101','Zero','PR',true,0,0),
      ('00000000-0000-0000-0000-000000000102','Missing','PR',true,null,null),
      ('00000000-0000-0000-0000-000000000103','NaN','PR',true,'NaN',0),
      ('00000000-0000-0000-0000-000000000104','Infinity','PR',true,0,'Infinity'),
      ('00000000-0000-0000-0000-000000000105','Unmarked','PR',false,0,0);
    update public.cliente_dados_visita set visita_obrigatoria=true where id='00000000-0000-0000-0000-000000000101';
  `)
  const file = readdirSync(migrationDir).find(n=>n.endsWith('_mapa_visual_resumo.sql'))
  assert.ok(file)
  await db.exec(readFileSync(new URL(file,migrationDir),'utf8'))
  originalFunctions=(await db.query("select pg_get_functiondef('public.mapa_conversoes()'::regprocedure) conversoes,pg_get_functiondef('public.mapa_visitas_clientes()'::regprocedure) visitas")).rows
  originalAccess=(await db.query("select (select nspacl::text from pg_namespace where nspname='private') schema_acl,(select relacl::text from pg_class where oid='public.cliente_dados_visita'::regclass) visitas_acl,(select proacl::text from pg_proc where oid='public.mapa_visual_resumo()'::regprocedure) resumo_acl,(select proacl::text from pg_proc where oid='private.mapa_visual_contagem_pontos()'::regprocedure) pontos_acl")).rows
  const narrow = readdirSync(migrationDir).find(n=>n.endsWith('_mapa_visual_visitas_resumo.sql'))
  assert.ok(narrow)
  await db.exec(readFileSync(new URL(narrow,migrationDir),'utf8'))
  const points = readdirSync(migrationDir).find(n=>n.endsWith('_mapa_visual_pontos_materializados.sql'))
  assert.ok(points)
  await db.exec(readFileSync(new URL(points,migrationDir),'utf8'))
})
after(async()=>{ if(db) await db.close() })
const finite = p=>p.lat!=null && p.lng!=null && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180
async function asRole(role,options,run) {
  const {ufs='',restrito=false,mapa=false,uid='00000000-0000-0000-0000-000000000001'}=options
  await db.exec('delete from public.usuario_ufs')
  await db.query("update public.user_profiles set role=$1 where id='00000000-0000-0000-0000-000000000001'",[ufs==='NONE'?'representante':'admin'])
  if(ufs&&ufs!=='NONE')await db.query('insert into public.usuario_ufs select $1::uuid,unnest(string_to_array($2,\',\'))',[uid,ufs])
  await db.exec(`set role ${role};set test.uid='${uid}';set test.ufs='${ufs}';set test.restrito='${restrito}';set test.mapa='${mapa}';`)
  try{return await run()}finally{await db.exec('reset role')}
}
async function assertParity(role='authenticated',options={}) {
  return asRole(role,options,async()=>{
    const pontos=(await db.query('select * from public.mapa_orcamentos_v2()')).rows.filter(finite)
    const original=(await db.query('select * from public.mapa_visitas_clientes() where visitar is true order by id')).rows
    const narrow=(await db.query('select * from public.mapa_visual_visitas() order by id')).rows
    assert.deepEqual(narrow,original)
    if(narrow.length)assert.deepEqual(Object.keys(narrow[0]),['id','telefone','nome','cidade','estado','interesse','visitar','vendedor_nome','etiquetas','valor_negociando','lat','lng','created_at','vendido','n_vendas','visita_obrigatoria'])
    const visitas=original.filter(v=>!v.vendido&&(v.n_vendas??0)===0)
    const sold=p=>p.vendido||(p.n_vendas??0)>0
    const expected={vendidos:pontos.filter(sold).length,orcados:pontos.filter(p=>!sold(p)).length,
      visitas:visitas.length,visitas_no_mapa:visitas.filter(finite).length,visitas_sem_localizacao:visitas.filter(v=>!finite(v)).length}
    const rows=(await db.query('select * from public.mapa_visual_resumo()')).rows
    assert.deepEqual(rows,[expected])
    return expected
  })
}
test('summary exactly matches existing selector/RPCs including conversion and coordinate override',async()=>{
  const r=await assertParity()
  assert.ok(r.vendidos>0&&r.orcados>0&&r.visitas_no_mapa>0&&r.visitas_sem_localizacao>=3)
  await asRole('authenticated',{},async()=>assert.equal((await db.query("select visita_obrigatoria from public.mapa_visual_visitas() where id='00000000-0000-0000-0000-000000000101'")).rows[0].visita_obrigatoria,true))
})
test('same original UF boundary applies, including empty representative scope',async()=>{
  await assertParity('authenticated',{ufs:'PR'})
  const empty=await assertParity('authenticated',{ufs:'NONE'})
  assert.equal(empty.vendidos,0);assert.equal(empty.orcados,0)
})
test('visit RLS is preserved for restricted approved map and restricted nonmap',async()=>{
  await assertParity('authenticated',{restrito:true,mapa:true})
  const denied=await assertParity('authenticated',{restrito:true,mapa:false})
  assert.equal(denied.visitas,0)
})
test('pending authenticated profile retains only the existing RPC boundary',async()=>{
  assert.equal((await db.query("select role from public.user_profiles where id='00000000-0000-0000-0000-000000000099'")).rows[0].role,'pending')
  await assertParity('authenticated',{uid:'00000000-0000-0000-0000-000000000099',restrito:true,mapa:false})
})
test('helper without uid closes points and service role retains existing access',async()=>{
  await asRole('authenticated',{uid:''},async()=>{
    assert.deepEqual((await db.query('select * from private.mapa_visual_contagem_pontos()')).rows,[{vendidos:0,orcados:0}])
  })
  await assertParity('service_role',{uid:''})
})
test('anonymous execution is denied and wrapper remains invoker/helper definer',async()=>{
  await asRole('anon',{},async()=>{
    for(const query of ['select * from public.mapa_visual_resumo()','select * from public.mapa_visual_visitas()','select * from private.mapa_visual_conversoes_visitas(array[]::text[])'])await assert.rejects(db.query(query),{code:'42501'})
  })
  const definitions=(await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('mapa_visual_resumo','mapa_visual_contagem_pontos') order by p.prosecdef`)).rows
  assert.equal(definitions[0].prosecdef,false);assert.equal(definitions[1].prosecdef,true)
  for(const d of definitions)assert.ok(d.proconfig.includes('search_path=""'))
  const narrowDefinitions=(await db.query("select p.proname,p.prosecdef,p.proconfig from pg_proc p where p.proname in('mapa_visual_visitas','mapa_visual_conversoes_visitas') order by p.prosecdef")).rows
  assert.equal(narrowDefinitions[0].proname,'mapa_visual_visitas');assert.equal(narrowDefinitions[0].prosecdef,false)
  assert.equal(narrowDefinitions[1].proname,'mapa_visual_conversoes_visitas');assert.equal(narrowDefinitions[1].prosecdef,true)
  for(const d of narrowDefinitions)assert.ok(d.proconfig.includes('search_path=""'))
  const grants=(await db.query(`select p.proname,coalesce(r.rolname,'PUBLIC') grantee from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee where p.proname in('mapa_visual_resumo','mapa_visual_contagem_pontos','mapa_visual_visitas','mapa_visual_conversoes_visitas') and a.privilege_type='EXECUTE'`)).rows
  assert.ok(grants.every(g=>['postgres','authenticated','service_role'].includes(g.grantee)))
})
test('narrow statuses never exceed input IDs and retain original conversion gates',async()=>{
  for(const options of [{},{ufs:'PR'},{restrito:true,mapa:true},{restrito:true,mapa:false},{uid:''}]) {
    await asRole('authenticated',options,async()=>{
      const ids=(await db.query('select id::text id from public.cliente_dados_visita where visitar is true order by id limit 2')).rows.map(r=>r.id)
      const original=(await db.query("select chave,vendido,n_vendas from public.mapa_conversoes() where tipo='visita' and chave=any($1::text[]) order by chave",[ids])).rows
      const narrow=(await db.query('select * from private.mapa_visual_conversoes_visitas($1::text[]) order by chave',[ids])).rows
      assert.deepEqual(narrow,original)
      assert.deepEqual((await db.query('select * from private.mapa_visual_conversoes_visitas(null::text[])')).rows,[])
      assert.deepEqual((await db.query('select * from private.mapa_visual_conversoes_visitas(array[]::text[])')).rows,[])
    })
  }
})
test('old RPC definitions and table/schema permissions are unchanged',async()=>{
  assert.deepEqual((await db.query("select pg_get_functiondef('public.mapa_conversoes()'::regprocedure) conversoes,pg_get_functiondef('public.mapa_visitas_clientes()'::regprocedure) visitas")).rows,originalFunctions)
  assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='private') schema_acl,(select relacl::text from pg_class where oid='public.cliente_dados_visita'::regclass) visitas_acl,(select proacl::text from pg_proc where oid='public.mapa_visual_resumo()'::regprocedure) resumo_acl,(select proacl::text from pg_proc where oid='private.mapa_visual_contagem_pontos()'::regprocedure) pontos_acl")).rows,originalAccess)
})
