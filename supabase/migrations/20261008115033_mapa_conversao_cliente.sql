-- Uma regra de conversão para pinos, tabela e visitas. Não altera cadastros.
-- Identificadores fortes: orçamento, CPF/CNPJ e telefone. Nome exige cidade/UF
-- e ausência de documento/telefone conflitante. Nunca usar o n_vendas antigo:
-- ele era contado por nome, inclusive homônimos de estados diferentes.
-- CTEs de identidade têm estimativas baixas de cardinalidade; evitar comparar
-- toda a lista de orçamentos para cada pino. Configuração local desta transação.
set local enable_nestloop=off;
set local jit=off;
create materialized view public.mv_mapa_conversoes as
with propostas as materialized (
  select o.numero,private.mapa_numero(o.numero) as nz,o.data_emissao,o.total_proposta as total,
    private.mapa_fones(coalesce(nullif(o.cliente_dados->>'fone',''),c.fone)) as fones,
    regexp_replace(coalesce(nullif(o.cliente_dados->>'cnpj',''),nullif(o.cliente_dados->>'cpf',''),c.cnpj,''),'\D','','g') as doc
  from public.orcamentos_gerados o left join public.orcamento_clientes c on c.id=o.cliente_id
  union all
  select l.numero,private.mapa_numero(l.numero),l.data_emissao,l.total_proposta,
    private.mapa_fones(l.fone),regexp_replace(coalesce(l.cpf,''),'\D','','g')
  from public.orcamentos_legado l
), vendas_raw as materialized (
  select 'P:'||p.id as id,p.numero_orcamento as numero,p.cliente as nome,p.cidade,p.estado as uf,
    p.raw->>'telefone' as telefone,p.raw->>'cpf_cnpj' as doc,
    coalesce(nullif((p.payment_plan_json->>'total')::numeric,0),p.valor_total) as valor
  from public.mirror_pedidos_venda p
  where upper(coalesce(p.status,''))<>'CANCELADO'
    and lower(btrim(coalesce(p.raw->>'fonte_origem','')))<>'garantia'
  union all
  select 'V:'||v.id,v.numero_orcamento,v.nome_cliente,v.cidade,v.estado,v.telefone,null,v.valor
  from public.vendas_mapa v
  -- Pedido espelhado é a fonte vigente, inclusive para excluir cancelamentos.
  where not exists(select 1 from public.mirror_pedidos_venda p where p.id::text=v.pedido_id::text)
    and not (v.pedido_id is null and private.mapa_numero(v.numero_orcamento) is not null
      and exists(select 1 from public.mirror_pedidos_venda p where private.mapa_numero(p.numero_orcamento)=private.mapa_numero(v.numero_orcamento)))
), vendas as materialized (
  select v.id,private.mapa_numero(v.numero) as nz,private.mapa_nome(v.nome) as nome,
    private.mapa_nome(v.cidade) as cidade,upper(btrim(coalesce(v.uf,''))) as uf,
    private.mapa_fones(v.telefone) as fones,regexp_replace(coalesce(v.doc,''),'\D','','g') as doc,v.valor
  from vendas_raw v
), lids as materialized (
  select distinct split_part(chat_id,'@',1) as lid from public.wa_chat_labels where chat_id like '%@lid'
), lid_fones as materialized (
  select split_part(l.chat_id,'@',1) as lid,private.mapa_nome(l.vendedor_nome) as vendedor,array_agg(distinct f.fc) as fones
  from public.wa_chat_labels l,unnest(private.mapa_fones(l.phone)) f(fc)
  where l.chat_id like '%@lid' and regexp_replace(coalesce(l.phone,''),'\D','','g')<>split_part(l.chat_id,'@',1)
  group by split_part(l.chat_id,'@',1),private.mapa_nome(l.vendedor_nome) having count(distinct f.fc)=1
), entidades_raw as materialized (
  select 'cliente'::text as tipo,p.cli_key as chave,p.cliente as nome,p.cidade,p.uf,
    string_to_array(p.numeros,',') as numeros,
    private.mapa_fones(p.telefone)||private.mapa_fones(p.fone) as fones,p.total
  from public.mv_mapa_orcamentos p
  union all
  select 'orcamento',coalesce(l.numero,'')||'|'||private.mapa_nome(l.cliente)||'|'||private.mapa_nome(l.cidade)||'|'||upper(btrim(coalesce(l.uf,''))),l.cliente,l.cidade,l.uf,array[l.numero],'{}'::text[],l.total
  from public.mv_lista_orcamentos_mapa l
  union all
  select 'visita',v.id::text,v.nome,v.cidade,v.estado,'{}'::text[],
    case when lids.lid is not null then coalesce(lf.fones,'{}'::text[]) else private.mapa_fones(v.telefone) end,v.valor_negociando
  from public.cliente_dados_visita v
  left join lids on lids.lid=regexp_replace(coalesce(v.telefone,''),'\D','','g')
  left join lid_fones lf on lf.lid=lids.lid and lf.vendedor=private.mapa_nome(v.vendedor_nome)
), entidades as materialized (
  select distinct on(e.tipo,e.chave) e.tipo,e.chave,private.mapa_nome(e.nome) as nome,private.mapa_nome(e.cidade) as cidade,
    upper(btrim(coalesce(e.uf,''))) as uf,e.fones,
    array(select distinct private.mapa_numero(n) from unnest(e.numeros) n where private.mapa_numero(n) is not null) as numeros,e.total
  from entidades_raw e
), ep as materialized (
  select e.tipo,e.chave,p.* from entidades e,unnest(e.numeros) n join propostas p on p.nz=n
), ef as (
  select tipo,chave,array_agg(distinct fc) as fones from ep,unnest(ep.fones) fc group by tipo,chave
), ed as (
  select tipo,chave,array_agg(distinct doc) as docs from ep where length(doc) in (11,14) and doc !~ '^0+$' group by tipo,chave
), el as (
  select distinct on(tipo,chave) tipo,chave,total from ep order by tipo,chave,data_emissao desc nulls last,numero desc
), cadastro_base as materialized (
  select e.tipo,e.chave,e.nome,e.cidade,e.uf,e.numeros,
    e.fones||coalesce(ef.fones,'{}'::text[]) as fones,coalesce(ed.docs,'{}'::text[]) as docs,
    case when e.tipo='cliente' then coalesce(el.total,e.total) else e.total end as total
  from entidades e
  left join ef using(tipo,chave) left join ed using(tipo,chave) left join el using(tipo,chave)
), pino_numero as materialized (
  select n,min(p.chave) as chave from cadastro_base p,unnest(p.numeros) n
  where p.tipo='cliente' group by n having count(distinct p.chave)=1
), heranca as materialized (
  select e.chave,min(p.chave) as pino from cadastro_base e cross join lateral unnest(e.numeros) u(nz)
  join pino_numero pn on pn.n=u.nz join cadastro_base p on p.tipo='cliente' and p.chave=pn.chave
  where e.tipo='orcamento' and cardinality(p.docs)<=1
    and (cardinality(e.docs)=0 or cardinality(p.docs)=0 or e.docs&&p.docs)
  group by e.chave having count(distinct p.chave)=1
), cadastro as materialized (
  select e.tipo,e.chave,e.nome,e.cidade,e.uf,e.numeros||coalesce(p.numeros,'{}'::text[]) as numeros,
    e.fones||coalesce(p.fones,'{}'::text[]) as fones,e.docs||coalesce(p.docs,'{}'::text[]) as docs,e.total
  from cadastro_base e left join heranca h on e.tipo='orcamento' and h.chave=e.chave
  left join cadastro_base p on p.tipo='cliente' and p.chave=h.pino
), pf as (
  select nz,array_agg(distinct fc) as fones from propostas p,unnest(p.fones) fc group by nz
), pd as (
  select nz,array_agg(distinct doc) as docs from propostas where length(doc) in (11,14) and doc !~ '^0+$' group by nz
), venda_cadastro as materialized (
  select v.*,v.fones||coalesce(pf.fones,'{}'::text[]) as todos_fones,
    (case when length(v.doc) in (11,14) and v.doc !~ '^0+$' then array[v.doc] else '{}'::text[] end)||coalesce(pd.docs,'{}'::text[]) as docs
  from vendas v
  left join pf on pf.nz=v.nz left join pd on pd.nz=v.nz
), nomes_ambiguos as materialized (
  select nome||'|'||cidade||'|'||uf as token from cadastro
  where tipo='cliente' group by nome,cidade,uf having count(distinct chave)>1
), et as materialized (
  select e.tipo,e.chave,'numero' as via,n as token from cadastro e,unnest(e.numeros) n
  union select e.tipo,e.chave,'fone',f from cadastro e,unnest(e.fones) f
  union select e.tipo,e.chave,'doc',d from cadastro e,unnest(e.docs) d
  union select e.tipo,e.chave,'nome',e.nome||'|'||e.cidade||'|'||e.uf from cadastro e
    where position(' ' in e.nome)>0 and e.cidade<>'' and e.uf<>''
), vt as materialized (
  select v.id,'numero' as via,v.nz as token from venda_cadastro v where v.nz is not null
  union select v.id,'fone',f from venda_cadastro v,unnest(v.todos_fones) f
  union select v.id,'doc',d from venda_cadastro v,unnest(v.docs) d
  union select v.id,'nome',v.nome||'|'||v.cidade||'|'||v.uf from venda_cadastro v
    where position(' ' in v.nome)>0 and v.cidade<>'' and v.uf<>''
), casamentos as materialized (
  select distinct e.tipo,e.chave,v.id
  from et join vt on vt.via=et.via and vt.token=et.token
  join cadastro e on e.tipo=et.tipo and e.chave=et.chave
  join venda_cadastro v on v.id=vt.id
  where (et.via='numero' or cardinality(e.docs)=0 or cardinality(v.docs)=0 or e.docs&&v.docs)
    and (et.via<>'nome' or (
    not exists(select 1 from nomes_ambiguos a where a.token=et.token)
    and cardinality(e.docs)<=1
    and (cardinality(e.fones)=0 or cardinality(v.todos_fones)=0 or e.fones&&v.todos_fones)
  ))
)
select e.tipo,e.chave,e.uf,count(v.id)>0 as vendido,count(v.id)::integer as n_vendas,
  case when e.tipo='cliente' and count(v.id)>0 then coalesce(nullif(sum(v.valor),0),e.total) else e.total end as total
from cadastro e left join casamentos c on c.tipo=e.tipo and c.chave=e.chave
left join vendas v on v.id=c.id group by e.tipo,e.chave,e.uf,e.total;
create unique index mv_mapa_conversoes_key on public.mv_mapa_conversoes(tipo,chave);
revoke all on public.mv_mapa_conversoes from public, anon, authenticated;

-- Entrega somente correções de registros que o chamador já pode ler. Não expõe
-- documentos, telefones dos pedidos nem a carteira de outros estados.
create or replace function public.mapa_conversoes()
returns table(tipo text,chave text,vendido boolean,n_vendas integer,total numeric)
language sql stable security definer set search_path='' as $$
  select c.tipo,c.chave,c.vendido,c.n_vendas,c.total from public.mv_mapa_conversoes c
  where auth.uid() is not null and (not public.papel_restrito() or (
    public.papel_mapa() and c.tipo='visita' and exists(select 1 from public.cliente_dados_visita v where v.id::text=c.chave and v.visitar is true)))
    and (public.ufs_visiveis() is null or c.uf=any(public.ufs_visiveis()))
$$;
revoke all on function public.mapa_conversoes() from public,anon;
grant execute on function public.mapa_conversoes() to authenticated,service_role;

-- Preserva as portas e assinaturas das RPCs já usadas em toda a aplicação.
do $migration$
declare d text;
begin
  d:=pg_get_functiondef('public.mapa_orcamentos_v2()'::regprocedure);
  if position('f.vendido, f.n_vendas' in d)=0 then raise exception 'Revisar mapa_orcamentos_v2: definição alterada'; end if;
  d:=replace(d,'f.total,','coalesce(c.total,f.total) as total,');
  d:=replace(d,'f.vendido, f.n_vendas,','coalesce(c.vendido,f.vendido) as vendido, coalesce(c.n_vendas,f.n_vendas) as n_vendas,');
  d:=replace(d,'from public.mv_mapa_orcamentos f','from public.mv_mapa_orcamentos f left join public.mv_mapa_conversoes c on c.tipo=''cliente'' and c.chave=f.cli_key');
  execute d;
  d:=pg_get_functiondef('public.lista_orcamentos_mapa()'::regprocedure);
  if position('m.vendido,' in d)=0 then raise exception 'Revisar lista_orcamentos_mapa: definição alterada'; end if;
  d:=replace(d,'m.vendido,','coalesce(c.vendido,m.vendido) as vendido,');
  d:=replace(d,'from public.mv_lista_orcamentos_mapa m','from public.mv_lista_orcamentos_mapa m left join public.mv_mapa_conversoes c on c.tipo=''orcamento'' and c.chave=coalesce(m.numero,'''')||''|''||private.mapa_nome(m.cliente)||''|''||private.mapa_nome(m.cidade)||''|''||upper(btrim(coalesce(m.uf,'''')))');
  execute d;
end $migration$;

-- SECURITY INVOKER mantém as policies da tabela de visitas; a função auxiliar
-- retorna somente a situação, com o mesmo recorte por UF do mapa.
create or replace function public.mapa_visitas_clientes()
returns table(id uuid,telefone text,nome text,cidade text,estado text,interesse text,visitar boolean,
  vendedor_nome text,etiquetas text[],valor_negociando numeric,lat double precision,lng double precision,
  created_at timestamptz,vendido boolean,n_vendas integer)
language sql stable security invoker set search_path='' as $$
  select v.id,v.telefone,v.nome,v.cidade,v.estado,v.interesse,v.visitar,v.vendedor_nome,
    v.etiquetas,v.valor_negociando,v.lat,v.lng,v.created_at,coalesce(c.vendido,false),coalesce(c.n_vendas,0)
  from public.cliente_dados_visita v left join public.mapa_conversoes() c on c.tipo='visita' and c.chave=v.id::text
  order by v.created_at desc
$$;
revoke all on function public.mapa_visitas_clientes() from public,anon;
grant execute on function public.mapa_visitas_clientes() to authenticated,service_role;

-- Atualiza as três bases em sequência, evitando que a conversão leia um pino
-- anterior à lista. Mantém a cadência existente de cinco minutos.
select cron.alter_job(jobid,active := false) from cron.job where jobname='refresh-mv-mapa-orcamentos-5min';
select cron.alter_job(jobid,command := 'refresh materialized view concurrently public.mv_mapa_orcamentos; refresh materialized view concurrently public.mv_lista_orcamentos_mapa; set local enable_nestloop=off; set local jit=off; refresh materialized view concurrently public.mv_mapa_conversoes;')
from cron.job where jobname='refresh-mv-lista-orcamentos-mapa-5min';
