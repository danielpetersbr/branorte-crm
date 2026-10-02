-- Synthetic read-side fixtures only. No outbox, queue, claim or message send.
begin;
set local statement_timeout='15s';
do $$
declare cid uuid:=gen_random_uuid(); chat text:='origin-test-'||gen_random_uuid()::text; uid uuid; vendor_uid uuid; result jsonb; adid text:=('990000000000000000'::bigint+floor(random()*100000000000000)::bigint)::text;
begin
  select id into uid from public.user_profiles where role='admin' and approved_at is not null order by id limit 1;
  select p.id into vendor_uid from public.user_profiles p join public.vendors v on v.id=p.vendor_id and v.ativo where p.role='vendor' and p.approved_at is not null order by p.id limit 1;
  if uid is null or vendor_uid is null then raise exception 'Missing approved test profiles'; end if;
  perform set_config('test.origin_uid',uid::text,true);
  perform set_config('test.origin_vendor_uid',vendor_uid::text,true);
  perform set_config('test.origin_cid',cid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name) values(cid,chat,'5511991234321','Origin fixture');
  insert into public.wa_chat_messages(vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg) values
    ('ANA',chat,'5511991234321',chat||'-1',false,'chat','Tenho interesse &18','2026-10-02T08:00:00Z'),
    ('ANA',chat,'5511991234321',chat||'-2',false,'chat','Outra mensagem &90','2026-10-02T09:00:00Z');
  -- A newer click has a different creative; its exact ad metadata is independent.
  insert into public.meta_anuncio_mapa(ad_id,anuncio,campanha,conjunto) values(adid,'AD fixture','Campanha fixture','Conjunto fixture');
  insert into public.meta_ad_criativo(ad_id,criativo_codigo) values(adid,'&90');
  insert into public.anuncio_clique(ad_id,titulo,payload,recebido_em) values(adid,'Clique fixture',jsonb_build_object('vendedor','ANA','chat_id',chat,'url','https://fb.me/origin-fixture','app','facebook'),'2026-10-03T10:00:00Z');
  result:=public.crm_chat_origin(cid);
  if result->>'code'<>'&18' or result->>'code_source'<>'message' or result#>>'{creative,name}'<>'FÁBRICA DE RAÇÃO COMPACTA 04' then raise exception 'First code or exact creative mismatch: %',result; end if;
  if result#>>'{ad,id}'<>adid or result#>>'{ad,campaign}'<>'Campanha fixture' or result#>>'{ad,adset}'<>'Conjunto fixture' then raise exception 'Exact ad mapping mismatch: %',result; end if;
  -- Same phone plus an explicit OTHER chat must never override the correct click.
  insert into public.anuncio_clique(ad_id,telefone,payload,recebido_em) values('other-chat-fixture','5511991234321',jsonb_build_object('vendedor','ANA','chat_id',chat||'-other'),'2026-10-04T10:00:00Z');
  if public.crm_chat_origin(cid)#>>'{ad,id}'<>adid then raise exception 'Another chat leaked through phone match'; end if;
  -- A corrupt long phone cannot collide by its last ten digits.
  insert into public.anuncio_clique(ad_id,telefone,payload,recebido_em) values('bad-phone-fixture','123456789991191234321','{}','2026-10-05T10:00:00Z');
  if public.crm_chat_origin(cid)#>>'{ad,id}'<>adid then raise exception 'Corrupt phone leaked'; end if;
  -- An older acquisition survives a later beginning of the archived WA history.
  insert into auditoria.auditoria_atendimentos(data,conversation_id_disparachat,telefone,criativo_codigo,origem)
    values('2026-10-01T08:00:00Z',chat||'-lead','5511991234321','&8 RO','Meta ADS');
  result:=public.crm_chat_origin(cid);
  if result->>'code'<>'&8 RO' or result->>'code_source'<>'lead' or result->>'origin'<>'Meta ADS' or result#>>'{ad,id}'<>adid then raise exception 'Older acquisition or separate last click lost: %',result; end if;
  -- Invalid first-message code + invalid lead code cannot masquerade as a creative.
  update public.wa_chat_messages set body='Conheça &41101' where msg_id=chat||'-1';
  update auditoria.auditoria_atendimentos set criativo_codigo='&utm_source',origem='Não identificou' where conversation_id_disparachat=chat||'-lead';
  result:=public.crm_chat_origin(cid);
  if result->>'code'<>'&90' or result->>'code_source'<>'ad' or lower(result->>'origin') in('não identificou','nao identificou') then raise exception 'Invalid code or placeholder not discarded: %',result; end if;
  -- No ad evidence: do not guess campaign from &18 / another code.
  delete from public.anuncio_clique where payload->>'chat_id'=chat or ad_id in('other-chat-fixture','bad-phone-fixture');
  update public.wa_chat_messages set body='Tenho interesse &18' where msg_id=chat||'-1';
  result:=public.crm_chat_origin(cid);
  if result->>'code'<>'&18' or result->'ad'<>'null'::jsonb then raise exception 'Campaign inferred solely from creative: %',result; end if;
  -- A later code is not substituted when the first incoming message has no code.
  update public.wa_chat_messages set body='Bom dia' where msg_id=chat||'-1';
  result:=public.crm_chat_origin(cid);
  if result->>'code' is not null or result->'ad'<>'null'::jsonb then raise exception 'Later conversation code substituted for entry: %',result; end if;
  if has_function_privilege('anon','public.crm_chat_origin(uuid)','execute') or has_function_privilege('anon','private.crm_chat_origin(uuid)','execute') then raise exception 'Anonymous execute granted'; end if;
end $$;
set local role authenticated;
do $$
declare result jsonb;
begin
  -- Check the exposed wrapper with the actual authenticated database role.
  result:=public.crm_chat_origin(current_setting('test.origin_cid')::uuid);
  if result is null then raise exception 'Approved admin cannot use public wrapper'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.origin_vendor_uid'),'role','authenticated')::text,true);
  begin
    perform public.crm_chat_origin(current_setting('test.origin_cid')::uuid);
    raise exception 'Foreign portfolio allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin
    perform public.crm_chat_origin(current_setting('test.origin_cid')::uuid);
    raise exception 'Unapproved profile allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.crm_chat_origin(gen_random_uuid());
    raise exception 'Unknown conversation allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: exact creative/ad mapping, first stored message, historical acquisition, corrupt/foreign phone/chat isolation, invalid code, unknown campaign, authenticated wrapper, portfolio and unapproved/anon checks; all fixtures rolled back' as result;
rollback;
