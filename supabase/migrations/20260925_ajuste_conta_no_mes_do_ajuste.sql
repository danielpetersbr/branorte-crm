-- Ajuste de pedido (acréscimo/redução lançado depois da venda) conta no mês de
-- `ajuste_data`, não no mês da venda — regra do Daniel (25/09/2026, caso
-- PV-2026-2444: vendido em agosto, cliente acrescentou equipamento em setembro).
--
-- O controle.branorte.com (Dashboard, Controle de Vendas, Corrida, Metas) e os hooks
-- do CRM (useVendasReais, useControleDashboard) já faziam assim; estas RPCs somavam o
-- ajuste junto da venda. Medido no dia: 4 pedidos com ajuste em mês diferente da venda
-- (PV-2107 fev→mar 12.375; PV-2242 e PV-2210 abr→jun 9.000; PV-2414 ago→set −1.179,10).
-- Total do ano não muda — o valor só troca de mês.
--
-- NÃO mudam (e está certo): vendas_por_telefone_canon (soma o pedido inteiro, sem
-- período) e dashboard_orcvenda_por_criativo/_por_origem (o período filtra a chegada do
-- LEAD; a venda entra inteira, é safra de lead e não receita do mês).

-- ─── 1. Agregado do período ─────────────────────────────────────────────────
create or replace function public.dashboard_vendas_periodo(p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(qtd integer, valor numeric, qtd_lead integer, valor_lead numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with at as (
    select distinct public.fone_canon(coalesce(telefone, telefone_norm)) as fc
    from auditoria.atendimentos_por_cliente
    where is_internal = false
  ),
  orc_lead as (  -- nº de orçamento (sem espaços) cujo telefone é um lead do atendimento
    select distinct regexp_replace(o.numero, '\s', '', 'g') as num
    from public.orcamentos_gerados o
    join at on at.fc = public.fone_canon(o.cliente_dados->>'fone')
    where public.fone_canon(o.cliente_dados->>'fone') is not null
  ),
  base as (
    select
      regexp_replace(coalesce(numero_orcamento, ''), '\s', '', 'g') as num,
      (case when coalesce(nullif(payment_plan_json->>'total','')::numeric, 0) > 0
            then (payment_plan_json->>'total')::numeric
            else coalesce(valor_total, 0) end) as venda,
      coalesce(ajuste_valor, 0) as ajuste,
      data_venda,
      coalesce(ajuste_data, data_venda) as dia_ajuste  -- sem data, o ajuste vai com a venda
    from public.mirror_pedidos_venda
    where coalesce(upper(status), '') <> 'CANCELADO'
      and data_venda is not null
  ),
  pv as (
    select num,
      (p_from is null or data_venda >= (p_from at time zone 'America/Sao_Paulo')::date)
        and (p_to is null or data_venda <= (p_to at time zone 'America/Sao_Paulo')::date) as venda_no_periodo,
      (p_from is null or dia_ajuste >= (p_from at time zone 'America/Sao_Paulo')::date)
        and (p_to is null or dia_ajuste <= (p_to at time zone 'America/Sao_Paulo')::date) as ajuste_no_periodo,
      venda, ajuste
    from base
  ),
  v as (
    select num, venda_no_periodo,
      (case when venda_no_periodo then venda else 0 end)
        + (case when ajuste_no_periodo then ajuste else 0 end) as v
    from pv
    where venda_no_periodo or ajuste_no_periodo
  )
  select
    count(*) filter (where venda_no_periodo)::int,           -- só ajuste não é venda nova
    coalesce(sum(v.v), 0)::numeric,
    count(*) filter (where venda_no_periodo and num <> '' and num in (select num from orc_lead))::int,
    coalesce(sum(v.v) filter (where num <> '' and num in (select num from orc_lead)), 0)::numeric
  from v;
$function$;

-- ─── 2. Linhas por trás do KPI (drill-down) ────────────────────────────────
-- Ganha `so_ajuste`: pedido vendido FORA do período cujo ajuste caiu DENTRO. A soma
-- das linhas continua batendo com o agregado; a contagem de vendas exclui essas.
-- Mudar o tipo de retorno exige DROP — e o DROP leva os grants junto.
drop function if exists public.dashboard_vendas_periodo_detalhe(timestamp with time zone, timestamp with time zone);

create function public.dashboard_vendas_periodo_detalhe(p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(numero text, pedido text, cliente text, vendedor text, valor numeric, data_venda date, cidade text, estado text, is_lead boolean, origem text, criativo text, so_ajuste boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with at as (
    select distinct public.fone_canon(coalesce(telefone, telefone_norm)) as fc
    from auditoria.atendimentos_por_cliente
    where is_internal = false
  ),
  orc_lead as (  -- idêntico ao agregado: preserva is_lead
    select distinct regexp_replace(o.numero, '\s', '', 'g') as num
    from public.orcamentos_gerados o
    join at on at.fc = public.fone_canon(o.cliente_dados->>'fone')
    where public.fone_canon(o.cliente_dados->>'fone') is not null
  ),
  num2fc as (  -- nº orçamento -> telefone (mais recente) só p/ atribuir origem/criativo
    select distinct on (regexp_replace(o.numero, '\s', '', 'g'))
      regexp_replace(o.numero, '\s', '', 'g') as num,
      public.fone_canon(o.cliente_dados->>'fone') as fc
    from public.orcamentos_gerados o
    where public.fone_canon(o.cliente_dados->>'fone') is not null
    order by regexp_replace(o.numero, '\s', '', 'g'), o.created_at desc
  ),
  lead_src as (  -- 1 origem/criativo por telefone (prefere quem tem criativo, mais recente)
    select distinct on (public.fone_canon(coalesce(a.telefone, a.telefone_norm)))
      public.fone_canon(coalesce(a.telefone, a.telefone_norm)) as fc,
      a.origem, a.criativo_codigo
    from auditoria.atendimentos_por_cliente a
    where a.is_internal = false
      and public.fone_canon(coalesce(a.telefone, a.telefone_norm)) is not null
    order by public.fone_canon(coalesce(a.telefone, a.telefone_norm)),
             (a.criativo_codigo is not null and a.criativo_codigo <> '') desc,
             (a.origem is not null and a.origem <> '') desc,
             a.created_at desc
  ),
  base as (
    select
      regexp_replace(coalesce(mp.numero_orcamento,''), '\s', '', 'g') as num,
      mp.pedido_numero, mp.cliente, mp.vendedor, mp.vendedor_2, mp.cidade, mp.estado, mp.data_venda,
      coalesce(mp.ajuste_data, mp.data_venda) as dia_ajuste,
      (case when coalesce(nullif(mp.payment_plan_json->>'total','')::numeric,0) > 0
            then (mp.payment_plan_json->>'total')::numeric
            else coalesce(mp.valor_total,0) end) as venda,
      coalesce(mp.ajuste_valor,0) as ajuste
    from public.mirror_pedidos_venda mp
    where coalesce(upper(mp.status),'') <> 'CANCELADO'
      and mp.data_venda is not null
  ),
  p as (
    select b.*,
      (p_from is null or b.data_venda >= (p_from at time zone 'America/Sao_Paulo')::date)
        and (p_to is null or b.data_venda <= (p_to at time zone 'America/Sao_Paulo')::date) as venda_no_periodo,
      (p_from is null or b.dia_ajuste >= (p_from at time zone 'America/Sao_Paulo')::date)
        and (p_to is null or b.dia_ajuste <= (p_to at time zone 'America/Sao_Paulo')::date) as ajuste_no_periodo
    from base b
  )
  select
    p.num as numero, p.pedido_numero as pedido, p.cliente,
    coalesce(nullif(p.vendedor,''), p.vendedor_2) as vendedor,
    ((case when p.venda_no_periodo then p.venda else 0 end)
      + (case when p.ajuste_no_periodo then p.ajuste else 0 end)) as valor,
    -- linha só de ajuste mostra o dia em que ele contou
    (case when p.venda_no_periodo then p.data_venda else p.dia_ajuste end) as data_venda,
    p.cidade, p.estado,
    (p.num <> '' and p.num in (select num from orc_lead)) as is_lead,
    ls.origem, ls.criativo_codigo as criativo,
    not p.venda_no_periodo as so_ajuste
  from p
  left join num2fc nf on p.num <> '' and nf.num = p.num
  left join lead_src ls on ls.fc = nf.fc
  where p.venda_no_periodo or (p.ajuste_no_periodo and p.ajuste <> 0)
  order by 5 desc;
$function$;

revoke all on function public.dashboard_vendas_periodo_detalhe(timestamp with time zone, timestamp with time zone) from public, anon;
grant execute on function public.dashboard_vendas_periodo_detalhe(timestamp with time zone, timestamp with time zone) to authenticated, service_role;

-- ─── 3. metas_semanais: só o bloco `venda` (R$ do mês por vendedor) ──────────
-- A função tem 8,7 mil caracteres; trocar só o CTE por substituição exata evita
-- reescrever (e errar) o resto. Aborta se o trecho não casar.
-- Junto: exclui CANCELADO (critério oficial das outras RPCs; medido 0 afetados hoje).
do $mig$
declare
  d text := pg_get_functiondef('public.metas_semanais(date,date)'::regprocedure);
  antigo text := $old$venda as (
  select upper(split_part(btrim(vendedor),' ',1)) as vendedor_nome,
         count(*) as vendas,
         sum(valor_total + coalesce(ajuste_valor,0))::numeric(14,2) as rs
  from public.mirror_pedidos_venda
  where data_venda >= m_ini and data_venda <= d_fim
    and (valor_total + coalesce(ajuste_valor,0)) > 0
  group by 1
),$old$;
  novo text := $new$venda as (
  -- venda no mês de data_venda; ajuste (acréscimo/redução) no mês de ajuste_data (25/09/2026)
  select upper(split_part(btrim(vendedor),' ',1)) as vendedor_nome,
         count(*) filter (where venda_no_mes and (base + ajuste) > 0) as vendas,
         sum((case when venda_no_mes then base else 0 end)
             + (case when ajuste_no_mes then ajuste else 0 end))::numeric(14,2) as rs
  from (
    select vendedor,
           coalesce(valor_total,0) as base,
           coalesce(ajuste_valor,0) as ajuste,
           (data_venda >= m_ini and data_venda <= d_fim) as venda_no_mes,
           (coalesce(ajuste_data, data_venda) >= m_ini and coalesce(ajuste_data, data_venda) <= d_fim) as ajuste_no_mes
    from public.mirror_pedidos_venda
    where data_venda is not null
      and coalesce(upper(status),'') <> 'CANCELADO'
  ) pv
  where venda_no_mes or ajuste_no_mes
  group by 1
),$new$;
begin
  if position(novo in d) > 0 then
    raise notice 'metas_semanais já estava com o ajuste por ajuste_data';
    return;
  end if;
  if position(antigo in d) = 0 then
    raise exception 'metas_semanais: bloco venda não casou — a função mudou, revisar à mão';
  end if;
  execute replace(d, antigo, novo);
end
$mig$;
