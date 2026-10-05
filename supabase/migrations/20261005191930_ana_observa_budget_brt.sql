create or replace function public.ana_observa_reservar() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; custo numeric; exec_id bigint; dia date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 perform pg_advisory_xact_lock(hashtext('ana-observa-budget'));
 select valor->'v' into cfg from public.ia_config where chave='ana_revisor';
 if coalesce(cfg->>'ativo','false')<>'true' or coalesce(cfg->>'llm','false')<>'true' or nullif(cfg->>'modelo','') is null or not coalesce((cfg->>'preco_in_mtok')::numeric between 0.01 and 2,false) or not coalesce((cfg->>'preco_out_mtok')::numeric between 0.01 and 10,false) or cfg->>'teto_usd_dia' is null then return jsonb_build_object('ok',false,'motivo','revisor_indisponivel'); end if;
 if exists(select 1 from public.ana_observa_reservas where ana_observa_reservas.dia=(now() at time zone 'America/Sao_Paulo')::date) then return jsonb_build_object('ok',false,'motivo','rodada_diaria_registrada'); end if;
 select coalesce(sum(custo_usd),0) into custo from public.ana_revisor_execucoes where iniciado_em>=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 if custo+0.05>least(1,(cfg->>'teto_usd_dia')::numeric) then return jsonb_build_object('ok',false,'motivo','teto_compartilhado'); end if;
 if exists(select 1 from public.ana_revisor_execucoes where terminado_em is null and iniciado_em>now()-interval '10 minutes') then return jsonb_build_object('ok',false,'motivo','revisor_em_execucao'); end if;
 insert into public.ana_revisor_execucoes(modo,iniciado_em,custo_usd,detalhe) values('vendedores_observacao',now(),0.05,jsonb_build_object('reserva',true,'sem_publicacao',true)) returning id into exec_id;
 insert into public.ana_observa_reservas values(dia,exec_id);
 return jsonb_build_object('ok',true,'id',exec_id,'modelo',cfg->>'modelo','preco_in_mtok',cfg->'preco_in_mtok','preco_out_mtok',cfg->'preco_out_mtok','teto_rodada',0.05);
end $$;
revoke all on function public.ana_observa_reservar() from public,anon,authenticated;
grant execute on function public.ana_observa_reservar() to service_role;
