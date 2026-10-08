-- Uma leitura estreita dos status substitui os milhares de lookups por cli_key.
-- Corpo capturado do helper live: UID/UF, coordenadas e fallbacks permanecem iguais.
-- OR REPLACE mantém owner/ACLs; não altera bases, cron ou configurações do planner.
CREATE OR REPLACE FUNCTION private.mapa_visual_contagem_pontos()
 RETURNS TABLE(vendidos integer, orcados integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with vis as materialized(select public.ufs_visiveis() ufs,auth.uid() uid,current_setting('role',true) caller_role),
convertidos as materialized (
  select c.chave,c.vendido,c.n_vendas
  from public.mv_mapa_conversoes c where c.tipo='cliente'
)
select count(*) filter(where vendido)::integer vendidos,count(*) filter(where not vendido)::integer orcados
from (
select coalesce(c.vendido,f.vendido,false) or coalesce(c.n_vendas,f.n_vendas,0)>0 vendido
from public.mv_mapa_orcamentos f
left join convertidos c on c.chave=f.cli_key
left join public.cliente_localizacao l on l.cli_key=f.cli_key
cross join vis
where (vis.uid is not null or vis.caller_role='service_role')
and (vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs))
and coalesce(l.lat,f.lat) between -90 and 90
and coalesce(l.lng,f.lng) between -180 and 180
) pontos
$function$;

notify pgrst, 'reload schema';
