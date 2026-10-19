-- Aba Marketing (19/10/2026): "Orç · Venda real" por origem e por criativo.
-- Contava QUALQUER orçamento da vida do telefone (Meta: 23 em out/26, 21 válidos — 2 eram
-- orçamentos antigos de quem voltou como lead) e orçamento do DONO (a venda de R$ 744 do
-- "Não identificou" saiu de um orçamento do Daniel, que o resto do Dashboard exclui).
-- Agora é COORTE: orçamento montado a partir de 2 dias antes da chegada do lead, sem o dono;
-- venda só se o pedido nasceu de um desses orçamentos.
-- E as etiquetas por criativo/origem vinham cortadas em 15/12 linhas: o criativo cortado
-- aparecia com "0% não fabricamos" (o &50 tinha 14%).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dashboard_orcvenda_por_origem(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(origem text, orc integer, venda integer, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with leads as (
    select a.origem as origem,
           public.fone_canon(coalesce(a.telefone, a.telefone_norm)) as fc,
           min(a.created_at) as chegou
    from auditoria.atendimentos_por_cliente a
    where a.is_internal = false
      and a.origem is not null and a.origem <> ''
      and (p_from is null or a.created_at >= p_from)
      and (p_to   is null or a.created_at <= p_to)
    group by 1, 2
  ),
  og as (
    select public.fone_canon(cliente_dados->>'fone') as fc, created_at,
           regexp_replace(numero,'\s','','g') as num
    from public.orcamentos_gerados
    where public.fone_canon(cliente_dados->>'fone') is not null
      and not (coalesce(vendedor_nome,'') ilike '%daniel%')
  ),
  pv as (
    select distinct on (p.pedido_numero)
      regexp_replace(coalesce(p.numero_orcamento,''),'\s','','g') as num,
      ((case when coalesce(nullif(p.payment_plan_json->>'total','')::numeric,0)>0
             then (p.payment_plan_json->>'total')::numeric
             else coalesce(p.valor_total,0) end)+coalesce(p.ajuste_valor,0)) as v
    from public.mirror_pedidos_venda p
    where coalesce(upper(p.status),'')<>'CANCELADO'
  ),
  flags as (
    select l.origem, l.fc,
      exists (select 1 from og where og.fc = l.fc and og.created_at >= l.chegou - interval '2 days') as tem_orc,
      coalesce((select sum(pv.v) from pv
                where pv.num <> '' and pv.num in (select og.num from og
                                                   where og.fc = l.fc and og.created_at >= l.chegou - interval '2 days')), 0) as venda_valor
    from leads l where l.fc is not null
  )
  select origem,
    count(*) filter (where tem_orc)::int,
    count(*) filter (where venda_valor > 0)::int,
    coalesce(sum(venda_valor) filter (where venda_valor > 0), 0)::numeric
  from flags
  group by origem;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_orcvenda_por_criativo(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(criativo text, orc integer, venda integer, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with leads as (
    select a.criativo_codigo as criativo,
           public.fone_canon(coalesce(a.telefone, a.telefone_norm)) as fc,
           min(a.created_at) as chegou
    from auditoria.atendimentos_por_cliente a
    where a.is_internal = false
      and a.criativo_codigo is not null and a.criativo_codigo <> ''
      and (p_from is null or a.created_at >= p_from)
      and (p_to   is null or a.created_at <= p_to)
    group by 1, 2
  ),
  og as (
    select public.fone_canon(cliente_dados->>'fone') as fc, created_at,
           regexp_replace(numero,'\s','','g') as num
    from public.orcamentos_gerados
    where public.fone_canon(cliente_dados->>'fone') is not null
      and not (coalesce(vendedor_nome,'') ilike '%daniel%')
  ),
  pv as (
    select distinct on (p.pedido_numero)
      regexp_replace(coalesce(p.numero_orcamento,''),'\s','','g') as num,
      ((case when coalesce(nullif(p.payment_plan_json->>'total','')::numeric,0)>0
             then (p.payment_plan_json->>'total')::numeric
             else coalesce(p.valor_total,0) end)+coalesce(p.ajuste_valor,0)) as v
    from public.mirror_pedidos_venda p
    where coalesce(upper(p.status),'')<>'CANCELADO'
  ),
  flags as (
    select l.criativo, l.fc,
      exists (select 1 from og where og.fc = l.fc and og.created_at >= l.chegou - interval '2 days') as tem_orc,
      coalesce((select sum(pv.v) from pv
                where pv.num <> '' and pv.num in (select og.num from og
                                                   where og.fc = l.fc and og.created_at >= l.chegou - interval '2 days')), 0) as venda_valor
    from leads l where l.fc is not null
  )
  select criativo,
    count(*) filter (where tem_orc)::int,
    count(*) filter (where venda_valor > 0)::int,
    coalesce(sum(venda_valor) filter (where venda_valor > 0), 0)::numeric
  from flags
  group by criativo;
$function$;

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_etiquetas_extras'::regproc);
  a text := E'        ORDER BY total DESC\n        LIMIT 12';
  b text := E'        ORDER BY total DESC\n        LIMIT 200';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'dashboard_etiquetas_extras mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_etiquetas_resumo'::regproc);
  a text := E'         ORDER BY total DESC\n         LIMIT 15';
  b text := E'         ORDER BY total DESC\n         LIMIT 200';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'dashboard_etiquetas_resumo mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;
