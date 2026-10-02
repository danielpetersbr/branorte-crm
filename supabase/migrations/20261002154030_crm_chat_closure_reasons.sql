-- Transactional closure, using real ANA labels. No message is sent by this migration.
set local lock_timeout='500ms';

alter table public.crm_chat_conversations add column resolution_label_id text;
alter table public.crm_chat_conversations add column ana_paused_at timestamptz;
alter table public.crm_chat_conversations add column ana_blocked_at timestamptz;
comment on column public.crm_chat_conversations.ana_paused_at is 'CRM closure marker: automation waits for a genuinely new inbound. Independent of human takeover and permanent IA block.';
comment on column public.crm_chat_conversations.ana_blocked_at is 'CRM sticky automation silence. Removing it still requires a new genuine inbound.';

-- Source commands are written by the authorized dispatcher or the service only.
create policy crm_close_actions_insert on public.funil_fluxo_acoes as restrictive for insert to anon,authenticated
 with check(not (payload ? 'crm_close' or coalesce(payload->>'origem'='crm_chat_resolve',false)));
create policy crm_close_actions_update on public.funil_fluxo_acoes as restrictive for update to anon,authenticated
 using(not (payload ? 'crm_close' or coalesce(payload->>'origem'='crm_chat_resolve',false))) with check(not (payload ? 'crm_close' or coalesce(payload->>'origem'='crm_chat_resolve',false)));
create policy crm_close_actions_delete on public.funil_fluxo_acoes as restrictive for delete to anon,authenticated
 using(not (payload ? 'crm_close' or coalesce(payload->>'origem'='crm_chat_resolve',false)));
revoke truncate,references,trigger on public.funil_fluxo_acoes from anon,authenticated;

create function private.crm_chat_genuine_inbound(p_type text,p_body text) returns boolean
language plpgsql immutable set search_path='' as $function$
declare body text:=lower(btrim(public.sem_acento(coalesce(p_body,'')))); plain text; normalized text;
begin
 if p_type in('audio','ptt','image','document','video') then return true;end if;
 if coalesce(p_type,'') not in('chat','text') then return false;end if;
 if body='' then return false;end if;
 -- Strip URLs before deciding. A bare link, sticker or system event is not a new request.
 plain:=btrim(regexp_replace(body,'(https?://|www\.)[^[:space:]]+','','g'));
 if plain='' then return false;end if;
 normalized:=btrim(regexp_replace(plain,'[^a-z0-9[:space:]]','','g'));
 if normalized='' or normalized ~ '^(oi|ola|opa|oie|bom dia|boa tarde|boa noite|tudo bem|tudo bom|obrigad[oa]|valeu|ok|sim|nao|deus abencoe)([[:space:]]+(oi|ola|bom dia|boa tarde|boa noite|tudo bem|tudo bom|obrigad[oa]|valeu|ok|sim|nao))*$' then return false;end if;
 -- A real question or commercial request overrides an otherwise devotional message.
 if plain like '%?%' or plain ~ '\m(preco|orcamento|comprar|compra|compre|cotacao|equipamento|maquina|fabrica|fabricar|producao|racao|misturador|moedor|compacta|entrega|frete|pagamento|pedido|peca|assistencia|garantia)\M|\m(peletiz|extrus)' then return true;end if;
 if body ~ '(corrente|compartilhe|repasse|envie para|mande para|deus|jesus|versiculo|salmo|evangelho|oracao|amem|bencao)' then return false;end if;
 return true;
end $function$;
revoke all on function private.crm_chat_genuine_inbound(text,text) from public,anon,authenticated;

create function private.crm_chat_inbound_may_reopen(c public.crm_chat_conversations,p_type text,p_body text,p_at timestamptz) returns boolean
language sql stable set search_path='' as $function$
 select c.status='open' or (c.ana_blocked_at is null and not c.human_hold and (c.lock_until is null or c.lock_until<=now())
  and not exists(select 1 from public.ia_atendimentos ia where ia.vendedor_nome='ANA' and ia.chat_id=c.wa_chat_id
    and (ia.bloqueado_em is not null or ia.estado='HUMAN_TAKEOVER'))
  and p_at>coalesce(c.ana_paused_at,c.resolved_at,c.resolution_observed_at,c.last_message_at)
  and private.crm_chat_genuine_inbound(p_type,p_body));
$function$;
revoke all on function private.crm_chat_inbound_may_reopen(public.crm_chat_conversations,text,text,timestamptz) from public,anon,authenticated;

-- Preserve the current history/autorship/media sync; only gate its four reopen expressions.
do $patch$
declare source text:=pg_get_functiondef('private.crm_chat_sync_message()'::regprocedure);
 needle text:='not new.from_me and new.data_msg>existing.last_message_at';
 replacement text:='not new.from_me and new.data_msg>existing.last_message_at and private.crm_chat_inbound_may_reopen(existing,new.tipo,new.body,new.data_msg)';
begin
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>4 then raise exception 'Unexpected CRM history function; review before deploying.';end if;
 if position('if new.vendedor_nome <> ''ANA'' or' in source)=0 then raise exception 'Unexpected CRM history vendor guard';end if;
 source:=replace(source,'if new.vendedor_nome <> ''ANA'' or','if new.from_me is null or new.vendedor_nome <> ''ANA'' or');
 execute replace(source,needle,replacement);
end $patch$;

create function private.crm_chat_closure_inbound() returns trigger
language plpgsql security definer set search_path='' as $function$
declare c public.crm_chat_conversations;
begin
 if new.vendedor_nome<>'ANA' or new.from_me is distinct from false or not private.crm_chat_genuine_inbound(new.tipo,new.body) then return null;end if;
 select * into c from public.crm_chat_conversations where wa_chat_id=new.chat_id for update;
 if c.id is null or c.ana_paused_at is null or new.data_msg<=c.ana_paused_at or c.ana_blocked_at is not null
  or c.human_hold or c.lock_until>now() then return null;end if;
 -- Existing permanent block or takeover is a separate decision and remains intact.
 if exists(select 1 from public.ia_atendimentos ia where ia.chat_id=new.chat_id and ia.vendedor_nome='ANA'
  and (ia.bloqueado_em is not null or ia.estado='HUMAN_TAKEOVER')) then return null;end if;
 update public.crm_chat_conversations set ana_paused_at=null,status='open',resolved_at=null,resolution_source=null,
  resolution_reason=null,resolution_label_id=null,resolution_observed_at=null,updated_at=now() where id=c.id;
 update public.ia_atendimentos set ativo=true,estado='AI_ACTIVE',estado_desde=now(),estado_motivo=null,
  motivo_desligamento=null,ligado_em=now(),atualizado_em=now(),assumido_por=null,assumido_em=null
  where chat_id=new.chat_id and vendedor_nome='ANA' and motivo_desligamento='crm_finalizado' and bloqueado_em is null;
 update public.funil_fluxo_acoes set status='cancelada',erro='Encerramento superado por nova mensagem do cliente.'
  where vendedor_nome='ANA' and chat_id=new.chat_id and status='pendente' and payload ? 'crm_close';
 return null;
end $function$;
revoke all on function private.crm_chat_closure_inbound() from public,anon,authenticated;
create trigger crm_chat_z_closure_inbound after insert on public.wa_chat_messages
 for each row execute function private.crm_chat_closure_inbound();

create function public.crm_ana_automation_gate(p_chat_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare c public.crm_chat_conversations;
begin
 select * into c from public.crm_chat_conversations where wa_chat_id=p_chat_id;
 if c.human_hold or c.lock_until>now() then return jsonb_build_object('allowed',false,'reason','crm_human_hold');end if;
 if c.ana_blocked_at is not null then return jsonb_build_object('allowed',false,'reason','crm_ana_blocked');end if;
 if c.ana_paused_at is not null then return jsonb_build_object('allowed',false,'reason','crm_closed_until_inbound');end if;
 if exists(select 1 from public.ia_atendimentos where chat_id=p_chat_id and vendedor_nome='ANA' and bloqueado_em is not null) then
  return jsonb_build_object('allowed',false,'reason','legacy_ia_blocked');end if;
 return jsonb_build_object('allowed',true,'reason','allowed');
end $function$;
revoke all on function public.crm_ana_automation_gate(text) from public,anon,authenticated;
grant execute on function public.crm_ana_automation_gate(text) to service_role;

create function public.crm_ana_close_label_gate(p_chat_id text,p_close jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare c public.crm_chat_conversations; label_name text;
begin
 select * into c from public.crm_chat_conversations where wa_chat_id=p_chat_id;
 if c.id is null or c.id::text is distinct from p_close->>'conversation_id' or c.status is distinct from 'resolved' or c.resolution_source is distinct from 'crm'
  or c.ana_paused_at is null or c.resolution_label_id is distinct from p_close->>'label_id' then
  return jsonb_build_object('allowed',false,'reason','stale_crm_close');end if;
 begin
  if c.ana_paused_at is distinct from (p_close->>'marker')::timestamptz then return jsonb_build_object('allowed',false,'reason','stale_crm_close');end if;
 exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('allowed',false,'reason','invalid_marker');end;
 select e.etiqueta_nome into label_name from public.wascript_etiquetas e where e.vendedor_nome='ANA'
  and e.etiqueta_id_wascript::text=c.resolution_label_id and public.wa_status_da_etiqueta(e.etiqueta_nome)='FECHADO';
 if label_name is null then return jsonb_build_object('allowed',false,'reason','closure_label_unavailable');end if;
 return jsonb_build_object('allowed',true,'reason','current_crm_close','label_id',c.resolution_label_id,'label_name',label_name);
end $function$;
revoke all on function public.crm_ana_close_label_gate(text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_ana_close_label_gate(text,jsonb) to service_role;

-- Keep the reviewed dispatcher as the immutable implementation of every other action.
alter function private.crm_chat(text,jsonb) rename to crm_chat_before_closure_reasons;
revoke all on function private.crm_chat_before_closure_reasons(text,jsonb) from public,anon,authenticated;
create function private.crm_chat(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare p public.user_profiles; c public.crm_chat_conversations; cid uuid; session_id uuid; label_id text; label_name text;
 blocked boolean; stamp timestamptz; result jsonb;
begin
 if p_action not in('close_options','resolve','unblock_ana') then
  result:=private.crm_chat_before_closure_reasons(p_action,p_args);
  if p_action in('claim','reopen') then
   update public.crm_chat_conversations set resolution_label_id=null where id=(p_args->>'id')::uuid and resolution_label_id is not null;
  end if;
  if p_action='list' then
   return jsonb_set(result,'{items}',coalesce((select jsonb_agg(i.item||jsonb_build_object('resolution_label_id',cv.resolution_label_id,
    'ana_paused_at',cv.ana_paused_at,'ana_blocked_at',cv.ana_blocked_at) order by i.ordinality)
    from jsonb_array_elements(result->'items') with ordinality i(item,ordinality)
    join public.crm_chat_conversations cv on cv.id=(i.item->>'id')::uuid),'[]'::jsonb));
  end if;
  return result;
 end if;
 p:=private.crm_chat_profile();cid:=nullif(p_args->>'id','')::uuid;
 select * into c from public.crm_chat_conversations where id=cid;
 if c.id is null or (p.role<>'admin' and c.vendor_id is distinct from p.vendor_id) then
  raise exception 'Conversa não autorizada.' using errcode='42501';end if;
 if p_action='close_options' then
  return jsonb_build_object('reasons',(select coalesce(jsonb_agg(jsonb_build_object('id',e.etiqueta_id_wascript::text,'name',e.etiqueta_nome) order by e.etiqueta_nome),'[]'::jsonb)
   from public.wascript_etiquetas e where e.vendedor_nome='ANA' and public.wa_status_da_etiqueta(e.etiqueta_nome)='FECHADO'));
 end if;
 select * into c from public.crm_chat_conversations where id=cid for update;
 if c.id is null or (p.role<>'admin' and c.vendor_id is distinct from p.vendor_id) then raise exception 'Conversa transferida para outra carteira.' using errcode='42501';end if;
 session_id:=nullif(p_args->>'session','')::uuid;
 if c.lock_until>now() and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then
  raise exception 'Outra sessão está atendendo esta conversa.' using errcode='55P03';end if;
 if p_action='unblock_ana' then
  if c.ana_blocked_at is not null then update public.crm_chat_conversations set ana_blocked_at=null,
   ana_paused_at=clock_timestamp(),updated_at=now() where id=cid;end if;
  return jsonb_build_object('ok',true);
 end if;
 label_id:=nullif(p_args->>'reason_id','');
 select e.etiqueta_nome into label_name from public.wascript_etiquetas e where e.vendedor_nome='ANA'
  and e.etiqueta_id_wascript::text=label_id and public.wa_status_da_etiqueta(e.etiqueta_nome)='FECHADO';
 if label_name is null then raise exception 'Escolha um motivo de encerramento disponível da Ana.' using errcode='22023';end if;
 if p_args ? 'block_automation' and jsonb_typeof(p_args->'block_automation')<>'boolean' then raise exception 'Opção de automação inválida.' using errcode='22023';end if;
 blocked:=coalesce((p_args->>'block_automation')::boolean,false);
 if exists(select 1 from public.wa_scheduled_messages q where q.vendedor_nome='ANA' and q.chat_id=c.wa_chat_id and not coalesce(q.to_self,false)
   and (q.status='sending' or (q.status='pending' and q.crm_request_id is not null))) then
  raise exception 'Aguarde os envios pendentes antes de finalizar.' using errcode='55P03';end if;
 if c.status='resolved' and c.ana_paused_at is not null and c.resolution_label_id=label_id then
  if blocked and c.ana_blocked_at is null then update public.crm_chat_conversations set ana_blocked_at=now(),updated_at=now() where id=cid;end if;
  return jsonb_build_object('ok',true);
 end if;
 stamp:=clock_timestamp();
 update public.crm_chat_conversations set status='resolved',human_hold=false,lock_user_id=null,lock_session_id=null,lock_until=null,
  manual_status_at=stamp,resolution_source='crm',resolution_reason=label_name,resolution_label_id=label_id,resolution_observed_at=null,
  resolved_at=stamp,ana_paused_at=stamp,ana_blocked_at=case when blocked then coalesce(ana_blocked_at,stamp) else ana_blocked_at end,updated_at=stamp where id=cid;
 update public.ia_atendimentos set ativo=false,estado='AI_PAUSED',estado_desde=stamp,estado_motivo='Encerramento no CRM',
  motivo_desligamento='crm_finalizado',assumido_por=null,assumido_em=null,atualizado_em=stamp where vendedor_nome='ANA' and chat_id=c.wa_chat_id;
 update public.wa_scheduled_messages set status='cancelled',error='Atendimento finalizado no CRM.'
  where vendedor_nome='ANA' and chat_id=c.wa_chat_id and status='pending' and crm_request_id is null and not coalesce(to_self,false);
 update public.funil_fluxo_acoes set status='cancelada',erro='Encerramento substituído no CRM.'
  where vendedor_nome='ANA' and chat_id=c.wa_chat_id and status='pendente' and payload ? 'crm_close';
 insert into public.funil_fluxo_acoes(chat_id,vendedor_nome,tipo,payload)
  values(c.wa_chat_id,'ANA','mover_etiqueta',jsonb_build_object('origem','crm_chat_resolve','etiqueta',label_name,'crm_close',jsonb_build_object('conversation_id',cid,'marker',stamp,'label_id',label_id)));
 return jsonb_build_object('ok',true);
end $function$;
revoke all on function private.crm_chat(text,jsonb) from public,anon;
grant execute on function private.crm_chat(text,jsonb) to authenticated;

-- Late AI producers still cannot queue customer messages after the shutdown transaction.
create or replace function private.crm_chat_queue_guard() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
 if tg_op='INSERT' and new.vendedor_nome='ANA' and new.crm_request_id is null and not coalesce(new.to_self,false) then
  perform 1 from public.crm_chat_conversations c where c.wa_chat_id=new.chat_id for update;
 end if;
 if tg_op='INSERT' and new.vendedor_nome='ANA' and new.crm_request_id is null and not coalesce(new.to_self,false)
  and exists(select 1 from public.crm_chat_conversations c where c.wa_chat_id=new.chat_id
   and (c.human_hold or c.ana_paused_at is not null or c.ana_blocked_at is not null)) then
  new.status:='cancelled';new.error:='Automação da Ana pausada no CRM.';
 end if;
 if tg_op='UPDATE' and old.crm_request_id is not null then
  if old.status='sending' and new.status='pending' then new.status:='failed';new.error:='Confirmação incerta. Confira no WhatsApp antes de enviar novamente.';
  elsif new.status='sent' and coalesce(new.error,'') ilike '%sem confirmacao%' then new.status:='failed';new.error:='Confirmação incerta no WhatsApp. Não reenviar sem conferir.';end if;
 end if;
 return new;
end $function$;
-- Preserve conversation-before-queue locking and service-only execute grants.
create or replace function public.crm_chat_queue_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare q public.wa_scheduled_messages; c public.crm_chat_conversations;
begin
 select * into q from public.wa_scheduled_messages where id=p_id;
 if q.id is null then return null;end if;
 if q.vendedor_nome='ANA' then
  select * into c from public.crm_chat_conversations where wa_chat_id=q.chat_id for update;
  if (c.human_hold or c.ana_paused_at is not null or c.ana_blocked_at is not null) and q.crm_request_id is null and not coalesce(q.to_self,false) then return null;end if;
 end if;
 update public.wa_scheduled_messages set status='sending' where id=p_id and status='pending' returning * into q;
 if q.id is null then return null;end if;
 return to_jsonb(q);
end $function$;
