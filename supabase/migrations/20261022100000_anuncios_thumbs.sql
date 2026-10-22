-- Imagem do criativo de cada anúncio do Meta (22/10/2026, Daniel: "quero ver o criativo também").
-- A carga do Meta (meta-gasto-branorte.mjs, 3×/dia) grava em meta_anuncio a capa do criativo (600 px) e a publicação.
-- A URL do Facebook expira em alguns dias: a carga renova a dos anúncios com gasto nos últimos 10 dias.
set lock_timeout = '5s';
alter table public.meta_anuncio add column if not exists thumb_url text, add column if not exists post_id text, add column if not exists tipo_criativo text;
create or replace function public.anuncios_thumbs()
returns table(ad_id text, thumb_url text, post_id text, tipo_criativo text)
language sql stable security definer
set search_path to 'public'
as $$
  select a.ad_id, a.thumb_url, a.post_id, a.tipo_criativo from public.meta_anuncio a where a.thumb_url is not null or a.post_id is not null;
$$;
revoke all on function public.anuncios_thumbs() from public, anon;
grant execute on function public.anuncios_thumbs() to authenticated, service_role;
