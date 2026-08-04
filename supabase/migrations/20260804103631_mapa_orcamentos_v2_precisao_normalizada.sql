-- mapa_orcamentos_v2() = corpo IDÊNTICO ao de mapa_orcamentos(), com 2 colunas novas no fim:
--   cli_key   — identidade estável do cliente (já era calculada internamente, nunca exposta)
--   precisao  — 'endereco' | 'confirmada' | 'manual' | 'cidade' | 'estado'
--
-- O corpo NÃO é redigitado: é lido de pg_get_functiondef() e só a cauda é substituída.
-- Assim as regex escapadas do original ficam intactas e a v2 não pode divergir da v1.
--
-- Regra de precisão (verificada em 2026-08-04 sobre 2.340 clientes):
--   • override em cliente_localizacao  -> usa a precisão de lá e SOBREPÕE lat/lng
--   • coordenada serve a cidades de fato distintas -> 'estado' (112 clientes, 17 coords;
--     ex. (-18.1,-44.38) junta 16 municípios de MG no mesmo pixel)
--   • caso contrário -> 'cidade' (2.228 clientes)
-- Normaliza com unaccent + só alfanumérico e trata nome-prefixo como mesma família,
-- senão "Braço do Norte" vs "Braco do Norte" (mesma cidade) viraria 'estado'.
--
-- NOTA: mapa_orcamentos() (v1) fica intacta. Nada em produção muda até o front migrar.
do $do$
declare
  src text; head text; novo text; pos int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mapa_orcamentos';

  if src is null then raise exception 'mapa_orcamentos() não encontrada'; end if;

  pos := position('  select a.cliente,a.telefone,a.fone,a.numeros,a.cidade,a.uf,' in src);
  if pos = 0 then raise exception 'âncora não encontrada — corpo de mapa_orcamentos() mudou'; end if;

  head := left(src, pos - 1);
  head := replace(head, 'FUNCTION public.mapa_orcamentos()', 'FUNCTION public.mapa_orcamentos_v2()');
  head := replace(head, 'lng double precision)', 'lng double precision, cli_key text, precisao text)');

  novo := head || $tail$, fin as (
    select a.cli_key, a.cliente, a.telefone, a.fone, a.numeros, a.cidade, a.uf,
           case when a.vendido then coalesce(vs.sv, a.orc_latest) else a.orc_latest end as total,
           a.n_orcamentos, a.data_recente, a.vendedor, a.vendido,
           coalesce(v.c,0)::int n_vendas, a.lat, a.lng,
           upper(trim(regexp_replace(regexp_replace(
             unaccent(coalesce(a.cidade,'')), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))) as cidade_nm
    from agg a
    left join vnm v on v.nm = a.nmkey
    left join vsum vs on vs.cli_key = a.cli_key
    where a.lat is not null
  ),
  coord as (
    select lat, lng, min(cidade_nm) base, array_agg(distinct cidade_nm) nms
    from fin group by lat, lng
  ),
  coord_cls as (
    select lat, lng,
           (array_length(nms,1) > 1
            and not (select bool_and(x like base || '%') from unnest(nms) x)) as multi_cidade
    from coord
  )
  select f.cliente, f.telefone, f.fone, f.numeros, f.cidade, f.uf, f.total,
         f.n_orcamentos, f.data_recente, f.vendedor, f.vendido, f.n_vendas,
         coalesce(o.lat, f.lat), coalesce(o.lng, f.lng),
         f.cli_key,
         case when o.cli_key is not null then o.precisao
              when c.multi_cidade         then 'estado'
              else                             'cidade'
         end
  from fin f
  join coord_cls c on c.lat = f.lat and c.lng = f.lng
  left join public.cliente_localizacao o on o.cli_key = f.cli_key;
$function$
$tail$;

  execute novo;
end
$do$;
