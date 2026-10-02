-- Read-only WhatsApp ANA labels and explicit existing label taxonomy.
-- Historical snapshots are observations; they never fabricate today's closure.
set local lock_timeout='500ms';
alter table public.crm_chat_conversations add column ana_tags text[] not null default '{}';
alter table public.crm_chat_conversations add column ana_terminal_labels text[] not null default '{}';
alter table public.crm_chat_conversations add column ana_terminal_ids text[] not null default '{}';
alter table public.crm_chat_conversations add column ana_seen_label_changed_at timestamptz;
alter table public.crm_chat_conversations add column manual_status_at timestamptz;
alter table public.crm_chat_conversations add column resolution_source text check(resolution_source in ('ana','crm'));
alter table public.crm_chat_conversations add column resolution_reason text;
alter table public.crm_chat_conversations add column resolution_observed_at timestamptz;
create index crm_chat_ana_tags_idx on public.crm_chat_conversations using gin(ana_tags);

-- Cache writes are integration-only. Existing authenticated SELECT and the
-- restrictive ANA portfolio scope stay intact; the service role bypasses RLS.
revoke truncate,references,trigger on public.wa_chat_labels,public.wascript_etiquetas from anon,authenticated;
create policy crm_ana_labels_insert_source on public.wa_chat_labels as restrictive for insert to anon,authenticated with check(vendedor_nome<>'ANA');
create policy crm_ana_labels_update_source on public.wa_chat_labels as restrictive for update to anon,authenticated using(vendedor_nome<>'ANA') with check(vendedor_nome<>'ANA');
create policy crm_ana_labels_delete_source on public.wa_chat_labels as restrictive for delete to anon,authenticated using(vendedor_nome<>'ANA');
create policy crm_ana_catalog_insert_source on public.wascript_etiquetas as restrictive for insert to anon,authenticated with check(vendedor_nome<>'ANA');
create policy crm_ana_catalog_update_source on public.wascript_etiquetas as restrictive for update to anon,authenticated using(vendedor_nome<>'ANA') with check(vendedor_nome<>'ANA');
create policy crm_ana_catalog_delete_source on public.wascript_etiquetas as restrictive for delete to anon,authenticated using(vendedor_nome<>'ANA');

create function private.crm_chat_apply_ana_labels(p_chat text,p_historical boolean default false,p_lifecycle boolean default true) returns void
language plpgsql security definer set search_path='' as $function$
declare l public.wa_chat_labels; c public.crm_chat_conversations; names text[]; terminal text[]; terminal_ids text[];
 observed timestamptz; should_close boolean; historical boolean; added boolean;
begin
 select * into l from public.wa_chat_labels where vendedor_nome='ANA' and chat_id=p_chat
  order by label_changed_at desc nulls last,id desc limit 1;
 if l.id is null or p_chat like '%@g.us' or p_chat='status@broadcast' then return;end if;
 select * into c from public.crm_chat_conversations where wa_chat_id=p_chat for update;
 if c.id is null then return;end if;
 observed:=l.label_changed_at;
 if observed is null or observed<c.ana_seen_label_changed_at then return;end if;
 select coalesce(array_agg(distinct name order by name),'{}'::text[]),
  coalesce(array_agg(distinct canon order by canon)filter(where state='FECHADO'),'{}'::text[]),
  coalesce(array_agg(distinct id order by id)filter(where state='FECHADO' or (catalog_missing and id=any(c.ana_terminal_ids))),'{}'::text[])
 into names,terminal,terminal_ids from(
  select coalesce(nullif(btrim(e.etiqueta_nome),''),'#'||ids.id) name,
   public.wa_etiqueta_canonica(public.sem_acento(e.etiqueta_nome)) canon,
   public.wa_status_da_etiqueta(e.etiqueta_nome) state,ids.id,e.id is null catalog_missing
  from unnest(l.label_ids)ids(id) left join public.wascript_etiquetas e
    on e.vendedor_nome='ANA' and e.etiqueta_id_wascript::text=ids.id
 )labels;
 -- During catalog DELETE/INSERT, preserve recognized terminal IDs while their
 -- translations are absent. Catalog renames are display updates, not new closes.
 if cardinality(terminal)=0 and cardinality(terminal_ids)>0 then terminal:=c.ana_terminal_labels;end if;
 added:=exists(select unnest(terminal_ids) except select unnest(c.ana_terminal_ids));
 historical:=p_historical or c.ana_seen_label_changed_at is null;
 should_close:=p_lifecycle and added and cardinality(terminal)>0 and c.status='open'
  and not c.human_hold and (c.lock_until is null or c.lock_until<=now())
  and (c.manual_status_at is null or observed>c.manual_status_at)
  and (c.last_inbound_at is null or c.last_inbound_at<=observed)
  and (c.last_from_me or c.last_message_at<=observed)
  and not exists(select 1 from public.crm_chat_outbox o join public.wa_scheduled_messages q on q.id=o.scheduled_id
    where o.conversation_id=c.id and q.status in('pending','sending'));
 if names is not distinct from c.ana_tags and terminal is not distinct from c.ana_terminal_labels and terminal_ids is not distinct from c.ana_terminal_ids
  and observed is not distinct from c.ana_seen_label_changed_at and not should_close then return;end if;
 update public.crm_chat_conversations set ana_tags=names,ana_terminal_labels=terminal,ana_terminal_ids=terminal_ids,ana_seen_label_changed_at=observed,
  status=case when should_close then 'resolved' else status end,
  resolution_source=case when should_close then 'ana' else resolution_source end,
  resolution_reason=case when should_close then terminal[1] else resolution_reason end,
  resolution_observed_at=case when should_close then observed else resolution_observed_at end,
  resolved_at=case when should_close then case when historical then null else now() end else resolved_at end,
  updated_at=now() where id=c.id;
end;
$function$;
revoke all on function private.crm_chat_apply_ana_labels(text,boolean,boolean) from public,anon,authenticated;

create function private.crm_chat_ana_labels_changed() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
 if new.vendedor_nome<>'ANA' then return null;end if;
 if tg_op='UPDATE' and old.label_ids is not distinct from new.label_ids and old.chat_id is not distinct from new.chat_id then return null;end if;
 perform private.crm_chat_apply_ana_labels(new.chat_id,tg_op='INSERT',true);
 return null;
end;
$function$;
revoke all on function private.crm_chat_ana_labels_changed() from public,anon,authenticated;
-- 'crm_chat_label_arrived' sorts before this trigger and ensures the conversation exists.
create trigger crm_chat_z_ana_labels_changed after insert or update of label_ids,chat_id on public.wa_chat_labels
 for each row execute function private.crm_chat_ana_labels_changed();

create function private.crm_chat_ana_catalog_changed() returns trigger
language plpgsql security definer set search_path='' as $function$
declare chat text; vendor_name text:=case when tg_op='DELETE' then old.vendedor_nome else new.vendedor_nome end;
begin
 if vendor_name<>'ANA' then return null;end if;
 -- The sync replaces the catalog with DELETE then INSERT. Do not erase labels
 -- or treat that temporary catalog gap/rename as a new terminal event.
 if tg_op<>'DELETE' then
  for chat in select distinct l.chat_id from public.wa_chat_labels l where l.vendedor_nome='ANA'
   and new.etiqueta_id_wascript::text=any(l.label_ids) order by l.chat_id loop
   perform private.crm_chat_apply_ana_labels(chat,false,false);
  end loop;
 end if;
 perform realtime.send(jsonb_build_object('kind','tags'),'change','crm-chat:catalog',true);
 return null;
end;
$function$;
revoke all on function private.crm_chat_ana_catalog_changed() from public,anon,authenticated;
create trigger crm_chat_ana_catalog_changed after insert or update of etiqueta_nome,etiqueta_id_wascript or delete on public.wascript_etiquetas
 for each row execute function private.crm_chat_ana_catalog_changed();

CREATE OR REPLACE FUNCTION private.crm_chat_productivity_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_table_name='crm_chat_conversations' then
  if new.status is distinct from old.status then
   -- ANA sync supplies an observation timestamp or NULL for an unknown historical close.
   if new.status='open' then new.resolved_at:=null;
   elsif new.resolution_source is distinct from 'ana' then new.resolved_at:=now();
   end if;
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

CREATE OR REPLACE FUNCTION private.crm_chat_sync_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    resolution_source=case when not new.from_me and new.data_msg>existing.last_message_at then null else existing.resolution_source end,
    resolution_reason=case when not new.from_me and new.data_msg>existing.last_message_at then null else existing.resolution_reason end,
    resolution_observed_at=case when not new.from_me and new.data_msg>existing.last_message_at then null else existing.resolution_observed_at end,
    updated_at=now() returning id into cid;
  return new;
end $function$;

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
        'vendor_id',conv.vendor_id,'vendor_name',v.name,'avatar_url',avatar.foto_url,'status',conv.status,'tags',conv.tags,'ana_tags',conv.ana_tags,'resolution_source',conv.resolution_source,'resolution_reason',conv.resolution_reason,'resolution_observed_at',conv.resolution_observed_at,'resolved_at',conv.resolved_at,'human_hold',conv.human_hold,
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
        and (coalesce(p_args->>'ana_tag','')='' or p_args->>'ana_tag'=any(conv.ana_tags))
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
      'ana_tags',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from (select distinct btrim(e.etiqueta_nome) name from public.wascript_etiquetas e where e.vendedor_nome='ANA' and nullif(btrim(e.etiqueta_nome),'') is not null) catalog),
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
    update public.crm_chat_conversations set lock_user_id=p.id,lock_session_id=session_id,lock_until=now()+interval '90 seconds',human_hold=true,status='open',resolved_at=null,resolution_source=null,resolution_reason=null,resolution_observed_at=null,
      manual_status_at=case when p_action='claim' then now() else manual_status_at end,updated_at=now() where id=cid;
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
    update public.crm_chat_conversations set status=case when p_action='resolve' then 'resolved' else 'open' end,human_hold=case when p_action='resolve' then true else human_hold end,lock_user_id=null,lock_session_id=null,lock_until=null,manual_status_at=now(),resolution_source=case when p_action='resolve' then 'crm' end,
      resolution_reason=null,resolution_observed_at=null,resolved_at=case when p_action='resolve' then now() end,updated_at=now() where id=cid;
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
end $function$;

-- Preserve existing manual/human decisions. Unknown past CRM resolved authors
-- remain unknown; only explicit new CRM actions populate resolution_source.
do $backfill$
declare chat text;
begin
 for chat in select l.chat_id from public.wa_chat_labels l where l.vendedor_nome='ANA' order by l.chat_id loop
  perform private.crm_chat_apply_ana_labels(chat,true,true);
 end loop;
end;
$backfill$;
