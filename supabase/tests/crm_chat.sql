-- Executar em transação; nenhum teste envia mensagem nem altera a carteira real.
begin;
do $$
declare adm uuid; seller public.user_profiles; other public.user_profiles; cid uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); r jsonb; n int;
begin
  select id into adm from public.user_profiles where role='admin' and approved_at is not null limit 1;
  select * into seller from public.user_profiles where role='vendor' and vendor_id is not null and approved_at is not null limit 1;
  select * into other from public.user_profiles where role='vendor' and vendor_id is not null and vendor_id<>seller.vendor_id and approved_at is not null limit 1;
  if adm is null or seller.id is null or other.id is null then raise exception 'Perfis de teste indisponíveis'; end if;
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,vendor_id) values(cid,'crm-test-'||cid||'@c.us','test','TESTE ROLLBACK',seller.vendor_id);
  perform set_config('request.jwt.claim.sub',other.id::text,true);
  begin perform public.crm_chat('messages',jsonb_build_object('id',cid)); raise exception 'FAIL: leu carteira de outro vendedor'; exception when insufficient_privilege then null; end;
  begin perform public.crm_chat('assign',jsonb_build_object('id',cid,'vendor',other.vendor_id)); raise exception 'FAIL: transferiu carteira alheia'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',seller.id::text,true);
  r:=public.crm_chat('list','{}');
  if exists(select 1 from jsonb_array_elements(r->'items') t where t.value->>'vendor_id' is distinct from seller.vendor_id::text) then raise exception 'FAIL: lista revelou outra carteira'; end if;
  r:=public.crm_chat('contacts','{}');
  if exists(select 1 from jsonb_array_elements(r) t where t.value->>'vendor_id' is distinct from seller.vendor_id::text) then raise exception 'FAIL: busca de contatos revelou outra carteira'; end if;
  begin perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',req,'body','TESTE NAO ENVIAR')); raise exception 'FAIL: enviou sem lease'; exception when insufficient_privilege then null; end;
  perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',sess));
  begin perform public.crm_chat('claim',jsonb_build_object('id',cid,'session',gen_random_uuid())); raise exception 'FAIL: duas sessoes assumiram'; exception when lock_not_available then null; end;
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',req,'body','TESTE NAO ENVIAR'));
  perform public.crm_chat('send',jsonb_build_object('id',cid,'session',sess,'request',req,'body','TESTE NAO ENVIAR'));
  select count(*) into n from public.crm_chat_outbox where id=req;
  if n<>1 then raise exception 'FAIL: envio duplicado'; end if;
  -- Simular claim do worker: o segundo compare-and-set precisa atualizar zero linhas.
  r:=public.crm_chat_queue_claim((select id from public.wa_scheduled_messages where crm_request_id=req));
  if r is null then raise exception 'FAIL: worker nao assumiu envio manual'; end if;
  r:=public.crm_chat_queue_claim((select id from public.wa_scheduled_messages where crm_request_id=req));
  if r is not null then raise exception 'FAIL: worker duplicou claim'; end if;
  update public.wa_scheduled_messages set status='pending' where crm_request_id=req;
  if not exists(select 1 from public.wa_scheduled_messages where crm_request_id=req and status='failed') then raise exception 'FAIL: recovery reenviaria mensagem incerta'; end if;
  perform public.crm_chat('create_tag','{"name":"TESTE ROLLBACK"}');
  perform public.crm_chat('tags',jsonb_build_object('id',cid,'tags',jsonb_build_array('TESTE ROLLBACK')));
  perform public.crm_chat('note',jsonb_build_object('id',cid,'body','Nota interna teste'));
  perform public.crm_chat('resolve',jsonb_build_object('id',cid,'session',sess,'reason_id',
    (select etiqueta_id_wascript::text from public.wascript_etiquetas where vendedor_nome='ANA' and public.wa_status_da_etiqueta(etiqueta_nome)='FECHADO' order by etiqueta_id_wascript limit 1)));
  perform public.crm_chat('reopen',jsonb_build_object('id',cid,'session',sess));
  perform set_config('request.jwt.claim.sub',adm::text,true);
  perform public.crm_chat('assign',jsonb_build_object('id',cid,'vendor',other.vendor_id));
  perform set_config('request.jwt.claim.sub',seller.id::text,true);
  begin perform public.crm_chat('detail',jsonb_build_object('id',cid)); raise exception 'FAIL: ex-dono manteve acesso'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.crm_chat('list','{}'); raise exception 'FAIL: anonimo leu conversa'; exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: carteira, transferencia, lease, idempotencia, claim do worker, recovery, notas e etiquetas; tudo rollback' as resultado;
