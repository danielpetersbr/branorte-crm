-- Dashboard › Visão geral › "Atendimentos em aberto" (21/10/2026, auditoria pedida pelo Daniel: "se não tem nenhum furo"):
--   1. ORÇAMENTO ENVIADO entra como etapa (ficava de fora: 320 clientes e R$ 16 mi em proposta em 21/10, o dobro de follow up +
--      lead quente). Fica ENTRE novo lead e follow up: quem já tem FOLLOW UP ou LEAD QUENTE continua contado lá.
--   2. LEAD QUENTE aceita a etiqueta própria do Eder ("EDER - CLIENTE QUENTE"); ORÇAMENTO ENVIADO aceita "EDER - ORCAMENTO ENVIADO".
--   3. Número da CASA sai do total: contato com etiqueta BRANORTE (ou "EDER - BRANORTE") em QUALQUER conta, ou telefone de vendedor
--      (public.vendors). Antes só saía da conversa que tinha a etiqueta; o mesmo número aberto em outra conta contava como cliente.
-- Resto igual à 20261021120000 (dashboard_gasto_anuncios não muda).

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
        when we.etiqueta_nome_normalizado ~ '^(.+ - )?ORCAMENTOS? ENVIADOS?$' then 5
        when we.etiqueta_nome_normalizado ~ '^(FOLLOW ?UP|FALLOW UP)$' then 6
        when we.etiqueta_nome_normalizado ~ '^(.+ - )?(LEAD |CLIENTE )?QUENTE$' then 7
      end as etapa,
      public.etiqueta_categoria(we.etiqueta_nome_normalizado) in ('vendido', 'perdido', 'interno') as fecha,
      we.etiqueta_nome_normalizado ~ '^(.+ - )?BRANORTE$' as casa
    from public.wascript_etiquetas we
  ),
  lab as (
    select w.vendedor_nome, w.chat_id, coalesce(nullif(auditoria.wa_phone_strip9(w.phone), ''), w.chat_id) as cli, e.etapa, e.fecha, e.casa
    from public.wa_chat_labels w
    cross join lateral unnest(w.label_ids::int[]) lid(id)
    join etq e on e.vendedor_nome = w.vendedor_nome and e.id = lid.id
  ),
  -- número da casa: etiqueta BRANORTE em qualquer conta ou telefone de vendedor
  casa as (
    select cli from lab where casa
    union
    select auditoria.wa_phone_strip9(case when regexp_replace(vd.telefone, '\D', '', 'g') like '55%'
                                          then regexp_replace(vd.telefone, '\D', '', 'g')
                                          else '55' || regexp_replace(vd.telefone, '\D', '', 'g') end)
    from public.vendors vd where coalesce(vd.telefone, '') <> ''
  ),
  -- conversa = conta + contato, na etapa mais avançada que tem. Com etiqueta de fechamento junto (vendido, perdido, resolvido)
  -- não conta como aberta.
  chat as (
    select vendedor_nome, chat_id, cli, max(etapa) as etapa
    from lab
    where cli not in (select cli from casa where cli is not null)
    group by vendedor_nome, chat_id, cli
    having max(etapa) is not null and not bool_or(fecha)
  ),
  -- o mesmo contato em duas contas conta uma vez, na etapa mais avançada
  cli as (select cli, max(etapa) as etapa from chat group by cli),
  -- o orçamento mais novo de cada telefone (180 dias, sem rascunho): é a "projeção" do orçamento enviado, follow up e lead quente
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
      count(ch.chat_id) filter (where ch.etapa = 5)::int as orcamento_enviado,
      count(ch.chat_id) filter (where ch.etapa = 6)::int as follow_up,
      count(ch.chat_id) filter (where ch.etapa = 7)::int as lead_quente,
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
        'novo_lead', count(*) filter (where etapa = 4), 'orcamento_enviado', count(*) filter (where etapa = 5),
        'follow_up', count(*) filter (where etapa = 6), 'lead_quente', count(*) filter (where etapa = 7))
      from cli),
    'orcamento_enviado', (select jsonb_build_object('clientes', count(*), 'com_proposta', count(o.pm), 'brl', coalesce(round(sum(o.brl)), 0))
      from cli c left join orc o on o.pm = c.cli where c.etapa = 5),
    'follow_up', (select jsonb_build_object('clientes', count(*), 'com_proposta', count(o.pm), 'brl', coalesce(round(sum(o.brl)), 0))
      from cli c left join orc o on o.pm = c.cli where c.etapa = 6),
    'lead_quente', (select jsonb_build_object('clientes', count(*), 'com_proposta', count(o.pm), 'brl', coalesce(round(sum(o.brl)), 0))
      from cli c left join orc o on o.pm = c.cli where c.etapa = 7),
    'por_vendedor', coalesce((select jsonb_agg(to_jsonb(p) order by p.abertos desc, p.vendedor) from por_conta p), '[]'::jsonb),
    'atualizado_em', (select max(updated_at) from public.wa_chat_labels)
  ) into v;
  return v;
end
$fn$;

comment on function public.dashboard_atendimentos_abertos() is
  'Dashboard › Operação agora: conversas abertas (PROSPECÇÃO até LEAD QUENTE, com ORÇAMENTO ENVIADO) no total e por conta, sem número da casa, e orçamento enviado / follow up / lead quente com a proposta mais nova de cada cliente. Estado de agora (ignora o filtro do topo).';

revoke all on function public.dashboard_atendimentos_abertos() from public, anon;
grant execute on function public.dashboard_atendimentos_abertos() to authenticated, service_role;
