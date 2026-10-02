-- All rows, profile changes, holds, and queued sends are transaction-local.
-- Run after crm_chat_message_authors; never sends anything to WhatsApp.
begin;
set local statement_timeout='15s';
do $test$
declare
  subject uuid; owned_vendor uuid; other_vendor uuid; admin_id uuid;
  cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid();
  token text:='author-test-'||gen_random_uuid()::text; chat text; expected_name text; expected_vendor_name text;
  rid uuid:=gen_random_uuid(); rid2 uuid:=gen_random_uuid(); rid3 uuid:=gen_random_uuid(); queue_id uuid;
  hash1 text:='A'||replace(gen_random_uuid()::text,'-','');
  hash2 text:='B'||replace(gen_random_uuid()::text,'-','');
  hash3 text:='C'||replace(gen_random_uuid()::text,'-','');
  result jsonb; row jsonb; denied boolean; query_plan jsonb;
begin
  select p.id,p.vendor_id,coalesce(nullif(btrim(p.display_name),''),nullif(btrim(v.name),''))
    into subject,owned_vendor,expected_name from public.user_profiles p join public.vendors v on v.id=p.vendor_id
    where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
  select id into other_vendor from public.vendors where ativo and id<>owned_vendor order by id limit 1;
  select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
  if subject is null or other_vendor is null or admin_id is null then raise exception 'Approved vendor/admin and two portfolios required'; end if;
  if private.crm_chat_message_key('true_5599999999999@c.us_'||hash1)<>hash1
    or private.crm_chat_message_key('false_999999@lid_'||hash1||'_device')<>hash1
    or private.crm_chat_message_key('true_5599999999999@s.whatsapp.net_'||hash1)<>hash1
    or private.crm_chat_message_key('true_999999@g.us_'||hash1)<>hash1
    or private.crm_chat_message_key(hash1)<>hash1
    or private.crm_chat_message_key('true_broken') is not null
    or private.crm_chat_message_key('') is not null then raise exception 'Canonical ID formats differ'; end if;
  if has_function_privilege('anon','public.crm_chat(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','private.crm_chat_snapshot_sender()','EXECUTE')
    or has_function_privilege('authenticated','private.crm_chat_message_key(text)','EXECUTE')
    then raise exception 'Unexpected author helper/API grants'; end if;
  chat:=token||'@c.us';
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id,last_message_at)
    values(cid,chat,'5599999999999',token,owned_vendor,now()),
      (foreign_cid,token||'-other@c.us','5599999999998',token||'-other',other_vendor,now());
  execute 'set local role anon';
  denied:=false;
  begin perform public.crm_chat('messages',jsonb_build_object('id',cid)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anon read authors'; end if;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',subject::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
  denied:=false;
  begin perform public.crm_chat('messages',jsonb_build_object('id',foreign_cid)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Vendor read foreign authors'; end if;
  perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid,'body',token));
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid,'body',token));
  execute 'reset role';
  if (select count(*) from public.crm_chat_outbox where id=rid)<>1 then raise exception 'Author change broke idempotency'; end if;
  if (select sender_name from public.crm_chat_outbox where id=rid) is distinct from expected_name then raise exception 'Send did not snapshot actual author name'; end if;
  insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
    values('ANA',chat,hash1,true,'chat',token,now());
  execute 'set local role authenticated';
  result:=public.crm_chat('messages',jsonb_build_object('id',cid));
  if result->0->>'sender_id' is not null or result->0->>'sender_name' is not null then raise exception 'Unconfirmed ID inferred an author'; end if;
  execute 'reset role';
  -- Race A: history arrives before the queue acknowledgement.
  update public.wa_scheduled_messages set wa_msg_id='true_5599999999999@c.us_'||hash1,status='sent',sent_at=now()
    where crm_request_id=rid;
  execute 'set local role authenticated';
  result:=public.crm_chat('messages',jsonb_build_object('id',cid));
  if result->0->>'sender_id'<>subject::text or result->0->>'sender_name' is distinct from expected_name then raise exception 'History-before-confirmation lost author'; end if;
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid2,'body',token||'-second'));
  execute 'reset role';
  -- Race B: queue acknowledgement arrives before the history.
  update public.wa_scheduled_messages set wa_msg_id=hash2,status='sent',sent_at=now() where crm_request_id=rid2;
  insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
    values('ANA',chat,'false_999999@lid_'||hash2||'_device',true,'chat',token,now()+interval '1 second'),
      ('ANA',chat,hash2,false,'chat',token,now()+interval '2 seconds'),
      ('ANA',chat,hash3,true,'chat',token,now()+interval '3 seconds');
  -- A confirmed ID in another conversation cannot attribute an own-chat row.
  queue_id:=gen_random_uuid();
  insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,scheduled_at,status,crm_request_id,wa_msg_id)
    values(queue_id,'ANA',token||'-other@c.us',token,now(),'sent',gen_random_uuid(),hash3);
  insert into public.crm_chat_outbox(id,conversation_id,scheduled_id,sender_id,body,tipo,wa_msg_id)
    values(gen_random_uuid(),foreign_cid,queue_id,admin_id,token,'chat',hash3);
  -- A real author name change cannot rewrite the prior snapshots.
  update public.user_profiles set display_name=token||'-renamed' where id=subject;
  update public.crm_chat_outbox set sender_name='forged',sender_id=admin_id where id=rid;
  if (select sender_id from public.crm_chat_outbox where id=rid)<>subject
    or (select sender_name from public.crm_chat_outbox where id=rid) is distinct from expected_name then raise exception 'Snapshot author/name changed'; end if;
  execute 'set local role authenticated';
  result:=public.crm_chat('messages',jsonb_build_object('id',cid));
  for row in select value from jsonb_array_elements(result) loop
    if (row->>'msg_id') like 'false_%' then
      if row->>'sender_id'<>subject::text or row->>'sender_name' is distinct from expected_name then raise exception 'Confirmation-before-history or profile rename lost author'; end if;
    elsif row->>'msg_id'=hash2 or row->>'msg_id'=hash3 then
      if row->>'sender_id' is not null or row->>'sender_name' is not null then raise exception 'Inbound or unknown origin invented author'; end if;
    end if;
  end loop;
  -- Duplicate confirmed IDs are deliberately ambiguous, even with identical users.
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid3,'body',token||'-duplicate'));
  execute 'reset role';
  update public.wa_scheduled_messages set wa_msg_id=hash1,status='sent',sent_at=now() where crm_request_id=rid3;
  execute 'set local role authenticated';
  result:=public.crm_chat('messages',jsonb_build_object('id',cid));
  select value into row from jsonb_array_elements(result) where value->>'msg_id'=hash1;
  if row->>'sender_id' is not null or row->>'sender_name' is not null then raise exception 'Ambiguous ID invented author'; end if;
  execute 'reset role';
  -- The normalized-ID index must support the bounded per-page lookup.
  perform set_config('enable_seqscan','off',true);
  execute format('explain (format json) select sender_id from public.crm_chat_outbox where conversation_id=%L::uuid and wa_msg_id is not null and private.crm_chat_message_key(wa_msg_id)=%L limit 2',cid,hash2) into query_plan;
  -- With only a few real rows PostgreSQL may correctly choose the existing
  -- conversation index. Both bound the lookup; verify the canonical index is valid.
  if query_plan::text not like '%crm_chat_outbox_author_key_idx%'
    and query_plan::text not like '%crm_chat_outbox_conversation_idx%' then raise exception 'Author lookup is not index-backed'; end if;
  if not exists(select 1 from pg_index i join pg_class x on x.oid=i.indexrelid
    where x.relname='crm_chat_outbox_author_key_idx' and i.indisvalid
      and pg_get_indexdef(i.indexrelid) like '%crm_chat_message_key(wa_msg_id)%') then raise exception 'Canonical ID index missing/invalid'; end if;
  perform set_config('enable_seqscan','on',true);
  -- Empty display names use the vendor attached to the sender profile, never email.
  select nullif(btrim(name),'') into expected_vendor_name from public.vendors where id=owned_vendor;
  update public.user_profiles set display_name=' ' where id=subject;
  rid3:=gen_random_uuid();
  execute 'set local role authenticated';
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid3,'body',token||'-fallback'));
  execute 'reset role';
  if (select sender_name from public.crm_chat_outbox where id=rid3) is distinct from expected_vendor_name then raise exception 'Sender vendor fallback missing'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform public.crm_chat('assign',jsonb_build_object('id',cid,'vendor',other_vendor));
  result:=public.crm_chat('messages',jsonb_build_object('id',cid));
  select value into row from jsonb_array_elements(result) where (value->>'msg_id') like 'false_%';
  if row->>'sender_id'<>subject::text or row->>'sender_name' is distinct from expected_name then raise exception 'Transfer rewrote history author'; end if;
  result:=public.crm_chat('detail',jsonb_build_object('id',cid));
  select value into row from jsonb_array_elements(result->'outbox') where value->>'id'=rid::text;
  if row->>'sender_name' is distinct from expected_name then raise exception 'Outbox detail uses current profile name'; end if;
  perform set_config('request.jwt.claim.sub',subject::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
  denied:=false;
  begin perform public.crm_chat('messages',jsonb_build_object('id',cid)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Old portfolio retained history access after transfer'; end if;
  execute 'reset role';
  -- No display name/vendor is unknown: do not invent Ana, email, or current owner.
  update public.user_profiles set display_name=' ',vendor_id=null where id=admin_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
  rid3:=gen_random_uuid();
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',rid3,'body',token||'-unknown-name'));
  execute 'reset role';
  if (select sender_id from public.crm_chat_outbox where id=rid3)<>admin_id
    or (select sender_name from public.crm_chat_outbox where id=rid3) is not null then raise exception 'Unknown sender name invented'; end if;
end;
$test$;
select 'PASS: sender snapshots, canonical IDs, both races, transfer, RLS, ambiguity, index, idempotency' result;
rollback;
