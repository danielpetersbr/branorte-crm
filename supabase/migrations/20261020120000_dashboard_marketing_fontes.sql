-- Relatório de marketing (20/10/2026): numa passada só, por CANAL e por CRIATIVO (&NN), a coorte de
-- leads que chegou na janela — qualidade, proposta, venda e por que o atendimento fechou.
-- Mesmas réguas de dashboard_canais: proposta = orçamento a partir de 2 dias antes da chegada (sem o
-- dono); venda = pedido nascido dessas propostas; qualificado = IA OU etiqueta de avanço.
-- Motivo de fechamento = etiqueta de perda em qualquer WhatsApp da casa (um por lead, o mais específico).
-- Concorrente = COMPROU DO/NA CONCORR*. "Assunto nada a ver" = NÃO FABRICAMOS + OUTROS ASSUNTOS + TRANSPORTADORAS + SUPORTE TÉCNICO.
set lock_timeout = '5s';
create or replace function public.dashboard_marketing_fontes(p_from timestamptz, p_to timestamptz)
returns table(
  tipo text, chave text, nome text,
  leads int, leads_rastreaveis int, qualificados int, com_proposta int,
  prop_por_100 numeric, prop_ic95_min numeric, prop_ic95_max numeric, rs_proposto numeric,
  compraram int, rs_vendido numeric,
  fechados int, nunca_respondeu int, nao_respondeu_mais int, sem_interesse int, preco int, concorrente int, nada_a_ver int,
  bovino_200_mais int)
language sql stable security definer
set search_path to 'public', 'auditoria'
as $$
with l as materialized (
  select a.data, a.origem, substring(a.criativo_codigo from '^&[0-9]+') as cod, a.qual_animal, a.quantos_animais,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
         then public.fone_canon(a.telefone_norm) end as fc,
    nullif(auditoria.wa_phone_strip9(a.telefone),'') as pm,
    (case when coalesce(btrim(a.motivo_contato),'')='' then false
      when lower(a.motivo_contato) ~ 'fab|fáb' then coalesce(btrim(a.finalidade_fabrica),'')<>'' and coalesce(btrim(a.qual_animal),'')<>''
      when lower(a.motivo_contato) ~ 'equip' then lower(coalesce(a.o_que_precisa,'')) ~ '(aliment|balanc|brete|casquead|cacamb|caçamb|caixa|compact|fabric|fábric|descarga|elevador|caneca|sacaria|ensacad|helico|rosca|mistur|moega|moinho|martelo|passarela|peneira|limpeza|silo|big bag|bigbag|transporta|esteira)'
      else false end) as qualif_ia
  from auditoria.atendimentos_por_cliente a
  where coalesce(a.is_internal,false)=false and a.data >= p_from and a.data < p_to
),
chat as materialized (
  select nullif(auditoria.wa_phone_strip9(w.phone),'') pm,
    bool_or(public.etiqueta_categoria(e.n) in ('lead_quente','orcamento','vendido')
            or e.n in ('FOLLOW UP','FOLLOWUP','FALLOW UP','AGENDAMENTO')) has_adv,
    bool_or(public.etiqueta_categoria(e.n) = 'perdido') fechado,
    bool_or(e.n = 'NUNCA RESPONDEU') nunca,
    bool_or(e.n = 'NAO RESPONDEU MAIS') sumiu,
    bool_or(e.n = 'NAO TEM INTERESSE') sem_int,
    bool_or(e.n in ('SO BASE DE PRECO','BASE DE PRECO','FORA DO ORCAMENTO')) preco,
    bool_or(e.n like 'COMPROU %') conc,
    bool_or(e.n in ('NAO FABRICAMOS','OUTROS ASSUNTOS','TRANSPORTADORAS','SUPORTE TECNICO')) nada
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
  select l.fc, l.cod,
    case
      when l.origem in ('Meta ADS','META TESTE 1','Link') or (coalesce(btrim(l.origem),'')='' and l.cod is not null) then 'Meta ADS (WhatsApp)'
      when l.origem ilike '%formul%'   then 'Meta Formulário'
      when l.origem = 'Facebook'       then 'Facebook (Messenger)'
      when l.origem = 'Instagram'      then 'Instagram (Direct)'
      when l.origem = 'Bio Instagram'  then 'Bio Instagram'
      when l.origem ilike 'google%'    then 'Google'
      when l.origem ilike 'LP %'       then 'Landing pages'
      when l.origem ilike 'whatsapp %' then 'WhatsApp ANA'
      when coalesce(btrim(l.origem),'')='' and c.pm is not null then 'WhatsApp direto'
      else 'Não identificado' end as canal,
    (l.qualif_ia or coalesce(c.has_adv,false)) qualif,
    coalesce(c.fechado,false) fechado,
    -- um motivo só por lead (o WA de dois vendedores pode ter etiquetas diferentes): o mais específico ganha
    case when not coalesce(c.fechado,false) then null
         when c.nada then 'nada' when c.conc then 'conc' when c.preco then 'preco'
         when c.sem_int then 'sem_int' when c.sumiu then 'sumiu' when c.nunca then 'nunca' end as motivo,
    o1.primeira_prop, o1.valor_prop, coalesce(v1.n_ped,0) n_ped, v1.valor_venda,
    (lower(coalesce(l.qual_animal,'')) ~ '(bovin|gado|boi|vaca|novilh|bezerr)'
      and btrim(coalesce(l.quantos_animais,'')) ~ '^[0-9]{1,7}$' and btrim(l.quantos_animais)::int >= 200) boi200
  from l
  left join chat c on c.pm = l.pm
  left join lateral (
    select min(o.created_at) primeira_prop, (array_agg(o.total_proposta order by o.created_at desc))[1] valor_prop
    from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days'
  ) o1 on true
  left join lateral (
    select count(*) n_ped, sum(pv.v) valor_venda
    from pv
    where pv.num <> '' and pv.data_venda >= (l.data - interval '2 days')::date
      and pv.num in (select o.num from og o where o.fc = l.fc and o.created_at >= l.data - interval '2 days')
  ) v1 on true
),
agg as (
  select
    case when grouping(canal) = 0 then 'canal' when grouping(cod) = 0 then 'criativo' else 'total' end as tipo,
    case when grouping(canal) = 0 then canal when grouping(cod) = 0 then cod else 'TOTAL' end as chave,
    count(*)::int leads,
    count(*) filter (where fc is not null)::int rastr,
    count(*) filter (where qualif)::int qualif,
    count(*) filter (where primeira_prop is not null)::int prop,
    coalesce(sum(valor_prop),0) rs_prop,
    count(*) filter (where n_ped > 0)::int compr,
    coalesce(sum(valor_venda),0) rs_vend,
    count(*) filter (where fechado)::int fech, count(*) filter (where motivo='nunca')::int nunca, count(*) filter (where motivo='sumiu')::int sumiu,
    count(*) filter (where motivo='sem_int')::int sem_int, count(*) filter (where motivo='preco')::int preco,
    count(*) filter (where motivo='conc')::int conc, count(*) filter (where motivo='nada')::int nada,
    count(*) filter (where boi200)::int boi200
  from x
  group by grouping sets ((canal), (cod), ())
)
select a.tipo, a.chave,
  case when a.tipo = 'criativo' then coalesce(nullif(btrim(cr.nome_oficial),''), cr.headline) end as nome,
  a.leads, a.rastr, a.qualif, a.prop,
  round(100.0*a.prop/nullif(a.rastr,0), 2),
  case when a.rastr > 0 then round((100*(( a.prop::float8/a.rastr + 3.8416/(2*a.rastr)
         - 1.96*sqrt((a.prop::float8/a.rastr)*(1-a.prop::float8/a.rastr)/a.rastr + 3.8416/(4.0*a.rastr*a.rastr)))
         / (1+3.8416/a.rastr)))::numeric, 1) end,
  case when a.rastr > 0 then round((100*(( a.prop::float8/a.rastr + 3.8416/(2*a.rastr)
         + 1.96*sqrt((a.prop::float8/a.rastr)*(1-a.prop::float8/a.rastr)/a.rastr + 3.8416/(4.0*a.rastr*a.rastr)))
         / (1+3.8416/a.rastr)))::numeric, 1) end,
  round(a.rs_prop), a.compr, round(a.rs_vend),
  a.fech, a.nunca, a.sumiu, a.sem_int, a.preco, a.conc, a.nada, a.boi200
from agg a
left join auditoria.criativos cr on a.tipo = 'criativo' and cr.codigo = a.chave
where a.chave is not null;
$$;
revoke all on function public.dashboard_marketing_fontes(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_fontes(timestamptz, timestamptz) to authenticated, service_role;
