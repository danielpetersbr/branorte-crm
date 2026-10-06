-- Atendimento WhatsApp: a conversa segue o repasse da Ana (v2 da 20261006200007).
-- Aplicada em produção em 06/10/2026 (versão 20261006203037). Nenhuma mensagem é enviada e
-- public.contacts não é alterada por esta migration.
set local lock_timeout = '5s';

create or replace function private.crm_chat_owner_from_ana_label()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer; vid uuid; n_old integer; vid_old uuid; mudou_etq boolean := false;
begin
  -- (06/10/2026, v2) Quem recebeu o lead da Ana vê a conversa. O repasse da Ana põe na conversa a
  -- etiqueta com o nome do vendedor e dispara pelo WhatsApp dele; nada disso grava dono no contato
  -- do CRM, e a carteira do Atendimento WhatsApp vinha só de contacts.vendor_id. Resultado medido:
  -- 125 conversas repassadas sem responsável (só o admin via) e 27 aparecendo pro dono antigo do
  -- contato (importações de 2025/2026) em vez de quem a Ana passou.
  -- Regra: quando a etiqueta de vendedor da conversa APARECE ou TROCA (exatamente uma etiqueta com
  -- nome de vendedor ativo), esse vendedor vira o responsável — mesmo que o contato tenha outro dono
  -- no CRM. É o mesmo critério do /atendimentos desde 28/09 (trg_outbound_ana_repasse_responsavel).
  -- Também preenche responsável vazio. Não desfaz o que vem depois: responsável informado no próprio
  -- UPDATE (transferência do admin, troca de dono do contato) vale, e mudança de outras etiquetas
  -- não mexe. Duas etiquetas de vendedor = ambíguo, não decide. Etiqueta removida não tira o acesso.
  -- Não toca em public.contacts de propósito: o dono do cliente no CRM é decisão humana, e preencher
  -- dono ali dispara zzz_replyagent_tag_on_atribuir_contacts (cria contato no ReplyAgent).
  if tg_op = 'UPDATE' then
    mudou_etq := new.ana_tags is distinct from old.ana_tags;
    if new.vendor_id is not null and new.vendor_id is distinct from old.vendor_id then return new; end if;
    if new.vendor_id is not null and not mudou_etq then return new; end if;
  end if;
  if cardinality(new.ana_tags) = 0 then return new; end if;
  select count(*), min(v.id::text)::uuid into n, vid
    from public.vendors v
   where v.ativo and upper(v.name) in (select upper(t) from unnest(new.ana_tags) t);
  if n <> 1 then return new; end if;
  if tg_op = 'UPDATE' and new.vendor_id is not null then
    -- As etiquetas mudaram, mas a de vendedor é a mesma de antes: não é repasse novo.
    select count(*), min(v.id::text)::uuid into n_old, vid_old
      from public.vendors v
     where v.ativo and upper(v.name) in (select upper(t) from unnest(old.ana_tags) t);
    if n_old = 1 and vid_old = vid then return new; end if;
  end if;
  new.vendor_id := vid;
  return new;
end
$function$;

revoke all on function private.crm_chat_owner_from_ana_label() from public, anon, authenticated;

create or replace function private.crm_chat_contact_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare conv public.crm_chat_conversations; changing boolean; transferiu boolean;
begin
  changing:=tg_op='INSERT' or new.vendor_id is distinct from old.vendor_id;
  -- (06/10/2026) O dono do contato só vai pra conversa quando ELE mudou (transferência) ou quando a
  -- conversa ainda não tem responsável. Antes, qualquer UPDATE de nome regravava o dono do contato
  -- na conversa e desfazia o responsável vindo do repasse da Ana (private.crm_chat_owner_from_ana_label).
  transferiu:=tg_op='UPDATE' and new.vendor_id is distinct from old.vendor_id;
  for conv in select * from public.crm_chat_conversations where contact_id=new.id or
    (contact_id is null and public.fone_canon(phone)=public.fone_canon(new.phone) and public.fone_canon(new.phone) is not null)
    order by id for update
  loop
    if changing then
      if exists(select 1 from public.wa_scheduled_messages q join public.crm_chat_outbox o on o.scheduled_id=q.id where o.conversation_id=conv.id and q.status='sending') then raise exception 'Há envio de WhatsApp em andamento. Aguarde antes de transferir este contato.'; end if;
      update public.wa_scheduled_messages q set status='cancelled',error='Contato transferido antes do envio.'
        from public.crm_chat_outbox o where o.scheduled_id=q.id and o.conversation_id=conv.id and q.status='pending';
    end if;
    update public.crm_chat_conversations set contact_id=new.id,
      vendor_id=case when transferiu or conv.vendor_id is null then new.vendor_id else conv.vendor_id end,
      name=coalesce(new.name,name),
      lock_user_id=case when changing then null else lock_user_id end,
      lock_session_id=case when changing then null else lock_session_id end,
      lock_until=case when changing then null else lock_until end,updated_at=now()
    where id=conv.id;
  end loop;
  return new;
end $function$;

-- Retrato de quem era o responsável antes de a conversa passar pra quem recebeu o repasse (pra desfazer).
create table if not exists public.crm_chat_conv_owner_bkp2_20261006 as
select cc.id, cc.wa_chat_id, cc.contact_id, cc.vendor_id as vendor_id_antes, cc.ana_tags, now() as copiado_em
from public.crm_chat_conversations cc
where (select count(*) from public.vendors v where v.ativo and upper(v.name) = any (select upper(t) from unnest(cc.ana_tags) t)) >= 1
  and cc.vendor_id is distinct from (select min(v.id::text)::uuid from public.vendors v where v.ativo and upper(v.name) = any (select upper(t) from unnest(cc.ana_tags) t));
alter table public.crm_chat_conv_owner_bkp2_20261006 enable row level security;
revoke all on public.crm_chat_conv_owner_bkp2_20261006 from anon, authenticated;

-- Rodado à mão em produção logo depois (06/10/2026), fora desta migration:
--   * 23 conversas com UMA etiqueta de vendedor que apareciam pro dono antigo do contato passaram pro
--     vendedor da etiqueta (vendor_id + locks zerados). Ficaram de fora 4 números de teste da equipe.
--   * 2 conversas com DUAS etiquetas de vendedor e sem responsável foram atribuídas pelo último disparo
--     'sent' da Ana (outbound_dispatch, raw_payload->>'chat_ana').
-- Desfazer: restaurar as duas funções das migrations anteriores e
--   update public.crm_chat_conversations c set vendor_id = b.vendor_id_antes
--     from public.crm_chat_conv_owner_bkp2_20261006 b where c.id = b.id;
