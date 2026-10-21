-- Dashboard › Visão geral › tile Vendas (21/10/2026, Daniel: "o Vendas tem que marcar embaixo, daqueles contatos que vieram
-- no mês, quantas vendas foram feitas… tem cliente que é do mês passado e fechou agora").
-- Vendas do período (mesma régua de dashboard_vendas_periodo: pedido não cancelado com data_venda no período) cujo cliente
-- CHEGOU como lead no mesmo período (1º atendimento em auditoria_atendimentos). Telefone do pedido (raw.telefone, que todo
-- pedido tem) e, sem ele, o do orçamento. Em outubro/2026: 30 vendas = 1 de lead do mês + 6 de lead de meses antes + 23 de
-- cliente que nunca passou como lead (veio direto no WhatsApp do vendedor). Função nova: dashboard_vendas_periodo não muda.

create or replace function public.dashboard_vendas_coorte(p_from timestamptz, p_to timestamptz)
returns table(qtd integer, valor numeric)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  -- SECURITY DEFINER passa por cima da RLS: papel externo não lê nada
  if public.papel_restrito() then return; end if;
  return query
  with v as (
    select coalesce(public.fone_canon(m.raw->>'telefone'), o.fone) as fc,
      (case when coalesce(nullif(m.payment_plan_json->>'total', '')::numeric, 0) > 0
            then (m.payment_plan_json->>'total')::numeric
            else coalesce(m.valor_total, 0) end) as venda
    from public.mirror_pedidos_venda m
    left join lateral (
      select public.fone_canon(og.cliente_dados->>'fone') as fone
      from public.orcamentos_gerados og
      where coalesce(m.numero_orcamento, '') <> ''
        and regexp_replace(og.numero, '\s', '', 'g') = regexp_replace(m.numero_orcamento, '\s', '', 'g')
      limit 1
    ) o on true
    where coalesce(upper(m.status), '') <> 'CANCELADO'
      and m.data_venda is not null
      and (p_from is null or m.data_venda >= (p_from at time zone 'America/Sao_Paulo')::date)
      and (p_to is null or m.data_venda <= (p_to at time zone 'America/Sao_Paulo')::date)
  ),
  chegada as (
    select public.fone_canon(coalesce(a.telefone, a.telefone_norm)) as fc, min(a.created_at) as em
    from auditoria.auditoria_atendimentos a
    where a.is_internal is not true
      and public.fone_canon(coalesce(a.telefone, a.telefone_norm)) in (select fc from v where fc is not null)
    group by 1
  )
  select count(*)::int, coalesce(sum(v.venda), 0)::numeric
  from v join chegada c on c.fc = v.fc
  where (p_from is null or c.em >= p_from)
    and (p_to is null or (c.em at time zone 'America/Sao_Paulo')::date <= (p_to at time zone 'America/Sao_Paulo')::date);
end
$fn$;

comment on function public.dashboard_vendas_coorte(timestamptz, timestamptz) is
  'Dashboard › tile Vendas: vendas do período cujo cliente chegou como lead no mesmo período (telefone do pedido × 1º atendimento).';

revoke all on function public.dashboard_vendas_coorte(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_vendas_coorte(timestamptz, timestamptz) to authenticated, service_role;
