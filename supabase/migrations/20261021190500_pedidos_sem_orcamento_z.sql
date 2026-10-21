-- Card "Para corrigir" da /anuncios (21/10/2026): o PV-2026-2536 (Plaszom, 2026-2867) aparecia como "orçamento que não
-- existe", mas o orçamento existe — feito à mão no Word e salvo na pasta Z: (índice public.orcamentos_files), só não
-- passou pelo gerador (orcamentos_gerados). Agora o pedido só entra no card se o número não existir em NENHUM dos dois,
-- e não entra a venda sem orçamento de propósito (campo = o próprio número do pedido). 90 dias: 22 → 1 (PV-2026-2403).
set lock_timeout = '5s';
create or replace function public.anuncios_pedidos_sem_orcamento(p_from timestamptz, p_to timestamptz)
returns table(pedido text, numero_orcamento text, vendedor text, data_venda date, valor numeric)
language sql stable security definer
set search_path to 'public'
as $$
  select distinct on (p.pedido_numero) p.pedido_numero::text, p.numero_orcamento::text, p.vendedor::text, p.data_venda,
    round((case when coalesce(nullif(p.payment_plan_json->>'total','')::numeric,0) > 0 then (p.payment_plan_json->>'total')::numeric
                else coalesce(p.valor_total,0) end) + coalesce(p.ajuste_valor,0))
  from public.mirror_pedidos_venda p
  where coalesce(upper(p.status),'') <> 'CANCELADO' and lower(coalesce(p.raw->>'fonte_origem','')) <> 'garantia'
    and p.data_venda >= (p_from at time zone 'America/Sao_Paulo')::date and p.data_venda < (p_to at time zone 'America/Sao_Paulo')::date
    and coalesce(btrim(p.numero_orcamento),'') <> ''
    -- venda sem orçamento de propósito (peça avulsa): o vendedor repete o número do pedido no campo — não é erro
    and regexp_replace(p.numero_orcamento,'\s','','g') <> regexp_replace(p.pedido_numero,'\s','','g')
    and regexp_replace(p.numero_orcamento,'\s','','g') not in (select regexp_replace(o.numero,'\s','','g') from public.orcamentos_gerados o)
    -- orçamento feito à mão (Word) na pasta Z: também vale
    and not exists (
      select 1 from public.orcamentos_files f
      where f.arquivo_removido_em is null
        and ltrim(f.numero, '0') = ltrim(split_part(regexp_replace(p.numero_orcamento,'\s','','g'), '-', 2), '0')
        and f.ano::text = split_part(regexp_replace(p.numero_orcamento,'\s','','g'), '-', 1))
  order by p.pedido_numero;
$$;
revoke all on function public.anuncios_pedidos_sem_orcamento(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_pedidos_sem_orcamento(timestamptz, timestamptz) to authenticated, service_role;
