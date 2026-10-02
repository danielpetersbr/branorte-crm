-- Only a validated conversation grants access to its acquisition evidence.
-- First-message creative and most recent recorded ad click are separate facts.
set local lock_timeout='500ms';
create index if not exists crm_chat_ad_phone_idx on public.anuncio_clique
  (public.fone_canon(telefone_norm),recebido_em desc,id desc)
  where length(telefone_norm)>=10;
create index if not exists crm_chat_ad_ana_chat_idx on public.anuncio_clique
  ((payload->>'chat_id'),recebido_em desc,id desc)
  where coalesce(nullif(payload->>'vendedor',''),'ANA')='ANA';

create function private.crm_chat_origin(p_conversation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  p public.user_profiles; c public.crm_chat_conversations;
  first_body text; first_at timestamptz; lead_at timestamptz; code text; code_source text; origin text; digits text; canon text;
  phones text[]:='{}'; lead_code text; lead_creative jsonb;
  ad jsonb; creative jsonb; ad_code text;
begin
  p:=private.crm_chat_profile();
  select * into c from public.crm_chat_conversations where id=p_conversation_id;
  if c.id is null or (p.role<>'admin' and c.vendor_id is distinct from p.vendor_id) then
    raise exception 'Conversa não disponível para sua carteira.' using errcode='42501';
  end if;

  -- Read the beginning on the server, independently of the current history page.
  select m.body,m.data_msg into first_body,first_at from public.wa_chat_messages m
    where m.vendedor_nome='ANA' and m.chat_id=c.wa_chat_id and not m.from_me
    order by m.data_msg,m.id limit 1;
  code:=(regexp_match(first_body,'(?:^|[[:space:]])(&[0-9]{1,4}(?:[[:space:]]+(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MTS|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO))?)[[:space:].!?]*$','i'))[1];
  if code is not null then code_source:='message'; end if;

  -- Equality variants use the existing audit phone index; never truncate LIDs or foreign IDs.
  digits:=regexp_replace(c.phone,'[^0-9]','','g');
  if (c.phone not like '+%' or c.phone like '+55%') and digits ~ '^(55[1-9][0-9]{9,10}|[1-9][0-9]{9,10})$' then
    if length(digits) in(10,11) then digits:='55'||digits; end if;
    phones:=array[digits];
    if length(digits)=12 then phones:=array_append(phones,substr(digits,1,4)||'9'||substr(digits,5));
    elsif length(digits)=13 and substr(digits,5,1)='9' then phones:=array_append(phones,substr(digits,1,4)||substr(digits,6)); end if;
    canon:=public.fone_canon(digits);
    select nullif(btrim(a.origem),'') into origin
      from auditoria.auditoria_atendimentos a
      where a.telefone_norm<>'' and a.telefone_norm=any(phones)
        and nullif(btrim(a.origem),'') is not null and lower(btrim(a.origem)) not in('não identificou','nao identificou')
      order by a.data,a.id limit 1;
    select nullif(btrim(a.criativo_codigo),''),a.criativo_facebook,a.data into lead_code,lead_creative,lead_at
      from auditoria.auditoria_atendimentos a
      where a.telefone_norm<>'' and a.telefone_norm=any(phones)
        and btrim(a.criativo_codigo) ~* '^&?[0-9]{1,4}([[:space:]]+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MTS|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO))?$|^#LP[A-Z0-9_-]{1,40}$'
      order by a.data,a.id limit 1;
  end if;
  if origin is null then select nullif(btrim(ct.origin),'') into origin from public.contacts ct where ct.id=c.contact_id; end if;
  if lower(btrim(origin)) in('não identificou','nao identificou') then origin:=null; end if;
  if lead_code is not null then
    lead_code:=upper(regexp_replace(btrim(lead_code),'[[:space:]]+',' ','g'));
    if lead_code ~ '^[0-9]+$' then lead_code:='&'||lead_code; end if;
    lead_code:=regexp_replace(lead_code,' MTS$',' MS');
    if lead_code !~ '^&[0-9]{1,4}( (AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO))?$' and lead_code !~ '^#LP[A-Z0-9_-]{1,40}$' then lead_code:=null; end if;
  end if;
  -- The archived WhatsApp history can begin after an already recorded acquisition.
  if lead_code is not null and (code is null or lead_at<first_at) then code:=lead_code;code_source:='lead'; end if;

  -- An ad ID / title / URL is evidence; temporal proximity or a shared code is not.
  select jsonb_build_object('id',hit.ad_id,'name',coalesce(nullif(btrim(map.anuncio),''),nullif(btrim(mapping.nome_anuncio),'')),
      'title',nullif(btrim(hit.titulo),''),'campaign',nullif(btrim(map.campanha),''),'adset',nullif(btrim(map.conjunto),''),
      'seen_at',hit.recebido_em,'url',nullif(btrim(hit.payload->>'url'),''),'platform',nullif(btrim(hit.payload->>'app'),'')),
      nullif(btrim(mapping.criativo_codigo),'')
    into ad,ad_code
    from (
      select a.* from public.anuncio_clique a
        where coalesce(nullif(a.payload->>'vendedor',''),'ANA')='ANA'
          and a.payload->>'chat_id'=c.wa_chat_id
      union all
      select a.* from public.anuncio_clique a
        where canon is not null and length(a.telefone_norm)>=10 and public.fone_canon(a.telefone_norm)=canon
          and a.telefone_norm ~ '^(55[1-9][0-9]{9,10}|[1-9][0-9]{9,10})$'
          and coalesce(nullif(a.payload->>'vendedor',''),'ANA')='ANA'
          and (nullif(a.payload->>'chat_id','') is null or a.payload->>'chat_id'=c.wa_chat_id)
    ) hit
    left join public.meta_anuncio_mapa map on map.ad_id=hit.ad_id
    left join public.meta_ad_criativo mapping on mapping.ad_id=hit.ad_id
    where nullif(btrim(hit.ad_id),'') is not null or nullif(btrim(hit.titulo),'') is not null or nullif(btrim(hit.payload->>'url'),'') is not null
    order by hit.recebido_em desc,hit.id desc limit 1;
  if code is null and ad_code is not null then code:=ad_code;code_source:='ad'; end if;

  if code is not null then
    code:=upper(regexp_replace(btrim(code),'[[:space:]]+',' ','g'));
    if code ~ '^[0-9]+$' then code:='&'||code; end if;
    code:=regexp_replace(code,' MTS$',' MS');
    if code !~ '^&[0-9]{1,4}( (AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO))?$' and code !~ '^#LP[A-Z0-9_-]{1,40}$' then code:=null;code_source:=null; end if;
    select jsonb_build_object('name',nullif(btrim(cr.nome_oficial),''),'headline',nullif(btrim(cr.headline),''),'url',nullif(btrim(cr.source_url),''))
      into creative from auditoria.criativos cr where cr.codigo=code;
    -- Preserve a recorded snapshot only if it identifies this exact creative.
    if creative is null and code_source='lead' and coalesce(lead_creative->>'codigo','') in(code,ltrim(code,'&')) then
      creative:=jsonb_build_object('name',nullif(btrim(lead_creative->>'nome_oficial'),''),'headline',nullif(btrim(lead_creative->>'headline'),''),'url',nullif(btrim(lead_creative->>'source_url'),''));
    end if;
  end if;
  return jsonb_build_object('origin',origin,'code',code,'code_source',code_source,'creative',creative,'ad',ad);
end $$;
revoke all on function private.crm_chat_origin(uuid) from public,anon;
grant execute on function private.crm_chat_origin(uuid) to authenticated;

create function public.crm_chat_origin(p_conversation_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.crm_chat_origin(p_conversation_id);
$$;
revoke all on function public.crm_chat_origin(uuid) from public,anon;
grant execute on function public.crm_chat_origin(uuid) to authenticated;
comment on function public.crm_chat_origin(uuid) is 'Acquisition evidence for one authorized ANA conversation. First entry creative is distinct from most recent recorded click; unavailable campaign names remain null.';
