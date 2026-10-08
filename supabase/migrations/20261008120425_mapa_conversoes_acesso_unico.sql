-- A RPC de visitas precisa apenas das visitas, com acesso calculado uma vez.
create or replace function public.mapa_conversoes()
returns table(tipo text,chave text,vendido boolean,n_vendas integer,total numeric)
language sql stable security definer set search_path='' as $$
  with acesso as materialized (
    select auth.uid() as uid,public.papel_restrito() as restrito,
      public.papel_mapa() as mapa,public.ufs_visiveis() as ufs
  )
  select c.tipo,c.chave,c.vendido,c.n_vendas,c.total
  from public.mv_mapa_conversoes c cross join acesso a
  where c.tipo='visita' and a.uid is not null
    and (not a.restrito or (a.mapa and exists(
      select 1 from public.cliente_dados_visita v where v.id::text=c.chave and v.visitar is true)))
    and (a.ufs is null or c.uf=any(a.ufs))
$$;
