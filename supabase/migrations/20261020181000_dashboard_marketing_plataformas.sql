-- Relatório de marketing (20/10/2026): "o que está no ar" no Google e no Meta, por campanha, no período.
-- Meta: meta_gasto_anuncio_dia (carga pelo Chrome do Gerenciador). Google: google_ads_gasto_dia (script da
-- conta BRANORTE-ADS). Linha tipo 'plataforma' = total + última data carregada; 'campanha' = cada campanha.
-- "resultado" = o que a própria plataforma conta: conversas iniciadas (Meta) / conversões (Google).
set lock_timeout = '5s';
create or replace function public.dashboard_marketing_plataformas(p_from timestamptz, p_to timestamptz)
returns table(tipo text, plataforma text, campanha text, status text, orcamento_dia numeric, gasto numeric,
              impressoes bigint, cliques bigint, resultado numeric, dias_com_gasto int, carregado_ate date)
language sql stable security definer
set search_path to 'public'
as $$
with per as (
  select (p_from at time zone 'America/Sao_Paulo')::date de, (p_to at time zone 'America/Sao_Paulo')::date ate
),
m as (
  select 'Meta'::text plataforma, g.campanha, null::text status, null::numeric orcamento_dia,
         sum(g.gasto) gasto, sum(g.impressoes)::bigint impressoes, sum(g.cliques)::bigint cliques,
         sum(g.conversas + g.leads_form)::numeric resultado, count(distinct g.data) filter (where g.gasto > 0)::int dias
  from public.meta_gasto_anuncio_dia g, per
  where g.data >= per.de and g.data < per.ate
  group by g.campanha
),
gg as (
  select 'Google'::text plataforma, g.campanha,
         (array_agg(g.status order by g.data desc))[1] status,
         (array_agg(g.orcamento_dia order by g.data desc))[1] orcamento_dia,
         sum(g.gasto) gasto, sum(g.impressoes)::bigint impressoes, sum(g.cliques)::bigint cliques,
         sum(g.conversoes) resultado, count(distinct g.data) filter (where g.gasto > 0)::int dias
  from public.google_ads_gasto_dia g, per
  where g.data >= per.de and g.data < per.ate
  group by g.campanha
),
todas as (select * from m union all select * from gg)
select 'campanha', plataforma, campanha, status, orcamento_dia, round(gasto, 2), impressoes, cliques, resultado, dias, null::date
from todas where gasto > 0 or impressoes > 0
union all
select 'plataforma', 'Meta', null, null, null, coalesce((select round(sum(gasto), 2) from m), 0),
       (select sum(impressoes) from m)::bigint, (select sum(cliques) from m)::bigint, (select sum(resultado) from m), null,
       (select max(data) from public.meta_gasto_anuncio_dia)
union all
select 'plataforma', 'Google', null, null, null, coalesce((select round(sum(gasto), 2) from gg), 0),
       (select sum(impressoes) from gg)::bigint, (select sum(cliques) from gg)::bigint, (select sum(resultado) from gg), null,
       (select max(data) from public.google_ads_gasto_dia);
$$;
revoke all on function public.dashboard_marketing_plataformas(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_plataformas(timestamptz, timestamptz) to authenticated, service_role;

-- O que as pessoas pesquisaram no Google (últimos 30 dias, fotografia do último envio do script).
create or replace function public.dashboard_marketing_termos_google(p_limite int default 15)
returns table(termo text, campanha text, cliques int, impressoes int, gasto numeric, conversoes numeric, de date, ate date)
language sql stable security definer
set search_path to 'public'
as $$
  select termo, campanha, cliques, impressoes, gasto, conversoes, de, ate
  from public.google_ads_termo
  order by gasto desc, cliques desc
  limit greatest(1, least(coalesce(p_limite, 15), 100));
$$;
revoke all on function public.dashboard_marketing_termos_google(int) from public, anon;
grant execute on function public.dashboard_marketing_termos_google(int) to authenticated, service_role;
