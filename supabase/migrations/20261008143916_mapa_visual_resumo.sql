-- Resumo estreito: não percorre vendedor WhatsApp nem devolve os detalhes dos pinos.
-- A MV continua privada. USAGE de private para authenticated/service_role já existe.
create function private.mapa_visual_contagem_pontos()
returns table(vendidos integer,orcados integer)
language sql stable security definer set search_path=''
as $function$
with vis as materialized(select public.ufs_visiveis() ufs,auth.uid() uid,current_setting('role',true) caller_role)
select count(*) filter(where vendido)::integer vendidos,count(*) filter(where not vendido)::integer orcados
from (
select coalesce(c.vendido,f.vendido,false) or coalesce(c.n_vendas,f.n_vendas,0)>0 vendido
from public.mv_mapa_orcamentos f
left join public.mv_mapa_conversoes c on c.tipo='cliente' and c.chave=f.cli_key
left join public.cliente_localizacao l on l.cli_key=f.cli_key
cross join vis
where (vis.uid is not null or vis.caller_role='service_role')
and (vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs))
and coalesce(l.lat,f.lat) between -90 and 90
and coalesce(l.lng,f.lng) between -180 and 180
) pontos
$function$;

-- Invoker é necessário para preservar a RLS da tabela de visitas na RPC existente.
create function public.mapa_visual_resumo()
returns table(vendidos integer,orcados integer,visitas integer,
  visitas_no_mapa integer,visitas_sem_localizacao integer)
language sql stable security invoker set search_path=''
as $function$
  with pendentes as materialized (
    select coalesce(v.lat between -90 and 90 and v.lng between -180 and 180,false) as localizado
    from public.mapa_visitas_clientes() v
    where v.visitar is true and not coalesce(v.vendido,false) and coalesce(v.n_vendas,0)=0
  )
  select p.vendidos,p.orcados,v.total,v.no_mapa,v.sem_localizacao
  from private.mapa_visual_contagem_pontos() p cross join (
    select count(*)::integer as total,
      count(*) filter(where localizado)::integer as no_mapa,
      count(*) filter(where not localizado)::integer as sem_localizacao
    from pendentes
  ) v
$function$;

revoke all on function private.mapa_visual_contagem_pontos() from public,anon;
grant execute on function private.mapa_visual_contagem_pontos() to authenticated,service_role;
revoke all on function public.mapa_visual_resumo() from public,anon;
grant execute on function public.mapa_visual_resumo() to authenticated,service_role;

notify pgrst, 'reload schema';
