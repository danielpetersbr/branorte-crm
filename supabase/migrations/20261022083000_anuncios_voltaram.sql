-- /anuncios: clientes que já estavam no CRM antes do período e voltaram a falar no período, por canal.
-- Mesma régua do "voltaram" de /atendimentos e do tile Leads (dashboard_leads_contexto), com a chegada = atendimentos_por_cliente.data
-- (a mesma que anuncios_crm usa para "contato novo"): quem conta aqui nunca conta nos contatos novos. Canal = a regra de anuncios_crm
-- pela origem gravada (Meta ADS/código do criativo → Meta; Google*/rótulos do script do site → Site; o resto → Outros).
-- Já aplicado no banco em 22/10/2026 (md5 do corpo = banco).
create or replace function public.anuncios_voltaram(p_from timestamptz, p_to timestamptz)
returns table(canal text, voltaram integer)
language sql
stable
security definer
set search_path = public, auditoria
as $fn$
  select case
           when coalesce(a.origem in ('Meta ADS','META TESTE 1','Link'), false)
             or (coalesce(btrim(a.origem),'') = '' and coalesce(a.criativo_codigo ~ '^&[0-9]+', false)) then 'Meta'
           when coalesce(a.origem ilike 'google%' or a.origem in ('Site','YouTube','TikTok','LinkedIn','ChatGPT/IA','E-mail','Link no WhatsApp',
                                                                  'Outros buscadores','Outros sites'), false) then 'Site'
           else 'Outros' end,
         count(*)::int
  from auditoria.atendimentos_por_cliente a
  where not public.papel_restrito()
    and coalesce(a.is_internal, false) = false
    and a.data < p_from and a.last_message_at >= p_from and a.last_message_at < p_to
  group by 1
$fn$;
revoke all on function public.anuncios_voltaram(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_voltaram(timestamptz, timestamptz) to authenticated, service_role;
