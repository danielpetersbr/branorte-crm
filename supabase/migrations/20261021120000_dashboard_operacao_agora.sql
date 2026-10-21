-- Dashboard › Visão geral, painel "Operação agora" (21/10/2026, pedido do Daniel):
--   1. atendimentos em aberto: conversa com etiqueta de PROSPECÇÃO até LEAD QUENTE (prospecção, 2ª e 3ª tentativa, novo lead,
--      follow up, lead quente), no total (contato distinto) e por conta do WhatsApp;
--   2. follow up e lead quente: quantos clientes e quanto têm em proposta (o orçamento mais novo de cada um);
--   3. gasto de anúncio no período do filtro, Meta e Google.
-- As ligações do painel saem de ligacoes_resumo (SECURITY INVOKER, a RLS de wa_ligacoes vale).
--
-- As duas funções são SECURITY DEFINER como as outras do Dashboard (as tabelas de gasto não têm policy de leitura), e por isso
-- devolvem NULL para papel externo (mapa, consultor, representante): definer passa por cima da RESTRICTIVE bloqueia_papel_restrito.

create or replace function public.dashboard_atendimentos_abertos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auditoria
as $fn$
declare v jsonb;
begin
  if public.papel_restrito() then return null; end if;
  with etq as (
    select we.vendedor_nome, we.etiqueta_id_wascript as id,
      case
        when we.etiqueta_nome_normalizado ~ '^PROSPECC(AO|OES)$' then 1
        when we.etiqueta_nome_normalizado ~ '^2\s*[AO°]?\s*TENTATIVA$' then 2
        when we.etiqueta_nome_normalizado ~ '^3\s*[AO°]?\s*TENTATIVA$' then 3
        when we.etiqueta_nome_normalizado ~ '^(NOVOS? LEADS?|LEAD NOVO)$' then 4
        when we.etiqueta_nome_normalizado ~ '^(FOLLOW ?UP|FALLOW UP)$' then 5
        when we.etiqueta_nome_normalizado ~ '^(LEAD QUENTE|QUENTE)$' then 6
      end as etapa,
      public.etiqueta_categoria(we.etiqueta_nome_normalizado) in ('vendido', 'perdido', 'interno') as fecha
    from public.wascript_etiquetas we
  ),
  lab as (
    select w.vendedor_nome, w.chat_id, coalesce(nullif(auditoria.wa_phone_strip9(w.phone), ''), w.chat_id) as cli, e.etapa, e.fecha
    from public.wa_chat_labels w
    cross join lateral unnest(w.label_ids::int[]) lid(id)
    join etq e on e.vendedor_nome = w.vendedor_nome and e.id = lid.id
  ),
  -- conversa = conta + contato, na etapa mais avançada que tem. Com etiqueta de fechamento junto (vendido, perdido, resolvido)
  -- não conta como aberta.
  chat as (
    select vendedor_nome, chat_id, cli, max(etapa) as etapa
    from lab
    group by vendedor_nome, chat_id, cli
    having max(etapa) is not null and not bool_or(fecha)
  ),
  -- o mesmo contato em duas contas conta uma vez, na etapa mais avançada
  cli as (select cli, max(etapa) as etapa from chat group by cli),
  -- o orçamento mais novo de cada telefone (180 dias, sem rascunho): é a "projeção" do follow up e do lead quente
  orc as (
    select distinct on (pm) pm, brl
    from (
      select auditoria.wa_phone_strip9(
               case when regexp_replace(coalesce(o.cliente_dados->>'fone', ''), '\D', '', 'g') like '55%'
                    then regexp_replace(o.cliente_dados->>'fone', '\D', '', 'g')
                    else '55' || regexp_replace(coalesce(o.cliente_dados->>'fone', ''), '\D', '', 'g') end) as pm,
             coalesce(o.total_proposta, 0)::numeric as brl, o.created_at
      from public.orcamentos_gerados o
      where o.created_at > now() - interval '180 days'
        and coalesce(o.status, '') <> 'rascunho'
        and coalesce(o.total_proposta, 0) > 0
    ) x
    where length(coalesce(pm, '')) >= 12
    order by pm, created_at desc
  ),
  contas as (select distinct vendedor_nome from public.wascript_etiquetas union select vendedor_nome from chat),
  -- conta sem leitura do WhatsApp (sem sinal em 24 h, ou vendo menos de 20 conversas) não pode aparecer como "0 em aberto".
  -- Vale a MELHOR das últimas 60 leituras da conta: a mesma conta pode ter duas cópias da extensão, e uma cópia que vê 0 conversas
  -- (caso DANIEL 21/10, cópia 1.70.52 a cada 10 s) não apaga a que vê todas. 60 linhas pelo índice (vendedor_nome, recebido_em).
  leitura as (
    select c.vendedor_nome, r.total_chats, r.recebido_em
    from contas c
    left join lateral (
      select max(s.total_chats) as total_chats, max(s.recebido_em) as recebido_em
      from (select d.total_chats, d.recebido_em from public.wa_sync_debug d
            where d.vendedor_nome = c.vendedor_nome order by d.recebido_em desc limit 60) s
    ) r on true
  ),
  por_conta as (
    select c.vendedor_nome as vendedor,
      count(ch.chat_id)::int as abertos,
      count(ch.chat_id) filter (where ch.etapa = 1)::int as prospeccao,
      count(ch.chat_id) filter (where ch.etapa = 2)::int as t2,
      count(ch.chat_id) filter (where ch.etapa = 3)::int as t3,
      count(ch.chat_id) filter (where ch.etapa = 4)::int as novo_lead,
      count(ch.chat_id) filter (where ch.etapa = 5)::int as follow_up,
      count(ch.chat_id) filter (where ch.etapa = 6)::int as lead_quente,
      coalesce(max(l.total_chats), 0)::int as conversas_lidas,
      coalesce(bool_or(l.recebido_em > now() - interval '24 hours' and coalesce(l.total_chats, 0) >= 20), false) as leitura_ok
    from contas c
    left join chat ch on ch.vendedor_nome = c.vendedor_nome
    left join leitura l on l.vendedor_nome = c.vendedor_nome
    group by c.vendedor_nome
  )
  select jsonb_build_object(
    'contatos', (select count(*) from cli),
    'por_etapa', (select jsonb_build_object(
        'prospeccao', count(*) filter (where etapa = 1), 't2', count(*) filter (where etapa = 2), 't3', count(*) filter (where etapa = 3),
        'novo_lead', count(*) filter (where etapa = 4), 'follow_up', count(*) filter (where etapa = 5), 'lead_quente', count(*) filter (where etapa = 6))
      from cli),
    'follow_up', (select jsonb_build_object('clientes', count(*), 'com_proposta', count(o.pm), 'brl', coalesce(round(sum(o.brl)), 0))
      from cli c left join orc o on o.pm = c.cli where c.etapa = 5),
    'lead_quente', (select jsonb_build_object('clientes', count(*), 'com_proposta', count(o.pm), 'brl', coalesce(round(sum(o.brl)), 0))
      from cli c left join orc o on o.pm = c.cli where c.etapa = 6),
    'por_vendedor', coalesce((select jsonb_agg(to_jsonb(p) order by p.abertos desc, p.vendedor) from por_conta p), '[]'::jsonb),
    'atualizado_em', (select max(updated_at) from public.wa_chat_labels)
  ) into v;
  return v;
end
$fn$;

comment on function public.dashboard_atendimentos_abertos() is
  'Dashboard › Operação agora: conversas abertas (PROSPECÇÃO até LEAD QUENTE) no total e por conta, e follow up / lead quente com a proposta mais nova de cada cliente. Estado de agora (ignora o filtro do topo).';

create or replace function public.dashboard_gasto_anuncios(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare de date; ate date; v jsonb;
begin
  if public.papel_restrito() then return null; end if;
  -- datas do Brasil; p_to é exclusivo (como nas outras RPCs do Dashboard)
  de := case when p_from is null then null else (p_from at time zone 'America/Sao_Paulo')::date end;
  ate := case when p_to is null then null else (p_to at time zone 'America/Sao_Paulo')::date end;
  select jsonb_build_object(
    'meta', (select coalesce(round(sum(g.gasto), 2), 0) from public.meta_gasto_anuncio_dia g
             where (de is null or g.data >= de) and (ate is null or g.data < ate)),
    'google', (select coalesce(round(sum(g.gasto), 2), 0) from public.google_ads_gasto_dia g
               where (de is null or g.data >= de) and (ate is null or g.data < ate)),
    'meta_atualizado_em', (select max(atualizado_em) from public.meta_gasto_anuncio_dia),
    'google_atualizado_em', (select max(atualizado_em) from public.google_ads_gasto_dia)
  ) into v;
  return v;
end
$fn$;

comment on function public.dashboard_gasto_anuncios(timestamptz, timestamptz) is
  'Dashboard › Operação agora: gasto de anúncio do Meta (meta_gasto_anuncio_dia) e do Google (google_ads_gasto_dia) no período, com a hora da última carga de cada um.';

revoke all on function public.dashboard_atendimentos_abertos() from public, anon;
revoke all on function public.dashboard_gasto_anuncios(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_atendimentos_abertos() to authenticated, service_role;
grant execute on function public.dashboard_gasto_anuncios(timestamptz, timestamptz) to authenticated, service_role;
