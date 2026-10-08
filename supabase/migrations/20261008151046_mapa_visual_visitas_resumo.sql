-- Status por IDs, com as mesmas portas de public.mapa_conversoes().
create function private.mapa_visual_conversoes_visitas(p_ids text[])
returns table(chave text,vendido boolean,n_vendas integer)
language sql stable security definer set search_path=''
as $function$
  with acesso as materialized (
    select auth.uid() as uid,public.papel_restrito() as restrito,
      public.papel_mapa() as mapa,public.ufs_visiveis() as ufs
  )
  select c.chave,c.vendido,c.n_vendas
  from public.mv_mapa_conversoes c cross join acesso a
  where c.tipo='visita' and c.chave=any(p_ids) and a.uid is not null
    and (not a.restrito or (a.mapa and exists(
      select 1 from public.cliente_dados_visita v where v.id::text=c.chave and v.visitar is true)))
    and (a.ufs is null or c.uf=any(a.ufs))
$function$;

-- Materializar a leitura invoker garante que apenas IDs marcados e visíveis
-- pela RLS são enviados ao auxiliar. A RPC antiga permanece intacta.
create function public.mapa_visual_visitas()
returns table(id uuid,telefone text,nome text,cidade text,estado text,interesse text,
  visitar boolean,vendedor_nome text,etiquetas text[],valor_negociando numeric,
  lat double precision,lng double precision,created_at timestamptz,
  vendido boolean,n_vendas integer,visita_obrigatoria boolean)
language sql stable security invoker set search_path=''
as $function$
  with candidatos as materialized (
    select v.id,v.telefone,v.nome,v.cidade,v.estado,v.interesse,v.visitar,
      v.vendedor_nome,v.etiquetas,v.valor_negociando,v.lat,v.lng,v.created_at,v.visita_obrigatoria
    from public.cliente_dados_visita v where v.visitar is true
  )
  select v.id,v.telefone,v.nome,v.cidade,v.estado,v.interesse,v.visitar,v.vendedor_nome,
    v.etiquetas,v.valor_negociando,v.lat,v.lng,v.created_at,coalesce(c.vendido,false),
    coalesce(c.n_vendas,0),v.visita_obrigatoria
  from candidatos v left join private.mapa_visual_conversoes_visitas(
    (select coalesce(array_agg(id::text),array[]::text[]) from candidatos)
  ) c on c.chave=v.id::text
  order by v.created_at desc
$function$;

create or replace function public.mapa_visual_resumo()
returns table(vendidos integer,orcados integer,visitas integer,
  visitas_no_mapa integer,visitas_sem_localizacao integer)
language sql stable security invoker set search_path=''
as $function$
  with pendentes as materialized (
    select coalesce(v.lat between -90 and 90 and v.lng between -180 and 180,false) as localizado
    from public.mapa_visual_visitas() v
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

revoke all on function private.mapa_visual_conversoes_visitas(text[]) from public,anon;
grant execute on function private.mapa_visual_conversoes_visitas(text[]) to authenticated,service_role;
revoke all on function public.mapa_visual_visitas() from public,anon;
grant execute on function public.mapa_visual_visitas() to authenticated,service_role;

notify pgrst, 'reload schema';
