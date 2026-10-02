-- Real-role regression; candidate DDL and every fixture/send stay in rollback.
begin;
set local statement_timeout='15s';
do $test$
declare
 subject uuid; admin_id uuid; vendor uuid; other_vendor uuid; vendor_name text;
 cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid(); ct uuid:=gen_random_uuid(); other_ct uuid:=gen_random_uuid();
 sess uuid:=gen_random_uuid(); token text:='productivity-test-'||gen_random_uuid()::text;
 source_id text:='Q'||replace(gen_random_uuid()::text,'-','');
 foreign_msg text:='F'||replace(gen_random_uuid()::text,'-','');
 reply_id text:='R'||replace(gen_random_uuid()::text,'-',''); request uuid:=gen_random_uuid(); request2 uuid;
 row jsonb; first_page jsonb; second_page jsonb; result jsonb; before_result jsonb; name_snapshot text;
 reply_uuid uuid; denied boolean; waiting_at timestamptz:=now()-interval '2 minutes';
 expected bigint; queues_before bigint; queue_id uuid; quote_id bigint; order_id text:='test-order-'||gen_random_uuid()::text;
 idx integer; previous_time timestamptz; previous_id uuid; actual_time timestamptz; actual_id uuid; failure_detail text;
begin
 select p.id,p.vendor_id,v.name into subject,vendor,vendor_name from public.user_profiles p join public.vendors v on v.id=p.vendor_id
  where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
 select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
 select id into other_vendor from public.vendors where ativo and id<>vendor limit 1;
 if subject is null or admin_id is null or other_vendor is null then raise exception 'Approved roles required'; end if;
 insert into public.contacts(id,phone,name,vendor_id) values(ct,token,token,vendor),(other_ct,token||'-other-9',token,other_vendor);
 insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_inbound_at,last_from_me)
 values(cid,token||'@c.us',token,token||'-one',ct,vendor,waiting_at,waiting_at,false),
  (foreign_cid,token||'-foreign@c.us',token,token||'-foreign',other_ct,other_vendor,waiting_at,waiting_at,false);
 insert into public.crm_chat_conversations(wa_chat_id,phone,name,vendor_id,last_message_at,last_inbound_at,last_from_me)
 select token||'-page-'||g||'@c.us',token,token||'-page-'||g,vendor,now()-interval '3 hours'+(g/2)*interval '1 second',now()-interval '3 hours',false
  from generate_series(1,101)g;
 -- Legacy seed: confirmed inbound preview exists, but its original backfill
 -- intentionally left last_inbound_at null to avoid creating unread old chats.
 insert into public.crm_chat_conversations(wa_chat_id,phone,name,vendor_id,last_message_at,last_from_me,last_preview)
 select token||'-seed-'||g||'@c.us',token,token||'-seed-'||g,vendor,now()-interval '4 hours',false,'[chat]'
  from generate_series(1,45)g;
 -- A new conversation without any confirmed message has no preview or inbound stamp.
 insert into public.crm_chat_conversations(wa_chat_id,phone,name,vendor_id)
 select token||'-empty-'||g||'@c.us',token,token||'-empty-'||g,vendor from generate_series(1,16)g;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
 values('ANA',token||'@c.us',source_id,false,'chat','Pergunta para citar',waiting_at),
  ('ANA',token||'-foreign@c.us',foreign_msg,false,'chat','Pergunta secreta',waiting_at);
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
 select 'ANA',token||'@c.us',token||'-search-'||g,false,'chat','Busca ÚNICA palavra',waiting_at-interval '1 day'+g*interval '1 second' from generate_series(1,55)g;
 -- Exact persisted contact relationship; a same-name unrelated quote is excluded.
 insert into public.orcamentos_files(ano,numero,cliente,status_kanban,path_principal,contact_id,vendor_id)
 values(2099,token,token,'NEGOCIANDO',token||'.pdf',ct,vendor) returning id into quote_id;
 insert into public.orcamentos_files(ano,numero,cliente,status_kanban,path_principal,contact_id,vendor_id)
 values(2099,token||'-foreign',token,'NEGOCIANDO',token||'-foreign.pdf',other_ct,other_vendor);
 insert into public.mirror_pedidos_venda(id,numero_orcamento,pedido_numero,cliente,vendedor,status,valor_total,data_venda,raw)
 values(order_id,token,token,token,upper(vendor_name),'ABERTO',123,now()::date,'{}');
 select count(*) into queues_before from public.wa_scheduled_messages;
 execute 'set local role anon';
 denied:=false;
 begin perform public.crm_chat('summary','{}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon summary allowed'; end if;
 denied:=false;
 begin perform 1 from public.crm_chat_quick_replies; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon templates allowed'; end if;
 execute 'reset role';
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 first_page:=public.crm_chat('list',jsonb_build_object('search',token,'queue','waiting','status','open'));
 if jsonb_array_length(first_page->'items')<>100 then raise exception 'Waiting first page size'; end if;
 for row in select value from jsonb_array_elements(first_page->'items') loop
  actual_time:=(row->>'waiting_since')::timestamptz;actual_id:=(row->>'id')::uuid;
  if previous_time is not null and (actual_time,actual_id)<(previous_time,previous_id) then raise exception 'Waiting ordering not stable'; end if;
  previous_time:=actual_time;previous_id:=actual_id;
 end loop;
 row:=first_page->'items'->99;
 second_page:=public.crm_chat('list',jsonb_build_object('search',token,'queue','waiting','status','open','before',row->>'waiting_since','before_id',row->>'id'));
 if jsonb_array_length(second_page->'items')<>47 then raise exception 'Waiting cursor skipped/duplicated seeded rows'; end if;
 if exists(select 1 from jsonb_array_elements((first_page->'items')||(second_page->'items')) x where x.value->>'name' like token||'-empty-%') then raise exception 'Empty new conversations incorrectly wait'; end if;
 if (select count(*) from jsonb_array_elements((first_page->'items')||(second_page->'items')) x where x.value->>'name' like token||'-seed-%' and x.value->>'unread'='0' and x.value->>'waiting_since' is not null)<>45 then raise exception 'Confirmed seed waiting changed unread state'; end if;
 if exists(select 1 from jsonb_array_elements(second_page->'items') x join jsonb_array_elements(first_page->'items') y on x.value->>'id'=y.value->>'id') then raise exception 'Waiting pages overlap'; end if;
 execute 'reset role';
 update public.crm_chat_conversations set follow_up_at=now()-interval '1 hour' where name like token||'-page-%';
 execute 'set local role authenticated';
 first_page:=public.crm_chat('list',jsonb_build_object('search',token||'-page-','queue','overdue'));
 if jsonb_array_length(first_page->'items')<>100 then raise exception 'Overdue first page size'; end if;
 row:=first_page->'items'->99;
 second_page:=public.crm_chat('list',jsonb_build_object('search',token||'-page-','queue','overdue','before',row->>'follow_up_at','before_id',row->>'id'));
 if jsonb_array_length(second_page->'items')<>1 then raise exception 'Overdue timestamp tie cursor mismatch'; end if;
 if exists(select 1 from jsonb_array_elements(second_page->'items') x join jsonb_array_elements(first_page->'items') y on x.value->>'id'=y.value->>'id') then raise exception 'Overdue pages overlap'; end if;
 execute 'reset role';
 update public.crm_chat_conversations set follow_up_at=null where name like token||'-page-%';
 execute 'set local role authenticated';
 perform public.crm_chat('read',jsonb_build_object('id',cid));
 result:=public.crm_chat('list',jsonb_build_object('search',token||'-one','queue','waiting'));
 if jsonb_array_length(result->'items')<>1 or result->'items'->0->>'unread'<>'0' or result->'items'->0->>'waiting_since' is null then raise exception 'Reading erased pending response'; end if;
 result:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if result->'conversation'->>'vendor_name' is distinct from vendor_name or result->'conversation'->>'lock_user_name' is not null then raise exception 'Detail owner/inactive lease names'; end if;
 perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
 result:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if result->'conversation'->>'lock_user_name' is distinct from (select display_name from public.user_profiles where id=subject) then raise exception 'Active lease name missing'; end if;
 result:=public.crm_chat('messages',jsonb_build_object('id',cid,'search','única'));
 if jsonb_array_length(result)<>50 then raise exception 'Search page size'; end if;
 row:=result->0;
 result:=public.crm_chat('messages',jsonb_build_object('id',cid,'search','única','before',row->>'data_msg','before_id',row->>'id'));
 if jsonb_array_length(result)<>5 then raise exception 'Search cursor omitted older results'; end if;
 denied:=false;
 begin perform public.crm_chat('messages',jsonb_build_object('id',foreign_cid,'search','secreta')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign history search allowed'; end if;
 -- Retorno edits neither pause IA nor queue any messages; one slot replaces the prior date.
 perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at',now()-interval '1 minute'));
 perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at',now()-interval '2 minutes'));
 result:=public.crm_chat('list',jsonb_build_object('search',token,'queue','overdue'));
 if jsonb_array_length(result->'items')<>1 or result->'items'->0->>'id'<>cid::text then raise exception 'Overdue queue mismatch'; end if;
 perform public.crm_chat('followup_done',jsonb_build_object('id',cid));
 result:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if result->'conversation'->>'follow_up_at' is not null then raise exception 'Done followup not cleared'; end if;
 perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at',now()+interval '1 day'));
 perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at',null));
 denied:=false;
 begin perform public.crm_chat('followup',jsonb_build_object('id',foreign_cid,'due_at',now())); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign followup allowed'; end if;
 denied:=false;
 begin perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at','infinity')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Infinite followup allowed'; end if;
 denied:=false;
 begin perform public.crm_chat('quick_reply_save',jsonb_build_object('title','Not allowed','body','Not allowed')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Vendor edited team templates'; end if;
 result:=public.crm_chat('sales',jsonb_build_object('id',cid));
 if not public.papel_restrito() then
  if jsonb_array_length(result->'quotes')<>1 or result->'quotes'->0->>'id'<>quote_id::text then raise exception 'Exact contact sales links mismatch'; end if;
  if public.ve_todos_pedidos() or upper(vendor_name)=public.vendedor_do_usuario() then
   if jsonb_array_length(result->'orders')<>1 or result->'orders'->0->>'id'<>order_id then raise exception 'Exact quote to order link mismatch'; end if;
  else
   if jsonb_array_length(result->'orders')<>0 then raise exception 'Quote access bypassed seller order policy'; end if;
  end if;
  if exists(select 1 from jsonb_array_elements((result->'quotes')||(result->'orders')) x where x.value->>'href' is not null) then raise exception 'Vendor received blocked legacy route links'; end if;
 end if;
 execute 'reset role';
 insert into public.orcamentos_files(ano,numero,cliente,status_kanban,path_principal,contact_id,vendor_id)
  values(2098,token,token,'NEGOCIANDO',token||'-ambiguous.pdf',other_ct,other_vendor);
 execute 'set local role authenticated';
 result:=public.crm_chat('sales',jsonb_build_object('id',cid));
 if jsonb_array_length(result->'orders')<>0 then raise exception 'Ambiguous quote number inferred wrong contact order'; end if;
 denied:=false;
 begin perform public.crm_chat('sales',jsonb_build_object('id',foreign_cid)); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Foreign sales allowed'; end if;
 execute 'reset role';
 if (select count(*) from public.wa_scheduled_messages)<>queues_before then raise exception 'Non-send action queued WhatsApp messages'; end if;
 execute 'set local role authenticated';
 -- Citation must belong to the selected ANA conversation.
 denied:=false;
 begin
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',gen_random_uuid(),'body','Reply','reply_msg_id',foreign_msg));
 exception when no_data_found then
  get stacked diagnostics failure_detail=pg_exception_detail;
  denied:=failure_detail='crm_chat_quote_rejected';
 end;
 if not denied then raise exception 'Foreign citation accepted'; end if;
 perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',request,'body','Resposta','reply_msg_id',source_id));
 perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',request,'body','Resposta','reply_msg_id',source_id));
 denied:=false;
 begin perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',request,'body','Resposta')); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Retry changed quotation'; end if;
 result:=public.crm_chat('detail',jsonb_build_object('id',cid));
 row:=result->'outbox'->0;
 if row->>'reply_msg_id'<>source_id or row->>'reply_preview'<>'Pergunta para citar' or row->>'reply_sender_name'<>token||'-one' then raise exception 'Citation snapshot lost'; end if;
 execute 'reset role';
 select id into queue_id from public.wa_scheduled_messages where crm_request_id=request and reply_msg_id=source_id and reply_from_me=false;
 if queue_id is null or (select count(*) from public.wa_scheduled_messages where crm_request_id=request)<>1 then raise exception 'Citation queue or idempotency mismatch'; end if;
 -- Snapshot protects race: history sync happens before the ACK and ends waiting.
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
 values('ANA',token||'@c.us',reply_id,true,'chat','Resposta',waiting_at+interval '60 seconds');
 update public.wa_scheduled_messages set status='sent',sent_at=waiting_at+interval '60 seconds',wa_msg_id='true_'||token||'@c.us_'||reply_id where id=queue_id;
 update public.wa_scheduled_messages set status='sent',sent_at=waiting_at+interval '60 seconds',wa_msg_id='true_'||token||'@c.us_'||reply_id where id=queue_id;
 if (select count(*) from private.crm_chat_response_events where request_id=request and vendor_id=vendor and response_seconds=60)<>1 then raise exception 'Response metric race or dedup failed'; end if;
 execute 'set local role authenticated';
 result:=public.crm_chat('messages',jsonb_build_object('id',cid));
 select value into row from jsonb_array_elements(result) where value->>'msg_id'=reply_id;
 if row->>'reply_msg_id'<>source_id or row->>'reply_preview'<>'Pergunta para citar' then raise exception 'Confirmed bubble citation missing'; end if;
 result:=public.crm_chat('summary','{}');
 if (result->>'response_samples')::int<>1 or (result->>'average_response_seconds')::numeric<>60 or result->>'metrics_since' is null then raise exception 'Summary measured sample mismatch'; end if;
 -- No waiting snapshot, failure, or absent WPP ID must never produce a metric.
 request2:=gen_random_uuid();
 perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',request2,'body','Already answered'));
 execute 'reset role';
 update public.wa_scheduled_messages set status='failed',sent_at=now(),wa_msg_id='FAILHASH' where crm_request_id=request2;
 if (select count(*) from private.crm_chat_response_events)<>1 then raise exception 'Failed send measured response'; end if;
 update public.wa_scheduled_messages set status='sent',sent_at=now(),wa_msg_id=null where crm_request_id=request2;
 if (select count(*) from private.crm_chat_response_events)<>1 then raise exception 'Unconfirmed send measured response'; end if;
 update public.wa_scheduled_messages set wa_msg_id='NOWAITHASH' where crm_request_id=request2;
 if (select count(*) from private.crm_chat_response_events)<>1 then raise exception 'Already answered conversation measured response'; end if;
 -- A different confirmed answer before our ACK disqualifies a first-response sample.
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
  values('ANA',token||'@c.us',token||'-new-question',false,'chat','Question',now()-interval '20 seconds');
 execute 'set local role authenticated';
 request2:=gen_random_uuid();
 perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',request2,'body','Late reply'));
 execute 'reset role';
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
  values('ANA',token||'@c.us','EXTERNAL'||replace(gen_random_uuid()::text,'-',''),true,'chat','Other answer',now()-interval '10 seconds');
 update public.wa_scheduled_messages set status='sent',sent_at=now(),wa_msg_id='LATE'||replace(gen_random_uuid()::text,'-','') where crm_request_id=request2;
 if (select count(*) from private.crm_chat_response_events)<>1 then raise exception 'Prior confirmed response ignored'; end if;
 -- Legacy seed also snapshots confirmed waiting without modifying unread stamps.
 select id into queue_id from public.crm_chat_conversations where name=token||'-seed-1';
 execute 'set local role authenticated';
 perform public.crm_chat('claim',jsonb_build_object('id',queue_id,'session',sess));
 request2:=gen_random_uuid();
 perform public.crm_chat('send',jsonb_build_object('id',queue_id,'session',sess,'request',request2,'body','Legacy answer'));
 execute 'reset role';
 if (select waiting_since_at_send from public.crm_chat_outbox where id=request2) is null then raise exception 'Legacy confirmed waiting not snapshotted'; end if;
 update public.wa_scheduled_messages set status='cancelled' where crm_request_id=request2;
 execute 'set local role authenticated';
 -- Resolve records a real event time; old resolved rows are not invented.
 perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess));
 result:=public.crm_chat('summary','{}');
 if (result->>'resolved_today')::int<1 then raise exception 'New resolution not counted'; end if;
 perform public.crm_chat('reopen',jsonb_build_object('id',cid,'session',sess));
 execute 'reset role';
 select count(*) into expected from public.crm_chat_conversations where vendor_id=vendor and status='open' and last_from_me=false and (last_inbound_at is not null or last_preview is not null);
 execute 'set local role authenticated';
 result:=public.crm_chat('summary',jsonb_build_object('vendor',other_vendor));
 if (result->>'waiting')::int<>0 or (result->>'response_samples')::int<>0 then raise exception 'Summary leaked foreign portfolio'; end if;
 result:=public.crm_chat('summary','{}');
 if (result->>'waiting')::bigint<>expected then raise exception 'Summary only counts loaded pages'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 result:=public.crm_chat('quick_reply_save',jsonb_build_object('title',token,'body','Equipe'));
 reply_uuid:=(result->>'id')::uuid;
 perform public.crm_chat('quick_reply_save',jsonb_build_object('reply_id',reply_uuid,'title',token,'body','Equipe atualizada'));
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 result:=public.crm_chat('quick_replies','{}');
 if not exists(select 1 from jsonb_array_elements(result) r where r.value->>'id'=reply_uuid::text and r.value->>'body'='Equipe atualizada') then raise exception 'Vendor cannot read shared reply'; end if;
 denied:=false;
 begin perform 1 from private.crm_chat_response_events; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Direct private metric read allowed'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 perform public.crm_chat('quick_reply_delete',jsonb_build_object('reply_id',reply_uuid));
 perform public.crm_chat('assign',jsonb_build_object('id',cid,'vendor',other_vendor));
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 result:=public.crm_chat('summary','{}');
 if (result->>'response_samples')::int<>1 then raise exception 'Transfer rewrote sender metric portfolio'; end if;
 denied:=false;
 begin perform public.crm_chat('followup',jsonb_build_object('id',cid,'due_at',now())); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Old portfolio retained followup access'; end if;
 execute 'reset role';
end;
$test$;
select 'PASS: waiting/read/cursors, leases, scoped history/search/quote, internal followup, templates, sales, summary and confirmed response metrics' result;
rollback;
