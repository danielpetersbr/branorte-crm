-- Sufixo corporativo deve ser uma palavra, sem confundir ROSA ou GUILHERME.
set local enable_nestloop=off;
set local jit=off;
do $fix$
declare d text;
begin
  d:=pg_get_viewdef('public.mv_mapa_conversoes'::regclass,true);
  d:=replace(d,'''(LTDA|S/?A[.]?|EIRELI|EPP|ME)$''','''[[:space:]](LTDA|S/?A[.]?|EIRELI|EPP|ME)$''');
  drop materialized view public.mv_mapa_conversoes;
  execute 'create materialized view public.mv_mapa_conversoes as '||d;
  create unique index mv_mapa_conversoes_key on public.mv_mapa_conversoes(tipo,chave);
  revoke all on public.mv_mapa_conversoes from public,anon,authenticated;
end $fix$;
