-- O mapa visual recorta somente ORÇADOS. Vendidos, conversões, visitas e a
-- RPC do mapa completo continuam com todo o histórico e as portas atuais.
create function public.mapa_visual_orcados()
returns table (
  cliente text, telefone text, fone text, numeros text, cidade text, uf text,
  total numeric, n_orcamentos integer, data_recente date, vendedor text,
  vendido boolean, n_vendas integer, lat double precision, lng double precision,
  cli_key text, precisao text, vendedor_fonte text, equipamento text
)
language sql stable security invoker set search_path=''
as $function$
  select p.* from public.mapa_orcamentos_v2() p
  where p.vendido is false and p.n_vendas=0
    and p.data_recente >= (
      (current_timestamp at time zone 'America/Sao_Paulo')::date - interval '24 months'
    )::date
    and p.data_recente <= (current_timestamp at time zone 'America/Sao_Paulo')::date
$function$;

revoke all on function public.mapa_visual_orcados() from public,anon;
grant execute on function public.mapa_visual_orcados() to authenticated,service_role;

-- Mesma fonte materializada e guardas de UID, UF, aprovação e coordenadas.
-- A idade entra apenas na contagem de orçados; vendido antigo/sem data fica.
create or replace function private.mapa_visual_contagem_pontos()
returns table(vendidos integer,orcados integer)
language sql stable security definer set search_path=''
as $function$
with vis as materialized (
  select public.ufs_visiveis() ufs,auth.uid() uid,current_setting('role',true) caller_role,
    not exists(select 1 from public.user_profiles p
      where p.id=auth.uid() and p.role='mapa_visual' and p.approved_at is null) visual_liberado
),
convertidos as materialized (
  select c.chave,c.vendido,c.n_vendas
  from public.mv_mapa_conversoes c where c.tipo='cliente'
)
select count(*) filter(where vendido)::integer vendidos,
  count(*) filter(where not vendido
    and data_recente >= (
      (current_timestamp at time zone 'America/Sao_Paulo')::date - interval '24 months'
    )::date
    and data_recente <= (current_timestamp at time zone 'America/Sao_Paulo')::date
  )::integer orcados
from (
  select coalesce(c.vendido,f.vendido,false) or coalesce(c.n_vendas,f.n_vendas,0)>0 vendido,
    f.data_recente
  from public.mv_mapa_orcamentos f
  left join convertidos c on c.chave=f.cli_key
  left join public.cliente_localizacao l on l.cli_key=f.cli_key
  cross join vis
  where (vis.uid is not null or vis.caller_role='service_role')
    and vis.visual_liberado
    and (vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs))
    and coalesce(l.lat,f.lat) between -90 and 90
    and coalesce(l.lng,f.lng) between -180 and 180
) pontos
$function$;

notify pgrst, 'reload schema';
