-- Equipamento vem dos mesmos orçamentos/vendas que já determinam o valor do ponto.
-- Baseline live pg_get_viewdef(...,true) SHA256:
-- bf3f5f912b3cb88dca40ae5c28499b5e7daef247fb13868ef92d86fa3bb522c3
-- Baseline live pg_get_functiondef(mapa_orcamentos_v2()) SHA256:
-- 380e48f5afc19691ae6f870a4cc6f20067c56d24b79ba406e8979ccca4596ce3
-- PostgreSQL exige recriar a MV e a função para acrescentar colunas ao retorno.
-- Sem CASCADE: uma dependência inesperada aborta a migração inteira.
set local enable_nestloop=off;
set local jit=off;

do $migration$
declare
  view_sql text := pg_get_viewdef('public.mv_mapa_conversoes'::regclass,true);
  rpc_sql text := pg_get_functiondef('public.mapa_orcamentos_v2()'::regprocedure);
  view_owner text;
  rpc_owner text;
  view_comment text;
  rpc_comment text;
  indexes text[];
  saved_acl jsonb;
  entry record;
  acl_row jsonb;
  object_sql text;
  role_sql text;
  targets text[] := array[
$target$ AS doc
           FROM orcamentos_gerados o$target$,
$target$ AS regexp_replace
           FROM orcamentos_legado l$target$,
$target$ AS valor
           FROM mirror_pedidos_venda p$target$,
$target$v_1.valor
           FROM vendas_mapa v_1$target$,
$target$ AS fone_local
           FROM vendas_raw v_1$target$,
$target$p.doc
           FROM entidades e_1,$target$,
$target$ep.total
           FROM ep
          ORDER BY$target$,
$target$END AS total
   FROM cadastro e$target$,
$target$LEFT JOIN vendas v ON v.id = c.id
  GROUP BY$target$
  ];
  replacements text[] := array[
$replacement$ AS doc,
            coalesce((
              select string_agg(coalesce(it->>'qtd','1') || 'x ' || (it->>'nome'), ' + ' order by ord)
              from jsonb_array_elements(case when jsonb_typeof(o.itens)='array' then o.itens else '[]'::jsonb end) with ordinality items(it,ord)
            ), nullif(o.modelo_basename,'')) as equipamento
           FROM orcamentos_gerados o$replacement$,
$replacement$ AS regexp_replace,
            l.equipamento
           FROM orcamentos_legado l$replacement$,
$replacement$ AS valor,
            coalesce(nullif(btrim(p.raw->>'descricao_equipamento'),''),
              (select string_agg(coalesce(it->>'quantidade',it->>'qtd','1') || 'x ' || coalesce(it->>'descricao',it->>'nome'), ' + ' order by ord)
               from jsonb_array_elements(case
                 when jsonb_typeof(p.raw->'equipamentos_detalhados')='array' then p.raw->'equipamentos_detalhados'
                 when jsonb_typeof(p.raw->'equipamentos_json')='array' then p.raw->'equipamentos_json'
                 else '[]'::jsonb end) with ordinality items(it,ord))) as equipamento
           FROM mirror_pedidos_venda p$replacement$,
$replacement$v_1.valor,
            v_1.equipamento
           FROM vendas_mapa v_1$replacement$,
$replacement$ AS fone_local,
            v_1.equipamento
           FROM vendas_raw v_1$replacement$,
$replacement$p.doc,
            p.equipamento
           FROM entidades e_1,$replacement$,
$replacement$ep.total,
            ep.equipamento
           FROM ep
          ORDER BY$replacement$,
$replacement$END AS total,
    case
      when e.tipo='cliente' and count(v.id)>0 then
        case when sum(v.valor) is not distinct from coalesce(nullif(sum(v.valor),0),e.total)
          then string_agg(nullif(btrim(v.equipamento),''), E'\n' order by v.id)
          else null::text end
      when max(el.total) is not distinct from e.total then max(el.equipamento)
      else null::text
    end as equipamento
   FROM cadastro e$replacement$,
$replacement$LEFT JOIN vendas v ON v.id = c.id
     LEFT JOIN el ON el.tipo=e.tipo and el.chave=e.chave
  GROUP BY$replacement$
  ];
  i integer;
begin
  select pg_get_userbyid(c.relowner),obj_description(c.oid,'pg_class')
    into view_owner,view_comment from pg_class c where c.oid='public.mv_mapa_conversoes'::regclass;
  select pg_get_userbyid(p.proowner),obj_description(p.oid,'pg_proc')
    into rpc_owner,rpc_comment from pg_proc p where p.oid='public.mapa_orcamentos_v2()'::regprocedure;
  select array_agg(pg_get_indexdef(indexrelid) order by indexrelid)
    into indexes from pg_index where indrelid='public.mv_mapa_conversoes'::regclass;
  select jsonb_agg(to_jsonb(a)) into saved_acl from (
    select 'view' as kind,case when a.grantee=0 then null else pg_get_userbyid(a.grantee) end as role,a.privilege_type,a.is_grantable
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='public.mv_mapa_conversoes'::regclass
    union all
    select 'rpc',case when a.grantee=0 then null else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.mapa_orcamentos_v2()'::regprocedure
  ) a;

  -- Exigir cada trecho exatamente uma vez evita alterar silenciosamente outra versão.
  for i in 1..array_length(targets,1) loop
    if (length(view_sql)-length(replace(view_sql,targets[i],'')))/length(targets[i]) <> 1 then
      raise exception 'mv_mapa_conversoes: trecho % mudou; migração não aplicada',i;
    end if;
    view_sql := replace(view_sql,targets[i],replacements[i]);
  end loop;
  if (length(rpc_sql)-length(replace(rpc_sql,'vendedor_fonte text)','')))/length('vendedor_fonte text)') <> 1
     or (length(rpc_sql)-length(replace(rpc_sql,E'end as vendedor_fonte\n  from','')))/length(E'end as vendedor_fonte\n  from') <> 1 then
    raise exception 'mapa_orcamentos_v2: retorno/seleção mudou; migração não aplicada';
  end if;
  rpc_sql := replace(rpc_sql,'vendedor_fonte text)','vendedor_fonte text, equipamento text)');
  rpc_sql := replace(rpc_sql,E'end as vendedor_fonte\n  from',E'end as vendedor_fonte,\n         c.equipamento\n  from');

  drop function public.mapa_orcamentos_v2();
  drop materialized view public.mv_mapa_conversoes;
  execute 'create materialized view public.mv_mapa_conversoes as ' || view_sql;
  execute format('alter materialized view public.mv_mapa_conversoes owner to %I',view_owner);
  foreach object_sql in array coalesce(indexes,array[]::text[]) loop
    execute object_sql;
  end loop;
  execute rpc_sql;
  execute format('alter function public.mapa_orcamentos_v2() owner to %I',rpc_owner);
  if view_comment is not null then
    execute format('comment on materialized view public.mv_mapa_conversoes is %L',view_comment);
  end if;
  if rpc_comment is not null then
    execute format('comment on function public.mapa_orcamentos_v2() is %L',rpc_comment);
  end if;

  -- Remover os grants de criação (incluindo default privileges) e restaurar ACLs.
  for entry in
    select 'view' as kind,a.grantee from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='public.mv_mapa_conversoes'::regclass and a.grantee<>c.relowner
    union
    select 'rpc',a.grantee from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.mapa_orcamentos_v2()'::regprocedure and a.grantee<>p.proowner
  loop
    object_sql := case when entry.kind='view' then 'table public.mv_mapa_conversoes' else 'function public.mapa_orcamentos_v2()' end;
    role_sql := case when entry.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(entry.grantee)) end;
    execute 'revoke all on ' || object_sql || ' from ' || role_sql;
  end loop;
  for acl_row in select value from jsonb_array_elements(saved_acl) loop
    object_sql := case when acl_row->>'kind'='view' then 'table public.mv_mapa_conversoes' else 'function public.mapa_orcamentos_v2()' end;
    role_sql := case when acl_row->>'role' is null then 'PUBLIC' else quote_ident(acl_row->>'role') end;
    execute 'grant ' || (acl_row->>'privilege_type') || ' on ' || object_sql || ' to ' || role_sql
      || case when (acl_row->>'is_grantable')::boolean then ' with grant option' else '' end;
  end loop;
end
$migration$;

notify pgrst, 'reload schema';
