SET lock_timeout = '5s';
-- Aba Marketing, "Qualidade por canal" (19/10/2026). Coorte por canal: leads que CHEGARAM em [p_from, p_to).
-- Réguas reutilizadas: fone_canon (proposta/venda), wa_phone_strip9 (etiqueta),
-- etiqueta_categoria + régua "qualificou" de dashboard_funil_union, exclusão do Daniel de dashboard_orcamentos_periodo,
-- valor de pedido de dashboard_orcvenda_por_* (payment_plan_json.total || valor_total, + ajuste).
create or replace function public.dashboard_canais(p_from timestamptz, p_to timestamptz)
returns table(
  canal text, leads int, leads_rastreaveis int, respondeu_ia int, qualificados int, qualif_ou_proposta int,
  com_proposta int, prop_por_100 numeric, prop_ic95_min numeric, prop_ic95_max numeric,
  compraram int, rs_proposto numeric, rs_proposto_por_lead numeric, mediana_proposta numeric,
  rs_vendido numeric, ticket_venda numeric, dias_ate_proposta numeric,
  nao_fabricamos int, lixo int, bovino int, suino int, aves int, peixe int,
  bovino_com_cabecas int, bovino_200_mais int, selo text)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with l as materialized (
  select a.data, a.origem, a.criativo_codigo, a.qual_animal, a.quantos_animais,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
         then public.fone_canon(a.telefone_norm) end as fc,                 -- estrangeiro/Messenger sem fone: sem canônico
    nullif(auditoria.wa_phone_strip9(a.telefone),'') as pm,
    (coalesce(btrim(a.motivo_contato),'')<>'' or coalesce(btrim(a.finalidade_fabrica),'')<>''
      or coalesce(btrim(a.qual_animal),'')<>'' or coalesce(btrim(a.quantos_animais),'')<>''
      or a.tocou_botao_em is not null) as engajou_ia,
    (case when coalesce(btrim(a.motivo_contato),'')='' then false
      when lower(a.motivo_contato) ~ 'fab|fáb' then coalesce(btrim(a.finalidade_fabrica),'')<>'' and coalesce(btrim(a.qual_animal),'')<>''
      when lower(a.motivo_contato) ~ 'equip' then lower(coalesce(a.o_que_precisa,'')) ~ '(aliment|balanc|brete|casquead|cacamb|caçamb|caixa|compact|fabric|fábric|descarga|elevador|caneca|sacaria|ensacad|helico|rosca|mistur|moega|moinho|martelo|passarela|peneira|limpeza|silo|big bag|bigbag|transporta|esteira)'
      else false end) as qualif_ia
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false)=false and a.data >= p_from and a.data < p_to
),
chat as materialized (   -- 1 linha por telefone que tem conversa no WhatsApp da casa (com ou sem etiqueta)
  select nullif(auditoria.wa_phone_strip9(w.phone),'') pm,
    bool_or(public.etiqueta_categoria(e.n) in ('lead_quente','orcamento','vendido')
            or e.n in ('FOLLOW UP','FOLLOWUP','FALLOW UP','AGENDAMENTO')) has_adv,
    bool_or(e.n = 'NAO FABRICAMOS') nf,
    bool_or(e.n in ('NAO FABRICAMOS','OUTROS ASSUNTOS','TRANSPORTADORAS','SUPORTE TECNICO')) lixo
  from public.wa_chat_labels w
  left join lateral (select we.etiqueta_nome_normalizado n
                     from unnest(w.label_ids::int[]) lid(id)
                     join public.wascript_etiquetas we
                       on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = w.vendedor_nome) e on true
  where nullif(auditoria.wa_phone_strip9(w.phone),'') in (select pm from l)
  group by 1
),
og as materialized (
  select public.fone_canon(o.cliente_dados->>'fone') fc, o.created_at, o.total_proposta,
         regexp_replace(o.numero,'\s','','g') num
  from public.orcamentos_gerados o
  where not (coalesce(o.vendedor_nome,'') ilike '%daniel%')
    and public.fone_canon(o.cliente_dados->>'fone') in (select fc from l where fc is not null)
),
pv as materialized (
  select distinct on (pedido_numero) regexp_replace(coalesce(numero_orcamento,''),'\s','','g') num, data_venda,
    (case when coalesce(nullif(payment_plan_json->>'total','')::numeric,0) > 0
          then (payment_plan_json->>'total')::numeric else coalesce(valor_total,0) end) + coalesce(ajuste_valor,0) v
  from public.mirror_pedidos_venda
  where coalesce(upper(status),'') <> 'CANCELADO'
),
x as (
  select l.*,
    case
      when l.origem in ('Meta ADS','META TESTE 1','Link')
        or (coalesce(btrim(l.origem),'')='' and l.criativo_codigo ~ '^&[0-9]+') then 'Meta ADS (WhatsApp)'
      when l.origem ilike '%formul%'   then 'Meta Formulário'
      when l.origem = 'Facebook'       then 'Facebook (Messenger)'
      when l.origem = 'Instagram'      then 'Instagram (Direct)'
      when l.origem = 'Bio Instagram'  then 'Bio Instagram'
      when l.origem ilike 'google%'    then 'Google'
      when l.origem ilike 'LP %'       then 'Landing pages'
      when l.origem ilike 'whatsapp %' then 'WhatsApp ANA'
      when coalesce(btrim(l.origem),'')='' and c.pm is not null then 'WhatsApp direto'
      else 'Não identificado' end as canal,
    coalesce(c.has_adv,false) has_adv, coalesce(c.nf,false) nf, coalesce(c.lixo,false) lixo,
    o1.primeira_prop, o1.valor_prop, coalesce(v1.n_ped,0) n_ped, v1.valor_venda,
    case when lower(coalesce(l.qual_animal,'')) ~ '(bovin|gado|boi|vaca|novilh|bezerr)' then 'bovino'
         when lower(coalesce(l.qual_animal,'')) ~ '(su[íi]n|porco)' then 'suino'
         when lower(coalesce(l.qual_animal,'')) ~ '(\mave|frango|galinha|codorn|poedeir)' then 'aves'
         when lower(coalesce(l.qual_animal,'')) ~ '(peixe|til[áa]pia)' then 'peixe'
         when coalesce(btrim(l.qual_animal),'')<>'' then 'outro'
         else 'nao_informou' end especie,
    case when btrim(coalesce(l.quantos_animais,'')) ~ '^[0-9]{1,7}$' then btrim(l.quantos_animais)::int end cab
  from l
  left join chat c on c.pm = l.pm
  left join lateral (   -- proposta montada a partir de 2 dias antes da chegada; valor = a última
    select min(o.created_at) primeira_prop,
           (array_agg(o.total_proposta order by o.created_at desc))[1] valor_prop
    from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days'
  ) o1 on true
  left join lateral (   -- pedido não cancelado que nasceu de uma dessas propostas
    select count(*) n_ped, sum(pv.v) valor_venda
    from pv
    where pv.num <> '' and pv.data_venda >= (l.data - interval '2 days')::date
      and pv.num in (select o.num from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days')
  ) v1 on true
),
agg as (
  select coalesce(canal,'TOTAL') canal,
    count(*)::int leads,
    count(*) filter (where fc is not null)::int rastreaveis,
    count(*) filter (where engajou_ia)::int resp,
    count(*) filter (where qualif_ia or has_adv)::int qualif,
    count(*) filter (where qualif_ia or has_adv or primeira_prop is not null)::int qualif_prop,
    count(*) filter (where primeira_prop is not null)::int prop,
    count(*) filter (where n_ped > 0)::int compr,
    coalesce(sum(valor_prop),0) rs_prop,
    percentile_cont(0.5) within group (order by valor_prop) filter (where valor_prop > 0) med_prop,
    coalesce(sum(valor_venda),0) rs_vend,
    percentile_cont(0.5) within group (order by greatest(extract(epoch from primeira_prop - data),0)/86400.0)
      filter (where primeira_prop is not null) dias,
    count(*) filter (where nf)::int nf, count(*) filter (where lixo)::int lixo,
    count(*) filter (where especie='bovino')::int bov, count(*) filter (where especie='suino')::int sui,
    count(*) filter (where especie='aves')::int aves, count(*) filter (where especie='peixe')::int peixe,
    count(*) filter (where especie='bovino' and cab is not null)::int bovcab,
    count(*) filter (where especie='bovino' and cab >= 200)::int bov200
  from x group by rollup(canal)
)
select canal, leads, rastreaveis, resp, qualif, qualif_prop, prop,
  round(100.0*prop/nullif(rastreaveis,0), 2) as prop100,
  -- Wilson 95% sobre a base RASTREÁVEL (fone BR): o canal sem telefone não é punido por ser cego
  case when rastreaveis > 0 then round((100*(( prop::float8/rastreaveis + 3.8416/(2*rastreaveis)
         - 1.96*sqrt((prop::float8/rastreaveis)*(1-prop::float8/rastreaveis)/rastreaveis + 3.8416/(4.0*rastreaveis*rastreaveis)))
         / (1+3.8416/rastreaveis)))::numeric, 1) end as ic_min,
  case when rastreaveis > 0 then round((100*(( prop::float8/rastreaveis + 3.8416/(2*rastreaveis)
         + 1.96*sqrt((prop::float8/rastreaveis)*(1-prop::float8/rastreaveis)/rastreaveis + 3.8416/(4.0*rastreaveis*rastreaveis)))
         / (1+3.8416/rastreaveis)))::numeric, 1) end as ic_max,
  -- R$ por lead na MESMA base do prop/100 (rastreáveis): proposta só liga por telefone.
  compr, round(rs_prop) as rs_prop, round(rs_prop/nullif(rastreaveis,0)) as rs_prop_lead, round(med_prop::numeric) as med_prop,
  round(rs_vend) as rs_vend, round(rs_vend/nullif(compr,0)) as ticket, round(dias::numeric,1) as dias,
  nf, lixo, bov, sui, aves, peixe, bovcab, bov200,
  case when rastreaveis::numeric/nullif(leads,0) < 0.5 then 'canal sem telefone (pouco rastreável)'
       when rastreaveis < 100 or prop < 5 then 'amostra pequena'
       else null end as selo
from agg
order by (canal='TOTAL'), leads desc;
$$;
revoke all on function public.dashboard_canais(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_canais(timestamptz, timestamptz) to authenticated, service_role;
