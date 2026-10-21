-- Dashboard › Evolução diária (21/10/2026, auditoria pedida pelo Daniel): a série "Qualificados pela IA" do gráfico ainda usava a régua
-- antiga do robô (isQualificadoBranorte, no front), e a ajuda dizia que era a mesma do funil — em 21/10 o gráfico mostrava 20 e o funil 41.
-- Esta função dá, por dia de Brasília, a MESMA conta da etapa Qualificou de dashboard_funil_union: lead que chegou no dia (primeira_data)
-- e que a Ana passou pro vendedor como qualificado, ou que qualificava pelo robô, ou com etiqueta de avanço (LEAD QUENTE, FOLLOW UP,
-- AGENDAMENTO, ORÇAMENTO, VENDIDO). Somando os dias do período dá o número do funil.

create or replace function public.dashboard_qualificados_por_dia(p_from timestamptz, p_to timestamptz)
returns table(dia date, entrou int, qualificou int)
language sql
stable
security definer
set search_path = auditoria, public
as $fn$
  with leads as (
    select (apc.primeira_data at time zone 'America/Sao_Paulo')::date as dia,
      nullif(auditoria.wa_phone_strip9(apc.telefone), '') as pm,
      (case
        when apc.motivo_contato is null or btrim(apc.motivo_contato) = '' then false
        when lower(apc.motivo_contato) ~ 'fab|fáb' then (coalesce(btrim(apc.finalidade_fabrica), '') <> '' and coalesce(btrim(apc.qual_animal), '') <> '')
        when lower(apc.motivo_contato) ~ 'equip' then (lower(coalesce(apc.o_que_precisa, '')) ~ '(aliment|balanc|brete|casquead|cacamb|caçamb|caixa|compact|fabric|fábric|descarga|elevador|caneca|sacaria|ensacad|helico|rosca|mistur|moega|moinho|martelo|passarela|peneira|limpeza|silo|big bag|bigbag|transporta|esteira)')
        else false end) as qualif_bot
    from auditoria.atendimentos_por_cliente apc
    where coalesce(apc.is_internal, false) = false
      and (p_from is null or apc.primeira_data >= p_from)
      and (p_to is null or apc.primeira_data < p_to)
      and not public.papel_restrito()
  ),
  ana as (
    select distinct auditoria.wa_phone_strip9(case when o.cliente_telefone_norm like '55%' then o.cliente_telefone_norm
                                                   else '55' || o.cliente_telefone_norm end) as pm
    from public.outbound_dispatch o
    where o.raw_payload ? 'chat_ana' and coalesce(o.raw_payload->>'ana_qualificado', 'true') <> 'false'
      and coalesce(o.cliente_telefone_norm, '') <> ''
  ),
  etq as (
    select nullif(auditoria.wa_phone_strip9(wcl.phone), '') as pm,
      bool_or(public.etiqueta_categoria(we.etiqueta_nome_normalizado) in ('lead_quente', 'orcamento', 'vendido')
              or we.etiqueta_nome_normalizado in ('FOLLOW UP', 'FOLLOWUP', 'FALLOW UP', 'AGENDAMENTO')) as has_adv
    from public.wa_chat_labels wcl
    cross join lateral unnest(wcl.label_ids::int[]) lid(id)
    join public.wascript_etiquetas we on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = wcl.vendedor_nome
    where nullif(auditoria.wa_phone_strip9(wcl.phone), '') in (select pm from leads where pm is not null)
    group by 1
  )
  select l.dia, count(*)::int,
         count(*) filter (where l.qualif_bot or a.pm is not null or coalesce(e.has_adv, false))::int
  from leads l
  left join etq e on e.pm = l.pm
  left join ana a on a.pm = l.pm
  group by l.dia
  order by l.dia
$fn$;

comment on function public.dashboard_qualificados_por_dia(timestamptz, timestamptz) is
  'Dashboard › Evolução diária: leads que chegaram e qualificados por dia de Brasília, com a régua da etapa Qualificou de dashboard_funil_union.';
revoke all on function public.dashboard_qualificados_por_dia(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_qualificados_por_dia(timestamptz, timestamptz) to authenticated, service_role;
