-- Carga do gasto do Meta pelo SERVIDOR (edge meta-gasto-sync + pg_cron), sem o Chrome (22/10/2026, pedido do Daniel).
-- Token: secret META_ADS_TOKEN da edge (usuário do sistema "CRM Branorte", ads_read). Mesmas regras do loader do PC
-- (Branorte/backend/meta_gasto): um dia por pedido, cada dia conferido com o gasto da CONTA (2% / R$ 2), e a gravação
-- nunca troca gasto/impressões > 0 por zero.
set lock_timeout = '5s';

create table if not exists private.meta_gasto_carga_log (
  id bigserial primary key,
  em timestamptz not null default now(),
  origem text,
  desde date,
  ate date,
  linhas int,
  gasto numeric,
  campanhas int,
  anuncios int,
  pulados text,
  erro text
);

-- a edge confere quem chama com a mesma senha do cofre que o pg_cron já usa (alerta_entregar_bearer)
create or replace function public.meta_gasto_chave_ok(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(p, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'alerta_entregar_bearer' and decrypted_secret = p)
$fn$;
revoke all on function public.meta_gasto_chave_ok(text) from public, anon, authenticated;
grant execute on function public.meta_gasto_chave_ok(text) to service_role;

-- p = {linhas:[...], campanhas:[...], anuncios:[...], info:{origem, desde, ate, pulados, erro}}
create or replace function public.meta_gasto_gravar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare n_l int := 0; n_c int := 0; n_a int := 0; g numeric := 0;
begin
  if jsonb_typeof(p -> 'linhas') = 'array' and jsonb_array_length(p -> 'linhas') > 0 then
    insert into public.meta_gasto_anuncio_dia
      (data, ad_id, anuncio, conjunto, campanha, campanha_id, objetivo, gasto, impressoes, cliques, conversas, leads_form, acoes, atualizado_em)
    select distinct on (r.data, r.ad_id) r.data, r.ad_id, r.anuncio, r.conjunto, r.campanha, r.campanha_id, r.objetivo, r.gasto, r.impressoes,
           r.cliques, r.conversas, r.leads_form, r.acoes, now()
    from jsonb_to_recordset(p -> 'linhas') as r(data date, ad_id text, anuncio text, conjunto text, campanha text, campanha_id text,
         objetivo text, gasto numeric, impressoes int, cliques int, conversas int, leads_form int, acoes jsonb)
    on conflict (data, ad_id) do update set
      anuncio = excluded.anuncio, conjunto = excluded.conjunto, campanha = excluded.campanha, objetivo = excluded.objetivo,
      campanha_id = excluded.campanha_id, acoes = excluded.acoes,
      -- nunca troca gasto/impressões positivos por zero (resposta incompleta do Meta)
      gasto = case when excluded.gasto = 0 and excluded.impressoes = 0 then meta_gasto_anuncio_dia.gasto else excluded.gasto end,
      impressoes = case when excluded.gasto = 0 and excluded.impressoes = 0 then meta_gasto_anuncio_dia.impressoes else excluded.impressoes end,
      cliques = excluded.cliques, conversas = excluded.conversas, leads_form = excluded.leads_form, atualizado_em = now();
    get diagnostics n_l = row_count;
    select coalesce(sum((x ->> 'gasto')::numeric), 0) into g from jsonb_array_elements(p -> 'linhas') x;
  end if;

  if jsonb_typeof(p -> 'campanhas') = 'array' and jsonb_array_length(p -> 'campanhas') > 0 then
    insert into public.meta_campanha (campanha_id, nome, objetivo, status, orcamento_dia, atualizado_em)
    select distinct on (r.campanha_id) r.campanha_id, r.nome, r.objetivo, r.status, r.orcamento_dia, now()
    from jsonb_to_recordset(p -> 'campanhas') as r(campanha_id text, nome text, objetivo text, status text, orcamento_dia numeric)
    on conflict (campanha_id) do update set nome = excluded.nome, objetivo = excluded.objetivo, status = excluded.status,
      orcamento_dia = excluded.orcamento_dia, atualizado_em = now();
    get diagnostics n_c = row_count;
  end if;

  if jsonb_typeof(p -> 'anuncios') = 'array' and jsonb_array_length(p -> 'anuncios') > 0 then
    insert into public.meta_anuncio (ad_id, nome, status, conjunto_id, conjunto, conjunto_status, conjunto_orcamento_dia, campanha_id,
                                     thumb_url, post_id, tipo_criativo, atualizado_em)
    select distinct on (r.ad_id) r.ad_id, r.nome, r.status, r.conjunto_id, r.conjunto, r.conjunto_status, r.conjunto_orcamento_dia, r.campanha_id,
           r.thumb_url, r.post_id, r.tipo_criativo, now()
    from jsonb_to_recordset(p -> 'anuncios') as r(ad_id text, nome text, status text, conjunto_id text, conjunto text, conjunto_status text,
         conjunto_orcamento_dia numeric, campanha_id text, thumb_url text, post_id text, tipo_criativo text)
    on conflict (ad_id) do update set nome = excluded.nome, status = excluded.status, conjunto_id = excluded.conjunto_id,
      conjunto = excluded.conjunto, conjunto_status = excluded.conjunto_status, conjunto_orcamento_dia = excluded.conjunto_orcamento_dia,
      campanha_id = excluded.campanha_id, thumb_url = coalesce(excluded.thumb_url, meta_anuncio.thumb_url),
      post_id = coalesce(excluded.post_id, meta_anuncio.post_id), tipo_criativo = coalesce(excluded.tipo_criativo, meta_anuncio.tipo_criativo),
      atualizado_em = now();
    get diagnostics n_a = row_count;
  end if;

  insert into private.meta_gasto_carga_log (origem, desde, ate, linhas, gasto, campanhas, anuncios, pulados, erro)
  values (p #>> '{info,origem}', (p #>> '{info,desde}')::date, (p #>> '{info,ate}')::date, n_l, g, n_c, n_a,
          nullif(p #>> '{info,pulados}', ''), nullif(p #>> '{info,erro}', ''));
  return jsonb_build_object('linhas', n_l, 'gasto', g, 'campanhas', n_c, 'anuncios', n_a);
end
$fn$;
revoke all on function public.meta_gasto_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.meta_gasto_gravar(jsonb) to service_role;

-- Agendamento (jobs 101 e 102, já criados em 22/10): de hora em hora das 06h às 23h de Brasília (09–02 UTC), hoje + 2 dias
-- antes; às 03h10 de Brasília, os últimos 10 dias (o Meta ajusta o gasto de dias anteriores).
-- Desfazer: select cron.unschedule('meta-gasto-hora'); select cron.unschedule('meta-gasto-10d');
select cron.schedule('meta-gasto-hora', '7 0-2,9-23 * * *', $c$
select net.http_post(
  url := 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/meta-gasto-sync?dias=3',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_entregar_bearer')),
  body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);
select cron.schedule('meta-gasto-10d', '10 6 * * *', $c$
select net.http_post(
  url := 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/meta-gasto-sync?dias=10',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_entregar_bearer')),
  body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);
