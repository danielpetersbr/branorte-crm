-- Relatório de marketing (20/10/2026): o que faltava para virar decisão de verba e de delegação.
set lock_timeout = '5s';

-- 1) Gasto do Meta no período, por código &NN do nome do anúncio. Linha 'sem_codigo' = verba que o
--    CRM não consegue seguir; 'total' traz a última data carregada (o gasto chega por carga manual).
drop function if exists public.dashboard_marketing_gasto(timestamptz, timestamptz);
create function public.dashboard_marketing_gasto(p_from timestamptz, p_to timestamptz)
returns table(tipo text, codigo text, gasto numeric, conversas int, leads_form int, anuncios int, carregado_ate date, campanhas text)
language sql stable security definer
set search_path to 'public'
as $$
with g as (
  select * from public.meta_gasto_anuncio_dia
  where data >= (p_from at time zone 'America/Sao_Paulo')::date
    and data <  (p_to   at time zone 'America/Sao_Paulo')::date
)
select 'codigo', codigo, round(sum(gasto), 2), sum(conversas)::int, sum(leads_form)::int, count(distinct ad_id)::int, null::date,
       string_agg(distinct campanha, ' | ')
from g where codigo is not null group by codigo
union all
select 'sem_codigo', null, round(sum(gasto), 2), sum(conversas)::int, sum(leads_form)::int, count(distinct ad_id)::int, null, null
from g where codigo is null
union all
select 'total', null, round(coalesce(sum(gasto), 0), 2), coalesce(sum(conversas), 0)::int, coalesce(sum(leads_form), 0)::int,
       count(distinct ad_id)::int, (select max(data) from public.meta_gasto_anuncio_dia), null
from g;
$$;
revoke all on function public.dashboard_marketing_gasto(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_gasto(timestamptz, timestamptz) to authenticated, service_role;

-- 2) Por vendedor que RECEBEU o contato (repasse da Ana/disparo): orçamentos, quantos sumiram e a
--    velocidade de resposta — minutos entre a 1ª mensagem do cliente depois da chegada e a resposta
--    seguinte no WhatsApp do vendedor (espelho wa_chat_messages). A 1ª mensagem do repasse sai
--    automática do WA do vendedor, então NÃO serve como "tempo de resposta"; por isso o relógio
--    começa quando o cliente escreve. Vendedor com mediana 0 de mensagens enviadas = espelho do
--    WhatsApp dele não chega ao banco (sinalizado na tela).
create or replace function public.dashboard_marketing_vendedores(p_from timestamptz, p_to timestamptz)
returns table(vendedor text, contatos int, rastreaveis int, com_orcamento int, sumiu int,
              cliente_escreveu int, respondidos int, mediana_resposta_min numeric, ate_1h int,
              sem_resposta_24h int, mediana_enviadas numeric)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with l as materialized (
  select a.data, a.dispatch_vendedor_nome vn,
    nullif(auditoria.wa_phone_strip9(a.telefone),'') pm,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
         then public.fone_canon(a.telefone_norm) end fc
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false) = false and a.data >= p_from and a.data < p_to
    and a.dispatch_vendedor_nome is not null
),
m as materialized (
  select w.vendedor_nome vn, nullif(auditoria.wa_phone_strip9(w.phone),'') pm, w.from_me, w.data_msg
  from public.wa_chat_messages w
  where w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '14 days'
    and w.chat_id not like '%@g.us' and w.tipo <> 'call_log'
    and w.vendedor_nome in (select distinct vn from l)
),
c as (
  select l.vn, l.pm, l.fc, l.data,
    min(m.data_msg) filter (where not m.from_me) cli,
    count(m.*) filter (where m.from_me) env
  from l left join m on m.vn = l.vn and m.pm = l.pm and m.data_msg >= l.data
  group by 1,2,3,4
),
r as (
  -- join + group em vez de subconsulta por linha (a subconsulta varria o CTE inteiro: 30 s)
  select c.vn, c.pm, c.fc, c.data, c.cli, c.env, min(m.data_msg) resp
  from c left join m on m.vn = c.vn and m.pm = c.pm and m.from_me and m.data_msg > c.cli
  group by 1,2,3,4,5,6
),
lab as materialized (
  select nullif(auditoria.wa_phone_strip9(w.phone),'') pm,
    bool_or(e.n in ('NUNCA RESPONDEU','NAO RESPONDEU MAIS')) sumiu
  from public.wa_chat_labels w
  join lateral (select we.etiqueta_nome_normalizado n
                from unnest(w.label_ids::int[]) lid(id)
                join public.wascript_etiquetas we
                  on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = w.vendedor_nome) e on true
  where nullif(auditoria.wa_phone_strip9(w.phone),'') in (select pm from l)
  group by 1
),
og as materialized (
  select public.fone_canon(o.cliente_dados->>'fone') fc, o.created_at
  from public.orcamentos_gerados o
  where not (coalesce(o.vendedor_nome,'') ilike '%daniel%')
    and public.fone_canon(o.cliente_dados->>'fone') in (select fc from l where fc is not null)
)
select r.vn,
  count(*)::int,
  count(*) filter (where r.fc is not null)::int,
  count(*) filter (where exists (select 1 from og where og.fc = r.fc and og.created_at >= r.data - interval '2 days'))::int,
  count(*) filter (where coalesce(lab.sumiu, false))::int,
  count(r.cli)::int,
  count(r.resp)::int,
  round((percentile_cont(0.5) within group (order by extract(epoch from r.resp - r.cli) / 60) filter (where r.resp is not null))::numeric),
  count(*) filter (where r.resp - r.cli <= interval '1 hour')::int,
  count(*) filter (where r.cli is not null and (r.resp is null or r.resp - r.cli > interval '24 hours'))::int,
  (percentile_cont(0.5) within group (order by r.env))::numeric
from r left join lab on lab.pm = r.pm
group by r.vn;
$$;
revoke all on function public.dashboard_marketing_vendedores(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_vendedores(timestamptz, timestamptz) to authenticated, service_role;
