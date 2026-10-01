-- Apply the dashboard compact snapshot migration before running this regression.
-- Compares every field against direct reads of the same view under real roles.
-- No application rows are written, and claims/role/settings disappear at rollback.
begin;
set local statement_timeout = '15s';

do $$
declare
  columns text[] := array['id','nome','telefone','responsavel','criativo_codigo','origem','motivo_contato','finalidade_fabrica','qual_animal','quantos_animais','quando_investir','tocou_botao_em','o_que_precisa','data','last_message_at','is_internal','chegou_no_vendedor','orcamento_enviado','orcamento_valor','status_real','status_vendedor','finished_at'];
  admin_id uuid; vendor_id uuid; subject uuid; snapshot jsonb; baseline jsonb;
  decoded jsonb; started timestamptz; elapsed numeric; results jsonb := '[]'::jsonb;
begin
  if to_regprocedure('auditoria.dashboard_snapshot()') is null then
    raise exception 'Apply dashboard_snapshot migration first';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='auditoria' and p.proname='dashboard_snapshot' and p.prosecdef) then
    raise exception 'Snapshot must remain SECURITY INVOKER';
  end if;
  if has_function_privilege('anon','auditoria.dashboard_snapshot()','EXECUTE')
    or not has_function_privilege('authenticated','auditoria.dashboard_snapshot()','EXECUTE')
    or not has_function_privilege('service_role','auditoria.dashboard_snapshot()','EXECUTE') then
    raise exception 'Unexpected snapshot execution grants';
  end if;

  select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
  select p.id into vendor_id from public.user_profiles p join public.vendors v on v.id=p.vendor_id
    where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
  if admin_id is null or vendor_id is null then raise exception 'Approved admin and active vendor required'; end if;

  execute 'set local role anon';
  begin
    perform auditoria.dashboard_snapshot();
    raise exception 'Anonymous snapshot invocation succeeded';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  foreach subject in array array[admin_id,vendor_id] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',subject::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);

    started := clock_timestamp();
    snapshot := auditoria.dashboard_snapshot()::jsonb;
    elapsed := extract(epoch from clock_timestamp()-started)*1000;
    if snapshot->'columns' is distinct from to_jsonb(columns)
      or jsonb_typeof(snapshot->'rows') is distinct from 'array' then
      raise exception 'Snapshot column order/row shape changed';
    end if;
    if jsonb_array_length(snapshot->'rows')>50000 then raise exception 'Snapshot exceeded legacy limit'; end if;
    if exists(select 1 from jsonb_array_elements(snapshot->'rows') r
      where jsonb_typeof(r.value)<>'array' or jsonb_array_length(r.value)<>22) then
      raise exception 'Snapshot has truncated/invalid rows';
    end if;

    -- Independent baseline: named JSON objects, not the compact function's array construction.
    select coalesce(jsonb_agg(to_jsonb(t) order by t.data desc nulls last,t.id),'[]'::jsonb)
      into baseline from (
      select id,nome,telefone,responsavel,criativo_codigo,origem,motivo_contato,
        finalidade_fabrica,qual_animal,quantos_animais,quando_investir,tocou_botao_em,
        o_que_precisa,data,last_message_at,is_internal,chegou_no_vendedor,
        orcamento_enviado,orcamento_valor,status_real,status_vendedor,finished_at
      from auditoria.atendimentos_por_cliente where is_internal=false
      order by data desc nulls last,id limit 50000
    ) t;
    select coalesce(jsonb_agg(t.object order by t.position),'[]'::jsonb) into decoded
      from (
        select row_data.position,jsonb_object_agg(columns[cell.position::int],cell.value) as object
        from jsonb_array_elements(snapshot->'rows') with ordinality row_data(value,position)
        cross join lateral jsonb_array_elements(row_data.value) with ordinality cell(value,position)
        group by row_data.position
      ) t;
    if decoded is distinct from baseline then
      raise exception 'Snapshot differs from direct view for %: compact=% baseline=%',
        case when subject=admin_id then 'admin' else 'vendor' end,
        jsonb_array_length(decoded),jsonb_array_length(baseline);
    end if;
    results := results || jsonb_build_array(jsonb_build_object(
      'role',case when subject=admin_id then 'admin' else 'vendor' end,
      'rows',jsonb_array_length(decoded),'all_22_fields_equal',true,
      'snapshot_ms',round(elapsed,2),'jsonb_bytes',octet_length(snapshot::text)));
    execute 'reset role';
  end loop;
  perform set_config('dashboard_test.results',results::text,true);
end $$;

select 'PASS' as result,current_setting('dashboard_test.results')::jsonb as checks;
rollback;
