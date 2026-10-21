-- /anuncios (21/10/2026, Daniel: "vai"): RECEITA por origem e retorno do anúncio.
-- O bloco "Vendas" do funil só conta venda de quem CHEGOU no período — e o contato leva em média 36 dias pra virar pedido,
-- então ele quase sempre mostrava 0. Esta função olha o outro lado: as VENDAS do período e de onde veio cada cliente,
-- chegando em qualquer data (até 365 dias antes da venda). Evidência, da mais forte pra mais fraca:
--   1. rastreado — o telefone do pedido chegou no CRM por anúncio (origem Meta ADS/LP/Google/Site), ou conversou com a
--      Ana a partir de um anúncio (ad_id), ou mandou o código do criativo (&NN) / a frase do site na 1ª mensagem ao vendedor;
--   2. declarado — a origem que o vendedor marcou no pedido (facebook/instagram → Meta; google/site → Google/Site);
--   3. carteira — já era cliente, representante, indicação, feira; senão "sem origem".
-- Em 90 dias até 21/10, só pelo CRM: 64% dos pedidos não achavam contato (telefone de outro número/sem cadastro).
set lock_timeout = '5s';
create or replace function public.anuncios_vendas_origem(p_from timestamptz, p_to timestamptz)
returns table(pedido text, data_venda date, vendedor text, cliente text, valor numeric, canal text, evidencia text,
              detalhe text, chegou_em date, dias_ate_venda int)
language plpgsql stable security definer
set search_path to 'public', 'auditoria'
set enable_nestloop to 'off'
as $$
begin
  return query execute $q$
  with pv as materialized (
    select distinct on (p.pedido_numero) p.pedido_numero, p.data_venda, p.vendedor, coalesce(p.raw->>'cliente', p.raw->>'fantasia') cliente,
      public.fone_canon(nullif(p.raw->>'telefone','')) fc,
      right(regexp_replace(coalesce(p.raw->>'telefone',''), '\D', '', 'g'), 8) f8,
      lower(coalesce(p.raw->>'fonte_origem','')) fo,
      (case when coalesce(nullif(p.payment_plan_json->>'total','')::numeric,0) > 0 then (p.payment_plan_json->>'total')::numeric
            else coalesce(p.valor_total,0) end) + coalesce(p.ajuste_valor,0) v
    from public.mirror_pedidos_venda p
    where coalesce(upper(p.status),'') <> 'CANCELADO' and lower(coalesce(p.raw->>'fonte_origem','')) <> 'garantia'
      and p.data_venda >= ($1 at time zone 'America/Sao_Paulo')::date and p.data_venda < ($2 at time zone 'America/Sao_Paulo')::date
  ),
  crm as materialized (
    -- chegada no CRM por canal pago (a mais antiga, até 365 dias antes da venda)
    select v.pedido_numero, a.data, a.origem, substring(a.criativo_codigo from '^&[0-9]+') cod
    from pv v join auditoria.atendimentos_por_cliente a
      on a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13 and public.fone_canon(a.telefone_norm) = v.fc
    where a.data::date <= v.data_venda and a.data::date > v.data_venda - 365
  ),
  ana as materialized (
    -- conversa com a Ana vinda de um anúncio (ad_id que a extensão guarda)
    select v.pedido_numero, x.ligado_em, x.ad_id
    from pv v
    join (select public.fone_canon(w.phone) fc, ia.ligado_em,
                 coalesce((ia.dados_coletados->>'_origem')::jsonb->>'ad_id',
                          substring((ia.dados_coletados->>'_origem')::jsonb->>'url' from '/([0-9]{15,})$')) ad_id
            from public.ia_atendimentos ia
            join lateral (select w.phone from public.wa_chat_messages w where w.vendedor_nome = 'ANA' and w.chat_id = ia.chat_id
                          and coalesce(w.phone,'') ~ '[0-9]{10}' limit 1) w on true
           where ia.vendedor_nome = 'ANA' and ia.dados_coletados ? '_origem' and ia.ligado_em > $1 - interval '400 days') x
      on x.fc = v.fc
    where x.ad_id is not null and x.ligado_em::date <= v.data_venda and x.ligado_em::date > v.data_venda - 365
  ),
  wa as materialized (
    -- 1ª fala do cliente ao vendedor com o código do criativo (&NN) ou a frase do site
    select v.pedido_numero, w.data_msg, substring(w.body from '&[0-9]{1,3}') cod,
           w.body ~* '(vim pelo site|achei voc[eê]s no google|pesquisando no google|no google \(patrocinado\))' site,
           w.body ~* 'no google \(patrocinado\)' gads
    from pv v join public.wa_chat_messages w
      on right(w.phone, 8) = v.f8 and public.fone_canon(w.phone) = v.fc
    where not w.from_me and w.data_msg::date <= v.data_venda and w.data_msg::date > v.data_venda - 365
      and (w.body ~ '&[0-9]{1,3}' or w.body ~* '(vim pelo site|achei voc[eê]s no google|pesquisando no google|no google \(patrocinado\))')
  ),
  ev as (
    select v.*,
      (select c.data from crm c where c.pedido_numero = v.pedido_numero and (c.origem in ('Meta ADS','META TESTE 1','Link') or c.origem ilike 'LP %') order by c.data limit 1) meta_crm,
      (select coalesce(c.cod, c.origem) from crm c where c.pedido_numero = v.pedido_numero and (c.origem in ('Meta ADS','META TESTE 1','Link') or c.origem ilike 'LP %') order by c.data limit 1) meta_crm_det,
      (select a.ligado_em from ana a where a.pedido_numero = v.pedido_numero order by a.ligado_em limit 1) meta_ana,
      (select a.ad_id from ana a where a.pedido_numero = v.pedido_numero order by a.ligado_em limit 1) meta_ana_ad,
      (select w.data_msg from wa w where w.pedido_numero = v.pedido_numero and w.cod is not null order by w.data_msg limit 1) meta_wa,
      (select w.cod from wa w where w.pedido_numero = v.pedido_numero and w.cod is not null order by w.data_msg limit 1) meta_wa_cod,
      (select c.data from crm c where c.pedido_numero = v.pedido_numero and (c.origem ilike 'google%' or c.origem = 'Site') order by c.data limit 1) site_crm,
      (select w.data_msg from wa w where w.pedido_numero = v.pedido_numero and w.site order by w.data_msg limit 1) site_wa,
      (select c.data from crm c where c.pedido_numero = v.pedido_numero order by c.data limit 1) crm_qualquer,
      (select c.origem from crm c where c.pedido_numero = v.pedido_numero order by c.data limit 1) crm_origem
    from pv v
  )
  select e.pedido_numero::text, e.data_venda, e.vendedor::text, e.cliente, round(e.v, 2),
    case
      when coalesce(e.meta_crm, e.meta_ana, e.meta_wa) is not null then 'Meta'
      when coalesce(e.site_crm, e.site_wa) is not null then 'Google / Site'
      when e.fo in ('facebook', 'instagram') then 'Meta'
      when e.fo in ('google', 'site') then 'Google / Site'
      when e.fo in ('ja_era_cliente', 'representante', 'indicacao', 'feira') then 'Carteira e indicação'
      else 'Sem origem' end,
    case
      when coalesce(e.meta_crm, e.meta_ana, e.meta_wa, e.site_crm, e.site_wa) is not null then 'rastreado'
      when e.fo in ('facebook', 'instagram', 'google', 'site') then 'declarado'
      when e.fo in ('ja_era_cliente', 'representante', 'indicacao', 'feira') then 'declarado'
      else 'sem' end,
    case
      when e.meta_ana is not null and (e.meta_crm is null or e.meta_ana <= e.meta_crm) then 'conversou com a Ana por anúncio' || coalesce(' (ad ' || e.meta_ana_ad || ')', '')
      when e.meta_crm is not null then 'chegou no CRM por ' || coalesce(e.meta_crm_det, 'Meta')
      when e.meta_wa is not null then 'mandou ' || e.meta_wa_cod || ' na 1ª mensagem ao vendedor'
      when e.site_crm is not null then 'chegou no CRM pelo site/Google'
      when e.site_wa is not null then 'mensagem do botão do site'
      when e.fo <> '' then 'vendedor marcou no pedido: ' || e.fo
      when e.crm_origem is not null then 'no CRM como ' || e.crm_origem
      else 'telefone do pedido sem contato no CRM' end,
    coalesce(e.meta_ana, e.meta_crm, e.meta_wa, e.site_crm, e.site_wa, e.crm_qualquer)::date,
    (e.data_venda - coalesce(e.meta_ana, e.meta_crm, e.meta_wa, e.site_crm, e.site_wa)::date)::int
  from ev e
  order by e.data_venda desc, e.pedido_numero
  $q$ using p_from, p_to;
end $$;
revoke all on function public.anuncios_vendas_origem(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_vendas_origem(timestamptz, timestamptz) to authenticated, service_role;
