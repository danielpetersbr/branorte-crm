-- O launcher visual precisa carregar toda a carteira sem timeout. O lateral
-- anterior era inlineado: ufs_visiveis() se repetia no filtro de cada cliente.
-- Materializar uma única linha mantém o mesmo escopo, colunas e classificação.
create or replace function public.mapa_orcamentos_v2()
returns table (
  cliente text, telefone text, fone text, numeros text, cidade text, uf text,
  total numeric, n_orcamentos integer, data_recente date, vendedor text,
  vendido boolean, n_vendas integer, lat double precision, lng double precision,
  cli_key text, precisao text, vendedor_fonte text
)
language sql stable security definer set search_path='public' as $$
  with vis as materialized (select public.ufs_visiveis() as ufs)
  select f.cliente, f.telefone, f.fone, f.numeros, f.cidade, f.uf,
         coalesce(c.total,f.total) as total, f.n_orcamentos, f.data_recente,
         coalesce(f.vendedor,w.vend_wa) as vendedor,
         coalesce(c.vendido,f.vendido) as vendido,
         coalesce(c.n_vendas,f.n_vendas) as n_vendas,
         coalesce(o.lat,f.lat), coalesce(o.lng,f.lng), f.cli_key,
         case when o.cli_key is not null then o.precisao else f.precisao_base end,
         case when f.vendedor is not null then 'orcamento'
              when w.vend_wa is not null then 'whatsapp' end as vendedor_fonte
  from public.mv_mapa_orcamentos f
  left join public.mv_mapa_conversoes c on c.tipo='cliente' and c.chave=f.cli_key
  cross join vis
  left join public.cliente_localizacao o on o.cli_key=f.cli_key
  left join lateral (
    select l.vendedor_nome as vend_wa
    from public.wa_chat_labels l
    where f.vendedor is null
      and public.fone_canon(l.phone) in (public.fone_canon(f.telefone),public.fone_canon(f.fone))
    order by (upper(btrim(l.vendedor_nome)) <> 'DANIEL') desc,
             (coalesce(array_length(l.label_ids,1),0) > 0) desc,
             l.last_message_at desc nulls last
    limit 1
  ) w on true
  where vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs)
$$;
