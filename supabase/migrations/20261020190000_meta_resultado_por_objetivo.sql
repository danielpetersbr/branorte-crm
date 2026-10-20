-- Meta por objetivo (20/10/2026): "resultado" de cada campanha segue o objetivo dela, como no Gerenciador.
--   Mensagem (OUTCOME_ENGAGEMENT/MESSAGES) → conversas iniciadas;
--   Tráfego (LINK_CLICKS/OUTCOME_TRAFFIC) → cliques no link;
--   Cadastro (OUTCOME_LEADS/LEAD_GENERATION) → cadastros (formulário do Meta OU pixel da página, inclusive evento próprio).
-- A carga passa a guardar todas as ações do dia (acoes jsonb) e o cadastro da campanha (status, orçamento).
set lock_timeout = '5s';

alter table public.meta_gasto_anuncio_dia add column if not exists campanha_id text;
alter table public.meta_gasto_anuncio_dia add column if not exists acoes jsonb;

create table if not exists public.meta_campanha (
  campanha_id text primary key,
  nome text,
  objetivo text,
  status text,
  orcamento_dia numeric(12,2),
  atualizado_em timestamptz not null default now()
);
alter table public.meta_campanha enable row level security;
revoke all on public.meta_campanha from anon, authenticated;

-- resultado de UMA linha (dia × anúncio) pelo objetivo
create or replace function public.meta_resultado(p_objetivo text, p_acoes jsonb, p_cliques int, p_conversas int, p_leads int)
returns numeric
language sql immutable
as $$
  select case
    when p_objetivo in ('LINK_CLICKS', 'OUTCOME_TRAFFIC') then coalesce(p_cliques, 0)
    when p_objetivo in ('OUTCOME_LEADS', 'LEAD_GENERATION') then greatest(
      coalesce((p_acoes->>'lead')::numeric, p_leads, 0),
      coalesce((p_acoes->>'offsite_conversion.fb_pixel_lead')::numeric, 0),
      coalesce((p_acoes->>'onsite_conversion.lead_grouped')::numeric, 0),
      coalesce((p_acoes->>'leadgen_grouped')::numeric, 0),
      -- a LP otimiza por evento próprio do pixel (148 em out/26 contra 2 "lead" padrão)
      coalesce((p_acoes->>'offsite_conversion.fb_pixel_custom')::numeric, 0))
    else coalesce(p_conversas, 0)
  end
$$;

create or replace function public.meta_resultado_tipo(p_objetivo text)
returns text language sql immutable as $$
  select case
    when p_objetivo in ('LINK_CLICKS', 'OUTCOME_TRAFFIC') then 'cliques no link'
    when p_objetivo in ('OUTCOME_LEADS', 'LEAD_GENERATION') then 'cadastros/conversões do pixel'
    else 'conversas' end
$$;

drop function if exists public.dashboard_marketing_plataformas(timestamptz, timestamptz);
create function public.dashboard_marketing_plataformas(p_from timestamptz, p_to timestamptz)
returns table(tipo text, plataforma text, campanha text, status text, orcamento_dia numeric, gasto numeric,
              impressoes bigint, cliques bigint, resultado numeric, dias_com_gasto int, carregado_ate date,
              resultado_tipo text, objetivo text)
language sql stable security definer
set search_path to 'public'
as $$
with per as (
  select (p_from at time zone 'America/Sao_Paulo')::date de, (p_to at time zone 'America/Sao_Paulo')::date ate
),
m as (
  select 'Meta'::text plataforma, g.campanha,
         (select mc.status from public.meta_campanha mc where mc.campanha_id = max(g.campanha_id)) status,
         (select mc.orcamento_dia from public.meta_campanha mc where mc.campanha_id = max(g.campanha_id)) orcamento_dia,
         sum(g.gasto) gasto, sum(g.impressoes)::bigint impressoes, sum(g.cliques)::bigint cliques,
         sum(public.meta_resultado(g.objetivo, g.acoes, g.cliques, g.conversas, g.leads_form)) resultado,
         count(distinct g.data) filter (where g.gasto > 0)::int dias,
         public.meta_resultado_tipo(max(g.objetivo)) resultado_tipo, max(g.objetivo) objetivo
  from public.meta_gasto_anuncio_dia g, per
  where g.data >= per.de and g.data < per.ate
  group by g.campanha
),
gg as (
  select 'Google'::text plataforma, g.campanha,
         (array_agg(g.status order by g.data desc))[1] status,
         (array_agg(g.orcamento_dia order by g.data desc))[1] orcamento_dia,
         sum(g.gasto) gasto, sum(g.impressoes)::bigint impressoes, sum(g.cliques)::bigint cliques,
         sum(g.conversoes) resultado, count(distinct g.data) filter (where g.gasto > 0)::int dias,
         'conversões'::text resultado_tipo, max(g.tipo) objetivo
  from public.google_ads_gasto_dia g, per
  where g.data >= per.de and g.data < per.ate
  group by g.campanha
),
todas as (select * from m union all select * from gg)
select 'campanha', plataforma, campanha, status, orcamento_dia, round(gasto, 2), impressoes, cliques, resultado, dias, null::date,
       resultado_tipo, objetivo
from todas where gasto > 0 or impressoes > 0
union all
select 'plataforma', 'Meta', null, null, (select sum(orcamento_dia) from public.meta_campanha where status = 'ACTIVE'),
       coalesce((select round(sum(gasto), 2) from m), 0),
       (select sum(impressoes) from m)::bigint, (select sum(cliques) from m)::bigint,
       (select sum(resultado) from m where resultado_tipo = 'conversas'), null,
       (select max(data) from public.meta_gasto_anuncio_dia), 'conversas', null
union all
select 'plataforma', 'Google', null, null, null, coalesce((select round(sum(gasto), 2) from gg), 0),
       (select sum(impressoes) from gg)::bigint, (select sum(cliques) from gg)::bigint, (select sum(resultado) from gg), null,
       (select max(data) from public.google_ads_gasto_dia), 'conversões', null;
$$;
revoke all on function public.dashboard_marketing_plataformas(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_plataformas(timestamptz, timestamptz) to authenticated, service_role;
