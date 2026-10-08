-- PostgreSQL exige recriar a função para acrescentar uma coluna ao retorno.
-- Mesmo endpoint, campos anteriores na mesma ordem e mesmas permissões.
drop function public.mapa_visitas_clientes();
create function public.mapa_visitas_clientes()
returns table(id uuid,telefone text,nome text,cidade text,estado text,interesse text,visitar boolean,
  vendedor_nome text,etiquetas text[],valor_negociando numeric,lat double precision,lng double precision,
  created_at timestamptz,vendido boolean,n_vendas integer,visita_obrigatoria boolean)
language sql stable security invoker set search_path='' as $$
  select v.id,v.telefone,v.nome,v.cidade,v.estado,v.interesse,v.visitar,v.vendedor_nome,
    v.etiquetas,v.valor_negociando,v.lat,v.lng,v.created_at,coalesce(c.vendido,false),coalesce(c.n_vendas,0),
    v.visita_obrigatoria
  from public.cliente_dados_visita v left join public.mapa_conversoes() c on c.tipo='visita' and c.chave=v.id::text
  order by v.created_at desc
$$;
revoke all on function public.mapa_visitas_clientes() from public,anon;
grant execute on function public.mapa_visitas_clientes() to authenticated,service_role;

notify pgrst, 'reload schema';
