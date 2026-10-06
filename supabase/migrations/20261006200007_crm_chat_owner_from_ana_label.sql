-- Atendimento WhatsApp: o vendedor que recebeu o lead da Ana passa a ver a conversa.
-- Aplicada em produção em 06/10/2026 (versão 20261006200007). Nenhuma mensagem é enviada e
-- public.contacts não é alterada por esta migration.
set local lock_timeout = '5s';

-- Retrato de quem estava sem responsável antes da regra (pra desfazer: vendor_id volta a NULL nesses ids).
create table if not exists public.crm_chat_conv_owner_bkp_20261006 as
select id, wa_chat_id, contact_id, vendor_id as vendor_id_antes, ana_tags, now() as copiado_em
from public.crm_chat_conversations where vendor_id is null;
alter table public.crm_chat_conv_owner_bkp_20261006 enable row level security;
revoke all on public.crm_chat_conv_owner_bkp_20261006 from anon, authenticated;

create or replace function private.crm_chat_owner_from_ana_label()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare dono uuid; n integer; vid uuid; mudou_etq boolean := false;
begin
  -- (06/10/2026) A carteira do Atendimento WhatsApp vem do dono do CONTATO no CRM, mas o repasse da
  -- Ana não grava dono no contato: ela põe a etiqueta com o nome do vendedor e dispara pelo WhatsApp
  -- dele. O contato do lead nasce sem dono (sync_contacts_from_atendimentos roda antes do repasse e
  -- nunca atualiza), então a conversa ficava sem responsável e só o admin via: de 219 conversas
  -- passadas, 126 estavam invisíveis pro vendedor que recebeu.
  -- Regra: contato COM dono no CRM manda (carteira antiga e transferência do admin continuam valendo).
  -- Contato sem dono, ou conversa sem contato: o responsável é o vendedor da etiqueta da Ana, quando há
  -- exatamente UMA etiqueta com nome de vendedor ativo. Só PREENCHE responsável vazio ou acompanha a
  -- troca de etiqueta; nunca passa por cima de um responsável definido no mesmo UPDATE (transferência).
  -- Duas etiquetas de vendedor = ambíguo, não mexe. Etiqueta removida não tira o acesso.
  -- Não toca em public.contacts de propósito: preencher dono ali dispara
  -- zzz_replyagent_tag_on_atribuir_contacts, que CRIA o contato no ReplyAgent e aplica etiqueta.
  if tg_op = 'UPDATE' then mudou_etq := new.ana_tags is distinct from old.ana_tags; end if;
  if new.vendor_id is not null
     and not (mudou_etq and new.vendor_id is not distinct from old.vendor_id) then
    return new;
  end if;
  if cardinality(new.ana_tags) = 0 then return new; end if;
  if new.contact_id is not null then
    select c.vendor_id into dono from public.contacts c where c.id = new.contact_id;
    if dono is not null then return new; end if;
  end if;
  select count(*), min(v.id::text)::uuid into n, vid
    from public.vendors v
   where v.ativo and upper(v.name) in (select upper(t) from unnest(new.ana_tags) t);
  if n = 1 then new.vendor_id := vid; end if;
  return new;
end
$function$;

revoke all on function private.crm_chat_owner_from_ana_label() from public, anon, authenticated;

drop trigger if exists crm_chat_owner_from_ana_label on public.crm_chat_conversations;
create trigger crm_chat_owner_from_ana_label
  before insert or update on public.crm_chat_conversations
  for each row execute function private.crm_chat_owner_from_ana_label();

-- Preenchimento das conversas que já estavam sem responsável: rodado à mão em produção logo depois
-- (06/10/2026, 125 conversas), fora desta migration. Em banco novo não há o que preencher.
--
--   update public.crm_chat_conversations c set vendor_id = a.vid
--   from (
--     select cc.id,
--            (select min(v.id::text)::uuid from public.vendors v
--              where v.ativo and upper(v.name) = any (select upper(t) from unnest(cc.ana_tags) t)) as vid
--     from public.crm_chat_conversations cc left join public.contacts ct on ct.id = cc.contact_id
--     where cc.vendor_id is null and ct.vendor_id is null
--       and (select count(*) from public.vendors v
--             where v.ativo and upper(v.name) = any (select upper(t) from unnest(cc.ana_tags) t)) = 1
--   ) a
--   where c.id = a.id;
--
-- Desfazer: drop trigger crm_chat_owner_from_ana_label on public.crm_chat_conversations;
--           update public.crm_chat_conversations c set vendor_id = null
--             from public.crm_chat_conv_owner_bkp_20261006 b
--            where c.id = b.id
--              and not exists (select 1 from public.contacts ct where ct.id = c.contact_id and ct.vendor_id is not null);
--           (conversa cujo contato ganhou dono depois continua com o dono do contato)
