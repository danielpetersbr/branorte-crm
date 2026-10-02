-- Team productivity; no reminder or template schedules a WhatsApp send.
-- Live WA sync/ACK transactions may hold queue/history locks before touching
-- conversations. Fail quickly on contention; deployment retries the whole TX.
set local lock_timeout='500ms';
alter table public.crm_chat_conversations add column follow_up_at timestamptz;
alter table public.crm_chat_conversations add column resolved_at timestamptz;
alter table public.crm_chat_outbox add column reply_msg_id text;
alter table public.crm_chat_outbox add column reply_preview text;
alter table public.crm_chat_outbox add column reply_sender_name text;
alter table public.crm_chat_outbox add column reply_from_me boolean;
alter table public.crm_chat_outbox add column waiting_since_at_send timestamptz;
alter table public.crm_chat_outbox add column sender_vendor_id uuid references public.vendors(id) on delete set null;
alter table public.wa_scheduled_messages add column reply_msg_id text;
alter table public.wa_scheduled_messages add column reply_from_me boolean;
create index crm_chat_waiting_idx on public.crm_chat_conversations(vendor_id,last_message_at,id)
  where status='open' and last_from_me=false and (last_inbound_at is not null or last_preview is not null);
create index crm_chat_followup_idx on public.crm_chat_conversations(vendor_id,follow_up_at,id) where follow_up_at is not null;
create index crm_chat_resolved_idx on public.crm_chat_conversations(vendor_id,resolved_at) where resolved_at is not null;
create index if not exists crm_chat_sales_quote_number_idx on public.orcamentos_files(numero,contact_id);
create index if not exists crm_chat_sales_order_quote_idx on public.mirror_pedidos_venda(numero_orcamento);

create table public.crm_chat_quick_replies(
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 1 and 60),
 body text not null check(length(btrim(body)) between 1 and 4000),
 created_by uuid not null references public.user_profiles(id),
 updated_at timestamptz not null default now()
);
alter table public.crm_chat_quick_replies enable row level security;
revoke all on public.crm_chat_quick_replies from public,anon,authenticated;
grant select on public.crm_chat_quick_replies to authenticated;
create policy crm_chat_quick_replies_read on public.crm_chat_quick_replies for select to authenticated
 using (exists(select 1 from public.user_profiles u where u.id=(select auth.uid()) and u.approved_at is not null
  and (u.role='admin' or (u.role='vendor' and exists(select 1 from public.vendors v where v.id=u.vendor_id and v.ativo)))));

create table private.crm_chat_metrics_start(singleton boolean primary key default true check(singleton),started_at timestamptz not null default now());
insert into private.crm_chat_metrics_start(singleton) values(true);
alter table private.crm_chat_metrics_start enable row level security;
revoke all on private.crm_chat_metrics_start from public,anon,authenticated;

create table private.crm_chat_response_events(
 request_id uuid primary key references public.crm_chat_outbox(id) on delete cascade,
 conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
 waiting_since timestamptz not null,sent_at timestamptz not null,
 sender_id uuid not null references public.user_profiles(id),
 vendor_id uuid references public.vendors(id) on delete set null,
 sender_name text,response_seconds numeric not null check(response_seconds>=0),
 unique(conversation_id,waiting_since)
);
alter table private.crm_chat_response_events enable row level security;
revoke all on private.crm_chat_response_events from public,anon,authenticated;
create index crm_chat_response_vendor_day_idx on private.crm_chat_response_events(vendor_id,sent_at);

create or replace function private.crm_chat_productivity_snapshot() returns trigger
 language plpgsql security definer set search_path='' as $function$
begin
 if tg_table_name='crm_chat_conversations' then
  if new.status is distinct from old.status then
   new.resolved_at:=case when new.status='resolved' then now() else null end;
  end if;
 else
  if tg_op='INSERT' then
   select vendor_id into new.sender_vendor_id from public.user_profiles where id=new.sender_id;
   select case when status='open' and last_from_me=false and (last_inbound_at is not null or last_preview is not null) then last_message_at end
    into new.waiting_since_at_send from public.crm_chat_conversations where id=new.conversation_id;
  else
   new.waiting_since_at_send:=old.waiting_since_at_send;
   new.sender_vendor_id:=old.sender_vendor_id;
   new.reply_msg_id:=old.reply_msg_id;new.reply_preview:=old.reply_preview;
   new.reply_sender_name:=old.reply_sender_name;new.reply_from_me:=old.reply_from_me;
  end if;
 end if;
 return new;
end;
$function$;
revoke all on function private.crm_chat_productivity_snapshot() from public,anon,authenticated;
create trigger crm_chat_resolution_timestamp before update of status on public.crm_chat_conversations
 for each row execute function private.crm_chat_productivity_snapshot();
create trigger crm_chat_productivity_snapshot before insert or update of waiting_since_at_send,sender_vendor_id,reply_msg_id,reply_preview,reply_sender_name,reply_from_me
 on public.crm_chat_outbox for each row execute function private.crm_chat_productivity_snapshot();

create or replace function private.crm_chat_capture_response() returns trigger
 language plpgsql security definer set search_path='' as $function$
declare o public.crm_chat_outbox; wa_chat text; key text;
begin
 if new.crm_request_id is null or new.status<>'sent' or new.sent_at is null then return new; end if;
 key:=private.crm_chat_message_key(new.wa_msg_id);
 if key is null then return new; end if;
 select * into o from public.crm_chat_outbox where id=new.crm_request_id and scheduled_id=new.id;
 if o.id is null or o.waiting_since_at_send is null or new.sent_at<o.waiting_since_at_send then return new; end if;
 select wa_chat_id into wa_chat from public.crm_chat_conversations where id=o.conversation_id;
 -- Only a first confirmed response is a sample. History can precede the ACK.
 if exists(select 1 from public.wa_chat_messages m where m.vendedor_nome='ANA' and m.chat_id=wa_chat and m.from_me
   and m.data_msg>o.waiting_since_at_send and m.data_msg<=new.sent_at and private.crm_chat_message_key(m.msg_id) is distinct from key)
 or exists(select 1 from public.crm_chat_outbox x join public.wa_scheduled_messages q on q.id=x.scheduled_id
   where x.conversation_id=o.conversation_id and x.id<>o.id and q.status='sent' and q.sent_at>o.waiting_since_at_send and q.sent_at<=new.sent_at
    and private.crm_chat_message_key(q.wa_msg_id) is not null and private.crm_chat_message_key(q.wa_msg_id) is distinct from key)
 then return new; end if;
 insert into private.crm_chat_response_events(request_id,conversation_id,waiting_since,sent_at,sender_id,vendor_id,sender_name,response_seconds)
 values(o.id,o.conversation_id,o.waiting_since_at_send,new.sent_at,o.sender_id,o.sender_vendor_id,o.sender_name,extract(epoch from new.sent_at-o.waiting_since_at_send))
 on conflict(conversation_id,waiting_since) do update
  set request_id=excluded.request_id,sent_at=excluded.sent_at,sender_id=excluded.sender_id,vendor_id=excluded.vendor_id,
   sender_name=excluded.sender_name,response_seconds=excluded.response_seconds
  where excluded.sent_at<private.crm_chat_response_events.sent_at;
 return new;
end;
$function$;
revoke all on function private.crm_chat_capture_response() from public,anon,authenticated;
create trigger crm_chat_capture_response after update of status,sent_at,wa_msg_id on public.wa_scheduled_messages
 for each row execute function private.crm_chat_capture_response();

create or replace function private.crm_chat_quick_replies_changed() returns trigger
 language plpgsql security definer set search_path='' as $function$
begin
 perform realtime.send(jsonb_build_object('kind','tags'),'change','crm-chat:catalog',true);
 return null;
exception when others then raise log 'crm_chat templates broadcast failure: %',SQLSTATE; return null;
end;
$function$;
revoke all on function private.crm_chat_quick_replies_changed() from public,anon,authenticated;
create trigger crm_chat_quick_replies_changed after insert or update or delete on public.crm_chat_quick_replies
 for each row execute function private.crm_chat_quick_replies_changed();

CREATE OR REPLACE FUNCTION private.crm_chat(p_action text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.user_profiles; c public.crm_chat_conversations; result jsonb; cid uuid;
  ct public.contacts; phone text; session_id uuid; rid uuid; sid uuid; body text; media_path text; media_url text; mime text; kind text; target uuid; tag text; object_metadata jsonb;
  queue text:=coalesce(nullif(p_args->>'queue',''),'all'); due_at timestamptz; reply_id text; reply_source public.wa_chat_messages;
  reply_preview text; reply_sender text; day_start timestamptz; day_end timestamptz;
begin
  p:=private.crm_chat_profile();
  if p_action='list' then
    if queue not in ('all','waiting','overdue') then raise exception 'Fila inválida.'; end if;
    select coalesce(jsonb_agg(t.row order by t.priority_at asc nulls last,case when queue<>'all' then t.id end asc,t.last_message_at desc,t.id desc),'[]'::jsonb) into result from (
      select jsonb_build_object('id',conv.id,'wa_chat_id',conv.wa_chat_id,'phone',conv.phone,'name',conv.name,'contact_id',conv.contact_id,
        'vendor_id',conv.vendor_id,'vendor_name',v.name,'avatar_url',avatar.foto_url,'status',conv.status,'tags',conv.tags,'human_hold',conv.human_hold,
        'last_message_at',conv.last_message_at,'last_preview',conv.last_preview,'last_from_me',conv.last_from_me,
        'unread',case when conv.last_inbound_at>coalesce(r.read_at,'epoch') then 1 else 0 end,
        'lock_user_id',conv.lock_user_id,'lock_session_id',conv.lock_session_id,'lock_until',conv.lock_until,
        'lock_user_name',case when conv.lock_until>now() then (select display_name from public.user_profiles where id=conv.lock_user_id and approved_at is not null) end,
        'waiting_since',case when conv.status='open' and conv.last_from_me=false and (conv.last_inbound_at is not null or conv.last_preview is not null) then conv.last_message_at end,
        'follow_up_at',conv.follow_up_at) as row,conv.last_message_at,conv.id,
        case when queue='waiting' then conv.last_message_at when queue='overdue' then conv.follow_up_at end priority_at
      from public.crm_chat_conversations conv left join public.vendors v on v.id=conv.vendor_id
      left join public.crm_chat_reads r on r.conversation_id=conv.id and r.user_id=p.id
      left join (select distinct on (chat_id) chat_id,foto_url from public.wa_chat_labels
        where vendedor_nome='ANA' order by chat_id,foto_checked_at desc nulls last,id desc) avatar on avatar.chat_id=conv.wa_chat_id
      where (p.role='admin' or conv.vendor_id=p.vendor_id)
        and (coalesce(p_args->>'search','')='' or conv.name ilike '%'||(p_args->>'search')||'%' or conv.phone ilike '%'||(p_args->>'search')||'%')
        and (coalesce(p_args->>'status','')='' or conv.status=p_args->>'status')
        and (coalesce(p_args->>'tag','')='' or p_args->>'tag'=any(conv.tags))
        and (coalesce(p_args->>'vendor','')='' or (p_args->>'vendor'='unassigned' and conv.vendor_id is null) or conv.vendor_id::text=p_args->>'vendor')
        and (queue<>'waiting' or (conv.status='open' and conv.last_from_me=false and (conv.last_inbound_at is not null or conv.last_preview is not null)))
        and (queue<>'overdue' or conv.follow_up_at<=now())
        and (coalesce(p_args->>'before','')='' or
          (queue='all' and (conv.last_message_at,conv.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::uuid)) or
          (queue='waiting' and (conv.last_message_at,conv.id)>((p_args->>'before')::timestamptz,(p_args->>'before_id')::uuid)) or
          (queue='overdue' and (conv.follow_up_at,conv.id)>((p_args->>'before')::timestamptz,(p_args->>'before_id')::uuid)))
      order by priority_at asc nulls last,case when queue<>'all' then conv.id end asc,conv.last_message_at desc,conv.id desc limit 100
    ) t;
    return jsonb_build_object('items',result,'tags',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from public.crm_chat_tags),
      'connection',(select jsonb_build_object('last_sync',recebido_em,'version',client_version,'number_final',right(split_part(wa_self_wid,'@',1),4)) from public.wa_sync_debug where vendedor_nome='ANA' order by recebido_em desc limit 1));
  elsif p_action='quick_replies' then
    return (select coalesce(jsonb_agg(to_jsonb(t) order by t.title,t.id),'[]'::jsonb) from
      (select qr.id,qr.title,qr.body,qr.updated_at,qr.created_by from public.crm_chat_quick_replies qr order by qr.title,qr.id limit 100)t);
  elsif p_action in ('quick_reply_save','quick_reply_delete') then
    if p.role<>'admin' then raise exception 'Somente administrador pode alterar respostas da equipe.' using errcode='42501'; end if;
    rid:=nullif(p_args->>'reply_id','')::uuid;
    if p_action='quick_reply_delete' then
      if rid is null then raise exception 'Resposta não informada.'; end if;
      delete from public.crm_chat_quick_replies where id=rid;
    else
      tag:=btrim(p_args->>'title');body:=btrim(p_args->>'body');
      if tag is null or length(tag) not between 1 and 60 or body is null or length(body) not between 1 and 4000 then raise exception 'Título ou resposta inválidos.'; end if;
      -- A catalog-level transaction lock keeps the 100-item cap under concurrent saves.
      perform pg_advisory_xact_lock(hashtext('crm_chat_quick_replies'));
      if rid is null then
        if (select count(*) from public.crm_chat_quick_replies)>=100 then raise exception 'Limite de 100 respostas da equipe.'; end if;
        rid:=gen_random_uuid();
        insert into public.crm_chat_quick_replies(id,title,body,created_by) values(rid,tag,body,p.id);
      else
        update public.crm_chat_quick_replies set title=tag,body=btrim(p_args->>'body'),updated_at=now() where id=rid;
        if not found then raise exception 'Resposta não encontrada.'; end if;
      end if;
    end if;
    return jsonb_build_object('ok',true,'id',rid);
  elsif p_action='summary' then
    day_start:=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
    day_end:=day_start+interval '1 day';
    select jsonb_build_object(
      'waiting',count(*) filter(where conv.status='open' and conv.last_from_me=false and (conv.last_inbound_at is not null or conv.last_preview is not null)),
      'unassigned',count(*) filter(where conv.vendor_id is null and conv.status='open'),
      'overdue',count(*) filter(where conv.follow_up_at<=now()),
      'resolved_today',count(*) filter(where conv.status='resolved' and conv.resolved_at>=day_start and conv.resolved_at<day_end))
    into result from public.crm_chat_conversations conv
      where (p.role='admin' or conv.vendor_id=p.vendor_id)
        and (coalesce(p_args->>'vendor','')='' or (p_args->>'vendor'='unassigned' and conv.vendor_id is null) or conv.vendor_id::text=p_args->>'vendor');
    return result||(select jsonb_build_object('average_response_seconds',avg(response_seconds),'response_samples',count(*),
      'metrics_since',(select started_at from private.crm_chat_metrics_start where singleton))
      from private.crm_chat_response_events e where e.sent_at>=day_start and e.sent_at<day_end
        and (p.role='admin' or e.vendor_id=p.vendor_id)
        and (coalesce(p_args->>'vendor','')='' or e.vendor_id::text=p_args->>'vendor'));
  elsif p_action='contacts' then
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
      select contact.id,contact.name,contact.phone,contact.vendor_id from public.contacts contact where (p.role='admin' or contact.vendor_id=p.vendor_id)
      and (coalesce(p_args->>'search','')='' or contact.name ilike '%'||(p_args->>'search')||'%' or contact.phone ilike '%'||(p_args->>'search')||'%')
      order by contact.updated_at desc,contact.id limit 30
    ) t;
    return result;
  elsif p_action='start' then
    select * into ct from public.contacts where id=(p_args->>'contact')::uuid for share;
    if ct.id is null or (p.role<>'admin' and ct.vendor_id is distinct from p.vendor_id) then raise exception 'Contato não disponível para sua carteira.' using errcode='42501'; end if;
    select id into cid from public.crm_chat_conversations where contact_id=ct.id order by last_message_at desc limit 1;
    if cid is not null then return jsonb_build_object('id',cid); end if;
    phone:=regexp_replace(ct.phone,'[^0-9]','','g');
    if length(phone) in (10,11) and ct.phone not like '+%' then phone:='55'||phone; end if;
    if phone !~ '^[1-9][0-9]{9,14}$' then raise exception 'Telefone do contato inválido. Corrija o cadastro antes de iniciar.'; end if;
    insert into public.crm_chat_conversations(wa_chat_id,phone,name,contact_id,vendor_id)
      values(phone||'@c.us',phone,coalesce(ct.name,phone),ct.id,ct.vendor_id)
      on conflict(wa_chat_id) do update set updated_at=now() returning id into cid;
    if not private.crm_chat_can(cid) then raise exception 'Conversa já atribuída a outra carteira.' using errcode='42501'; end if;
    return jsonb_build_object('id',cid);
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
    if length(coalesce(p_args->>'search',''))>200 then raise exception 'Busca deve ter no máximo 200 caracteres.'; end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.data_msg,t.id),'[]'::jsonb) into result from (
      -- Page first: author lookups do not scan the complete WhatsApp history.
      select page.*,author.sender_id,author.sender_name,author.reply_msg_id,author.reply_preview,author.reply_sender_name,author.reply_from_me from (
        select m.id,m.msg_id,m.from_me,m.tipo,m.body,m.media_url,m.data_msg,m.transcricao,m.duracao_seg,m.filename
        from public.wa_chat_messages m where m.vendedor_nome='ANA' and m.chat_id=c.wa_chat_id
          and (btrim(coalesce(p_args->>'search',''))='' or strpos(lower(coalesce(m.body,'')||' '||coalesce(m.transcricao,'')),lower(btrim(p_args->>'search')))>0)
          and (coalesce(p_args->>'before','')='' or (m.data_msg,m.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::bigint))
        order by m.data_msg desc,m.id desc limit 50
      ) page
      left join lateral (
        -- Even an accidental duplicate confirmed ID must not invent an author.
        select (array_agg(matches.sender_id))[1] sender_id,(array_agg(matches.sender_name))[1] sender_name,
          (array_agg(matches.reply_msg_id))[1] reply_msg_id,(array_agg(matches.reply_preview))[1] reply_preview,
          (array_agg(matches.reply_sender_name))[1] reply_sender_name,(array_agg(matches.reply_from_me))[1] reply_from_me
        from (
          select o.sender_id,o.sender_name,o.reply_msg_id,o.reply_preview,o.reply_sender_name,o.reply_from_me from public.crm_chat_outbox o
          where o.conversation_id=cid and o.wa_msg_id is not null
            and private.crm_chat_message_key(o.wa_msg_id)=private.crm_chat_message_key(page.msg_id)
            and page.from_me=true
          limit 2
        ) matches
        having count(*)=1
      ) author on true
    ) t;
    return result;
  elsif p_action='detail' then
    return jsonb_build_object('conversation',to_jsonb(c)||jsonb_build_object('vendor_name',(select name from public.vendors where id=c.vendor_id),
      'lock_user_name',case when c.lock_until>now() then (select display_name from public.user_profiles where id=c.lock_user_id and approved_at is not null) end,
      'waiting_since',case when c.status='open' and c.last_from_me=false and (c.last_inbound_at is not null or c.last_preview is not null) then c.last_message_at end,
      'avatar_url',(select l.foto_url from public.wa_chat_labels l where l.vendedor_nome='ANA' and l.chat_id=c.wa_chat_id order by l.foto_checked_at desc nulls last,l.id desc limit 1)),'contact',(select jsonb_build_object('city',city,'state',state,'empresa',empresa,'email',email,'status',status) from public.contacts where id=c.contact_id),
      'notes',(select coalesce(jsonb_agg(t.row order by t.created_at desc),'[]'::jsonb) from (select jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author_name',u.display_name) row,n.created_at from public.crm_chat_notes n left join public.user_profiles u on u.id=n.author_id where n.conversation_id=cid order by n.created_at desc limit 50)t),
      'outbox',(select coalesce(jsonb_agg(t.row order by t.created_at),'[]'::jsonb) from (select to_jsonb(o)||jsonb_build_object('status',q.status,'error',q.error,'sent_at',q.sent_at,'filename',q.media_filename,'sender_name',o.sender_name) row,o.created_at from public.crm_chat_outbox o join public.wa_scheduled_messages q on q.id=o.scheduled_id where o.conversation_id=cid order by o.created_at desc limit 20)t));
  elsif p_action='sales' then
    if c.contact_id is null or not exists(select 1 from public.contacts linked where linked.id=c.contact_id and (p.role='admin' or linked.vendor_id=p.vendor_id))
      or coalesce(public.papel_restrito(),true) then return jsonb_build_object('orders','[]'::jsonb,'quotes','[]'::jsonb); end if;
    return jsonb_build_object('quotes',(select coalesce(jsonb_agg(to_jsonb(t) order by t.year desc,t.number desc),'[]'::jsonb) from (
      select q.id,q.numero as number,q.ano as year,q.status_kanban as status,q.mtime_iso as date,
        case when p.role='admin' and public.acesso_liberado_rota('/orcamentos') then '/orcamentos/lista'::text end as href
      from public.orcamentos_files q where q.contact_id=c.contact_id and q.arquivo_removido_em is null
        and (p.role='admin' or q.vendor_id=p.vendor_id or exists(select 1 from public.contacts linked where linked.id=q.contact_id and linked.vendor_id=p.vendor_id))
      order by q.ano desc,q.numero desc limit 20)t),
      'orders',(select coalesce(jsonb_agg(to_jsonb(t) order by t.date desc,t.id),'[]'::jsonb) from (
        select pv.id,pv.pedido_numero as number,pv.status,pv.valor_total as total,pv.data_venda as date,
          case when p.role='admin' and public.acesso_liberado_rota('/controle/pedidos') then '/controle/pedidos/'||pv.id end as href
        from public.mirror_pedidos_venda pv where exists(select 1 from public.orcamentos_files q where q.contact_id=c.contact_id
          and q.arquivo_removido_em is null and q.numero=pv.numero_orcamento)
          and not exists(select 1 from public.orcamentos_files other where other.numero=pv.numero_orcamento and other.contact_id is distinct from c.contact_id)
          and (public.ve_todos_pedidos() or upper(pv.vendedor)=public.vendedor_do_usuario() or upper(coalesce(pv.vendedor_2,''))=public.vendedor_do_usuario())
        order by pv.data_venda desc nulls last,pv.id limit 20)t));
  elsif p_action='read' then
    insert into public.crm_chat_reads(conversation_id,user_id,read_at) values(cid,p.id,now()) on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='assign' and c.contact_id is not null then perform 1 from public.contacts where id=c.contact_id for update; end if;
  -- Toda mutação revalida após obter a trava: atribuição pode mudar durante uma requisição.
  select * into c from public.crm_chat_conversations where id=cid for update;
  if p.role<>'admin' and c.vendor_id is distinct from p.vendor_id then raise exception 'Conversa transferida para outra carteira.' using errcode='42501'; end if;
  if p_action in ('followup','followup_done') then
    due_at:=case when p_action='followup' then nullif(p_args->>'due_at','')::timestamptz end;
    if due_at is not null and (not isfinite(due_at) or due_at>now()+interval '5 years') then raise exception 'Data de retorno inválida.'; end if;
    update public.crm_chat_conversations set follow_up_at=due_at,updated_at=now() where id=cid;
    return jsonb_build_object('ok',true);
  end if;
  session_id:=(p_args->>'session')::uuid;
  if p_action in ('claim','heartbeat') then
    if session_id is null then raise exception 'Sessão de atendimento inválida.'; end if;
    if c.lock_until>now() and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then raise exception 'Esta conversa está sendo atendida em outra sessão.' using errcode='55P03'; end if;
    if p_action='heartbeat' and (c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id) then raise exception 'Assuma a conversa novamente.'; end if;
    update public.crm_chat_conversations set lock_user_id=p.id,lock_session_id=session_id,lock_until=now()+interval '90 seconds',human_hold=true,status='open',updated_at=now() where id=cid;
    if p_action='claim' then
      if exists(select 1 from public.wa_scheduled_messages where vendedor_nome='ANA' and chat_id=c.wa_chat_id and status='sending' and crm_request_id is null and not coalesce(to_self,false)) then raise exception 'Há um envio da Ana em andamento. Aguarde a confirmação antes de assumir.'; end if;
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
    reply_id:=nullif(p_args->>'reply_msg_id','');
    if exists(select 1 from public.crm_chat_outbox where id=rid and conversation_id=cid and sender_id=p.id) then
      if exists(select 1 from public.crm_chat_outbox where id=rid and reply_msg_id is distinct from reply_id) then raise exception 'A citação desta solicitação não pode ser alterada.' using errcode='22023'; end if;
      return jsonb_build_object('ok',true,'id',rid);
    end if;
    if c.status<>'open' or c.lock_until is null or c.lock_until<=now() or c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id then raise exception 'Assuma a conversa antes de enviar.' using errcode='42501'; end if;
    body:=btrim(coalesce(p_args->>'body','')); media_path:=nullif(p_args->>'media_path',''); media_url:=nullif(p_args->>'media_url',''); mime:=lower(btrim(split_part(coalesce(p_args->>'mime',''),';',1))); kind:='chat';
    if length(body)>4000 then raise exception 'Mensagem deve ter no máximo 4000 caracteres.'; end if;
    if media_path is not null then
      if split_part(media_path,'/',1)<>cid::text or media_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.[a-z0-9]+$' or not exists(select 1 from storage.objects where bucket_id='crm-chat-media' and name=media_path and owner_id=p.id::text) then raise exception 'Anexo não pertence a este atendimento.' using errcode='42501'; end if;
      select metadata into object_metadata from storage.objects
        where bucket_id='crm-chat-media' and name=media_path and owner_id=p.id::text;
      if coalesce(object_metadata->>'size','') !~ '^[0-9]+$' then raise exception 'Tamanho do anexo não disponível.'; end if;
      if (object_metadata->>'size')::numeric not between 1 and 20971520 then raise exception 'Anexo deve ter no máximo 20 MB.'; end if;
      if lower(btrim(split_part(coalesce(object_metadata->>'mimetype',''),';',1))) is distinct from mime then raise exception 'Formato do anexo não corresponde ao arquivo enviado.'; end if;
      if mime in ('image/jpeg','image/png','image/webp') then kind:='image'; elsif mime in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav') then kind:='audio'; elsif mime in ('video/mp4','video/webm') then kind:='video'; elsif mime in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','application/zip') then kind:='document'; else raise exception 'Formato de anexo não permitido.'; end if;
      if media_url is null or split_part(media_url,'?',1)<>'https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/sign/crm-chat-media/'||media_path then raise exception 'URL do anexo inválida.'; end if;
    else
      media_url:=null;
      if body='' then raise exception 'Digite uma mensagem ou escolha um anexo.'; end if;
    end if;
    if reply_id is not null then
      select * into reply_source from public.wa_chat_messages where vendedor_nome='ANA' and chat_id=c.wa_chat_id and msg_id=reply_id;
      if reply_source.id is null then
        raise exception 'Mensagem citada não está disponível nesta conversa. Escolha outra mensagem.'
          using errcode='P0002',detail='crm_chat_quote_rejected';
      end if;
      reply_preview:=left(coalesce(nullif(reply_source.body,''),'['||reply_source.tipo||']'),200);
      if reply_source.from_me then
        select case when count(*)=1 then (array_agg(o.sender_name))[1] end into reply_sender
        from public.crm_chat_outbox o where o.conversation_id=cid and o.wa_msg_id is not null
          and private.crm_chat_message_key(o.wa_msg_id)=private.crm_chat_message_key(reply_source.msg_id);
      else reply_sender:=c.name; end if;
    end if;
    sid:=gen_random_uuid();
    insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,contato_nome,contato_numero,body,scheduled_at,status,to_self,urgente,crm_request_id,media_url,media_type,media_filename,reply_msg_id,reply_from_me)
      values(sid,'ANA',c.wa_chat_id,c.name,c.phone,body,now(),'pending',false,true,rid,media_url,case when media_path is not null then kind end,left(coalesce(p_args->>'filename','arquivo'),200),reply_id,reply_source.from_me);
    insert into public.crm_chat_outbox(id,conversation_id,scheduled_id,sender_id,body,tipo,media_path,reply_msg_id,reply_preview,reply_sender_name,reply_from_me) values(rid,cid,sid,p.id,body,kind,media_path,reply_id,reply_preview,reply_sender,reply_source.from_me);
    update public.crm_chat_conversations set lock_until=now()+interval '90 seconds',updated_at=now() where id=cid;
    return jsonb_build_object('ok',true,'id',rid);
  else raise exception 'Ação desconhecida.';
  end if;
  return jsonb_build_object('ok',true);
end $function$
;
