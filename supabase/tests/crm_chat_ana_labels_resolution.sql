-- Candidate DDL and fixtures stay in a rollback transaction; no WhatsApp send.
begin;
set local statement_timeout='15s';
do $test$
declare
 subject uuid; admin_id uuid; vendor uuid; other_vendor uuid; cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid();
 fresh uuid:=gen_random_uuid(); waiting uuid:=gen_random_uuid(); locked uuid:=gen_random_uuid(); held uuid:=gen_random_uuid(); queued uuid:=gen_random_uuid();
 sess uuid:=gen_random_uuid(); token text:='ana-label-test-'||gen_random_uuid()::text; r jsonb; before_summary jsonb; after_summary jsonb;
 denied boolean; i integer; target uuid; qid uuid:=gen_random_uuid(); oid uuid:=gen_random_uuid(); old_observed timestamptz:=now()-interval '7 days';
begin
 select p.id,p.vendor_id into subject,vendor from public.user_profiles p join public.vendors v on v.id=p.vendor_id where p.role='vendor' and p.approved_at is not null and v.ativo order by p.id limit 1;
 select id into admin_id from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
 select id into other_vendor from public.vendors where ativo and id<>vendor limit 1;
 if subject is null or admin_id is null or other_vendor is null then raise exception 'Approved roles required'; end if;
 insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)
 values('ANA',990001,'RESOLVIDOS','RESOLVIDOS',0),('ANA',990002,'PENDÊNCIA','PENDENCIA',0),('ANA',990003,'OUTROS ASSUNTOS','OUTROS ASSUNTOS',0);
 insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id,last_message_at,last_inbound_at,last_from_me,tags)
 values(cid,token||'-old@lid',token||'-old',token||'-old',vendor,old_observed-interval '1 day',old_observed-interval '1 day',false,array['manual-preserved']),
 (foreign_cid,token||'-foreign@lid',token||'-foreign',token||'-foreign',other_vendor,old_observed,old_observed,false,'{}'),
 (fresh,token||'-fresh@lid',token||'-fresh',token||'-fresh',vendor,old_observed,old_observed,false,'{}'),
 (waiting,token||'-waiting@lid',token||'-waiting',token||'-waiting',vendor,old_observed,old_observed,false,'{}'),
 (locked,token||'-locked@lid',token||'-locked',token||'-locked',vendor,old_observed,old_observed,false,'{}'),
 (held,token||'-held@lid',token||'-held',token||'-held',vendor,old_observed,old_observed,false,'{}'),
 (queued,token||'-queued@lid',token||'-queued',token||'-queued',vendor,old_observed,old_observed,false,'{}');
 update public.crm_chat_conversations set human_hold=true where id=held;
 update public.crm_chat_conversations set lock_user_id=subject,lock_session_id=sess,lock_until=now()+interval '1 hour' where id=locked;
 insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,body,status,scheduled_at,crm_request_id)
 values(qid,'ANA',token||'-queued@lid','synthetic fixture','pending',now(),oid);
 insert into public.crm_chat_outbox(id,conversation_id,sender_id,body,tipo,scheduled_id)
 values(oid,queued,subject,'synthetic fixture','chat',qid);
 perform set_config('request.jwt.claim.sub',subject::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 before_summary:=public.crm_chat('summary','{}');
 insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids,label_changed_at,last_message_at,last_message_from_me)
 values('ANA',token||'-old',token||'-old@lid',array['990001'],old_observed,old_observed-interval '1 day',false),
 ('ANA',token||'-foreign',token||'-foreign@lid',array['990003'],old_observed,old_observed-interval '1 day',false);
 if not exists(select 1 from public.crm_chat_conversations where id=cid and status='resolved' and resolution_source='ana' and resolution_reason='RESOLVIDO' and resolution_observed_at=old_observed and resolved_at is null and tags=array['manual-preserved']) then raise exception 'Historical labels/closure not preserved accurately'; end if;
 after_summary:=public.crm_chat('summary','{}');
 if before_summary->>'resolved_today' is distinct from after_summary->>'resolved_today' then raise exception 'Historical backfill counted as today'; end if;
 execute 'set local role authenticated';
 r:=public.crm_chat('list',jsonb_build_object('search',token,'ana_tag','RESOLVIDOS','status','resolved'));
 if jsonb_array_length(r->'items')<>1 or r->'items'->0->'ana_tags'<>'["RESOLVIDOS"]'::jsonb then raise exception 'Scoped exact ANA filter/list'; end if;
 r:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if r->'conversation'->>'resolution_source'<>'ana' or r->'conversation'->>'resolution_reason'<>'RESOLVIDO' then raise exception 'Detail ANA provenance missing'; end if;
 denied:=false;begin perform public.crm_chat('detail',jsonb_build_object('id',foreign_cid));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign ANA detail allowed';end if;
 denied:=false;begin update public.wa_chat_labels set label_ids=array['990003']where chat_id=token||'-old@lid'; get diagnostics i=row_count; if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA labels update allowed';end if;
 denied:=false;begin insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids)values('ANA',token||'-forged',token||'-forged@lid',array['990001']);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA labels insert allowed';end if;
 denied:=false;begin update public.wascript_etiquetas set etiqueta_nome='RESOLVIDOS'where vendedor_nome='ANA'and etiqueta_id_wascript=990002;get diagnostics i=row_count; if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA catalog update allowed';end if;
 denied:=false;begin delete from public.wa_chat_labels where chat_id=token||'-old@lid';get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA labels delete allowed';end if;
 denied:=false;begin delete from public.wascript_etiquetas where vendedor_nome='ANA'and etiqueta_id_wascript=990002;get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA catalog delete allowed';end if;
 denied:=false;begin insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)values('ANA',990004,'RESOLVIDOS','RESOLVIDOS',0);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Forged ANA catalog insert allowed';end if;
perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
 perform public.crm_chat('release',jsonb_build_object('id',cid,'session',sess));
 r:=public.crm_chat('detail',jsonb_build_object('id',cid));
 if r->'conversation'->>'status'<>'open' or r->'conversation'->>'resolution_source' is not null then raise exception 'Claim did not override old resolution';end if;
 execute 'reset role';
 update public.wa_chat_labels set label_ids=array['990001','990002']where chat_id=token||'-old@lid';
 if (select status from public.crm_chat_conversations where id=cid)<>'open' then raise exception 'Neutral label overrode human claim';end if;
 -- Initial neutral observation establishes a baseline before a real terminal addition.
 insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids,label_changed_at)
 select 'ANA',phone,wa_chat_id,array['990002'],old_observed from public.crm_chat_conversations where id in(fresh,waiting,held,locked,queued);
 update public.wa_chat_labels set label_ids=array['990001','990002']where chat_id in(select wa_chat_id from public.crm_chat_conversations where id in(fresh,held,locked,queued));
 if not exists(select 1 from public.crm_chat_conversations where id=fresh and status='resolved'and resolution_source='ana'and resolved_at=now()) then raise exception 'Fresh terminal addition not detected';end if;
 if exists(select 1 from public.crm_chat_conversations where id in(held,locked,queued)and status<>'open')then raise exception 'Lease/human hold/pending send protection failed';end if;
 -- Idempotent same-set/avatars/heartbeat never changes observed resolution.
 update public.wa_chat_labels set foto_checked_at=now(),updated_at=now(),label_ids=label_ids where chat_id=token||'-fresh@lid';
 if (select resolved_at from public.crm_chat_conversations where id=fresh)<>now()then raise exception 'Idempotent resolution changed';end if;
 -- Historical, later-arriving inbound opens the chat without losing the WA label.
 insert into public.wa_chat_messages(vendedor_nome,chat_id,msg_id,from_me,tipo,body,data_msg)
 values('ANA',token||'-fresh@lid',token||'-inbound',false,'chat','synthetic inbound',now()+interval '1 second');
 update public.wa_chat_labels set label_ids=array['990001']where chat_id=token||'-fresh@lid';
 update public.wa_chat_labels set label_ids=array['990001','990002']where chat_id=token||'-fresh@lid';
 if not exists(select 1 from public.crm_chat_conversations where id=fresh and status='open'and resolution_source is null and resolution_reason is null and resolved_at is null)then raise exception 'Neutral labels reclosed newer inbound';end if;
-- Removing a terminal label is not an instruction to reopen.
 -- Catalog replacement cannot forget an existing terminal ID, even if a
 -- label snapshot arrives in the temporary DELETE/INSERT gap.
 delete from public.wascript_etiquetas where vendedor_nome='ANA'and etiqueta_id_wascript=990001;
 update public.wa_chat_labels set label_ids=array['990001']where chat_id=token||'-fresh@lid';
 if not exists(select 1 from public.crm_chat_conversations where id=fresh and ana_terminal_ids=array['990001']and status='open')then raise exception 'Catalog gap forgot terminal IDs';end if;
 insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)values('ANA',990001,'RESOLVIDOS','RESOLVIDOS',0);
 update public.wa_chat_labels set label_ids=array['990001','990002']where chat_id=token||'-fresh@lid';
 if (select status from public.crm_chat_conversations where id=fresh)<>'open'then raise exception 'Catalog reinsertion reclosed inbound';end if;
 update public.wa_chat_labels set label_ids=array['990001']where chat_id=token||'-waiting@lid';
 update public.wa_chat_labels set label_ids=array['990002']where chat_id=token||'-waiting@lid';
 if (select status from public.crm_chat_conversations where id=waiting)<>'resolved'then raise exception 'Label removal reopened conversation';end if;
 -- A catalog rename refreshes display only; does not finalize a chat again.
 update public.wascript_etiquetas set etiqueta_nome='PENDÊNCIA RENOMEADA',etiqueta_nome_normalizado='PENDENCIA RENOMEADA'where vendedor_nome='ANA'and etiqueta_id_wascript=990002;
 if not exists(select 1 from public.crm_chat_conversations where id=fresh and 'PENDÊNCIA RENOMEADA'=any(ana_tags)and status='open')then raise exception 'Catalog rename display/lifecycle';end if;
 execute 'set local role authenticated';
 perform public.crm_chat('reopen',jsonb_build_object('id',waiting));
 execute 'reset role';
 update public.wa_chat_labels set label_ids=array['990002','990001']where chat_id=token||'-waiting@lid';
 if (select status from public.crm_chat_conversations where id=waiting)<>'open'then raise exception 'Manual reopen overridden by stale snapshot';end if;
 if (select status from public.wa_scheduled_messages where id=qid)<>'pending'then raise exception 'ANA reconciliation altered pending queue';end if;
 -- The integration still writes ANA caches using the real service_role.
 execute 'set local role service_role';
 insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)values('ANA',990005,'TESTE NEUTRO','TESTE NEUTRO',0);
 insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids)values('ANA',token||'-service',token||'-service@lid',array['990005']);
 update public.wa_chat_labels set label_ids='{}'where chat_id=token||'-service@lid';
 delete from public.wa_chat_labels where chat_id=token||'-service@lid';
 delete from public.wascript_etiquetas where vendedor_nome='ANA'and etiqueta_id_wascript=990005;
 execute 'reset role';
 -- Other WhatsApp instances keep their existing approved access, unchanged.
 execute 'set local role authenticated';
 insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids)values('LABELTEST',token||'-other-source',token||'-other-source@lid','{}');
 update public.wa_chat_labels set label_ids=array['990002']where vendedor_nome='LABELTEST'and phone=token||'-other-source';
 delete from public.wa_chat_labels where vendedor_nome='LABELTEST'and phone=token||'-other-source';
 execute 'reset role';
execute 'set local role anon';
 denied:=false;begin insert into public.wa_chat_labels(vendedor_nome,phone,chat_id,label_ids)values('ANA',token||'-anon',token||'-anon@lid',array['990001']);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA label insert';end if;
 denied:=false;begin update public.wa_chat_labels set label_ids='{}'where chat_id=token||'-old@lid';get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA label update';end if;
 denied:=false;begin delete from public.wa_chat_labels where chat_id=token||'-old@lid';get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA label delete';end if;
 denied:=false;begin insert into public.wascript_etiquetas(vendedor_nome,etiqueta_id_wascript,etiqueta_nome,etiqueta_nome_normalizado,total_contatos)values('ANA',990006,'RESOLVIDOS','RESOLVIDOS',0);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA catalog insert';end if;
 denied:=false;begin update public.wascript_etiquetas set etiqueta_nome='RESOLVIDOS'where vendedor_nome='ANA'and etiqueta_id_wascript=990002;get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA catalog update';end if;
 denied:=false;begin delete from public.wascript_etiquetas where vendedor_nome='ANA'and etiqueta_id_wascript=990002;get diagnostics i=row_count;if i=0 then denied:=true;end if;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon ANA catalog delete';end if;
 denied:=false;begin perform public.crm_chat('list','{}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Anon CRM allowed';end if;
 execute 'reset role';
 if has_table_privilege('authenticated','public.wa_chat_labels','TRUNCATE')or has_table_privilege('anon','public.wascript_etiquetas','TRUNCATE')then raise exception 'Cache TRUNCATE privilege remains';end if;
end;
$test$;
select 'PASS: ANA labels, exact scoped filtering, historical/fresh closure, manual/inbound precedence, neutral changes, pending/lease guards, RLS and idempotency' result;
rollback;
