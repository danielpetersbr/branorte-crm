
-- Freeze only explicitly marked future seller packets; legacy queues remain unchanged.
create table public.ana_catalogo_pendencias (
 id bigint generated always as identity primary key,
 dispatch_id uuid not null unique references public.outbound_dispatch(id),
 sku text, configuracao jsonb not null default '{}'::jsonb,
 faltas jsonb not null, registrado_em timestamptz not null default now()
);
alter table public.ana_catalogo_pendencias enable row level security;
revoke all on public.ana_catalogo_pendencias from anon,authenticated;
grant select on public.ana_catalogo_pendencias to authenticated;
grant all on public.ana_catalogo_pendencias to service_role;
grant usage,select on sequence public.ana_catalogo_pendencias_id_seq to service_role;
create policy ana_catalogo_admin on public.ana_catalogo_pendencias for select to authenticated using (public.ana_painel_admin());

create function public.ana_pacote_congelar(p_id uuid,p_vendedor text,p_pacote jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.outbound_dispatch; frozen jsonb;
begin
 select * into r from public.outbound_dispatch where id=p_id for update;
 if r.id is null or r.status<>'sending' or r.vendedor_nome is distinct from p_vendedor or coalesce(r.raw_payload->'pacote_vendedor_v1'->>'v','')<>'1'
 or r.raw_payload->'pacote_vendedor_v1'->>'conta' is distinct from p_vendedor then raise exception 'pacote_fora_do_escopo'; end if;
 frozen:=r.raw_payload->'_super_ia_pacote';
 if frozen is not null then return frozen; end if;
 if coalesce(p_pacote->>'v','')<>'1' or p_pacote->>'vendedor' is distinct from p_vendedor
 or p_pacote->>'desde' is distinct from r.raw_payload->'pacote_vendedor_v1'->>'desde'
 or jsonb_typeof(p_pacote->'passos') is distinct from 'array' or jsonb_array_length(p_pacote->'passos') not between 1 and 4
 then raise exception 'reserva_invalida'; end if;
 update public.outbound_dispatch set raw_payload=jsonb_set(raw_payload,'{_super_ia_pacote}',p_pacote,true) where id=p_id;
 if jsonb_array_length(coalesce(p_pacote->'faltas','[]'::jsonb))>0 then
 insert into public.ana_catalogo_pendencias(dispatch_id,sku,configuracao,faltas)
 values(p_id,p_pacote->'vinculo'->>'sku',p_pacote->'vinculo'-'video'-'foto'-'arte',p_pacote->'faltas') on conflict do nothing;
 end if;
 return p_pacote;
end $$;
revoke all on function public.ana_pacote_congelar(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ana_pacote_congelar(uuid,text,jsonb) to service_role;

create function public.ana_pacote_adiar(p_id uuid,p_vendedor text,p_motivo text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.outbound_dispatch; chat text; ref text;
begin
 select * into r from public.outbound_dispatch where id=p_id for update;
 if r.id is null or r.vendedor_nome is distinct from p_vendedor or coalesce(r.raw_payload->'pacote_vendedor_v1'->>'v','')<>'1' then return; end if;
 update public.outbound_dispatch set raw_payload=jsonb_set(raw_payload,'{_super_ia_reconciliacao}',jsonb_build_object('motivo',left(p_motivo,80),'em',now()),true) where id=p_id;
 select a.chat_id into chat from public.ia_atendimentos a where a.vendedor_nome='ANA' and a.dados_coletados->'_repasse'->>'dispatch_id'=p_id::text limit 1;
 select c.cliente_ref into ref from public.ana_painel_clientes c where c.chat_id=chat;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 values('pacote-reconciliacao',p_id::text,'erro_tecnico',coalesce(ref,'ana:'||chat),chat,
 jsonb_build_object('categoria','repasse','resumo','Pacote aguardando reconciliação','referencia',p_id)) on conflict do nothing;
end $$;
revoke all on function public.ana_pacote_adiar(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ana_pacote_adiar(uuid,text,text) to service_role;

-- The existing fleet confirms ordered step success to dispatch-report. Optional WhatsApp
-- message IDs are retained when supplied; an absent ID is never invented.
create function public.ana_pacote_reportar(p_id uuid,p_vendedor text,p_status text,p_msg_id text,p_aviso boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.outbound_dispatch; chat text; ref text; inc text;
begin
 select * into r from public.outbound_dispatch where id=p_id for update;
 if r.id is null or r.vendedor_nome is distinct from p_vendedor or coalesce(r.raw_payload->'pacote_vendedor_v1'->>'v','')<>'1'
 or p_status is null or p_status not in ('sent','failed','skipped') then raise exception 'reporte_fora_do_escopo'; end if;
 if r.status in ('sent','skipped') then return jsonb_build_object('cliente_telefone',r.cliente_telefone,'vendedor_nome',r.vendedor_nome); end if;
 update public.outbound_dispatch set status=p_status,
 sent_at=case when p_status='sent' then now() else null end,
 msg_id=case when p_status='sent' then coalesce(nullif(left(p_msg_id,200),''),msg_id) else msg_id end,
 erro=case when p_status='failed' then 'envio_pacote_falhou' when p_aviso then 'midia_pacote_incompleta' else null end,
 raw_payload=jsonb_set(raw_payload,'{_super_ia_confirmacao}',jsonb_build_object('em',now(),'status',p_status,'midia_incompleta',p_aviso,'msg_id_disponivel',nullif(p_msg_id,'') is not null),true)
 where id=p_id;
 select a.chat_id into chat from public.ia_atendimentos a where a.vendedor_nome='ANA' and a.dados_coletados->'_repasse'->>'dispatch_id'=p_id::text limit 1;
 select c.cliente_ref into ref from public.ana_painel_clientes c where c.chat_id=chat;
 if p_status='sent' and p_aviso then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 values('dispatch-midias',p_id::text,'erro_tecnico',coalesce(ref,'ana:'||chat),chat,jsonb_build_object('categoria','envio','resumo','Apresentação incompleta; mensagem final confirmada','referencia',p_id)) on conflict do nothing;
 end if;
 if p_status='sent' and not p_aviso then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 select 'pacote-reconciliacao',p_id::text,'recuperacao_erro',coalesce(ref,'ana:'||chat),chat,'{}'::jsonb
 where exists(select 1 from public.ana_painel_eventos e where e.origem='pacote-reconciliacao' and e.origem_ref=p_id::text and e.tipo='erro_tecnico') on conflict do nothing;
 end if;
 return jsonb_build_object('cliente_telefone',r.cliente_telefone,'vendedor_nome',r.vendedor_nome);
end $$;
revoke all on function public.ana_pacote_reportar(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.ana_pacote_reportar(uuid,text,text,text,boolean) to service_role;

create function public.ana_painel_modelo_fallback() returns trigger language plpgsql security definer set search_path='' as $$
declare ref text; begin
 if NEW.vendedor_nome='ANA' and NEW.regra_key='ia_atendente' and NEW.acao='ia_resposta'
 and nullif(NEW.payload->>'modelo_erro','') is not null then
 select c.cliente_ref into ref from public.ana_painel_clientes c where c.chat_id=NEW.chat_id;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,ocorrido_em,dados)
 values('modelo',NEW.id::text,'erro_tecnico',coalesce(ref,'ana:'||NEW.chat_id),NEW.chat_id,NEW.created_at,
 jsonb_build_object('categoria','geracao','resumo','Modelo principal falhou; resposta gerada pelo modelo reserva','referencia',NEW.id)) on conflict do nothing;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,ocorrido_em,dados)
 values('modelo',NEW.id::text,'recuperacao_erro',coalesce(ref,'ana:'||NEW.chat_id),NEW.chat_id,NEW.created_at,
 jsonb_build_object('recuperacao','geracao_por_reserva','entrega_confirmada',false)) on conflict do nothing;
 end if; return NEW;
end $$;
revoke all on function public.ana_painel_modelo_fallback() from public,anon,authenticated;
create trigger ana_painel_fallback after insert on public.automation_runs for each row execute function public.ana_painel_modelo_fallback();
