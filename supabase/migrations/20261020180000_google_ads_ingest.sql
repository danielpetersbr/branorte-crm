-- Google Ads no CRM (20/10/2026). Um script dentro da conta BRANORTE-ADS (484-560-6333) roda todo dia e
-- chama public.google_ads_ingest pelo PostgREST com a chave anon + uma chave própria (p_token). A função
-- confere o sha256 da chave em private.integracao_token e grava:
--   - google_ads_gasto_dia: campanha × dia (gasto, cliques, impressões, conversões do Google);
--   - google_ads_termo: o que as pessoas pesquisaram nos últimos 30 dias (fotografia, trocada a cada envio).
-- As tabelas não têm acesso direto; a tela lê agregado pelas RPCs do relatório.
set lock_timeout = '5s';

create schema if not exists private;
create table if not exists private.integracao_token (
  nome text primary key,
  sha256 text not null,
  criado_em timestamptz not null default now()
);
revoke all on private.integracao_token from public, anon, authenticated;

create table if not exists public.google_ads_gasto_dia (
  data date not null,
  campanha_id text not null,
  campanha text,
  status text,
  tipo text,
  orcamento_dia numeric(12,2),
  gasto numeric(12,2) not null default 0,
  impressoes integer not null default 0,
  cliques integer not null default 0,
  conversoes numeric(12,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (data, campanha_id)
);
alter table public.google_ads_gasto_dia enable row level security;
revoke all on public.google_ads_gasto_dia from anon, authenticated;

create table if not exists public.google_ads_termo (
  termo text not null,
  campanha text not null,
  cliques integer not null default 0,
  impressoes integer not null default 0,
  gasto numeric(12,2) not null default 0,
  conversoes numeric(12,2) not null default 0,
  de date,
  ate date,
  atualizado_em timestamptz not null default now(),
  primary key (termo, campanha)
);
alter table public.google_ads_termo enable row level security;
revoke all on public.google_ads_termo from anon, authenticated;

create or replace function public.google_ads_ingest(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'private', 'extensions'
as $$
declare
  v_dias int := 0;
  v_termos int := 0;
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

  return jsonb_build_object('ok', true, 'dias', v_dias, 'termos', v_termos);
end;
$$;
revoke all on function public.google_ads_ingest(text, jsonb) from public;
grant execute on function public.google_ads_ingest(text, jsonb) to anon, authenticated, service_role;
