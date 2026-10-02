-- Candidate + fixture regression only; wrap candidate before this script and ROLLBACK.
begin;
set local statement_timeout='15s';
do $test$
declare
 subject uuid; admin_id uuid; vendor uuid; other_vendor uuid; sess uuid:=gen_random_uuid(); other_sess uuid:=gen_random_uuid();
 cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid(); target uuid; qid uuid; oid uuid;
 token text:='closure-test-'||gen_random_uuid()::text; chat text; result jsonb; action_payload jsonb; stamp timestamptz;
 denied boolean; rows_changed integer; i integer; action_count bigint; before_actions bigint; t text; b text;
begin
 select p.id,p.vendor_id into subject,vendor from public.user_profiles p join public.vendors v on v.id=p.vendor_id
  where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
 select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
 select id into other_vendor from public.vendors where ativo and id<>vendor limit 1;
 if subject is null or admin_id is null or other_vendor is null then raise exception 'Approved roles required';end if;
 if private.crm_chat_genuine_inbound('chat','Compartilhe esta oração') or private.crm_chat_genuine_inbound('chat','Deus abençoe a todos')
  or private.crm_chat_genuine_inbound('chat','Olá, tudo bem?') then raise exception 'Devotional/greeting classification';end if;
 if not private.crm_chat_genuine_inbound('chat','Deus abençoe! Qual preço?') or not private.crm_chat_genuine_inbound('ptt','')
  or not private.crm_chat_genuine_inbound('image','') or not private.crm_chat_genuine_inbound('document','') then raise exception 'Question/commercial/media classification';end if;
 insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)
  values('ANA',990011,'RESOLVIDOS','RESOLVIDOS',0),('ANA',990012,'OUTROS ASSUNTOS','OUTROS ASSUNTOS',0),('ANA',990013,'PROSPECÇÃO','PROSPECCAO',0);
 insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id,last_message_at,last_inbound_at,last_from_me)
  values(cid,token||'@lid',token,token,vendor,now()-interval '1 hour',now()-interval '1 hour',false),
  (foreign_cid,token||'-foreign@lid',token||'-foreign',token||'-foreign',other_vendor,now()-interval '1 hour',now()-interval '1 hour',false);
 chat:=token||'@lid';
 insert into public.ia_atendimentos(chat_id,vendedor_nome,ativo) values(chat,'ANA',true);
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 result:=public.crm_chat('close_options',jsonb_build_object('id',cid));
 if not exists(select 1 from jsonb_array_elements(result->'reasons')r where r->>'id'='990011' and r->>'name'='RESOLVIDOS')
  or exists(select 1 from jsonb_array_elements(result->'reasons')r where r->>'id'='990013') then raise exception 'Only real terminal options';end if;
 denied:=false;begin perform public.crm_chat('close_options',jsonb_build_object('id',foreign_cid));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign closure options leak';end if;
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',foreign_cid,'reason_id','990011'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign conversation closed';end if;
 denied:=false;begin perform public.crm_chat('unblock_ana',jsonb_build_object('id',foreign_cid));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign conversation unblocked';end if;
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','990013'));exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Open-stage label accepted as closure';end if;
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','missing'));exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Unknown label accepted';end if;
 denied:=false;begin perform public.crm_ana_automation_gate(chat);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Vendor can execute privileged gate';end if;
 denied:=false;begin perform public.crm_ana_close_label_gate(chat,'{}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Vendor can execute privileged label gate';end if;
 perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',other_sess,'reason_id','990011'));exception when lock_not_available then denied:=true;end;
 if not denied then raise exception 'Other active session can close';end if;
 execute 'reset role';
 -- Automation sending and CRM pending are independently checked; no cancellation on a rejected close.
 update public.crm_chat_conversations set human_hold=false where id=cid;
 qid:=gen_random_uuid();
 insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,status,scheduled_at)
  values(qid,'ANA',chat,'synthetic fixture','sending',now());
 execute 'set local role authenticated';
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','990011'));exception when lock_not_available then denied:=true;end;
 if not denied then raise exception 'Sending ANA message not protected';end if;
 execute 'reset role';delete from public.wa_scheduled_messages where id=qid;
 qid:=gen_random_uuid();oid:=gen_random_uuid();
 insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,status,scheduled_at,crm_request_id)
  values(qid,'ANA',chat,'synthetic fixture','pending',now(),oid);
 insert into public.crm_chat_outbox(id,conversation_id,sender_id,body,tipo,scheduled_id) values(oid,cid,subject,'synthetic fixture','chat',qid);
 execute 'set local role authenticated';
 denied:=false;begin perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','990011'));exception when lock_not_available then denied:=true;end;
 if not denied then raise exception 'Pending CRM message not protected';end if;
 execute 'reset role';delete from public.crm_chat_outbox where id=oid;delete from public.wa_scheduled_messages where id=qid;
 -- Hold is now the closure pause; customer automation is cancelled, internal notifications remain.
 update public.crm_chat_conversations set human_hold=false where id=cid;
 insert into public.wa_scheduled_messages(vendedor_nome,chat_id,body,status,scheduled_at,to_self)
  values('ANA',chat,'synthetic pending','pending',now(),false),('ANA',chat,'synthetic internal','pending',now(),true);
 execute 'set local role authenticated';
 perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','990011'));
 result:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if result->'conversation'->>'resolution_reason'<>'RESOLVIDOS' or result->'conversation'->>'resolution_label_id'<>'990011'
  or result->'conversation'->>'ana_paused_at' is null or (result->'conversation'->>'human_hold')::boolean then raise exception 'Closure snapshot/pause/detail failed';end if;
 result:=public.crm_chat('list',jsonb_build_object('search',token,'status','resolved'));
 if result->'items'->0->>'resolution_label_id'<>'990011' or result->'items'->0->>'ana_paused_at' is null then raise exception 'List metadata missing';end if;
 perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id','990011'));
 execute 'reset role';
 select ana_paused_at into stamp from public.crm_chat_conversations where id=cid;
 if (select count(*) from public.funil_fluxo_acoes where chat_id=chat and payload ? 'crm_close')<>1 then raise exception 'Repeated close enqueued twice';end if;
 if not exists(select 1 from public.funil_fluxo_acoes where chat_id=chat and tipo='mover_etiqueta'and payload->>'origem'='crm_chat_resolve'and status='pendente')then raise exception 'Transport origin missing';end if;
 if exists(select 1 from public.wa_scheduled_messages where chat_id=chat and not to_self and status='pending')
  or not exists(select 1 from public.wa_scheduled_messages where chat_id=chat and to_self and status='pending')then raise exception 'Shutdown touched wrong queue';end if;
 if not exists(select 1 from public.ia_atendimentos where chat_id=chat and not ativo and estado='AI_PAUSED' and motivo_desligamento='crm_finalizado' and assumido_por is null)then raise exception 'IA shutdown incomplete';end if;
 result:=public.crm_ana_automation_gate(chat);if (result->>'allowed')::boolean then raise exception 'Closed gate allowed';end if;
 select payload->'crm_close' into action_payload from public.funil_fluxo_acoes where chat_id=chat and payload ? 'crm_close';
 result:=public.crm_ana_close_label_gate(chat,action_payload);if not (result->>'allowed')::boolean or result->>'label_name'<>'RESOLVIDOS' then raise exception 'Valid closure label denied';end if;
 result:=public.crm_ana_close_label_gate(token||'-foreign@lid',action_payload);if (result->>'allowed')::boolean then raise exception 'Cross-chat closure label accepted';end if;
 result:=public.crm_ana_close_label_gate(chat,action_payload||jsonb_build_object('label_id','990012'));if (result->>'allowed')::boolean then raise exception 'Altered closure label accepted';end if;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
  values('ANA',chat,token||'-null-text',null,'chat','Quero orçamento',stamp+interval '1 second'),
   ('ANA',chat,token||'-null-image',null,'image','',stamp+interval '1 second');
 if not exists(select 1 from public.crm_chat_conversations where id=cid and status='resolved'and ana_paused_at=stamp)then raise exception 'Unknown direction resumed';end if;
 -- A late producer cannot enqueue automation; CRM and to_self remain separate.
 qid:=gen_random_uuid();insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,status,scheduled_at)
  values(qid,'ANA',chat,'synthetic late','pending',now());
 if (select status from public.wa_scheduled_messages where id=qid)<>'cancelled'then raise exception 'Late automation survived pause';end if;
 update public.wa_scheduled_messages set status='pending'where id=qid;
 if public.crm_chat_queue_claim(qid) is not null then raise exception 'Paused queue claim allowed';end if;
 -- Insert real metadata only: no transport sends. Greetings/devotional/link/system events never reopen.
 for i in 1..7 loop
  t:=case i when 4 then 'sticker' when 5 then 'reaction' when 6 then 'ciphertext' else 'chat' end;
  b:=case i when 1 then 'Olá, tudo bem?' when 2 then 'Bom dia! Deus abençoe! Compartilhe esta oração' when 3 then 'https://example.test' else '' end;
  insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
   values('ANA',chat,token||'-irrelevant-'||i,false,t,b,stamp+interval '1 second');
  if not exists(select 1 from public.crm_chat_conversations where id=cid and status='resolved' and ana_paused_at=stamp and resolution_reason='RESOLVIDOS') then raise exception 'Irrelevant inbound reopened: %',i;end if;
 end loop;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
  values('ANA',chat,token||'-old',false,'chat','Quero orçamento de uma máquina',stamp-interval '1 second');
 update public.wa_chat_messages set body='Quero orçamento de uma máquina',data_msg=stamp+interval '3 seconds'where msg_id=token||'-old';
 if (select ana_paused_at from public.crm_chat_conversations where id=cid)is distinct from stamp then raise exception 'UPDATE/old event resumed';end if;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
  values('ANA',chat,token||'-genuine',false,'chat','Bom dia! Deus abençoe. Quero orçamento da máquina',stamp+interval '4 seconds');
 if not exists(select 1 from public.crm_chat_conversations where id=cid and status='open' and ana_paused_at is null and resolution_reason is null) then raise exception 'Genuine commercial inbound not resumed';end if;
 if not (public.crm_ana_automation_gate(chat)->>'allowed')::boolean then raise exception 'Resumed automation not eligible';end if;
 if (public.crm_ana_close_label_gate(chat,action_payload)->>'allowed')::boolean then raise exception 'Old close applied after inbound';end if;
 -- Sticky silence requires explicit unblock and then another genuine inbound; permanent blocks remain intact.
 execute 'set local role authenticated';perform public.crm_chat('resolve',jsonb_build_object('id',cid,'reason_id','990012','block_automation',true));execute 'reset role';
 select ana_paused_at into stamp from public.crm_chat_conversations where id=cid;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg) values('ANA',chat,token||'-blocked-inbound',false,'chat','Quero preço da máquina',stamp+interval '1 second');
 if not exists(select 1 from public.crm_chat_conversations where id=cid and status='resolved'and ana_blocked_at is not null and ana_paused_at=stamp)then raise exception 'Sticky resumed automatically';end if;
 execute 'set local role authenticated';perform public.crm_chat('unblock_ana',jsonb_build_object('id',cid));execute 'reset role';
 if not exists(select 1 from public.crm_chat_conversations where id=cid and ana_paused_at>stamp and ana_blocked_at is null)then raise exception 'Unblock did not establish new inbound boundary';end if;
 select ana_paused_at into stamp from public.crm_chat_conversations where id=cid;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg) values('ANA',chat,token||'-delayed-before-unblock',false,'chat','Quero orçamento',stamp-interval '1 microsecond');
 if (select ana_paused_at from public.crm_chat_conversations where id=cid)is distinct from stamp then raise exception 'Inbound before unblock resumed';end if;
 if (public.crm_ana_automation_gate(chat)->>'allowed')::boolean then raise exception 'Unblock resumed without new inbound';end if;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg) values('ANA',chat,token||'-audio',false,'ptt','',stamp+interval '2 seconds');
 if not (public.crm_ana_automation_gate(chat)->>'allowed')::boolean then raise exception 'Genuine audio not resumed';end if;
 execute 'set local role authenticated';perform public.crm_chat('resolve',jsonb_build_object('id',cid,'reason_id','990011'));execute 'reset role';
 select ana_paused_at into stamp from public.crm_chat_conversations where id=cid;
 update public.ia_atendimentos set bloqueado_em=now(),bloqueado_por='synthetic fixture'where chat_id=chat;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg) values('ANA',chat,token||'-legacy-block',false,'document','',stamp+interval '1 second');
 if (select ana_paused_at from public.crm_chat_conversations where id=cid)is distinct from stamp or (public.crm_ana_automation_gate(chat)->>'allowed')::boolean then raise exception 'Legacy permanent block removed';end if;
 update public.ia_atendimentos set bloqueado_em=null,bloqueado_por=null,estado='HUMAN_TAKEOVER'where chat_id=chat;
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg) values('ANA',chat,token||'-takeover',false,'image','',stamp+interval '2 seconds');
 if (select ana_paused_at from public.crm_chat_conversations where id=cid)is distinct from stamp then raise exception 'Takeover cleared by inbound';end if;
 -- Source payload cannot be forged/modified by authenticated/anonymous roles.
 execute 'set local role authenticated';
 denied:=false;begin insert into public.funil_fluxo_acoes(chat_id,vendedor_nome,tipo,payload)values(chat,'ANA','mover_etiqueta',jsonb_build_object('crm_close',action_payload));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged source action allowed';end if;
 denied:=false;begin update public.funil_fluxo_acoes set payload=payload||'{"crm_close":{}}'where chat_id=chat;get diagnostics rows_changed=row_count;denied:=rows_changed=0;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged source action update allowed';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{"role":"anon"}',true);execute 'set local role anon';
 denied:=false;begin perform public.crm_chat('close_options',jsonb_build_object('id',cid));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon options allowed';end if;
 denied:=false;begin perform public.crm_ana_automation_gate(chat);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon gate allowed';end if;
 denied:=false;begin insert into public.funil_fluxo_acoes(chat_id,vendedor_nome,tipo,payload)values(chat,'ANA','mover_etiqueta',jsonb_build_object('crm_close',action_payload));exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon command forged';end if;
 execute 'reset role';execute 'set local role service_role';
 if not (public.crm_ana_close_label_gate(chat,(select payload->'crm_close'from public.funil_fluxo_acoes where chat_id=chat and status='pendente'order by id desc limit 1))->>'allowed')::boolean then raise exception 'Service label gate unavailable';end if;
 execute 'reset role';
 raise notice 'PASS: closure options/snapshot/auth, queues and service gates, genuinely new inbound, sticky/permanent silence, idempotence and stale label actions';
end $test$;
rollback;
