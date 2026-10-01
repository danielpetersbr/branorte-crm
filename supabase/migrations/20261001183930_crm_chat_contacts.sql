create or replace function private.crm_chat(p_action text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.user_profiles; c public.crm_chat_conversations; result jsonb; cid uuid;
  ct public.contacts; phone text; session_id uuid; rid uuid; sid uuid; body text; media_path text; media_url text; mime text; kind text; target uuid; tag text;
begin
  p:=private.crm_chat_profile();
  if p_action='list' then
    select coalesce(jsonb_agg(t.row order by t.last_message_at desc,t.id desc),'[]'::jsonb) into result from (
      select jsonb_build_object('id',c.id,'wa_chat_id',c.wa_chat_id,'phone',c.phone,'name',c.name,'contact_id',c.contact_id,
        'vendor_id',c.vendor_id,'vendor_name',v.name,'status',c.status,'tags',c.tags,'human_hold',c.human_hold,
        'last_message_at',c.last_message_at,'last_preview',c.last_preview,'last_from_me',c.last_from_me,
        'unread',case when c.last_inbound_at>coalesce(r.read_at,'epoch') then 1 else 0 end,
        'lock_user_id',c.lock_user_id,'lock_session_id',c.lock_session_id,'lock_until',c.lock_until) as row,c.last_message_at,c.id
      from public.crm_chat_conversations c left join public.vendors v on v.id=c.vendor_id
      left join public.crm_chat_reads r on r.conversation_id=c.id and r.user_id=p.id
      where (p.role='admin' or c.vendor_id=p.vendor_id)
        and (coalesce(p_args->>'search','')='' or c.name ilike '%'||(p_args->>'search')||'%' or c.phone ilike '%'||(p_args->>'search')||'%')
        and (coalesce(p_args->>'status','')='' or c.status=p_args->>'status')
        and (coalesce(p_args->>'tag','')='' or p_args->>'tag'=any(c.tags))
        and (coalesce(p_args->>'vendor','')='' or (p_args->>'vendor'='unassigned' and c.vendor_id is null) or c.vendor_id::text=p_args->>'vendor')
        and (coalesce(p_args->>'before','')='' or (c.last_message_at,c.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::uuid))
      order by c.last_message_at desc,c.id desc limit 100
    ) t;
    return jsonb_build_object('items',result,'tags',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from public.crm_chat_tags),
      'connection',(select jsonb_build_object('last_sync',recebido_em,'version',client_version,'number_final',right(split_part(wa_self_wid,'@',1),4)) from public.wa_sync_debug where vendedor_nome='ANA' order by recebido_em desc limit 1));
  elsif p_action='contacts' then
    select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
      select ct.id,ct.name,ct.phone,ct.vendor_id from public.contacts ct where (p.role='admin' or ct.vendor_id=p.vendor_id)
      and (coalesce(p_args->>'search','')='' or ct.name ilike '%'||(p_args->>'search')||'%' or ct.phone ilike '%'||(p_args->>'search')||'%')
      order by ct.updated_at desc,ct.id limit 30
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
    select coalesce(jsonb_agg(to_jsonb(t) order by t.data_msg,t.id),'[]'::jsonb) into result from (
      select m.id,m.msg_id,m.from_me,m.tipo,m.body,m.media_url,m.data_msg,m.transcricao,m.duracao_seg
      from public.wa_chat_messages m where m.vendedor_nome='ANA' and m.chat_id=c.wa_chat_id
        and (coalesce(p_args->>'before','')='' or (m.data_msg,m.id)<((p_args->>'before')::timestamptz,(p_args->>'before_id')::bigint))
      order by m.data_msg desc,m.id desc limit 50
    ) t;
    return result;
  elsif p_action='detail' then
    return jsonb_build_object('conversation',to_jsonb(c),'contact',(select jsonb_build_object('city',city,'state',state,'empresa',empresa,'email',email,'status',status) from public.contacts where id=c.contact_id),
      'notes',(select coalesce(jsonb_agg(t.row order by t.created_at desc),'[]'::jsonb) from (select jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author_name',u.display_name) row,n.created_at from public.crm_chat_notes n left join public.user_profiles u on u.id=n.author_id where n.conversation_id=cid order by n.created_at desc limit 50)t),
      'outbox',(select coalesce(jsonb_agg(t.row order by t.created_at),'[]'::jsonb) from (select to_jsonb(o)||jsonb_build_object('status',q.status,'error',q.error,'sent_at',q.sent_at,'sender_name',u.display_name) row,o.created_at from public.crm_chat_outbox o join public.wa_scheduled_messages q on q.id=o.scheduled_id left join public.user_profiles u on u.id=o.sender_id where o.conversation_id=cid order by o.created_at desc limit 20)t));
  elsif p_action='read' then
    insert into public.crm_chat_reads(conversation_id,user_id,read_at) values(cid,p.id,now()) on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
    return jsonb_build_object('ok',true);
  end if;
  -- Toda mutação revalida após obter a trava: atribuição pode mudar durante uma requisição.
  select * into c from public.crm_chat_conversations where id=cid for update;
  if p.role<>'admin' and c.vendor_id is distinct from p.vendor_id then raise exception 'Conversa transferida para outra carteira.' using errcode='42501'; end if;
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
    if exists(select 1 from public.crm_chat_outbox where id=rid and conversation_id=cid and sender_id=p.id) then return jsonb_build_object('ok',true,'id',rid); end if;
    if c.status<>'open' or c.lock_until is null or c.lock_until<=now() or c.lock_user_id is distinct from p.id or c.lock_session_id is distinct from session_id then raise exception 'Assuma a conversa antes de enviar.' using errcode='42501'; end if;
    body:=btrim(coalesce(p_args->>'body','')); media_path:=nullif(p_args->>'media_path',''); media_url:=nullif(p_args->>'media_url',''); mime:=split_part(coalesce(p_args->>'mime',''),';',1); kind:='chat';
    if length(body)>4000 then raise exception 'Mensagem deve ter no máximo 4000 caracteres.'; end if;
    if media_path is not null then
      if split_part(media_path,'/',1)<>cid::text or media_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.[a-z0-9]+$' or not exists(select 1 from storage.objects where bucket_id='crm-chat-media' and name=media_path and owner_id=p.id::text) then raise exception 'Anexo não pertence a este atendimento.' using errcode='42501'; end if;
      if mime in ('image/jpeg','image/png','image/webp') then kind:='image'; elsif mime in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav') then kind:='audio'; elsif mime in ('video/mp4','video/webm') then kind:='video'; elsif mime='application/pdf' then kind:='document'; else raise exception 'Formato de anexo não permitido.'; end if;
      if media_url is null or split_part(media_url,'?',1)<>'https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/sign/crm-chat-media/'||media_path then raise exception 'URL do anexo inválida.'; end if;
    else
      media_url:=null;
      if body='' then raise exception 'Digite uma mensagem ou escolha um anexo.'; end if;
    end if;
    sid:=gen_random_uuid();
    insert into public.wa_scheduled_messages(id,vendedor_nome,chat_id,contato_nome,contato_numero,body,scheduled_at,status,to_self,urgente,crm_request_id,media_url,media_type,media_filename)
      values(sid,'ANA',c.wa_chat_id,c.name,c.phone,body,now(),'pending',false,true,rid,media_url,case when media_path is not null then kind end,left(coalesce(p_args->>'filename','arquivo'),200));
    insert into public.crm_chat_outbox(id,conversation_id,scheduled_id,sender_id,body,tipo,media_path) values(rid,cid,sid,p.id,body,kind,media_path);
    update public.crm_chat_conversations set lock_until=now()+interval '90 seconds',updated_at=now() where id=cid;
    return jsonb_build_object('ok',true,'id',rid);
  else raise exception 'Ação desconhecida.';
  end if;
  return jsonb_build_object('ok',true);
end $$;

create function private.crm_chat_can_wa(p_chat text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.crm_chat_conversations c where c.wa_chat_id=p_chat and private.crm_chat_can(c.id));
$$;
revoke all on function private.crm_chat_can_wa(text) from public,anon;
grant execute on function private.crm_chat_can_wa(text) to authenticated;
