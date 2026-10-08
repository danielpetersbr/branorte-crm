// Postgres descartável: nunca conecta à base real.
// Dependência opcional: npm install --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
// Executar: node supabase/tests/mapa-conversao.test.mjs [caminho/node_modules]
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root=process.argv[2]
const { PGlite }=await import(root ? pathToFileURL(resolve(root,'@electric-sql/pglite/dist/index.js')).href : '@electric-sql/pglite')
const { unaccent }=await import(root ? pathToFileURL(resolve(root,'@electric-sql/pglite/dist/contrib/unaccent.js')).href : '@electric-sql/pglite/contrib/unaccent')
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite({ extensions: { unaccent } })
await db.exec(`
create extension unaccent; create schema private; create schema auth; create schema cron;
create role anon; create role authenticated; create role service_role;
create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
create function public.papel_restrito() returns boolean language sql stable as $$select false$$;
create function public.papel_mapa() returns boolean language sql stable as $$select false$$;
create function public.ufs_visiveis() returns text[] language sql stable as $$select null::text[]$$;
create table orcamento_clientes(id uuid,fone text,cnpj text);
create table orcamentos_gerados(numero text,cliente_id uuid,cliente_dados jsonb,data_emissao date,total_proposta numeric);
create table orcamentos_legado(numero text,fone text,cpf text,data_emissao date,total_proposta numeric);
create table mirror_pedidos_venda(id text,numero_orcamento text,cliente text,cidade text,estado text,raw jsonb,payment_plan_json jsonb,valor_total numeric,status text);
create table vendas_mapa(id text,pedido_id text,numero_orcamento text,nome_cliente text,cidade text,estado text,telefone text,valor numeric);
create table mv_mapa_orcamentos(cli_key text,cliente text,cidade text,uf text,numeros text,telefone text,fone text,total numeric);
create table mv_lista_orcamentos_mapa(rid bigint,numero text,cliente text,cidade text,uf text,total numeric);
create table cliente_dados_visita(id uuid,telefone text,nome text,cidade text,estado text,interesse text,visitar boolean,vendedor_nome text,etiquetas text[],valor_negociando numeric,lat float8,lng float8,created_at timestamptz);
create table wa_chat_labels(chat_id text,vendedor_nome text,phone text);
`)
const fone=readFileSync(new URL('../migrations/20260804220000_fone_canon_estrangeiro.sql',import.meta.url),'utf8')
await db.exec(fone.slice(fone.indexOf('create or replace function public.fone_canon'),fone.indexOf('end; $function$;')+'end; $function$;'.length))
const phones=readFileSync(new URL('../migrations/20261007190000_controle_vendas_rastreio.sql',import.meta.url),'utf8')
await db.exec(phones.slice(phones.indexOf('create or replace function public.fones_canon_do_campo'),phones.indexOf('revoke all on function public.fones_canon_do_campo')))
await db.exec(readFileSync(new URL('./mapa-conversao-fixtures.sql',import.meta.url),'utf8'))
await db.exec(`
alter table mv_mapa_orcamentos add n_orcamentos integer,add data_recente date,add vendedor text,add vendido boolean default false,add n_vendas integer default 0,add lat float8,add lng float8,add precisao_base text;
alter table mv_lista_orcamentos_mapa add data_emissao date,add equipamento text,add vendido boolean default false,add lat float8,add lng float8,add vendedor text;
alter table wa_chat_labels add label_ids text[],add last_message_at timestamptz;
create table cliente_localizacao(cli_key text,lat float8,lng float8,precisao text);
create table cron.job(jobid bigint,jobname text,command text,active boolean);
create function cron.alter_job(jobid bigint,command text default null,active boolean default null) returns void language sql as $$ select $$;
`)
await db.exec(String.raw`CREATE OR REPLACE FUNCTION public.mapa_orcamentos_v2()
 RETURNS TABLE(cliente text, telefone text, fone text, numeros text, cidade text, uf text, total numeric, n_orcamentos integer, data_recente date, vendedor text, vendido boolean, n_vendas integer, lat double precision, lng double precision, cli_key text, precisao text, vendedor_fonte text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- o calculo pesado esta em mv_mapa_orcamentos (cron a cada 5 min); aqui so o que e
  -- por usuario: UFs visiveis e o pino corrigido a mao (cliente_localizacao).
  -- 02/09/2026: sem vendedor no orcamento, o pino herda o do WhatsApp (wa_chat_labels, por
  -- telefone canonico): 1) qualquer vendedor antes do DANIEL, que e o dono e so fica com o
  -- pino se for o unico WhatsApp com a conversa; 2) quem etiquetou; 3) quem falou por ultimo.
  -- vendedor_fonte diz de onde veio ('orcamento' | 'whatsapp').
  select f.cliente, f.telefone, f.fone, f.numeros, f.cidade, f.uf, f.total,
         f.n_orcamentos, f.data_recente,
         coalesce(f.vendedor, w.vend_wa) as vendedor,
         f.vendido, f.n_vendas,
         coalesce(o.lat, f.lat), coalesce(o.lng, f.lng),
         f.cli_key,
         case when o.cli_key is not null then o.precisao else f.precisao_base end,
         case when f.vendedor is not null then 'orcamento'
              when w.vend_wa is not null then 'whatsapp' end as vendedor_fonte
  from public.mv_mapa_orcamentos f
  cross join lateral (select public.ufs_visiveis() as ufs) vis
  left join public.cliente_localizacao o on o.cli_key = f.cli_key
  left join lateral (
    select l.vendedor_nome as vend_wa
    from public.wa_chat_labels l
    where f.vendedor is null
      and public.fone_canon(l.phone) in (public.fone_canon(f.telefone), public.fone_canon(f.fone))
    order by (upper(btrim(l.vendedor_nome)) <> 'DANIEL') desc,
             (coalesce(array_length(l.label_ids, 1), 0) > 0) desc,
             l.last_message_at desc nulls last
    limit 1
  ) w on true
  where vis.ufs is null or upper(coalesce(f.uf,'')) = any(vis.ufs);
$function$`)
await db.exec(String.raw`CREATE OR REPLACE FUNCTION public.lista_orcamentos_mapa()
 RETURNS TABLE(numero text, data_emissao date, cliente text, equipamento text, cidade text, uf text, total numeric, vendido boolean, lat double precision, lng double precision, vendedor text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.numero, m.data_emissao, m.cliente, m.equipamento, m.cidade, m.uf, m.total, m.vendido, m.lat, m.lng, m.vendedor
  from public.mv_lista_orcamentos_mapa m
  cross join lateral (select public.ufs_visiveis() as ufs) vis
  where vis.ufs is null or upper(coalesce(m.uf,'')) = any(vis.ufs);
$function$`)
const migration=readFileSync(new URL('../migrations/20261008114856_mapa_identidade_helpers.sql',import.meta.url),'utf8')+readFileSync(new URL('../migrations/20261008115033_mapa_conversao_cliente.sql',import.meta.url),'utf8')
await db.exec(migration)
await db.exec(readFileSync(new URL('../migrations/20261008115735_mapa_conversao_historico.sql',import.meta.url),'utf8'))
const result=await db.query("select tipo,chave,vendido,n_vendas,total from mv_mapa_conversoes order by tipo,chave")
const clientes=result.rows.filter(r=>r.tipo==='cliente')
for(const key of ['varios','cpf','fone','historico','nomecidade','mudou-fone','local','empresa-antiga']) assert.equal(clientes.find(r=>r.chave===key)?.vendido,true,key)
for(const key of ['homonimo','outrof','cancelado','lid','conflito-doc','conflito-fone','garantia','fone-compartilhado']) assert.equal(clientes.find(r=>r.chave===key)?.vendido,false,key)
assert.equal(clientes.find(r=>r.chave==='varios').n_vendas,1)
assert.equal(Number(clientes.find(r=>r.chave==='varios').total),150)
assert.equal(result.rows.find(r=>r.tipo==='visita').vendido,true)
assert.equal(result.rows.find(r=>r.tipo==='orcamento'&&r.chave.startsWith('2026 - 0002|')).vendido,true)
assert.equal(result.rows.find(r=>r.tipo==='orcamento'&&r.chave.startsWith('2026 - 1001|')).vendido,true)
assert.equal(result.rows.find(r=>r.tipo==='orcamento'&&r.chave.startsWith('2026 - 2001|')).vendido,true)
assert.equal(result.rows.find(r=>r.tipo==='visita'&&r.chave.endsWith('003')).vendido,false)
assert.equal((await db.query("select vendido from lista_orcamentos_mapa() where numero='2026 - 1001'")).rows[0].vendido,true)
assert.equal((await db.query("select vendido from mapa_orcamentos_v2() where cli_key='mudou-fone'")).rows[0].vendido,true)
assert.equal((await db.query("select vendido from mapa_visitas_clientes() where id::text like '%002'")).rows[0].vendido,true)
await db.exec(`create or replace function public.papel_restrito() returns boolean language sql stable as $$ select true $$;
create or replace function public.papel_mapa() returns boolean language sql stable as $$ select true $$;
update cliente_dados_visita set visitar=true where id::text like '%002';`)
assert.deepEqual((await db.query("select distinct tipo from mapa_conversoes()")).rows.map(r=>r.tipo),['visita'])
assert.equal((await db.query("select vendido from mapa_conversoes()")).rows[0].vendido,true)
assert.equal((await db.query("select private.mapa_fones('221727753773286') as f")).rows[0].f.length,0)
console.log('SQL: identidade, histórico e conversão; 3 RPCs passaram; identidade, múltiplos orçamentos, conversão e acesso de usuário mapa.')
await db.close()
