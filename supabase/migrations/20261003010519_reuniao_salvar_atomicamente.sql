-- A ata e suas perdas devem ser confirmadas juntas. Uma falha na nova lista
-- reverte também o upsert e a exclusão anterior, conservando a reunião salva.
create or replace function public.reuniao_salvar_atomicamente(
  p_time_slug text,
  p_data date,
  p_conduzida_por text,
  p_funcionando text,
  p_melhorar text,
  p_proximos_passos text,
  p_perdas jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_time_slug is null or btrim(p_time_slug) = '' or p_data is null then
    raise exception 'Time e data da reunião são obrigatórios.' using errcode = '22023';
  end if;
  if p_perdas is null or jsonb_typeof(p_perdas) <> 'array' then
    raise exception 'A lista de perdas deve ser um array.' using errcode = '22023';
  end if;

  -- ON CONFLICT mantém o bloqueio desta ata até o fim da transação, evitando
  -- que dois salvamentos misturem as respectivas listas de perdas.
  insert into public.reuniao_time (
    time_slug, data, conduzida_por, funcionando, melhorar, proximos_passos, atualizado_em
  ) values (
    p_time_slug, p_data, nullif(p_conduzida_por, ''), nullif(p_funcionando, ''),
    nullif(p_melhorar, ''), nullif(p_proximos_passos, ''), now()
  )
  on conflict (time_slug, data) do update set
    conduzida_por = excluded.conduzida_por,
    funcionando = excluded.funcionando,
    melhorar = excluded.melhorar,
    proximos_passos = excluded.proximos_passos,
    atualizado_em = excluded.atualizado_em
  returning id into v_id;

  delete from public.reuniao_perda where reuniao_id = v_id;
  insert into public.reuniao_perda (reuniao_id, cliente, vendedor_nome, valor, motivo, concorrente)
  select v_id, p.cliente, nullif(p.vendedor_nome, ''), p.valor, nullif(p.motivo, ''),
    case when position('concorrente' in coalesce(p.motivo, '')) > 0
      then nullif(p.concorrente, '') else null end
  from jsonb_to_recordset(p_perdas) as p(
    cliente text, vendedor_nome text, valor numeric, motivo text, concorrente text
  )
  where btrim(p.cliente) <> '';

  return v_id;
end;
$$;

revoke all on function public.reuniao_salvar_atomicamente(text, date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.reuniao_salvar_atomicamente(text, date, text, text, text, text, jsonb) to authenticated;
