-- Cards que já existem no WhatsApp também entram na caixa, mesmo sem histórico arquivado.
create function private.crm_chat_sync_label() returns trigger
language plpgsql security definer set search_path='' as $$
declare contact public.contacts;
begin
  if new.vendedor_nome<>'ANA' or new.chat_id like '%@g.us' or new.chat_id='status@broadcast' then return new; end if;
  select * into contact from public.contacts ct where public.fone_canon(ct.phone)=public.fone_canon(new.phone)
    and public.fone_canon(new.phone) is not null order by ct.updated_at desc,ct.id limit 1;
  insert into public.crm_chat_conversations(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_inbound_at,last_preview,last_from_me)
  values(new.chat_id,coalesce(new.phone,split_part(new.chat_id,'@',1)),coalesce(contact.name,new.contact_name,new.phone,new.chat_id),contact.id,contact.vendor_id,
    coalesce(new.last_message_at,new.updated_at),case when new.last_message_from_me=false then new.last_message_at end,new.last_message_preview,coalesce(new.last_message_from_me,false))
  on conflict(wa_chat_id) do nothing;
  return new;
end $$;
revoke all on function private.crm_chat_sync_label() from public,anon,authenticated;
create trigger crm_chat_label_arrived after insert or update on public.wa_chat_labels for each row execute function private.crm_chat_sync_label();
insert into public.crm_chat_conversations(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_preview,last_from_me)
select l.chat_id,coalesce(l.phone,split_part(l.chat_id,'@',1)),coalesce(ct.name,l.contact_name,l.phone,l.chat_id),ct.id,ct.vendor_id,
  coalesce(l.last_message_at,l.updated_at),l.last_message_preview,coalesce(l.last_message_from_me,false)
from public.wa_chat_labels l
left join lateral(select * from public.contacts c where public.fone_canon(c.phone)=public.fone_canon(l.phone) and public.fone_canon(l.phone) is not null order by c.updated_at desc,c.id limit 1) ct on true
where l.vendedor_nome='ANA' and l.chat_id not like '%@g.us' and l.chat_id<>'status@broadcast'
and not exists(select 1 from public.crm_chat_conversations conv where conv.wa_chat_id=l.chat_id)
on conflict(wa_chat_id) do nothing;
