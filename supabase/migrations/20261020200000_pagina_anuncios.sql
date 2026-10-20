-- Página /anuncios (20/10/2026): acompanhar Meta e Google no detalhe.
--   Meta: campanha → conjunto → anúncio (situação de cada um vem de meta_anuncio, carregada junto com o gasto).
--   Google: campanha → grupo de anúncios (google_ads_grupo_dia) + palavras-chave (google_ads_palavra) — o script da
--   conta passa a mandar esses dois blocos também.
--   Por dia: gasto das duas plataformas e contatos que chegaram no CRM (Meta, Site e total).
set lock_timeout = '5s';

create table if not exists public.meta_anuncio (
  ad_id text primary key,
  nome text,
  status text,
  conjunto_id text,
  conjunto text,
  conjunto_status text,
  conjunto_orcamento_dia numeric(12,2),
  campanha_id text,
  atualizado_em timestamptz not null default now()
);
alter table public.meta_anuncio enable row level security;
revoke all on public.meta_anuncio from anon, authenticated;

create table if not exists public.google_ads_grupo_dia (
  data date not null,
  grupo_id text not null,
  grupo text,
  campanha_id text,
  campanha text,
  status text,
  gasto numeric(12,2) not null default 0,
  impressoes integer not null default 0,
  cliques integer not null default 0,
  conversoes numeric(12,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (data, grupo_id)
);
alter table public.google_ads_grupo_dia enable row level security;
revoke all on public.google_ads_grupo_dia from anon, authenticated;

create table if not exists public.google_ads_palavra (
  palavra text not null,
  correspondencia text not null default '',
  grupo text not null default '',
  campanha text not null default '',
  status text,
  cliques integer not null default 0,
  impressoes integer not null default 0,
  gasto numeric(12,2) not null default 0,
  conversoes numeric(12,2) not null default 0,
  de date,
  ate date,
  atualizado_em timestamptz not null default now(),
  primary key (palavra, correspondencia, grupo, campanha)
);
alter table public.google_ads_palavra enable row level security;
revoke all on public.google_ads_palavra from anon, authenticated;

-- ingest v2: aceita também 'grupos' (grupo × dia) e 'palavras' (fotografia de 30 dias)
create or replace function public.google_ads_ingest(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'private', 'extensions'
as $$
declare
  v_dias int := 0; v_termos int := 0; v_grupos int := 0; v_palavras int := 0;
begin
  if p_token is null or not exists (
    select 1 from private.integracao_token
    where nome = 'google_ads' and sha256 = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'chave invalida' using errcode = '28000';
  end if;

  insert into public.google_ads_gasto_dia
    (data, campanha_id, campanha, status, tipo, orcamento_dia, gasto, impressoes, cliques, conversoes, atualizado_em)
  select r.data, r.campanha_id, r.campanha, r.status, r.tipo, r.orcamento_dia, coalesce(r.gasto, 0),
         coalesce(r.impressoes, 0), coalesce(r.cliques, 0), coalesce(r.conversoes, 0), now()
  from jsonb_to_recordset(coalesce(p_payload->'dias', '[]'::jsonb)) as r(
    data date, campanha_id text, campanha text, status text, tipo text, orcamento_dia numeric,
    gasto numeric, impressoes int, cliques int, conversoes numeric)
  where r.data is not null and r.campanha_id is not null
  on conflict (data, campanha_id) do update set
    campanha = excluded.campanha, status = excluded.status, tipo = excluded.tipo,
    orcamento_dia = excluded.orcamento_dia, gasto = excluded.gasto, impressoes = excluded.impressoes,
    cliques = excluded.cliques, conversoes = excluded.conversoes, atualizado_em = now();
  get diagnostics v_dias = row_count;

  insert into public.google_ads_grupo_dia
    (data, grupo_id, grupo, campanha_id, campanha, status, gasto, impressoes, cliques, conversoes, atualizado_em)
  select r.data, r.grupo_id, r.grupo, r.campanha_id, r.campanha, r.status, coalesce(r.gasto, 0),
         coalesce(r.impressoes, 0), coalesce(r.cliques, 0), coalesce(r.conversoes, 0), now()
  from jsonb_to_recordset(coalesce(p_payload->'grupos', '[]'::jsonb)) as r(
    data date, grupo_id text, grupo text, campanha_id text, campanha text, status text,
    gasto numeric, impressoes int, cliques int, conversoes numeric)
  where r.data is not null and r.grupo_id is not null
  on conflict (data, grupo_id) do update set
    grupo = excluded.grupo, campanha_id = excluded.campanha_id, campanha = excluded.campanha, status = excluded.status,
    gasto = excluded.gasto, impressoes = excluded.impressoes, cliques = excluded.cliques,
    conversoes = excluded.conversoes, atualizado_em = now();
  get diagnostics v_grupos = row_count;

  if p_payload ? 'termos' then
    delete from public.google_ads_termo where true;
    insert into public.google_ads_termo (termo, campanha, cliques, impressoes, gasto, conversoes, de, ate, atualizado_em)
    select r.termo, coalesce(r.campanha, ''), sum(coalesce(r.cliques, 0)), sum(coalesce(r.impressoes, 0)),
           sum(coalesce(r.gasto, 0)), sum(coalesce(r.conversoes, 0)), max(r.de), max(r.ate), now()
    from jsonb_to_recordset(p_payload->'termos') as r(
      termo text, campanha text, cliques int, impressoes int, gasto numeric, conversoes numeric, de date, ate date)
    where coalesce(btrim(r.termo), '') <> ''
    group by r.termo, coalesce(r.campanha, '');
    get diagnostics v_termos = row_count;
  end if;

  if p_payload ? 'palavras' then
    delete from public.google_ads_palavra where true;
    insert into public.google_ads_palavra (palavra, correspondencia, grupo, campanha, status, cliques, impressoes, gasto, conversoes, de, ate, atualizado_em)
    select r.palavra, coalesce(r.correspondencia, ''), coalesce(r.grupo, ''), coalesce(r.campanha, ''), max(r.status),
           sum(coalesce(r.cliques, 0)), sum(coalesce(r.impressoes, 0)), sum(coalesce(r.gasto, 0)), sum(coalesce(r.conversoes, 0)),
           max(r.de), max(r.ate), now()
    from jsonb_to_recordset(p_payload->'palavras') as r(
      palavra text, correspondencia text, grupo text, campanha text, status text,
      cliques int, impressoes int, gasto numeric, conversoes numeric, de date, ate date)
    where coalesce(btrim(r.palavra), '') <> ''
    group by r.palavra, coalesce(r.correspondencia, ''), coalesce(r.grupo, ''), coalesce(r.campanha, '');
    get diagnostics v_palavras = row_count;
  end if;

  return jsonb_build_object('ok', true, 'dias', v_dias, 'grupos', v_grupos, 'termos', v_termos, 'palavras', v_palavras);
end;
$$;
revoke all on function public.google_ads_ingest(text, jsonb) from public;
grant execute on function public.google_ads_ingest(text, jsonb) to anon, authenticated, service_role;

-- Meta por anúncio no período (a página monta a árvore campanha → conjunto → anúncio)
create or replace function public.anuncios_meta(p_from timestamptz, p_to timestamptz)
returns table(campanha_id text, campanha text, campanha_status text, campanha_orcamento_dia numeric, objetivo text,
              conjunto text, conjunto_status text, conjunto_orcamento_dia numeric,
              ad_id text, anuncio text, codigo text, anuncio_status text,
              gasto numeric, impressoes bigint, cliques bigint, resultado numeric, resultado_tipo text, dias_com_gasto int)
language sql stable security definer
set search_path to 'public'
as $$
  select max(g.campanha_id), g.campanha, max(mc.status), max(mc.orcamento_dia), max(g.objetivo),
         g.conjunto, max(ma.conjunto_status), max(ma.conjunto_orcamento_dia),
         g.ad_id, max(g.anuncio), max(g.codigo), max(ma.status),
         round(sum(g.gasto), 2), sum(g.impressoes)::bigint, sum(g.cliques)::bigint,
         sum(public.meta_resultado(g.objetivo, g.acoes, g.cliques, g.conversas, g.leads_form)),
         public.meta_resultado_tipo(max(g.objetivo)),
         count(distinct g.data) filter (where g.gasto > 0)::int
  from public.meta_gasto_anuncio_dia g
  left join public.meta_campanha mc on mc.campanha_id = g.campanha_id
  left join public.meta_anuncio ma on ma.ad_id = g.ad_id
  where g.data >= (p_from at time zone 'America/Sao_Paulo')::date
    and g.data <  (p_to   at time zone 'America/Sao_Paulo')::date
  group by g.campanha, g.conjunto, g.ad_id
  having sum(g.gasto) > 0 or sum(g.impressoes) > 0;
$$;
revoke all on function public.anuncios_meta(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_meta(timestamptz, timestamptz) to authenticated, service_role;

-- Google por grupo de anúncios no período (+ linhas de campanha sem grupo, se o script ainda não manda grupos)
create or replace function public.anuncios_google(p_from timestamptz, p_to timestamptz)
returns table(nivel text, campanha text, campanha_status text, orcamento_dia numeric, grupo text, grupo_status text,
              gasto numeric, impressoes bigint, cliques bigint, conversoes numeric)
language sql stable security definer
set search_path to 'public'
as $$
with per as (select (p_from at time zone 'America/Sao_Paulo')::date de, (p_to at time zone 'America/Sao_Paulo')::date ate)
select 'campanha', g.campanha, (array_agg(g.status order by g.data desc))[1], (array_agg(g.orcamento_dia order by g.data desc))[1],
       null, null, round(sum(g.gasto), 2), sum(g.impressoes)::bigint, sum(g.cliques)::bigint, sum(g.conversoes)
from public.google_ads_gasto_dia g, per where g.data >= per.de and g.data < per.ate
group by g.campanha
union all
select 'grupo', g.campanha, null, null, g.grupo, (array_agg(g.status order by g.data desc))[1],
       round(sum(g.gasto), 2), sum(g.impressoes)::bigint, sum(g.cliques)::bigint, sum(g.conversoes)
from public.google_ads_grupo_dia g, per where g.data >= per.de and g.data < per.ate
group by g.campanha, g.grupo;
$$;
revoke all on function public.anuncios_google(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_google(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.anuncios_google_palavras(p_limite int default 30)
returns table(palavra text, correspondencia text, grupo text, campanha text, status text, cliques int, impressoes int,
              gasto numeric, conversoes numeric, de date, ate date)
language sql stable security definer
set search_path to 'public'
as $$
  select palavra, correspondencia, grupo, campanha, status, cliques, impressoes, gasto, conversoes, de, ate
  from public.google_ads_palavra order by gasto desc, cliques desc limit greatest(1, least(coalesce(p_limite, 30), 200));
$$;
revoke all on function public.anuncios_google_palavras(int) from public, anon;
grant execute on function public.anuncios_google_palavras(int) to authenticated, service_role;

-- Por dia: gasto das plataformas e contatos que chegaram no CRM (agrupa uma vez; 90 dias < 1 s)
create or replace function public.anuncios_diario(p_from timestamptz, p_to timestamptz)
returns table(dia date, gasto_meta numeric, gasto_google numeric, resultado_meta numeric, cliques_google bigint,
              contatos int, contatos_meta int, contatos_site int)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with per as (select (p_from at time zone 'America/Sao_Paulo')::date de, (p_to at time zone 'America/Sao_Paulo')::date ate),
dias as (select generate_series(per.de, per.ate - 1, interval '1 day')::date dia from per),
site as materialized (
  select distinct nullif(auditoria.wa_phone_strip9(w.phone),'') pm
  from public.wa_chat_messages w
  where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
    and w.body ~* '(vim pelo site da branorte|achei voc[eê]s no google)'
),
l as (
  select (a.data at time zone 'America/Sao_Paulo')::date dia,
         coalesce(a.origem in ('Meta ADS','META TESTE 1','Link'), false)
           or (coalesce(btrim(a.origem),'') = '' and coalesce(a.criativo_codigo ~ '^&[0-9]+', false)) meta,
         coalesce(a.origem ilike 'google%', false)
           or coalesce(nullif(auditoria.wa_phone_strip9(a.telefone),'') in (select pm from site where pm is not null), false) site
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false) = false and a.data >= p_from and a.data < p_to
),
lc as (
  select dia, count(*)::int contatos, count(*) filter (where meta)::int cm, count(*) filter (where site and not meta)::int cs
  from l group by dia
),
mg as (
  select g.data dia, round(sum(g.gasto), 2) gasto,
         sum(public.meta_resultado(g.objetivo, g.acoes, g.cliques, g.conversas, g.leads_form))
           filter (where public.meta_resultado_tipo(g.objetivo) = 'conversas') conv
  from public.meta_gasto_anuncio_dia g, per where g.data >= per.de and g.data < per.ate group by g.data
),
gg as (
  select g.data dia, round(sum(g.gasto), 2) gasto, sum(g.cliques)::bigint cliques
  from public.google_ads_gasto_dia g, per where g.data >= per.de and g.data < per.ate group by g.data
)
select d.dia, coalesce(mg.gasto, 0), coalesce(gg.gasto, 0), coalesce(mg.conv, 0), coalesce(gg.cliques, 0),
       coalesce(lc.contatos, 0), coalesce(lc.cm, 0), coalesce(lc.cs, 0)
from dias d left join mg using (dia) left join gg using (dia) left join lc using (dia)
order by d.dia;
$$;
revoke all on function public.anuncios_diario(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_diario(timestamptz, timestamptz) to authenticated, service_role;
