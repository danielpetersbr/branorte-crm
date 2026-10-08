// Postgres descartável: fixtures sintéticas, migrations reais, nenhuma conexão externa.
// node supabase/tests/mapa-visual-acesso.test.mjs [caminho/node_modules] [--baseline]
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

let db, legacy, originalAccess
const migrationDir = new URL('../migrations/', import.meta.url)
const uid = '00000000-0000-0000-0000-000000000091'
const missingUid = '00000000-0000-0000-0000-000000000092'
const extraId = '00000000-0000-0000-0000-000000000093'
const rationTables = ['venda_racao_config', 'venda_racao_formulas', 'venda_racao_ingredientes', 'venda_racao_simulacoes']
const deniedTables = ['representante_territorios', ...rationTables]
const roles = ['admin', 'financeiro', 'vendor', 'marketing', 'visualizador', 'mapa', 'consultor', 'representante', 'pending', 'rejected']

async function migration(suffix) {
  const file = readdirSync(migrationDir).find(name => name.endsWith(suffix))
  assert.ok(file, suffix)
  // PostgreSQL deparses view definitions with LF; normalize Windows checkout
  // endings so the equipment migration's exact dollar-quoted guards match.
  await db.exec(readFileSync(new URL(file, migrationDir), 'utf8').replace(/\r\n/g, '\n'))
}

before(async () => {
  const original = new URL('./mapa-conversao.test.mjs', import.meta.url)
  const source = readFileSync(original, 'utf8')
  const boundary = source.indexOf('const result=')
  assert.ok(boundary > 0)
  const bootstrap = source.slice(0, boundary).replaceAll('import.meta.url', JSON.stringify(original.href)) + '\nexport { db };'
  ;({ db } = await import('data:text/javascript;base64,' + Buffer.from(bootstrap).toString('base64')))
  await migration('_mapa_orcamentos_acesso_unico.sql')
  // The live points RPC has 18 fields since the equipment migration. Apply
  // that real migration so a later OR REPLACE cannot silently regress to 17.
  await db.exec(`
    alter table public.orcamentos_gerados add itens jsonb,add modelo_basename text;
    alter table public.orcamentos_legado add equipamento text;
    alter table public.vendas_mapa add equipamento text;
    update public.orcamentos_gerados set itens='[{"qtd":1,"nome":"Synthetic quoted equipment"}]';
    update public.orcamentos_legado set equipamento='Synthetic legacy equipment';
    update public.vendas_mapa set equipamento='Synthetic historical equipment';
    update public.mirror_pedidos_venda set raw=coalesce(raw,'{}'::jsonb)||
      jsonb_build_object('descricao_equipamento','Synthetic sold equipment');
    refresh materialized view public.mv_mapa_conversoes;
  `)
  await migration('_mapa_equipamento_valor.sql')
  await migration('_cliente_visita_obrigatoria.sql')
  await migration('_mapa_visitas_obrigatoria.sql')
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table public.user_profiles(id uuid primary key,role text not null,approved_at timestamptz,display_name text,
      constraint user_profiles_role_check check(role in (${roles.map(role => `'${role}'`).join(',')})));
    insert into public.user_profiles values('${uid}','admin','2026-01-01','Synthetic');
    create table public.usuario_ufs(user_id uuid,uf text);
    create or replace function public.ufs_visiveis() returns text[] language sql stable security definer as $$
      select case when count(*)>0 then array_agg(upper(u.uf))
        when (select role from public.user_profiles where id=auth.uid())='representante'
          then array[]::text[] else null::text[] end
      from public.usuario_ufs u where u.user_id=auth.uid() $$;
    create or replace function public.papel_restrito() returns boolean language sql stable security definer set search_path='' as $$
      select case when auth.uid() is null then false else coalesce(
        (select role in ('mapa','consultor','representante','pending','rejected') or approved_at is null
          from public.user_profiles where id=auth.uid()),true) end $$;
    create function public.papel_restrito_viagens() returns boolean language sql stable security definer set search_path='' as $$
      select coalesce((select role in ('consultor','representante') from public.user_profiles where id=auth.uid()),false) $$;
    create or replace function public.papel_mapa() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and role='mapa' and approved_at is not null) $$;
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.user_profiles where id=auth.uid() and role='admin') $$;
    alter role service_role bypassrls;
    grant usage on schema auth,private to authenticated,service_role;
    grant usage on schema auth to anon;
    alter table public.user_profiles enable row level security;
    grant select,insert,update,delete on public.user_profiles to authenticated;
    create policy up_self_select on public.user_profiles for select to authenticated using(id=auth.uid() or public.is_admin());
    -- INSERT/DELETE permissivos simulam defesa contra outra policy adicionada no futuro.
    create policy profile_insert on public.user_profiles for insert to authenticated with check(true);
    create policy up_admin_modify on public.user_profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
    create policy profile_delete on public.user_profiles for delete to authenticated using(id=auth.uid());
    alter table public.cliente_dados_visita enable row level security;
    grant select,insert,update,delete on public.cliente_dados_visita to authenticated,service_role;
    create policy visita_read on public.cliente_dados_visita for select to authenticated using(true);
    create policy bloqueia_papel_restrito_leitura on public.cliente_dados_visita as restrictive for select to authenticated
      using(not public.papel_restrito() or (visitar is true and public.papel_mapa()));
    create policy visita_insert on public.cliente_dados_visita for insert to authenticated with check(not public.papel_restrito());
    create policy visita_update on public.cliente_dados_visita for update to authenticated using(not public.papel_restrito()) with check(not public.papel_restrito());
    create policy visita_delete on public.cliente_dados_visita for delete to authenticated using(not public.papel_restrito());
    update public.mv_mapa_orcamentos set lat=-25,lng=-49;
    update public.cliente_dados_visita set visitar=true,lat=-25,lng=-49;
    insert into public.cliente_dados_visita(id,nome,estado,visitar,lat,lng) values
      ('00000000-0000-0000-0000-000000000101','Marked','PR',true,0,0),
      ('00000000-0000-0000-0000-000000000102','Unmarked','PR',false,0,0),
      ('00000000-0000-0000-0000-000000000103','Missing coordinates','MS',true,null,null);
    update public.cliente_dados_visita set visita_obrigatoria=true where id='00000000-0000-0000-0000-000000000101';
    create table public.representante_territorios(id integer primary key,marker text);
    create table public.contacts(id integer primary key,marker text);
    create table public.mapa_marcacoes(id integer primary key,marker text);
  `)
  for (const table of rationTables) await db.exec(`create table public.${table}(id integer primary key,marker text)`)
  for (const table of [...deniedTables, 'contacts', 'mapa_marcacoes']) {
    await db.exec(`insert into public.${table} values(1,'Synthetic');
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to authenticated,service_role;
      create policy existing_access on public.${table} for all to authenticated using(true) with check(true);`)
  }
  for (const table of ['contacts', 'mapa_marcacoes', 'vendas_mapa']) {
    if (table === 'vendas_mapa') await db.exec(`alter table public.vendas_mapa enable row level security;
    grant select,insert,update,delete on public.vendas_mapa to authenticated,service_role;
      create policy existing_access on public.vendas_mapa for all to authenticated using(true) with check(true);`)
    await db.exec(`create policy bloqueia_papel_restrito on public.${table} as restrictive for all to authenticated
      using(not public.papel_restrito()) with check(not public.papel_restrito());`)
  }
  await db.exec(`revoke all on function public.mapa_orcamentos_v2() from public,anon;
    grant execute on function public.mapa_orcamentos_v2() to authenticated,service_role;`)
  await migration('_mapa_visual_resumo.sql')
  await migration('_mapa_visual_visitas_resumo.sql')
  await migration('_mapa_visual_pontos_materializados.sql')
  legacy = new Map()
  for (const role of roles) {
    legacy.set(role, await asProfile(role, true, legacySnapshot))
    legacy.set(role + ':unapproved', await asProfile(role, false, legacySnapshot))
  }
  legacy.set('service_role', await asProfile('admin', true, legacySnapshot, { sqlRole: 'service_role', uid: '' }))
  originalAccess = await accessSnapshot()
  if (!process.argv.includes('--baseline')) {
    try { await migration('_mapa_visual_acesso_exclusivo.sql') }
    catch (error) { throw new Error(`Candidate migration failed: ${error.code}: ${error.message}`) }
  }
})

after(async () => { if (db) await db.close() })

async function asProfile(role, approved, run, options = {}) {
  await db.query('update public.user_profiles set role=$1,approved_at=$2 where id=$3', [role, approved ? '2026-01-01' : null, uid])
  await db.exec('delete from public.usuario_ufs')
  if (options.ufs) for (const uf of options.ufs) await db.query('insert into public.usuario_ufs values($1,$2)', [uid, uf])
  await db.exec(`set role ${options.sqlRole ?? 'authenticated'};set test.uid='${options.uid ?? uid}';`)
  try { return await run() } finally { await db.exec('reset role') }
}
async function rows(query, params) { return (await db.query(query, params)).rows }
async function legacySnapshot() {
  return {
    summary: await rows('select * from public.mapa_visual_resumo()'),
    points: await rows('select * from public.mapa_orcamentos_v2() order by cli_key'),
    visits: await rows('select * from public.mapa_visual_visitas() order by id'),
    gates: await rows('select public.papel_restrito() restricted,public.papel_restrito_viagens() trips,public.papel_mapa() map'),
    other: await rows(`select ${deniedTables.map(table => `(select count(*) from public.${table}) ${table}`).join(',')}`),
  }
}
async function accessSnapshot() {
  return rows(`select (select nspacl::text from pg_namespace where nspname='private') schema_acl,
    (select relacl::text from pg_class where oid='public.user_profiles'::regclass) profile_acl,
    (select relacl::text from pg_class where oid='public.cliente_dados_visita'::regclass) visits_acl,
    pg_get_functiondef('public.mapa_orcamentos_v2()'::regprocedure) points_definition,
    pg_get_functiondef('public.mapa_visual_visitas()'::regprocedure) visits_definition,
    pg_get_functiondef('public.mapa_visual_resumo()'::regprocedure) summary_definition,
    pg_get_functiondef('public.ufs_visiveis()'::regprocedure) uf_definition`)
}

test('the real role CHECK accepts mapa_visual without removing existing roles', async () => {
  await assert.doesNotReject(db.query('update public.user_profiles set role=$1 where id=$2', ['mapa_visual', uid]))
  for (const role of roles) await assert.doesNotReject(db.query('update public.user_profiles set role=$1 where id=$2', [role, uid]))
  await assert.rejects(db.query('update public.user_profiles set role=$1 where id=$2', ['invented', uid]), { code: '23514' })
})

test('role-only denial and approved reader are separate, including unapproved and missing profiles', async () => {
  for (const approved of [true, false]) await asProfile('mapa_visual', approved, async () => {
    assert.deepEqual(await rows(`select private.papel_mapa_visual() visual,
      private.leitor_mapa_visual_aprovado() reader,public.papel_restrito() restricted,
      public.papel_restrito_viagens() trips,public.papel_mapa() legacy_map`),
    [{ visual: true, reader: approved, restricted: true, trips: true, legacy_map: false }])
    if (!approved) assert.deepEqual(await rows('select * from public.mapa_visual_visitas()'), [])
  })
  await asProfile('admin', true, async () => assert.deepEqual(await rows('select public.papel_restrito() restricted'), [{ restricted: true }]), { uid: missingUid })
  await asProfile('admin', true, async () => assert.deepEqual(await rows('select public.papel_restrito() restricted'), [{ restricted: false }]), { uid: '' })
})

test('approved visual reader preserves point categories and marked visit statuses, including mandatory and converted', async () => {
  const expected = await asProfile('admin', true, async () => ({
    summary: await rows('select * from public.mapa_visual_resumo()'),
    points: await rows('select * from public.mapa_orcamentos_v2() order by cli_key'),
    visits: await rows('select * from public.mapa_visual_visitas() order by id'),
  }))
  assert.ok(expected.summary[0].vendidos > 0 && expected.summary[0].orcados > 0 && expected.summary[0].visitas > 0)
  assert.deepEqual(Object.keys(expected.points[0]), ['cliente','telefone','fone','numeros','cidade','uf',
    'total','n_orcamentos','data_recente','vendedor','vendido','n_vendas','lat','lng','cli_key',
    'precisao','vendedor_fonte','equipamento'])
  assert.ok(expected.points.some(p => typeof p.equipamento === 'string' && p.equipamento.includes('Synthetic')))
  assert.ok(expected.visits.some(v => v.vendido && v.n_vendas > 0))
  await asProfile('mapa_visual', true, async () => {
    assert.deepEqual(await rows('select * from public.mapa_visual_resumo()'), expected.summary)
    assert.deepEqual(await rows('select * from public.mapa_orcamentos_v2() order by cli_key'), expected.points)
    assert.deepEqual(await rows('select * from public.mapa_visual_visitas() order by id'), expected.visits)
    const visible = await rows('select id,visitar from public.cliente_dados_visita order by id')
    assert.ok(visible.length > 0 && visible.every(v => v.visitar))
    assert.equal(expected.visits.find(v => v.id.endsWith('101')).visita_obrigatoria, true)
    const ids = visible.map(v => v.id)
    const status = await rows('select * from private.mapa_visual_conversoes_visitas($1::text[]) order by chave', [ids])
    assert.deepEqual(status, expected.visits.filter(v => status.some(c => c.chave === v.id))
      .map(v => ({ chave: v.id, vendido: v.vendido, n_vendas: v.n_vendas })))
    assert.deepEqual(await rows('select * from private.mapa_visual_conversoes_visitas(array[]::text[])'), [])
    assert.deepEqual(await rows('select * from private.mapa_visual_conversoes_visitas($1::text[])', [['00000000-0000-0000-0000-000000000102']]), [])
  })
})

test('revoking visual reader approval closes commercial points, summary categories and visits', async () => {
  await asProfile('mapa_visual', false, async () => {
    assert.deepEqual(await rows('select * from public.mapa_orcamentos_v2()'), [])
    assert.deepEqual(await rows('select * from public.mapa_visual_resumo()'),
      [{ vendidos: 0, orcados: 0, visitas: 0, visitas_no_mapa: 0, visitas_sem_localizacao: 0 }])
    assert.deepEqual(await rows('select * from public.mapa_visual_visitas()'), [])
  })
})

test('existing UF selection still scopes points and statuses, and representative without UF stays empty', async () => {
  const expected = await asProfile('admin', true, async () => ({
    points: await rows('select * from private.mapa_visual_contagem_pontos()'),
    visits: await rows("select * from public.mapa_visual_visitas() where upper(coalesce(estado,''))='PR' order by id"),
  }), { ufs: ['PR'] })
  await asProfile('mapa_visual', true, async () => {
    const summary = (await rows('select * from public.mapa_visual_resumo()'))[0]
    assert.equal(summary.vendidos, expected.points[0].vendidos)
    assert.equal(summary.orcados, expected.points[0].orcados)
    assert.deepEqual(await rows('select * from public.mapa_visual_visitas() order by id'), expected.visits)
    assert.ok((await rows('select uf from public.mapa_orcamentos_v2()')).every(p => p.uf === 'PR'))
    assert.deepEqual(await rows('select * from private.mapa_visual_conversoes_visitas($1::text[])', [['00000000-0000-0000-0000-000000000103']]), [])
  }, { ufs: ['PR'] })
  await asProfile('representante', true, async () => assert.deepEqual(await rows('select * from public.mapa_orcamentos_v2()'), []))
})

test('an unmarked converted visit remains hidden even when its ID is supplied directly', async () => {
  const converted = (await rows("select chave from public.mv_mapa_conversoes where tipo='visita' and vendido limit 1"))[0]
  assert.ok(converted)
  await db.exec('begin')
  try {
    await db.query('update public.cliente_dados_visita set visitar=false where id=$1::uuid', [converted.chave])
    await asProfile('mapa_visual', true, async () => {
      assert.deepEqual(await rows('select id from public.cliente_dados_visita where id=$1::uuid', [converted.chave]), [])
      assert.deepEqual(await rows('select * from private.mapa_visual_conversoes_visitas($1::text[])', [[converted.chave]]), [])
    })
  } finally { await db.exec('rollback') }
})

test('visual reader cannot insert, update or delete visits, even a visible marked row', async () => {
  for (const approved of [true, false]) await asProfile('mapa_visual', approved, async () => {
    await assert.rejects(db.query('insert into public.cliente_dados_visita(id,visitar) values($1,true)', [extraId]), { code: '42501' })
    assert.deepEqual(await rows("update public.cliente_dados_visita set nome='Changed' returning id"), [])
    assert.deepEqual(await rows('delete from public.cliente_dados_visita returning id'), [])
  })
})

test('visual role can read its own profile but cannot promote, approve, insert or delete profiles', async () => {
  // Force a competing permissive UPDATE policy: restrictive role denial must still win.
  await db.exec('create policy adversarial_profile_update on public.user_profiles for update to authenticated using(true) with check(true)')
  try {
  for (const approved of [true, false]) await asProfile('mapa_visual', approved, async () => {
    assert.deepEqual(await rows('select id,role from public.user_profiles'), [{ id: uid, role: 'mapa_visual' }])
    assert.deepEqual(await rows("update public.user_profiles set role='admin',approved_at=now() returning id"), [])
    assert.deepEqual(await rows('delete from public.user_profiles returning id'), [])
    await assert.rejects(db.query("insert into public.user_profiles(id,role,approved_at) values($1,'admin',now())", [extraId]), { code: '42501' })
  })
  } finally { await db.exec('drop policy adversarial_profile_update on public.user_profiles') }
})

test('visual role cannot read or mutate unrelated representative/ration tables, approved or not', async () => {
  for (const approved of [true, false]) await asProfile('mapa_visual', approved, async () => {
    for (const table of deniedTables) {
      assert.deepEqual(await rows(`select * from public.${table}`), [], table)
      await assert.rejects(db.query(`insert into public.${table} values(2,'Changed')`), { code: '42501' })
      assert.deepEqual(await rows(`update public.${table} set marker='Changed' returning id`), [], table)
      assert.deepEqual(await rows(`delete from public.${table} returning id`), [], table)
    }
    for (const table of ['contacts', 'mapa_marcacoes', 'vendas_mapa']) assert.deepEqual(await rows(`select * from public.${table}`), [], table)
  })
})

test('all legacy roles retain their exact prior summaries, visits, statuses, gates and unrelated reads', async () => {
  for (const role of roles) {
    assert.deepEqual(await asProfile(role, true, legacySnapshot), legacy.get(role), role)
    assert.deepEqual(await asProfile(role, false, legacySnapshot), legacy.get(role + ':unapproved'), role + ':unapproved')
  }
  assert.deepEqual(await asProfile('admin', true, legacySnapshot, { sqlRole: 'service_role', uid: '' }), legacy.get('service_role'))
  for (const role of ['admin', 'vendor', 'mapa', 'representante']) await asProfile(role, true, async () => {
    await db.exec('begin')
    try { assert.equal((await rows("update public.user_profiles set display_name='Legacy' returning id")).length, role === 'admin' ? 1 : 0, role) }
    finally { await db.exec('rollback') }
  })
})

test('anonymous cannot execute new helpers or map wrappers, and invoker/schema/base contracts stay unchanged', async () => {
  for (const name of ['private.papel_mapa_visual()', 'private.leitor_mapa_visual_aprovado()',
    'private.mapa_visual_conversoes_visitas(text[])', 'public.mapa_visual_visitas()', 'public.mapa_visual_resumo()']) {
    assert.deepEqual(await rows(`select has_function_privilege('anon',$1,'EXECUTE') anon,
      has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') service`, [name]), [{ anon: false, authenticated: true, service: true }])
  }
  await asProfile('mapa_visual', true, async () => {
    for (const query of ['select * from public.mapa_visual_resumo()', 'select * from public.mapa_visual_visitas()'])
      await assert.rejects(db.query(query), { code: '42501' })
  }, { sqlRole: 'anon' })
  // The points RPC now has the intentional approval gate for the new role;
  // full legacy data parity above verifies its existing calculations instead.
  const { points_definition: oldPoints, ...before } = originalAccess[0]
  const { points_definition: newPoints, ...current } = (await accessSnapshot())[0]
  assert.deepEqual(current, before)
  assert.ok(oldPoints && newPoints)
  const wrappers = await rows("select proname,prosecdef from pg_proc where proname in('mapa_visual_resumo','mapa_visual_visitas') order by proname")
  assert.ok(wrappers.every(p => !p.prosecdef))
  const helpers = await rows("select proname,prosecdef,provolatile,proconfig from pg_proc where proname in('papel_mapa_visual','leitor_mapa_visual_aprovado') order by proname")
  assert.equal(helpers.length, 2)
  for (const helper of helpers) {
    assert.equal(helper.prosecdef, true)
    assert.equal(helper.provolatile, 's')
    assert.ok(helper.proconfig.includes('search_path=""'))
  }
})

test('orçados visuais usam 24 meses móveis sem recortar vendidos, conversões ou o mapa completo', async t => {
  await db.exec('begin')
  try {
    // Tudo que já existia fica sem data; compradores antigos continuam vendidos.
    await db.exec(`update public.mv_mapa_orcamentos set data_recente=null;
      update public.mv_mapa_orcamentos set data_recente='2012-01-01' where cli_key='varios';
      with dia as (select (current_timestamp at time zone 'America/Sao_Paulo')::date hoje)
      insert into public.mv_mapa_orcamentos(cli_key,cliente,cidade,uf,total,n_orcamentos,
        data_recente,vendido,n_vendas,lat,lng,precisao_base)
      select chave,chave,'Curitiba',uf,125000,3,data,false,0,lat,lng,'cidade'
      from dia cross join lateral (values
        ('janela-limite','PR',(hoje-interval '24 months')::date,-25::float8,-49::float8),
        ('janela-hoje','PR',hoje,-25,-49),
        ('janela-outra-uf','MS',hoje,-20,-54),
        ('janela-antigo','PR',(hoje-interval '24 months')::date-1,-25,-49),
        ('janela-futuro','PR',hoje+1,-25,-49),
        ('janela-sem-data','PR',null::date,-25,-49),
        ('janela-sem-coord','PR',hoje,null::float8,null::float8)
      ) fixtures(chave,uf,data,lat,lng);
      refresh materialized view public.mv_mapa_conversoes;`)
    const baseline = await asProfile('admin', true, legacySnapshot)
    await asProfile('admin', true, async () => {
      assert.equal((await rows("select vendido and data_recente=date '2012-01-01' old_sold from public.mapa_orcamentos_v2() where cli_key='varios'"))[0].old_sold, true)
    })
    assert.ok(baseline.points.some(p => p.vendido && p.data_recente == null))
    const baseRpc = (await rows("select pg_get_functiondef('public.mapa_orcamentos_v2()'::regprocedure) definition"))[0].definition
    const visitasRpc = (await rows("select pg_get_functiondef('public.mapa_visual_visitas()'::regprocedure) definition"))[0].definition
    if (!process.argv.includes('--periodo-baseline')) await migration('_mapa_visual_orcados_24_meses.sql')

    await t.test('contador exclui orçamento anterior ao limite, sem data e futuro; mantém todos os vendidos e visitas', async () => {
      await asProfile('admin', true, async () => {
        const summary = (await rows('select * from public.mapa_visual_resumo()'))[0]
        assert.equal(summary.orcados, 3)
        assert.equal(summary.vendidos, baseline.summary[0].vendidos)
        assert.equal(summary.visitas, baseline.summary[0].visitas)
        assert.equal(summary.visitas_no_mapa, baseline.summary[0].visitas_no_mapa)
        assert.equal(summary.visitas_sem_localizacao, baseline.summary[0].visitas_sem_localizacao)
      })
    })
    if (process.argv.includes('--periodo-baseline')) return

    await t.test('RPC estreita inclui a fronteira e preserva os 18 campos; orçamento recente de cliente antigo fica incluído', async () => {
      await asProfile('admin', true, async () => {
        const quotes = await rows('select * from public.mapa_visual_orcados() order by cli_key')
        assert.deepEqual(quotes.map(p => p.cli_key), ['janela-hoje','janela-limite','janela-outra-uf','janela-sem-coord'])
        assert.deepEqual(Object.keys(quotes[0]), Object.keys(baseline.points[0]))
        assert.equal(quotes[0].n_orcamentos, 3)
        assert.ok(quotes.every(p => !p.vendido && p.n_vendas === 0))
        assert.ok(!quotes.some(p => p.cli_key === 'varios'))
        assert.deepEqual(await rows('select * from public.mapa_orcamentos_v2() order by cli_key'), baseline.points)
        assert.deepEqual(await rows('select * from public.mapa_visual_visitas() order by id'), baseline.visits)
      })
    })

    await t.test('UF e aprovação continuam aplicadas no servidor para pontos e contagem', async () => {
      for (const role of ['admin','vendor','mapa','mapa_visual','representante']) {
        await asProfile(role, true, async () => {
          assert.deepEqual((await rows('select cli_key from public.mapa_visual_orcados() order by cli_key')).map(p => p.cli_key),
            ['janela-hoje','janela-limite','janela-sem-coord'], role)
          assert.equal((await rows('select * from public.mapa_visual_resumo()'))[0].orcados, 2, role)
        }, { ufs: ['PR'] })
      }
      await asProfile('representante', true, async () => {
        assert.deepEqual(await rows('select * from public.mapa_visual_orcados()'), [])
      })
      await asProfile('mapa_visual', false, async () => {
        assert.deepEqual(await rows('select * from public.mapa_visual_orcados()'), [])
        assert.deepEqual(await rows('select * from public.mapa_visual_resumo()'),
          [{ vendidos:0,orcados:0,visitas:0,visitas_no_mapa:0,visitas_sem_localizacao:0 }])
      })
      await asProfile('admin', true, async () => {
        assert.equal((await rows('select * from public.mapa_visual_orcados()')).length, 4)
        assert.equal((await rows('select * from private.mapa_visual_contagem_pontos()'))[0].orcados, 3)
      }, { sqlRole: 'service_role', uid: '' })
    })

    await t.test('anon não pode executar a RPC; invoker e contratos de mapas anteriores permanecem iguais', async () => {
      assert.deepEqual(await rows(`select has_function_privilege('anon','public.mapa_visual_orcados()','EXECUTE') anon,
        has_function_privilege('authenticated','public.mapa_visual_orcados()','EXECUTE') authenticated,
        has_function_privilege('service_role','public.mapa_visual_orcados()','EXECUTE') service`),
      [{ anon:false,authenticated:true,service:true }])
      await asProfile('admin', true, async () => {
        await db.exec('savepoint anonymous_denial')
        try { await assert.rejects(db.query('select * from public.mapa_visual_orcados()'), { code:'42501' }) }
        finally { await db.exec('rollback to savepoint anonymous_denial; release savepoint anonymous_denial') }
      }, { sqlRole:'anon' })
      const rpc = (await rows("select prosecdef,provolatile,proconfig from pg_proc where oid='public.mapa_visual_orcados()'::regprocedure"))[0]
      assert.equal(rpc.prosecdef, false)
      assert.equal(rpc.provolatile, 's')
      assert.ok(rpc.proconfig.includes('search_path=""'))
      assert.equal((await rows("select pg_get_functiondef('public.mapa_orcamentos_v2()'::regprocedure) definition"))[0].definition, baseRpc)
      assert.equal((await rows("select pg_get_functiondef('public.mapa_visual_visitas()'::regprocedure) definition"))[0].definition, visitasRpc)
    })

    await t.test('janela segue meses de calendário e o dia de São Paulo, avançando sem alterar dados', async () => {
      const definitions = await rows(`select pg_get_functiondef(oid) definition from pg_proc
        where oid in ('public.mapa_visual_orcados()'::regprocedure,'private.mapa_visual_contagem_pontos()'::regprocedure)`)
      // Controla somente o relógio das funções reais na base descartável.
      // Na produção elas continuam usando current_timestamp a cada leitura.
      await db.exec(`delete from public.mv_mapa_orcamentos where cli_key like 'janela-%';
        insert into public.mv_mapa_orcamentos(cli_key,cliente,cidade,uf,total,n_orcamentos,data_recente,vendido,n_vendas,lat,lng)
        values ('cal-limite','Calendar limit','Curitiba','PR',1,1,'2024-02-28',false,0,-25,-49),
          ('cal-antes','Before limit','Curitiba','PR',1,1,'2024-02-27',false,0,-25,-49),
          ('cal-bissexto','Leap day','Curitiba','PR',1,1,'2024-02-29',false,0,-25,-49),
          ('cal-hoje','Today','Curitiba','PR',1,1,'2026-02-28',false,0,-25,-49),
          ('cal-amanha','Tomorrow','Curitiba','PR',1,1,'2026-03-01',false,0,-25,-49);
        refresh materialized view public.mv_mapa_conversoes;
        set timezone='UTC';`)
      for (const [clock, expected] of [
        ["2026-03-01 02:59:59+00", ['cal-bissexto','cal-hoje','cal-limite']],
        ["2026-03-01 03:00:00+00", ['cal-amanha','cal-hoje']],
      ]) {
        for (const { definition } of definitions) {
          await db.exec(definition.replace(/\bCURRENT_TIMESTAMP\b/gi, `timestamptz '${clock}'`))
        }
        await asProfile('mapa_visual', true, async () => {
          assert.deepEqual((await rows('select cli_key from public.mapa_visual_orcados() order by cli_key')).map(p => p.cli_key), expected)
          const summary = (await rows('select * from public.mapa_visual_resumo()'))[0]
          assert.equal(summary.orcados, expected.length)
          assert.equal(summary.vendidos, baseline.summary[0].vendidos)
          assert.equal(summary.visitas, baseline.summary[0].visitas)
        })
      }
    })
  } finally { await db.exec('rollback') }
})
