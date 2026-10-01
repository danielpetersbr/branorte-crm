-- Run as postgres. Every fixture and realtime event is rolled back.
-- No client message is sent: the queue fixture is cancelled and scheduled at infinity.
begin;
set local statement_timeout = '30s';

do $$
declare
  admin_id uuid; seller_id uuid; other_id uuid; unapproved_id uuid;
  seller_vendor uuid; other_vendor uuid;
  cid uuid := gen_random_uuid(); sid uuid := gen_random_uuid(); rid uuid := gen_random_uuid();
  jid text; message_id bigint; n integer; before_n integer;
  marker text := 'SYNTHETIC-PRIVATE-CONTENT-DO-NOT-BROADCAST';
begin
  select id into admin_id from public.user_profiles where role='admin' and approved_at is not null limit 1;
  select p.id,p.vendor_id into seller_id,seller_vendor from public.user_profiles p join public.vendors v on v.id=p.vendor_id
    where p.role='vendor' and p.approved_at is not null and v.ativo limit 1;
  select p.id,p.vendor_id into other_id,other_vendor from public.user_profiles p join public.vendors v on v.id=p.vendor_id
    where p.role='vendor' and p.approved_at is not null and v.ativo and p.vendor_id<>seller_vendor limit 1;
  select id into unapproved_id from public.user_profiles where approved_at is null limit 1;
  if admin_id is null or seller_id is null or other_id is null or unapproved_id is null then
    raise exception 'FAIL: approved admin, two active vendor portfolios and unapproved profile required';
  end if;

  -- Exercise the helper with the real authenticated database role, not postgres bypassrls.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',seller_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller_id,'role','authenticated')::text,true);
  if private.crm_chat_topic_allowed('crm-chat:vendor:'||seller_vendor::text) is distinct from true
    or private.crm_chat_topic_allowed('crm-chat:catalog') is distinct from true
    or private.crm_chat_topic_allowed('crm-chat:vendor:'||other_vendor::text) is distinct from false
    or private.crm_chat_topic_allowed('crm-chat:all') is distinct from false
    or private.crm_chat_topic_allowed('crm-worker:ANA') is distinct from false
    or private.crm_chat_topic_allowed('crm-chat:vendor:'||seller_vendor::text||':extra') is distinct from false then
    raise exception 'FAIL: vendor topic authorization';
  end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  if private.crm_chat_topic_allowed('crm-chat:all') is distinct from true
    or private.crm_chat_topic_allowed('crm-chat:catalog') is distinct from true
    or private.crm_chat_topic_allowed('crm-worker:ANA') is distinct from false then
    raise exception 'FAIL: admin topic authorization';
  end if;
  perform set_config('request.jwt.claim.sub',unapproved_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',unapproved_id,'role','authenticated')::text,true);
  if private.crm_chat_topic_allowed('crm-chat:catalog') is distinct from false
    or private.crm_chat_topic_allowed('crm-chat:all') is distinct from false
    or private.crm_chat_topic_allowed('crm-chat:vendor:'||seller_vendor::text) is distinct from false then
    raise exception 'FAIL: unapproved profile joined a topic';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  if private.crm_chat_topic_allowed('crm-chat:catalog') is distinct from false then
    raise exception 'FAIL: missing authenticated identity joined catalog';
  end if;
  execute 'reset role';
  if has_function_privilege('anon','private.crm_chat_topic_allowed(text)','EXECUTE') then
    raise exception 'FAIL: anonymous helper execution granted';
  end if;
  execute 'set local role anon';
  begin
    perform private.crm_chat_topic_allowed('crm-chat:catalog');
    raise exception 'FAIL: anonymous helper invocation succeeded';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  jid := 'crm-realtime-test-'||cid::text||'@c.us';
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id)
    values(cid,jid,'SYNTHETIC-NON-PHONE',marker,seller_vendor);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='conversation';
  if n<>2 then raise exception 'FAIL: conversation insert did not emit admin plus current vendor events (%)',n; end if;
  select count(*) into before_n from realtime.messages where payload->>'id'=cid::text;
  update public.crm_chat_conversations set updated_at=now()+interval '1 second' where id=cid;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text;
  if n<>before_n then raise exception 'FAIL: updated_at-only update emitted an invalidation'; end if;

  -- Reassignment invalidates both the former and current vendor, without the new owner in its payload.
  update public.crm_chat_conversations set vendor_id=other_vendor where id=cid;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='conversation';
  if n<>5 or not exists(select 1 from realtime.messages where payload->>'id'=cid::text and topic='crm-chat:vendor:'||other_vendor::text)
    or (select count(*) from realtime.messages where payload->>'id'=cid::text and topic='crm-chat:vendor:'||seller_vendor::text)<>2 then
    raise exception 'FAIL: reassignment did not notify admin, former vendor and current vendor';
  end if;

  insert into public.crm_chat_notes(conversation_id,author_id,body) values(cid,other_id,marker);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='notes';
  if n<>2 then raise exception 'FAIL: note trigger events (%)',n; end if;
  insert into public.wa_chat_messages(vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
    values('ANA',jid,'SYNTHETIC-NON-PHONE','rt-'||rid::text,true,'chat',marker,now()) returning id into message_id;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='messages';
  if n<>2 then raise exception 'FAIL: history insert events (%)',n; end if;
  update public.wa_chat_messages set transcricao=marker||'-TRANSCRIPTION' where id=message_id;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='messages';
  if n<>4 then raise exception 'FAIL: history media/transcription update events (%)',n; end if;
  update public.wa_chat_messages set synced_at=now()+interval '1 second' where id=message_id;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='messages';
  if n<>4 then raise exception 'FAIL: synced_at-only update emitted a history invalidation'; end if;

  insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,scheduled_at,status,crm_request_id)
    values(sid,'ANA',jid,marker,'infinity'::timestamptz,'cancelled',rid);
  insert into public.crm_chat_outbox(id,conversation_id,scheduled_id,sender_id,body,tipo)
    values(rid,cid,sid,other_id,marker,'chat');
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='outbox';
  if n<>2 then raise exception 'FAIL: outbox insert events (%)',n; end if;
  update public.wa_scheduled_messages set status='failed',error=marker where id=sid;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='outbox';
  if n<>4 then raise exception 'FAIL: delivery status/error events (%)',n; end if;
  update public.wa_scheduled_messages set attempts=attempts+1 where id=sid;
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and payload->>'kind'='outbox';
  if n<>4 then raise exception 'FAIL: unrelated queue update emitted a delivery invalidation'; end if;

  if exists(select 1 from realtime.messages where payload->>'id'=cid::text and
    (private is distinct from true or extension<>'broadcast' or event<>'change'
      or (payload-'id'-'kind')<>'{}'::jsonb or payload::text like '%'||marker||'%')) then
    raise exception 'FAIL: invalidation exposed content/contact data or was public';
  end if;
  if exists(select 1 from realtime.messages where payload->>'id'=cid::text and payload->>'kind' in ('notes','messages','outbox')
    and topic='crm-chat:vendor:'||seller_vendor::text) then
    raise exception 'FAIL: former vendor received post-transfer conversation invalidations';
  end if;

  -- Test the actual realtime.messages SELECT policy using Realtime's topic setting.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',seller_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller_id,'role','authenticated')::text,true);
  perform set_config('realtime.topic','crm-chat:vendor:'||seller_vendor::text,true);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and topic='crm-chat:vendor:'||seller_vendor::text;
  if n<>2 then raise exception 'FAIL: actual RLS denied own vendor topic'; end if;
  perform set_config('realtime.topic','crm-chat:vendor:'||other_vendor::text,true);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and topic='crm-chat:vendor:'||other_vendor::text;
  if n<>0 then raise exception 'FAIL: actual RLS allowed another vendor topic'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform set_config('realtime.topic','crm-chat:all',true);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text and topic='crm-chat:all';
  if n=0 then raise exception 'FAIL: actual RLS denied administrator topic'; end if;
  perform set_config('request.jwt.claim.sub',unapproved_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',unapproved_id,'role','authenticated')::text,true);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text;
  if n<>0 then raise exception 'FAIL: actual RLS allowed unapproved profile'; end if;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  select count(*) into n from realtime.messages where payload->>'id'=cid::text;
  if n<>0 then raise exception 'FAIL: actual RLS allowed anonymous profile'; end if;
  execute 'reset role';
end $$;

rollback;
select 'PASS: authenticated/admin/vendor/unapproved/anonymous authorization; reassignment, history, notes, outbox and delivery invalidations; private minimal payloads; all fixtures rolled back' as resultado;
