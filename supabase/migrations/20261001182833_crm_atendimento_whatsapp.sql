-- Chat compartilhado ANA 1144. A fila e o histórico existentes continuam sendo o transporte.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.crm_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  wa_chat_id text not null unique, phone text not null, name text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  status text not null default 'open' check(status in ('open','resolved')),
  tags text[] not null default '{}', human_hold boolean not null default false,
  lock_user_id uuid references public.user_profiles(id) on delete set null,
  lock_session_id uuid, lock_until timestamptz,
  last_message_at timestamptz not null default now(), last_inbound_at timestamptz,
  last_preview text, last_from_me boolean not null default false,
  updated_at timestamptz not null default now()
);
create index crm_chat_vendor_latest_idx on public.crm_chat_conversations(vendor_id,last_message_at desc,id);
create index crm_chat_contact_idx on public.crm_chat_conversations(contact_id);
create index crm_chat_tags_idx on public.crm_chat_conversations using gin(tags);
create table public.crm_chat_tags (
  name text primary key check(length(name) between 1 and 40),
  created_by uuid references public.user_profiles(id), created_at timestamptz not null default now()
);
create unique index crm_chat_tag_name_ci on public.crm_chat_tags(lower(name));
create table public.crm_chat_reads (
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  read_at timestamptz not null default now(), primary key(conversation_id,user_id)
);
create table public.crm_chat_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id),
  body text not null check(length(body) between 1 and 4000), created_at timestamptz not null default now()
);
create index crm_chat_notes_conversation_idx on public.crm_chat_notes(conversation_id,created_at desc);
alter table public.wa_scheduled_messages add column crm_request_id uuid;
create unique index wa_scheduled_crm_request_idx on public.wa_scheduled_messages(crm_request_id) where crm_request_id is not null;
create table public.crm_chat_outbox (
  id uuid primary key, conversation_id uuid not null references public.crm_chat_conversations(id),
  scheduled_id uuid not null unique references public.wa_scheduled_messages(id),
  sender_id uuid not null references public.user_profiles(id),
  body text not null, tipo text not null check(tipo in ('chat','image','audio','video','document')),
  media_path text, wa_msg_id text, created_at timestamptz not null default now()
);
create index crm_chat_outbox_conversation_idx on public.crm_chat_outbox(conversation_id,created_at desc);
create index if not exists crm_chat_history_idx on public.wa_chat_messages(vendedor_nome,chat_id,data_msg desc,id desc);

create function private.crm_chat_profile() returns public.user_profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.user_profiles;
begin
  select * into p from public.user_profiles where id=auth.uid();
  if p.id is null or p.approved_at is null or p.role not in ('admin','vendor')
     or (p.role='vendor' and (p.vendor_id is null or not exists(select 1 from public.vendors v where v.id=p.vendor_id and v.ativo))) then
    raise exception 'Acesso ao atendimento não autorizado.' using errcode='42501';
  end if;
  return p;
end $$;
create function private.crm_chat_can(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare p public.user_profiles;
begin
  p:=private.crm_chat_profile();
  return exists(select 1 from public.crm_chat_conversations c where c.id=p_id and (p.role='admin' or c.vendor_id=p.vendor_id));
exception when insufficient_privilege then return false;
end $$;

alter table public.crm_chat_conversations enable row level security;
alter table public.crm_chat_tags enable row level security;
alter table public.crm_chat_reads enable row level security;
alter table public.crm_chat_notes enable row level security;
alter table public.crm_chat_outbox enable row level security;
revoke all on public.crm_chat_conversations, public.crm_chat_tags, public.crm_chat_reads, public.crm_chat_notes, public.crm_chat_outbox from anon,authenticated;
grant select on public.crm_chat_conversations, public.crm_chat_tags, public.crm_chat_reads, public.crm_chat_notes, public.crm_chat_outbox to authenticated;
grant all on public.crm_chat_conversations, public.crm_chat_tags, public.crm_chat_reads, public.crm_chat_notes, public.crm_chat_outbox to service_role;
create policy crm_chat_scope on public.crm_chat_conversations for select to authenticated using(private.crm_chat_can(id));
create policy crm_chat_tags_read on public.crm_chat_tags for select to authenticated using((private.crm_chat_profile()).id is not null);
create policy crm_chat_reads_scope on public.crm_chat_reads for select to authenticated using(user_id=(select auth.uid()) and private.crm_chat_can(conversation_id));
create policy crm_chat_notes_scope on public.crm_chat_notes for select to authenticated using(private.crm_chat_can(conversation_id));
create policy crm_chat_outbox_scope on public.crm_chat_outbox for select to authenticated using(private.crm_chat_can(conversation_id));

-- Mensagem nova cria a conversa e reabre atendimento finalizado; backfill não conta como não lida.
create function private.crm_chat_sync_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ct public.contacts; cid uuid;
begin
  if new.vendedor_nome <> 'ANA' or new.chat_id like '%@g.us' or new.chat_id='status@broadcast' then return new; end if;
  select * into ct from public.contacts c where public.fone_canon(c.phone)=public.fone_canon(new.phone)
    and public.fone_canon(new.phone) is not null order by c.updated_at desc,c.id limit 1;
  insert into public.crm_chat_conversations as existing(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_inbound_at,last_preview,last_from_me)
    values(new.chat_id,coalesce(new.phone,split_part(new.chat_id,'@',1)),coalesce(ct.name,new.phone,new.chat_id),ct.id,ct.vendor_id,
      new.data_msg,case when not new.from_me then new.data_msg end,left(coalesce(nullif(new.body,''),'['||new.tipo||']'),200),new.from_me)
  on conflict(wa_chat_id) do update set
    last_message_at=greatest(existing.last_message_at,excluded.last_message_at),
    last_inbound_at=case when not new.from_me then greatest(existing.last_inbound_at,new.data_msg) else existing.last_inbound_at end,
    last_preview=case when new.data_msg>=existing.last_message_at then excluded.last_preview else existing.last_preview end,
    last_from_me=case when new.data_msg>=existing.last_message_at then excluded.last_from_me else existing.last_from_me end,
    status=case when not new.from_me and new.data_msg>existing.last_message_at then 'open' else existing.status end,
    updated_at=now() returning id into cid;
  return new;
end $$;
create trigger crm_chat_message_arrived after insert on public.wa_chat_messages for each row execute function private.crm_chat_sync_message();

insert into public.crm_chat_conversations(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_preview,last_from_me)
select m.chat_id,coalesce(m.phone,split_part(m.chat_id,'@',1)),coalesce(c.name,l.contact_name,m.phone,m.chat_id),c.id,c.vendor_id,
  m.data_msg,left(coalesce(nullif(m.body,''),'['||m.tipo||']'),200),m.from_me
from (select distinct on(chat_id) * from public.wa_chat_messages where vendedor_nome='ANA' and chat_id not like '%@g.us' and chat_id <> 'status@broadcast' order by chat_id,data_msg desc,id desc) m
left join lateral(select * from public.contacts ct where public.fone_canon(ct.phone)=public.fone_canon(m.phone) and public.fone_canon(m.phone) is not null order by updated_at desc,id limit 1) c on true
left join lateral(select contact_name from public.wa_chat_labels l where l.vendedor_nome='ANA' and l.chat_id=m.chat_id limit 1) l on true;

create function private.crm_chat_contact_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.crm_chat_conversations set contact_id=new.id,vendor_id=new.vendor_id,name=coalesce(new.name,name),
    lock_user_id=case when tg_op='INSERT' or new.vendor_id is distinct from old.vendor_id then null else lock_user_id end,
    lock_session_id=case when tg_op='INSERT' or new.vendor_id is distinct from old.vendor_id then null else lock_session_id end,
    lock_until=case when tg_op='INSERT' or new.vendor_id is distinct from old.vendor_id then null else lock_until end,updated_at=now()
  where contact_id=new.id or (contact_id is null and public.fone_canon(phone)=public.fone_canon(new.phone) and public.fone_canon(new.phone) is not null);
  return new;
end $$;
create trigger crm_chat_contact_owner after insert or update of vendor_id,name on public.contacts for each row execute function private.crm_chat_contact_owner();

-- IA e cron legado não reenviam filas manuais incertas. Timeout não vira confirmação de entrega.
create function private.crm_chat_queue_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' and new.vendedor_nome='ANA' and new.crm_request_id is null and not coalesce(new.to_self,false)
    and exists(select 1 from public.crm_chat_conversations c where c.wa_chat_id=new.chat_id and c.human_hold) then
    new.status:='cancelled'; new.error:='Atendimento humano no CRM; automação pausada.';
  end if;
  if tg_op='UPDATE' and old.crm_request_id is not null then
    if old.status='sending' and new.status='pending' then
      new.status:='failed'; new.error:='Confirmação incerta. Confira no WhatsApp antes de enviar novamente.';
    elsif new.status='sent' and coalesce(new.error,'') ilike '%sem confirmacao%' then
      new.status:='failed'; new.error:='Confirmação incerta no WhatsApp. Não reenviar sem conferir.';
    end if;
  end if;
  return new;
end $$;
create trigger crm_chat_queue_guard before insert or update of status on public.wa_scheduled_messages for each row execute function private.crm_chat_queue_guard();

create function private.crm_chat(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.user_profiles; c public.crm_chat_conversations; result jsonb; cid uuid;
  session_id uuid; rid uuid; sid uuid; body text; media_path text; media_url text; mime text; kind text; target uuid; tag text;
begin
  p:=private.crm_chat_profile();
  if p_action='list' then
    select coalesce(jsonb_agg(t.row order by t.last_message_at desc,t.id desc),'[]'::jsonb) into result from (
      select jsonb_build_object('id',c.id,'wa_chat_id',c.wa_chat_id,'phone',c.phone,'name',c.name,'contact_id',c.contact_id,
        'vendor_id',c.vendor_id,'vendor_name',v.name,'status',c.status,'tags',c.tags,'human_hold',c.human_hold,
        'last_message_at',c.last_message_at,'last_preview',c.last_preview,'last_from_me',c.last_from_me,
        'unread',case when c.last_inbound_at>coalesce(r.read_at,'epoch') then 1 else 0 end,
        'lock_user_id',c.lock_user_id,'lock_session_id',c.lock_session_id,'lock_until',c.lock_until) as row,c.last_message_at,c.id
      from public.crm_chat_conversations c left join public.vendors v on v.id=c.vendor_id
      left join public.crm_chat_reads r on r.conversation_id=c.id and r.user_id=p.id
      where (p.role='admin' or c.vendor_id=p.vendor_id)
        and (coalesce(p_args->>'search','')='' or c.name ilike '%'||(p_args->>'search')||'%' or c.phone ilike '%'||(p_args->>'search')||'%')
        and (coalesce(p_args->>'status','')='' or c.status=p_args->>'status')
        and (coalesce(p_args->>'tag','')='' or p_args->>'tag'=any(c.tags))
        and (coalesce(p_args->>'vendor','')='' or (p_args->>'vendor'='unassigned' and c.vendor_id is null) or c.vendor_id::text=p_args->>'vendor')
        and (coalesce(p_args->>'before','')='' or (c.last_message_at,c.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::uuid))
      order by c.last_message_at desc,c.id desc limit 100
    ) t;
    return jsonb_build_object('items',result,'tags',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from public.crm_chat_tags),
      'connection',(select jsonb_build_object('last_sync',recebido_em,'version',client_version,'number_final',right(split_part(wa_self_wid,'@',1),4)) from public.wa_sync_debug where vendedor_nome='ANA' order by recebido_em desc limit 1));
  elsif p_action='create_tag' then
    tag:=btrim(p_args->>'name');
    if tag is null or length(tag) not between 1 and 40 then raise exception 'Etiqueta deve ter de 1 a 40 caracteres.'; end if;
    insert into public.crm_chat_tags(name,created_by) values(tag,p.id) on conflict do nothing;
    return jsonb_build_object('ok',true);
  end if;
  cid:=(p_args->>'id')::uuid;
  select * into c from public.crm_chat_conversations where id=cid;
  if c.id is null or (p.role <> 'admin' and c.vendor_id is distinct from p.vendor_id) then raise exception 'Conversa não disponível para sua carteira.' using errcode='42501'; end if;
  if p_action='messages' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.data_msg,t.id),'[]'::jsonb) into result from (
      select m.id,m.msg_id,m.from_me,m.tipo,m.body,m.media_url,m.data_msg,m.transcricao,m.duracao_seg
      from public.wa_chat_messages m where m.vendedor_nome='ANA' and m.chat_id=c.wa_chat_id
        and (coalesce(p_args->>'before','')='' or (m.data_msg,m.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::bigint))
      order by m.data_msg desc,m.id desc limit 50
    ) t;
    return result;
  elsif p_action='detail' then
    return jsonb_build_object('conversation',to_jsonb(c),'contact',(select jsonb_build_object('city',city,'state',state,'empresa',empresa,'email',email,'status',status) from public.contacts where id=c.contact_id),
      'notes',(select coalesce(jsonb_agg(t.row order by t.created_at desc),'[]'::jsonb) from (select jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author_name',u.display_name) row,n.created_at from public.crm_chat_notes n left join public.user_profiles u on u.id=n.author_id where n.conversation_id=cid order by n.created_at desc limit 50)t),
      'outbox',(select coalesce(jsonb_agg(t.row order by t.created_at),'[]'::jsonb) from (select to_jsonb(o)||jsonb_build_object('status',q.status,'error',q.error,'sent_at',q.sent_at,'sender_name',u.display_name) row,o.created_at from public.crm_chat_outbox o join public.wa_scheduled_messages q on q.id=o.scheduled_id left join public.user_profiles u on u.id=o.sender_id where o.conversation_id=cid order by o.created_at desc limit 20)t));
  elsif p_action='read' then
    insert into public.crm_chat_reads(conversation_id,user_id,read_at) values(cid,p.id,now()) on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
    return jsonb_build_object('ok',true);
  end if;
  -- Toda mutação revalida após obter a trava: atribuição pode mudar durante uma requisição.
  select * into c from public.crm_chat_conversations where id=cid for update;
  if p.role<>'admin' and c.vendor_id is distinct from p.vendor_id then raise exception 'Conversa transferida para outra carteira.' using errcode='42501'; end if;
  session_id:=(p_args->>'session')::uuid;
  if p_action in ('claim','heartbeat') then
    if session_id is null then raise exception 'Sessão de atendimento inválida.'; end if;
    if c.lock_until>now() and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then raise exception 'Esta conversa está sendo atendida em outra sessão.' using errcode='55P03'; end if;
    if p_action='heartbeat' and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then raise exception 'Assuma a conversa novamente.'; end if;
    update public.crm_chat_conversations set lock_user_id=p.id,lock_session_id=session_id,lock_until=now()+interval '90 seconds',human_hold=true,status='open',updated_at=now() where id=cid;
    if p_action='claim' then
      update public.ia_atendimentos set ativo=false,estado='HUMAN_TAKEOVER',estado_desde=now(),assumido_por=coalesce(p.display_name,p.email),assumido_em=now(),atualizado_em=now() where chat_id=c.wa_chat_id and vendedor_nome='ANA';
      update public.wa_scheduled_messages set status='cancelled',error='Atendimento assumido no CRM.' where vendedor_nome='ANA' and chat_id=c.wa_chat_id and status='pending' and crm_request_id is null and not coalesce(to_self,false);
    end if;
    return jsonb_build_object('ok',true);
  elsif p_action='release' then
    update public.crm_chat_conversations set lock_user_id=null,lock_session_id=null,lock_until=null where id=cid and lock_user_id=p.id and lock_session_id=session_id;
    return jsonb_build_object('ok',true);
  elsif p_action='assign' then
    if p.role<>'admin' then raise exception 'Somente administrador pode transferir.' using errcode='42501'; end if;
    target:=nullif(p_args->>'vendor','')::uuid;
    if target is not null and not exists(select 1 from public.vendors where id=target and ativo) then raise exception 'Vendedor não disponível.'; end if;
    if exists(select 1 from public.wa_scheduled_messages q join public.crm_chat_outbox o on o.scheduled_id=q.id where o.conversation_id=cid and q.status='sending') then raise exception 'Aguarde a confirmação do envio antes de transferir.'; end if;
    update public.wa_scheduled_messages q set status='cancelled',error='Conversa transferida antes do envio.' from public.crm_chat_outbox o where o.scheduled_id=q.id and o.conversation_id=cid and q.status='pending';
    if c.contact_id is not null then update public.contacts set vendor_id=target where id=c.contact_id; end if;
    update public.crm_chat_conversations set vendor_id=target,lock_user_id=null,lock_session_id=null,lock_until=null,updated_at=now() where id=cid;
  elsif p_action='tags' then
    if coalesce(jsonb_typeof(p_args->'tags'),'null')<>'array' or jsonb_array_length(p_args->'tags')>20 then raise exception 'Etiquetas inválidas.'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_args->'tags') t where not exists(select 1 from public.crm_chat_tags x where x.name=t.value)) then raise exception 'Crie a etiqueta antes de atribuí-la.'; end if;
    update public.crm_chat_conversations set tags=array(select distinct jsonb_array_elements_text(p_args->'tags')),updated_at=now() where id=cid;
  elsif p_action='note' then
    body:=btrim(p_args->>'body');
    if body is null or length(body) not between 1 and 4000 then raise exception 'Nota deve ter de 1 a 4000 caracteres.'; end if;
    insert into public.crm_chat_notes(conversation_id,author_id,body) values(cid,p.id,body);
  elsif p_action in ('resolve','reopen') then
    if c.lock_until>now() and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then raise exception 'Outra sessão está atendendo esta conversa.'; end if;
    if p_action='resolve' then
      if exists(select 1 from public.wa_scheduled_messages q join public.crm_chat_outbox o on o.scheduled_id=q.id where o.conversation_id=cid and q.status in ('pending','sending')) then raise exception 'Aguarde os envios pendentes antes de finalizar.'; end if;
      update public.ia_atendimentos set ativo=false,estado='AI_PAUSED',estado_desde=now(),atualizado_em=now() where chat_id=c.wa_chat_id and vendedor_nome='ANA';
      update public.wa_scheduled_messages set status='cancelled',error='Atendimento finalizado no CRM.' where vendedor_nome='ANA' and chat_id=c.wa_chat_id and status='pending' and crm_request_id is null and not coalesce(to_self,false);
    end if;
    update public.crm_chat_conversations set status=case when p_action='resolve' then 'resolved' else 'open' end,human_hold=case when p_action='resolve' then true else human_hold end,lock_user_id=null,lock_session_id=null,lock_until=null,updated_at=now() where id=cid;
  elsif p_action='send' then
    rid:=(p_args->>'request')::uuid;
    if rid is null then raise exception 'Identificador do envio obrigatório.'; end if;
    if exists(select 1 from public.crm_chat_outbox where id=rid and conversation_id=cid and sender_id=p.id) then return jsonb_build_object('ok',true,'id',rid); end if;
    if c.status<>'open' or c.lock_until is null or c.lock_until<=now() or c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id then raise exception 'Assuma a conversa antes de enviar.' using errcode='42501'; end if;
    body:=btrim(coalesce(p_args->>'body','')); media_path:=nullif(p_args->>'media_path',''); media_url:=nullif(p_args->>'media_url',''); mime:=split_part(coalesce(p_args->>'mime',''),';',1); kind:='chat';
    if length(body)>4000 then raise exception 'Mensagem deve ter no máximo 4000 caracteres.'; end if;
    if media_path is not null then
      if split_part(media_path,'/',1)<>cid::text or media_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.[a-z0-9]+$' or not exists(select 1 from storage.objects where bucket_id='crm-chat-media' and name=media_path and owner_id=p.id::text) then raise exception 'Anexo não pertence a este atendimento.' using errcode='42501'; end if;
      if mime in ('image/jpeg','image/png','image/webp') then kind:='image'; elsif mime in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav') then kind:='audio'; elsif mime in ('video/mp4','video/webm') then kind:='video'; elsif mime='application/pdf' then kind:='document'; else raise exception 'Formato de anexo não permitido.'; end if;
      if media_url is null or split_part(media_url,'?',1)<>'https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/sign/crm-chat-media/'||media_path then raise exception 'URL do anexo inválida.'; end if;
    else
      media_url:=null;
      if body='' then raise exception 'Digite uma mensagem ou escolha um anexo.'; end if;
    end if;
    sid:=gen_random_uuid();
    insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,contato_nome,contato_numero,body,scheduled_at,status,to_self,urgente,crm_request_id,media_url,media_type,media_filename)
      values(sid,'ANA',c.wa_chat_id,c.name,c.phone,body,now(),'pending',false,true,rid,media_url,case when media_path is not null then kind end,left(coalesce(p_args->>'filename','arquivo'),200));
    insert into public.crm_chat_outbox(id,conversation_id,scheduled_id,sender_id,body,tipo,media_path) values(rid,cid,sid,p.id,body,kind,media_path);
    update public.crm_chat_conversations set lock_until=now()+interval '90 seconds',updated_at=now() where id=cid;
    return jsonb_build_object('ok',true,'id',rid);
  else raise exception 'Ação desconhecida.';
  end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.crm_chat(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.crm_chat(p_action,p_args); $$;
revoke all on function public.crm_chat(text,jsonb) from public,anon;
grant execute on function public.crm_chat(text,jsonb) to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on function private.crm_chat(text,jsonb),private.crm_chat_profile(),private.crm_chat_can(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-chat-media','crm-chat-media',false,20971520,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','video/mp4','video/webm','application/pdf']);
create policy crm_chat_media_read on storage.objects for select to authenticated using(bucket_id='crm-chat-media' and private.crm_chat_can(case when (storage.foldername(name))[1] ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then (storage.foldername(name))[1]::uuid end));
create policy crm_chat_media_upload on storage.objects for insert to authenticated with check(bucket_id='crm-chat-media' and private.crm_chat_can(case when (storage.foldername(name))[1] ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then (storage.foldername(name))[1]::uuid end) and owner_id=(select auth.uid())::text);
create policy crm_chat_media_delete on storage.objects for delete to authenticated using(bucket_id='crm-chat-media' and owner_id=(select auth.uid())::text and private.crm_chat_can(case when (storage.foldername(name))[1] ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then (storage.foldername(name))[1]::uuid end) and not exists(select 1 from public.crm_chat_outbox o where o.media_path=name));
update public.role_permissions set permissions=permissions||'{"menu.whatsapp":true}'::jsonb where role in ('admin','vendor');
