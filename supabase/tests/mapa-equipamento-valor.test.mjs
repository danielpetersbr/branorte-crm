// Reutiliza a base sintética da conversão e compara cada campo anterior da MV/RPC.
// node supabase/tests/mapa-equipamento-valor.test.mjs [caminho/node_modules]
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

let db, beforeView, beforeRpc, beforeAcl
const migrations = new URL('../migrations/', import.meta.url)
before(async () => {
  // O bootstrap existente termina antes das assertions e do close(). Assim os
  // testes novos usam exatamente os mesmos cenários de identidade/conversão.
  const bootstrapUrl = new URL('./mapa-conversao.test.mjs', import.meta.url)
  const source = readFileSync(bootstrapUrl, 'utf8')
  const boundary = source.indexOf('const result=')
  assert.ok(boundary > 0)
  const bootstrap = source.slice(0, boundary).replaceAll('import.meta.url', JSON.stringify(bootstrapUrl.href)) + '\nexport { db };'
  ;({ db } = await import('data:text/javascript;base64,' + Buffer.from(bootstrap).toString('base64')))
  await db.exec(readFileSync(new URL('20261008125602_mapa_orcamentos_acesso_unico.sql', migrations), 'utf8'))
  await db.exec(`
    revoke all on function public.mapa_orcamentos_v2() from public,anon;
    grant execute on function public.mapa_orcamentos_v2() to authenticated,service_role;
    grant all on public.mv_mapa_conversoes to service_role;
    alter table public.orcamentos_gerados add itens jsonb,add modelo_basename text;
    alter table public.orcamentos_legado add equipamento text;
    alter table public.vendas_mapa add equipamento text;
    insert into orcamentos_gerados(numero,cliente_dados,data_emissao,total_proposta,cliente_nome,itens) values
      ('2026 - 4000','{}','2026-01-01',300,'Último zero','[{"qtd":1,"nome":"Antigo"}]'),
      ('2026 - 4001','{}','2026-02-01',0,'Último zero','[{"qtd":2,"nome":"Novo zero"}]'),
      ('2026 - 4002','{}','2026-02-01',null,'Sem preço','[{"qtd":1,"nome":"Sem preço"}]'),
      ('2026 - 4003','{}','2026-02-01',null,'Preço nulo','[{"qtd":1,"nome":"Preço nulo"}]'),
      ('2026 - 4100','{"fone":"61988880001"}','2026-01-01',100,'Duas vendas','[{"nome":"Orçamento antigo"}]'),
      ('2026 - 4101','{"fone":"61988880001"}','2026-04-01',9999,'Duas vendas','[{"nome":"Novo NÃO vendido"}]'),
      ('2026 - 4102','{"fone":"61988880001"}','2026-02-01',200,'Duas vendas','[{"nome":"Outra proposta"}]');
    insert into orcamentos_gerados(numero,cliente_dados,data_emissao,total_proposta,cliente_nome,itens,modelo_basename) values
      ('2026 - 4200','{}','2026-02-01',90,'Venda sem valor','[{"nome":"Proposta ainda aberta"}]',null),
      ('2026 - 4201','{}','2026-02-01',15,'Modelo fallback','{}','Modelo conhecido');
    insert into orcamentos_legado(numero,data_emissao,total_proposta,cliente_nome,equipamento) values
      ('2026 - 4202','2026-02-01',25,'Legado equipado','Modelo legado');
    insert into mv_mapa_orcamentos(cli_key,cliente,cidade,uf,numeros,total) values
      ('ultimo-zero','Último zero','Curitiba','PR','2026 - 4000,2026 - 4001',300),
      ('sem-preco','Sem preço','Curitiba','PR','2026 - 4002',800),
      ('preco-nulo','Preço nulo','Curitiba','PR','2026 - 4003',null),
      ('duas-vendas','Duas vendas','Brasília','DF','2026 - 4100,2026 - 4101,2026 - 4102',9999);
    insert into mv_mapa_orcamentos(cli_key,cliente,cidade,uf,numeros,total) values
      ('venda-sem-valor','Venda sem valor','Curitiba','PR','2026 - 4200',90),
      ('modelo-fallback','Modelo fallback','Curitiba','PR','2026 - 4201',15),
      ('legado-equipado','Legado equipado','Curitiba','PR','2026 - 4202',25);
    insert into mirror_pedidos_venda values
      ('pv4100','2026-4100','Duas vendas','Brasília','DF','{"telefone":"61988880001","descricao_equipamento":"Moinho vendido"}',null,160,'FECHADO'),
      ('pv4102','2026-4102','Duas vendas','Brasília','DF','{"telefone":"61988880001","equipamentos_detalhados":[{"quantidade":2,"descricao":"Misturador vendido"}]}',null,240,'FECHADO');
    insert into mirror_pedidos_venda values
      ('pv4200','2026-4200','Venda sem valor','Curitiba','PR','{"descricao_equipamento":"Venda zero"}',null,0,'FECHADO');
    update vendas_mapa set equipamento='Histórico vendido' where id='historico';
    update orcamentos_gerados set itens='[{"nome":"Orçamento em aberto"}]' where numero='2026 - 2001';
    refresh materialized view public.mv_mapa_conversoes;
  `)
  beforeView = (await db.query('select * from public.mv_mapa_conversoes order by tipo,chave')).rows
  beforeRpc = (await db.query('select * from public.mapa_orcamentos_v2() order by cli_key')).rows
  beforeAcl = await acl()
  const file = readdirSync(migrations).find(n => n.endsWith('_mapa_equipamento_valor.sql'))
  assert.ok(file)
  await db.exec(readFileSync(new URL(file, migrations), 'utf8'))
})
after(async () => { if (db) await db.close() })
const oldFields = rows => rows.map(({ equipamento, ...rest }) => rest)
async function cliente(chave) {
  return (await db.query("select * from public.mv_mapa_conversoes where tipo='cliente' and chave=$1", [chave])).rows[0]
}
async function acl() {
  return (await db.query(`select object,grantee::regrole::text as role,privilege_type,is_grantable from (
    select 'view'::text as object,a.* from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.mv_mapa_conversoes'::regclass
    union all select 'rpc',a.* from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.mapa_orcamentos_v2()'::regprocedure
    ) a order by object,role,privilege_type`)).rows
}

test('equipment belongs to the same latest quote even when the price is zero', async () => {
  const row = await cliente('ultimo-zero')
  assert.equal(Number(row.total), 0)
  assert.equal(row.equipamento, '2x Novo zero')
})
test('null latest price does not attach equipment to a different fallback value', async () => {
  const fallback = await cliente('sem-preco')
  assert.equal(Number(fallback.total), 800)
  assert.equal(fallback.equipamento, null)
  const nullPrice = await cliente('preco-nulo')
  assert.equal(nullPrice.total, null)
  assert.equal(nullPrice.equipamento, '1x Preço nulo')
})
test('sold equipment comes only from the sales that contribute to the total', async () => {
  const sold = await cliente('duas-vendas')
  assert.equal(Number(sold.total), 400)
  assert.equal(sold.n_vendas, 2)
  assert.equal(sold.equipamento, 'Moinho vendido\n2x Misturador vendido')
  assert.equal((await cliente('historico')).equipamento, 'Histórico vendido')
  assert.equal((await cliente('only-number')).equipamento, null)
})
test('unknown sale value never borrows equipment for an unrelated quote fallback', async () => {
  const row = await cliente('venda-sem-valor')
  assert.equal(Number(row.total), 90)
  assert.equal(row.vendido, true)
  assert.equal(row.equipamento, null)
})
test('legacy equipment and generated model fallback remain tied to their quote', async () => {
  assert.equal((await cliente('modelo-fallback')).equipamento, 'Modelo conhecido')
  assert.equal((await cliente('legado-equipado')).equipamento, 'Modelo legado')
})
test('every preexisting view and RPC field remains identical on all conversion fixtures', async () => {
  const afterView = (await db.query('select * from public.mv_mapa_conversoes order by tipo,chave')).rows
  const afterRpc = (await db.query('select * from public.mapa_orcamentos_v2() order by cli_key')).rows
  assert.deepEqual(oldFields(afterView), beforeView)
  assert.deepEqual(oldFields(afterRpc), beforeRpc)
  assert.equal(afterRpc.find(r => r.cli_key === 'duas-vendas').equipamento, 'Moinho vendido\n2x Misturador vendido')
})
test('view and RPC privileges remain identical and UF filtering still applies', async () => {
  assert.deepEqual(await acl(), beforeAcl)
  await db.exec("create or replace function public.ufs_visiveis() returns text[] language sql stable as $$select array['PR']$$")
  const rows = (await db.query('select * from public.mapa_orcamentos_v2() order by cli_key')).rows
  assert.deepEqual(oldFields(rows), beforeRpc.filter(r => r.uf === 'PR'))
})
