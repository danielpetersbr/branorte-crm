-- Primeira versão da mapa_orcamentos_v2(). SUPERSEDIDA no mesmo dia por
-- 20260804103631_mapa_orcamentos_v2_precisao_normalizada.sql.
--
-- Motivo: a regra de 'estado' contava cidades distintas SEM normalizar acento,
-- então "Braço do Norte" e "Braco do Norte" (mesma cidade, 115 clientes) eram
-- lidas como duas — marcava 576 clientes como 'estado' quando o número real é 112.
--
-- Mantida no histórico porque foi aplicada em produção. Não reaplicar isolada:
-- a migration seguinte recria a função inteira com a regra correta.
do $do$
declare
  src text; head text; novo text; pos int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mapa_orcamentos';

  if src is null then raise exception 'mapa_orcamentos() não encontrada'; end if;

  pos := position('  select a.cliente,a.telefone,a.fone,a.numeros,a.cidade,a.uf,' in src);
  if pos = 0 then raise exception 'âncora do SELECT final não encontrada'; end if;

  head := left(src, pos - 1);
  head := replace(head, 'FUNCTION public.mapa_orcamentos()', 'FUNCTION public.mapa_orcamentos_v2()');
  head := replace(head, 'lng double precision)', 'lng double precision, cli_key text, precisao text)');

  novo := head || $tail$, fin as (
    select a.cli_key, a.cliente, a.telefone, a.fone, a.numeros, a.cidade, a.uf,
           case when a.vendido then coalesce(vs.sv, a.orc_latest) else a.orc_latest end as total,
           a.n_orcamentos, a.data_recente, a.vendedor, a.vendido,
           coalesce(v.c,0)::int n_vendas, a.lat, a.lng
    from agg a
    left join vnm v on v.nm = a.nmkey
    left join vsum vs on vs.cli_key = a.cli_key
    where a.lat is not null
  ),
  coord as (
    select lat, lng, count(distinct lower(coalesce(cidade,''))) nc
    from fin group by lat, lng
  )
  select f.cliente, f.telefone, f.fone, f.numeros, f.cidade, f.uf, f.total,
         f.n_orcamentos, f.data_recente, f.vendedor, f.vendido, f.n_vendas,
         coalesce(o.lat, f.lat), coalesce(o.lng, f.lng),
         f.cli_key,
         case when o.cli_key is not null then o.precisao
              when c.nc > 1                then 'estado'
              else                              'cidade'
         end
  from fin f
  join coord c on c.lat = f.lat and c.lng = f.lng
  left join public.cliente_localizacao o on o.cli_key = f.cli_key;
$function$
$tail$;

  execute novo;
end
$do$;
