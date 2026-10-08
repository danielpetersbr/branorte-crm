create or replace function private.mapa_numero(p text) returns text
language sql immutable set search_path='' as $$
  select case when m is not null then m[1] || '-' || coalesce(nullif(ltrim(m[2],'0'),''),'0') end
  from (select regexp_match(p,'(20[0-9]{2})\s*[-–—/.]\s*([0-9]{1,5})') as m) x
$$;
create or replace function private.mapa_nome(p text) returns text
language sql immutable set search_path='' as $$
  select upper(btrim(regexp_replace(public.unaccent(coalesce(p,'')),'\s+',' ','g')))
$$;
create or replace function private.mapa_fones(p text) returns text[]
language sql stable set search_path='' as $$
  select coalesce(array_agg(distinct fc),'{}'::text[])
  from public.fones_canon_do_campo(p) x(fc)
  -- Um identificador @lid ou um número longo colado não é telefone.
  where p not like '%@%' and (length(regexp_replace(coalesce(p,''),'\D','','g'))<=13
    or p ~ '[;/|]|\s[eE]\s')
$$;
revoke all on function private.mapa_numero(text), private.mapa_nome(text), private.mapa_fones(text) from public, anon, authenticated;
