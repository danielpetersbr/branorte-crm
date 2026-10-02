-- Run after the media/avatar migration. Every fixture and queue row is rolled back.
-- Tests use real authenticated roles; nothing is sent to WhatsApp.
begin;
set local statement_timeout='15s';
do $$
declare
  subject uuid; owned_vendor uuid; other_vendor uuid; admin_id uuid;
  cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid();
  token text:='media-test-'||gen_random_uuid()::text; chat text;
  request_id uuid; queue_id uuid; attachment text; mime text; expected_kind text;
  own_private_path text; foreign_private_path text;
  expected_mimes text[]:=array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','video/mp4','video/webm','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','application/zip'];
  actual_mimes text[]; result jsonb; detail jsonb; messages jsonb; args jsonb;
  denied boolean; queued integer; owned_count integer;
  id_sample text:='true_5599999999999@c.us_TESTMESSAGEHASH';
begin
  select p.id,p.vendor_id into subject,owned_vendor from public.user_profiles p join public.vendors v on v.id=p.vendor_id
    where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
  select id into other_vendor from public.vendors where ativo and id<>owned_vendor order by id limit 1;
  select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
  if subject is null or other_vendor is null or admin_id is null then raise exception 'Real approved admin/vendor and two active portfolios required'; end if;
  select allowed_mime_types into actual_mimes from storage.buckets where id='crm-chat-media' and not public and file_size_limit=20971520;
  if actual_mimes is distinct from expected_mimes then raise exception 'Storage bucket MIME/size/public settings differ'; end if;
  if has_function_privilege('anon','public.crm_chat(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','private.crm_chat_apply_delivery_id()','EXECUTE') then raise exception 'Unexpected privileged function grants'; end if;
  chat:=token||'@c.us';
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id,last_message_at)
    values(cid,chat,'5599999999999',token,owned_vendor,now()+interval '1 day'),
      (foreign_cid,token||'-other@c.us','5599999999998',token||'-other',other_vendor,now()+interval '1 day');
  own_private_path:=cid::text||'/'||gen_random_uuid()::text||'.pdf';
  foreign_private_path:=foreign_cid::text||'/'||gen_random_uuid()::text||'.pdf';
  insert into storage.objects(bucket_id,name,owner_id,metadata) values
    ('crm-chat-media',own_private_path,null,jsonb_build_object('size',100,'mimetype','application/pdf')),
    ('crm-chat-media',foreign_private_path,null,jsonb_build_object('size',100,'mimetype','application/pdf'));
  insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,foto_url,foto_checked_at)
    values('ANA',token,chat,'https://example.test/ana.jpg',now()),
      ('ANA',token||'-old',chat,'https://example.test/old.jpg',now()-interval '1 day'),
      ('DANIEL',token,chat,'https://example.test/other-account.jpg',now());
  insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,filename,data_msg)
    values('ANA',chat,token,true,'document','', 'proposta.xlsx',now());
  update public.wa_chat_messages set filename=null where msg_id=token;
  if (select filename from public.wa_chat_messages where msg_id=token) is distinct from 'proposta.xlsx' then raise exception 'Legacy sync erased a captured attachment name'; end if;
  execute 'set local role anon';
  denied:=false;
  begin perform public.crm_chat('list','{}'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous chat RPC succeeded'; end if;
  begin
    if exists(select 1 from storage.objects where bucket_id='crm-chat-media' and name in (own_private_path,foreign_private_path)) then raise exception 'Anonymous can read private inbound files'; end if;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',subject::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
  select count(*) into owned_count from storage.objects where bucket_id='crm-chat-media' and name in (own_private_path,foreign_private_path);
  if owned_count<>1 or not exists(select 1 from storage.objects where bucket_id='crm-chat-media' and name=own_private_path) then raise exception 'Inbound private media RLS does not isolate the vendor portfolio'; end if;
  result:=public.crm_chat('list',jsonb_build_object('search',token));
  if jsonb_array_length(result->'items')<>1 or result->'items'->0->>'avatar_url'<>'https://example.test/ana.jpg' then raise exception 'Vendor list leaks another portfolio/account or duplicates labels'; end if;
  detail:=public.crm_chat('detail',jsonb_build_object('id',cid));
  if detail->'conversation'->>'avatar_url'<>'https://example.test/ana.jpg' then raise exception 'Detail avatar differs from list'; end if;
  messages:=public.crm_chat('messages',jsonb_build_object('id',cid));
  if messages->0->>'filename'<>'proposta.xlsx' then raise exception 'History filename omitted'; end if;
  denied:=false;
  begin perform public.crm_chat('detail',jsonb_build_object('id',foreign_cid)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Vendor read another portfolio detail'; end if;
  select count(*) into owned_count from public.crm_chat_conversations where id in (cid,foreign_cid);
  if owned_count<>1 then raise exception 'Conversation RLS lost portfolio scope'; end if;
  perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
  foreach mime in array expected_mimes loop
    request_id:=gen_random_uuid(); attachment:=cid::text||'/'||gen_random_uuid()::text||'.bin';
    expected_kind:=case when mime like 'image/%' then 'image' when mime like 'audio/%' then 'audio' when mime like 'video/%' then 'video' else 'document' end;
    execute 'reset role';
    insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-chat-media',attachment,subject::text,jsonb_build_object('size',20971520,'mimetype',mime));
    execute 'set local role authenticated';
    args:=jsonb_build_object('id',cid,'session',sess,'request',request_id,'body','','media_path',attachment,'media_url','https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/sign/crm-chat-media/'||attachment||'?token=fixture','mime',upper(mime)||'; charset=UTF-8','filename','proposta.xlsx');
    perform public.crm_chat('send',args);
    -- A duplicate request cannot enqueue twice, even if a retry contains bad attachment data.
    perform public.crm_chat('send',args||jsonb_build_object('media_path','bad','mime','text/html'));
    execute 'reset role';
    select q.id into queue_id from public.wa_scheduled_messages q join public.crm_chat_outbox o on o.scheduled_id=q.id
      where o.id=request_id and q.media_type=expected_kind and q.media_filename='proposta.xlsx';
    if queue_id is null then raise exception 'MIME kind/filename not preserved for %',mime; end if;
    select count(*) into queued from public.wa_scheduled_messages where crm_request_id=request_id;
    if queued<>1 then raise exception 'Send idempotency failed'; end if;
    perform public.crm_chat_queue_claim(queue_id);
    update public.wa_scheduled_messages set status='sent',sent_at=now(),error=null,wa_msg_id=id_sample where id=queue_id;
    if (select wa_msg_id from public.crm_chat_outbox where id=request_id) is distinct from id_sample then raise exception 'Delivery ID did not reach outbox'; end if;
    execute 'set local role authenticated';
  end loop;
  detail:=public.crm_chat('detail',jsonb_build_object('id',cid));
  if exists(select 1 from jsonb_array_elements(detail->'outbox') o where o.value->>'filename'<>'proposta.xlsx' or o.value->>'wa_msg_id'<>id_sample) then raise exception 'Outbox RPC omitted filename/transport ID'; end if;
  -- Owner, MIME, actual Storage metadata, size and lease are validated independently.
  foreach mime in array array['text/html','application/octet-stream','application/x-msdownload'] loop
    attachment:=cid::text||'/'||gen_random_uuid()::text||'.bin';
    execute 'reset role';
    insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-chat-media',attachment,subject::text,jsonb_build_object('size',100,'mimetype',mime));
    execute 'set local role authenticated';
    args:=jsonb_build_object('id',cid,'session',sess,'request',gen_random_uuid(),'media_path',attachment,'media_url','https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/sign/crm-chat-media/'||attachment,'mime',mime);
    denied:=false;
    begin perform public.crm_chat('send',args); exception when raise_exception then denied:=SQLERRM='Formato de anexo não permitido.'; end;
    if not denied then raise exception 'Forbidden MIME accepted: %',mime; end if;
  end loop;
  execute 'reset role';
  update storage.objects set metadata=jsonb_build_object('size',20971521,'mimetype','application/pdf') where bucket_id='crm-chat-media' and name=attachment;
  execute 'set local role authenticated';
  args:=args||jsonb_build_object('request',gen_random_uuid(),'mime','application/pdf'); denied:=false;
  begin perform public.crm_chat('send',args); exception when raise_exception then denied:=SQLERRM='Anexo deve ter no máximo 20 MB.'; end;
  if not denied then raise exception 'Oversized object accepted'; end if;
  execute 'reset role';
  update storage.objects set metadata=jsonb_build_object('size',100,'mimetype','text/html') where bucket_id='crm-chat-media' and name=attachment;
  execute 'set local role authenticated'; denied:=false;
  begin perform public.crm_chat('send',args); exception when raise_exception then denied:=SQLERRM='Formato do anexo não corresponde ao arquivo enviado.'; end;
  if not denied then raise exception 'Spoofed Storage MIME accepted'; end if;
  execute 'reset role';
  update storage.objects set owner_id=admin_id::text,metadata=jsonb_build_object('size',100,'mimetype','application/pdf') where bucket_id='crm-chat-media' and name=attachment;
  execute 'set local role authenticated'; denied:=false;
  begin perform public.crm_chat('send',args); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Another user attachment accepted'; end if;
  denied:=false;
  begin perform public.crm_chat('send',args||jsonb_build_object('session',gen_random_uuid())); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Send without owned lease accepted'; end if;
  execute 'reset role';
  -- A newest authoritative NULL hides an older duplicate label cache entry.
  update public.wa_chat_labels set foto_url=null,foto_checked_at=now()+interval '1 minute' where vendedor_nome='ANA' and phone=token;
  execute 'set local role authenticated';
  result:=public.crm_chat('list',jsonb_build_object('search',token));
  if result->'items'->0->'avatar_url' is distinct from 'null'::jsonb then raise exception 'Privacy NULL resurrected an older picture'; end if;
  detail:=public.crm_chat('detail',jsonb_build_object('id',cid));
  if detail->'conversation'->'avatar_url' is distinct from 'null'::jsonb then raise exception 'Detail resurrected older picture'; end if;
  execute 'reset role';
  perform set_config('chat_media_test.results',jsonb_build_object('mime_count',cardinality(expected_mimes),'max_bytes',20971520,'vendor_rls',true,'anon_denied',true,'avatar_batch_no_duplicates',true,'privacy_null',true,'history_filename',true,'outbox_filename_delivery_id',true,'idempotency',true,'owner_mime_size_lease_checks',true,'inbound_storage_vendor_rls',true,'inbound_storage_anon_hidden',true)::text,true);
end $$;
select 'PASS' result,current_setting('chat_media_test.results')::jsonb checks;
rollback;
