-- Relatório de marketing (20/10/2026): vendas FECHADAS no período e de onde veio o cliente.
-- A coorte de leads do mês quase nunca já comprou (lead → orçamento demora), então "quanto vendeu cada
-- origem" olha o pedido: data_venda na janela, sem cancelado/garantia/valor zero.
-- Origem = fonte_origem que o vendedor marca no pedido (cobre ~90% das vendas).
-- Criativo = &NN do 1º atendimento do cliente antes da venda (só ~10% das vendas têm — declarar na tela).
set lock_timeout = '5s';
create or replace function public.dashboard_marketing_vendas(p_from timestamptz, p_to timestamptz)
returns table(tipo text, chave text, nome text, vendas int, valor numeric)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with pv as materialized (
  select distinct on (pedido_numero) pedido_numero,
    regexp_replace(coalesce(numero_orcamento,''),'\s','','g') num, data_venda,
    (case when coalesce(nullif(payment_plan_json->>'total','')::numeric,0) > 0
          then (payment_plan_json->>'total')::numeric else coalesce(valor_total,0) end)
      -- ajuste entra como na Corrida de Vendas: no mês do ajuste (sem data = mês da venda)
      + case when ajuste_data is null or ajuste_data
                  between (p_from at time zone 'America/Sao_Paulo')::date and (p_to at time zone 'America/Sao_Paulo')::date - 1
             then coalesce(ajuste_valor,0) else 0 end v,
    lower(btrim(coalesce(raw->>'fonte_origem',''))) fo, nullif(raw->>'telefone','') tel
  from public.mirror_pedidos_venda
  where coalesce(upper(status),'') <> 'CANCELADO'
    and data_venda >= (p_from at time zone 'America/Sao_Paulo')::date
    and data_venda <  (p_to   at time zone 'America/Sao_Paulo')::date
),
v as materialized (
  select * from pv where v > 0 and fo <> 'garantia'
),
og as materialized (
  select regexp_replace(o.numero,'\s','','g') num, public.fone_canon(o.cliente_dados->>'fone') fc
  from public.orcamentos_gerados o
  where regexp_replace(o.numero,'\s','','g') in (select num from v where num <> '')
),
f as materialized (
  select v.*, coalesce(public.fone_canon(v.tel), (select og.fc from og where og.num = v.num and og.fc is not null limit 1)) fc
  from v
),
at as materialized (
  select public.fone_canon(a.telefone_norm) fc, a.data, substring(a.criativo_codigo from '^&[0-9]+') cod
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false) = false and a.criativo_codigo ~ '^&[0-9]+'
    and a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
),
m as (
  select f.v,
    case
      when f.fo = 'instagram'                 then 'Instagram'
      when f.fo = 'facebook'                  then 'Facebook'
      when f.fo = 'google'                    then 'Google'
      when f.fo = 'site' or f.fo like 'lp%'   then 'Site / landing page'
      when f.fo = 'ja_era_cliente'            then 'Já era cliente'
      when f.fo = 'indicacao'                 then 'Indicação'
      when f.fo = 'feira'                     then 'Feira'
      when f.fo = 'representante'             then 'Representante'
      when f.fo in ('','nao_informado','nao_lembra') then 'Não informado no pedido'
      else initcap(replace(f.fo,'_',' ')) end origem,
    (select at.cod from at where at.fc = f.fc and at.data < f.data_venda + 1 order by at.data limit 1) cod
  from f
)
select 'origem', origem, null::text, count(*)::int, round(sum(v)) from m group by origem
union all
select 'criativo', m.cod, max(coalesce(nullif(btrim(cr.nome_oficial),''), cr.headline)), count(*)::int, round(sum(m.v))
from m left join auditoria.criativos cr on cr.codigo = m.cod
where m.cod is not null group by m.cod
union all
select 'total', 'TOTAL', null, count(*)::int, round(sum(v)) from m;
$$;
revoke all on function public.dashboard_marketing_vendas(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_vendas(timestamptz, timestamptz) to authenticated, service_role;
