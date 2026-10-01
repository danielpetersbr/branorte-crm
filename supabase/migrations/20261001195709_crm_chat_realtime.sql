-- Private invalidation events: never broadcast message content or contact data.
create or replace function private.crm_chat_topic_allowed(topic text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p public.user_profiles;
begin
 p:=private.crm_chat_profile();
 return topic='crm-chat:catalog' or (p.role='admin' and topic='crm-chat:all')
   or (p.role='vendor' and topic='crm-chat:vendor:'||p.vendor_id::text);
exception when insufficient_privilege then return false;
end $$;
revoke all on function private.crm_chat_topic_allowed(text) from public,anon;
grant execute on function private.crm_chat_topic_allowed(text) to authenticated;
create policy crm_chat_receive on realtime.messages for select to authenticated
 using(extension='broadcast' and private.crm_chat_topic_allowed(realtime.topic()));

create function private.crm_chat_emit(p_id uuid,p_kind text,p_old_vendor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare v uuid; payload jsonb;
begin
 select vendor_id into v from public.crm_chat_conversations where id=p_id;
 payload:=jsonb_build_object('id',p_id,'kind',p_kind);
 perform realtime.send(payload,'change','crm-chat:all',true);
 if v is not null then perform realtime.send(payload,'change','crm-chat:vendor:'||v::text,true); end if;
 if p_old_vendor is not null and p_old_vendor is distinct from v then
   perform realtime.send(payload,'change','crm-chat:vendor:'||p_old_vendor::text,true);
 end if;
exception when others then raise log 'crm_chat broadcast failure: %',SQLSTATE;
end $$;
create function private.crm_chat_broadcast() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid; old_vendor uuid;
begin
 if tg_table_name='crm_chat_conversations' then
   if tg_op='UPDATE' then
     if (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
     old_vendor:=old.vendor_id;
   end if;
   perform private.crm_chat_emit(new.id,'conversation',old_vendor);
 elsif tg_table_name='wa_chat_messages' then
   if new.vendedor_nome<>'ANA' then return new; end if;
   if tg_op='UPDATE' and (new.body,new.tipo,new.media_url,new.transcricao,new.from_me,new.data_msg)
       is not distinct from (old.body,old.tipo,old.media_url,old.transcricao,old.from_me,old.data_msg) then return new; end if;
   select id into cid from public.crm_chat_conversations where wa_chat_id=new.chat_id;
   if cid is not null then perform private.crm_chat_emit(cid,'messages'); end if;
 elsif tg_table_name='crm_chat_notes' then
   perform private.crm_chat_emit(new.conversation_id,'notes');
 elsif tg_table_name='crm_chat_tags' then
   perform realtime.send(jsonb_build_object('kind','tags'),'change','crm-chat:catalog',true);
 elsif tg_table_name='crm_chat_outbox' then
   perform private.crm_chat_emit(new.conversation_id,'outbox');
   perform realtime.send('{}'::jsonb,'wake','crm-worker:ANA',true);
 elsif tg_table_name='wa_scheduled_messages' then
   if new.crm_request_id is null then return new; end if;
   if tg_op='UPDATE' and (new.status,new.error,new.sent_at) is not distinct from (old.status,old.error,old.sent_at) then return new; end if;
   select conversation_id into cid from public.crm_chat_outbox where scheduled_id=new.id;
   if cid is not null then perform private.crm_chat_emit(cid,'outbox'); end if;
 end if;
 return new;
exception when others then raise log 'crm_chat trigger broadcast failure: %',SQLSTATE; return new;
end $$;
revoke all on function private.crm_chat_emit(uuid,text,uuid),private.crm_chat_broadcast() from public,anon,authenticated;
create trigger crm_chat_broadcast_conversation after insert or update on public.crm_chat_conversations for each row execute function private.crm_chat_broadcast();
create trigger zz_crm_chat_broadcast_history after insert or update on public.wa_chat_messages for each row execute function private.crm_chat_broadcast();
create trigger crm_chat_broadcast_notes after insert on public.crm_chat_notes for each row execute function private.crm_chat_broadcast();
create trigger crm_chat_broadcast_tags after insert or update on public.crm_chat_tags for each row execute function private.crm_chat_broadcast();
create trigger crm_chat_broadcast_outbox after insert on public.crm_chat_outbox for each row execute function private.crm_chat_broadcast();
create trigger crm_chat_broadcast_delivery after update on public.wa_scheduled_messages for each row execute function private.crm_chat_broadcast();
