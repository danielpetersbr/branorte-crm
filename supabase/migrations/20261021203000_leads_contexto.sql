-- Dashboard › tile "Leads" (21/10/2026, auditoria pedida pelo Daniel: "as 53 hoje… mas chegou 72"). O tile conta cliente NOVO que virou
-- linha no CRM no período; o "Hoje" de /atendimentos conta quem mandou mensagem no período (inclui cliente antigo). Esta função dá o
-- contexto pra tela explicar a diferença, na mesma janela:
--   voltaram = cliente que já estava no CRM antes do período e conversou no período (última mensagem no período);
--   com_ana  = conversa nova que a Ana abriu no período e ainda está atendendo, sem linha no CRM (entra no Leads quando ela repassar).

create or replace function public.dashboard_leads_contexto(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auditoria
as $fn$
declare v jsonb;
begin
  if public.papel_restrito() then return null; end if;
  with ana as (
    select ia.chat_id,
           (select nullif(auditoria.wa_phone_strip9(m.phone), '') from public.wa_chat_messages m
             where m.vendedor_nome = 'ANA' and m.chat_id = ia.chat_id and m.phone is not null limit 1) as pm
    from public.ia_atendimentos ia
    where ia.vendedor_nome = 'ANA' and ia.origem = 'porteira' and ia.ativo
      and (p_from is null or ia.ligado_em >= p_from) and (p_to is null or ia.ligado_em < p_to)
  )
  select jsonb_build_object(
    'voltaram', (select count(*) from auditoria.atendimentos_por_cliente a
                 where coalesce(a.is_internal, false) = false
                   and p_from is not null and a.primeira_data < p_from
                   and a.last_message_at >= p_from and (p_to is null or a.last_message_at < p_to)),
    'com_ana', (select count(*) from ana
                where pm is null
                   or not exists (select 1 from auditoria.auditoria_atendimentos x
                                  where nullif(auditoria.wa_phone_strip9(x.telefone), '') = ana.pm))
  ) into v;
  return v;
end
$fn$;

comment on function public.dashboard_leads_contexto(timestamptz, timestamptz) is
  'Dashboard › tile Leads: clientes antigos que conversaram no período (voltaram) e conversas novas ainda com a Ana sem linha no CRM (com_ana).';
revoke all on function public.dashboard_leads_contexto(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_leads_contexto(timestamptz, timestamptz) to authenticated, service_role;
