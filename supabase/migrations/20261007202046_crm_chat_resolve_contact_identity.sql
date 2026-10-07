-- Repair identity without changing conversation IDs, history, ownership, or status.
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('private.crm_chat_sync_message()'::regprocedure)) <> '0af7cf3daa0326e50ae52e99f0479973'
    OR md5(pg_get_functiondef('private.crm_chat_sync_label()'::regprocedure)) <> '2ca0ecb6231e243de81d4cacd59e5bac'
  THEN RAISE EXCEPTION 'Chat sync functions changed; review before applying identity repair'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION private.crm_chat_resolve_identity(p_chat_id text, p_phone text, p_name text DEFAULT NULL)
RETURNS TABLE(phone text, name text, contact_id uuid, vendor_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
declare
  label_row public.wa_chat_labels;
  ct public.contacts;
  candidate text;
  digits text;
  resolved_phone text := '';
  resolved_name text;
begin
  -- Only an exact chat mapping from Ana may identify her mirrored conversation.
  select l.* into label_row from public.wa_chat_labels l
  where l.vendedor_nome='ANA' and l.chat_id=p_chat_id
  order by l.updated_at desc,l.id limit 1;

  foreach candidate in array array[
    label_row.phone, p_phone,
    case when p_chat_id ~ '^[0-9]+@(c\.us|s\.whatsapp\.net)$'
      then split_part(p_chat_id,'@',1) end
  ] loop
    if candidate is null or btrim(candidate) !~ '^[+]?[0-9 ().-]+$' then continue; end if;
    digits := regexp_replace(candidate,'[^0-9]','','g');
    -- A LID may have the same length as a telephone. Never canonicalize it.
    if p_chat_id like '%@lid' and digits=split_part(p_chat_id,'@',1) then continue; end if;
    if digits ~ '^[1-9][0-9]{9,14}$' then resolved_phone:=digits; exit; end if;
  end loop;

  if resolved_phone<>'' then
    select c.* into ct from public.contacts c
    where c.phone=resolved_phone or c.phone='+'||resolved_phone
      or c.telefone_normalizado=resolved_phone
    order by (c.phone=resolved_phone) desc,c.updated_at desc,c.id limit 1;
    -- Canonical matching is only safe for Brazilian numbers and unique matches.
    if ct.id is null and resolved_phone ~ '^55[1-9][0-9]{9,10}$' then
      select c.* into ct from public.contacts c where c.id=(
        select case when count(*)=1 then min(match.id::text)::uuid end
        from public.contacts match
        where match.phone ~ '^[+]?55[1-9][0-9]{9,10}$'
          and public.fone_canon(match.phone)=public.fone_canon(resolved_phone)
          and public.fone_canon(match.phone) is not null
      );
    end if;
  end if;

  foreach candidate in array array[ct.name,label_row.contact_name,p_name] loop
    if nullif(btrim(candidate),'') is null
      or candidate=p_chat_id or candidate=split_part(p_chat_id,'@',1)
      or candidate ~ '@(lid|c\.us|s\.whatsapp\.net)$'
      or candidate ~ '^[+]?[0-9 ().-]+$'
      or candidate='Contato WhatsApp' then continue; end if;
    resolved_name:=btrim(candidate); exit;
  end loop;
  return query select resolved_phone,coalesce(resolved_name,nullif(resolved_phone,''),'Contato WhatsApp'),ct.id,ct.vendor_id;
end
$function$;
REVOKE ALL ON FUNCTION private.crm_chat_resolve_identity(text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.crm_chat_sync_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare identity_row record; cid uuid;
begin
  if new.from_me is null or new.vendedor_nome <> 'ANA' or new.chat_id like '%@g.us' or new.chat_id='status@broadcast' then return new; end if;
  select * into identity_row from private.crm_chat_resolve_identity(new.chat_id,new.phone);
  insert into public.crm_chat_conversations as existing(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_inbound_at,last_preview,last_from_me)
    values(new.chat_id,identity_row.phone,identity_row.name,identity_row.contact_id,identity_row.vendor_id,
      new.data_msg,case when not new.from_me then new.data_msg end,left(coalesce(nullif(new.body,''),'['||new.tipo||']'),200),new.from_me)
  on conflict(wa_chat_id) do update set
    phone=case when excluded.phone<>'' then excluded.phone
      when existing.wa_chat_id like '%@lid' and existing.phone in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1)) then ''
      else existing.phone end,
    name=case when nullif(btrim(existing.name),'') is null
      or existing.name in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1),existing.phone,'Contato WhatsApp')
      or existing.name ~ '^[+]?[0-9 ().-]+$' then excluded.name else existing.name end,
    contact_id=coalesce(existing.contact_id,excluded.contact_id),
    last_message_at=greatest(existing.last_message_at,excluded.last_message_at),
    last_inbound_at=case when not new.from_me then greatest(existing.last_inbound_at,new.data_msg) else existing.last_inbound_at end,
    last_preview=case when new.data_msg>=existing.last_message_at then excluded.last_preview else existing.last_preview end,
    last_from_me=case when new.data_msg>=existing.last_message_at then excluded.last_from_me else existing.last_from_me end,
    status=case when not new.from_me and new.data_msg>existing.last_message_at and private.crm_chat_inbound_may_reopen(existing,new.tipo,new.body,new.data_msg) then 'open' else existing.status end,
    resolution_source=case when not new.from_me and new.data_msg>existing.last_message_at and private.crm_chat_inbound_may_reopen(existing,new.tipo,new.body,new.data_msg) then null else existing.resolution_source end,
    resolution_reason=case when not new.from_me and new.data_msg>existing.last_message_at and private.crm_chat_inbound_may_reopen(existing,new.tipo,new.body,new.data_msg) then null else existing.resolution_reason end,
    resolution_observed_at=case when not new.from_me and new.data_msg>existing.last_message_at and private.crm_chat_inbound_may_reopen(existing,new.tipo,new.body,new.data_msg) then null else existing.resolution_observed_at end,
    updated_at=now() returning id into cid;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.crm_chat_sync_label()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare identity_row record;
begin
  if new.vendedor_nome<>'ANA' or new.chat_id like '%@g.us' or new.chat_id='status@broadcast' then return new; end if;
  select * into identity_row from private.crm_chat_resolve_identity(new.chat_id,new.phone,new.contact_name);
  insert into public.crm_chat_conversations as existing(wa_chat_id,phone,name,contact_id,vendor_id,last_message_at,last_inbound_at,last_preview,last_from_me)
  values(new.chat_id,identity_row.phone,identity_row.name,identity_row.contact_id,identity_row.vendor_id,
    coalesce(new.last_message_at,new.updated_at),case when new.last_message_from_me=false then new.last_message_at end,new.last_message_preview,coalesce(new.last_message_from_me,false))
  on conflict(wa_chat_id) do update set
    phone=case when excluded.phone<>'' then excluded.phone
      when existing.wa_chat_id like '%@lid' and existing.phone in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1)) then ''
      else existing.phone end,
    name=case when nullif(btrim(existing.name),'') is null
      or existing.name in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1),existing.phone,'Contato WhatsApp')
      or existing.name ~ '^[+]?[0-9 ().-]+$' then excluded.name else existing.name end,
    contact_id=coalesce(existing.contact_id,excluded.contact_id),
    updated_at=now()
  where (excluded.phone<>'' and existing.phone is distinct from excluded.phone)
    or (existing.wa_chat_id like '%@lid' and existing.phone in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1)))
    or (existing.contact_id is null and excluded.contact_id is not null)
    or ((nullif(btrim(existing.name),'') is null
      or existing.name in (existing.wa_chat_id,split_part(existing.wa_chat_id,'@',1),existing.phone,'Contato WhatsApp')
      or existing.name ~ '^[+]?[0-9 ().-]+$') and existing.name is distinct from excluded.name);
  return new;
end $function$
;

-- Repair existing LID placeholders using an exact, already-synchronized mapping.
-- Lock only affected conversations; retain a snapshot to enforce identity-only changes.
CREATE TEMP TABLE crm_phone_identity_repair ON COMMIT DROP AS
SELECT c.id,r.phone AS new_phone,
  CASE WHEN nullif(btrim(c.name),'') IS NULL
    OR c.name IN (c.wa_chat_id,split_part(c.wa_chat_id,'@',1),c.phone,'Contato WhatsApp')
    OR c.name ~ '^[+]?[0-9 ().-]+$' THEN r.name ELSE c.name END AS new_name,
  coalesce(c.contact_id,r.contact_id) AS new_contact_id,to_jsonb(c) AS before_row
FROM public.crm_chat_conversations c
CROSS JOIN LATERAL private.crm_chat_resolve_identity(c.wa_chat_id,c.phone,c.name) r
WHERE c.wa_chat_id LIKE '%@lid'
  AND (c.phone='' OR c.phone IN(c.wa_chat_id,split_part(c.wa_chat_id,'@',1))
    OR c.name IN(c.wa_chat_id,split_part(c.wa_chat_id,'@',1)))
  AND r.phone<>''
  AND (c.phone IS DISTINCT FROM r.phone OR c.name IS DISTINCT FROM r.name)
FOR UPDATE OF c;

UPDATE public.crm_chat_conversations c SET
  phone=r.new_phone,name=r.new_name,contact_id=r.new_contact_id,updated_at=now()
FROM pg_temp.crm_phone_identity_repair r WHERE c.id=r.id;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.crm_phone_identity_repair r
    JOIN public.crm_chat_conversations c ON c.id=r.id
    WHERE (to_jsonb(c)-ARRAY['phone','name','contact_id','updated_at'])
      IS DISTINCT FROM (r.before_row-ARRAY['phone','name','contact_id','updated_at'])
      OR c.phone IS DISTINCT FROM r.new_phone OR c.name IS DISTINCT FROM r.new_name
  ) THEN RAISE EXCEPTION 'Identity repair changed unrelated conversation state'; END IF;
END
$verify$;

