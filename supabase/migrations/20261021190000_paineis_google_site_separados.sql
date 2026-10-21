-- Painéis de Marketing (21/10/2026): o botão de WhatsApp do site diz de onde veio a visita (script no rodapé do
-- mbranorte.com.br; auditoria.origem_lead_ana grava). Os canais passam a separar Site, Google (busca) e Google Ads,
-- e cada origem nova (YouTube, TikTok, LinkedIn, ChatGPT/IA, E-mail, Link no WhatsApp, Outros buscadores, Outros
-- sites) vira canal próprio. Inclui a troca de 21/10 "Instagram (Direct)" / "Facebook (Messenger)" -> "... orgânico".
-- Já aplicado no banco em 21/10; este arquivo guarda a versão exata (conferida por md5 com o banco).
set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dashboard_canais(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(canal text, leads integer, leads_rastreaveis integer, respondeu_ia integer, qualificados integer, qualif_ou_proposta integer, com_proposta integer, prop_por_100 numeric, prop_ic95_min numeric, prop_ic95_max numeric, compraram integer, rs_proposto numeric, rs_proposto_por_lead numeric, mediana_proposta numeric, rs_vendido numeric, ticket_venda numeric, dias_ate_proposta numeric, nao_fabricamos integer, lixo integer, bovino integer, suino integer, aves integer, peixe integer, bovino_com_cabecas integer, bovino_200_mais integer, selo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auditoria'
AS $function$
with l as materialized (
  select a.data, a.origem, a.criativo_codigo, a.qual_animal, a.quantos_animais,
    case when a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
         then public.fone_canon(a.telefone_norm) end as fc,
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
chat as materialized (
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
site as materialized (
  -- 20/10: o site manda "vim pelo site da Branorte" (antes "Achei vocês no Google"); o ReplyAgent só
  -- reconhecia a frase antiga e o site virava "WhatsApp direto"/"Não identificado".
  select distinct nullif(auditoria.wa_phone_strip9(w.phone),'') pm
  from public.wa_chat_messages w
  where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
    and w.body ~* '(vim pelo site da branorte|achei voc[eê]s no google)'
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
      when l.origem = 'Facebook'       then 'Facebook orgânico'
      when l.origem = 'Instagram'      then 'Instagram orgânico'
      when l.origem = 'Bio Instagram'  then 'Bio Instagram'
      -- (21/10) o script do site separa: Google Ads, Google (busca) e Site. "Google" de antes de out/2026 era a
      -- frase antiga do botão do site ("Achei vocês no Google"): continua Site.
      when l.origem = 'Google Ads'     then 'Google Ads'
      when l.origem ilike 'google%' and l.data >= '2026-10-01' then 'Google (busca)'
      when l.origem ilike 'google%'    then 'Site'
      when l.origem = 'Site'         then 'Site'
      -- origens do script do site (21/10, v2): cada uma vira o próprio canal
      when l.origem in ('YouTube','TikTok','LinkedIn','ChatGPT/IA','E-mail','Link no WhatsApp','Outros buscadores','Outros sites') then l.origem
      when l.origem ilike 'LP %'       then 'Landing pages'
      when l.origem ilike 'whatsapp %' then 'WhatsApp ANA'
      when l.pm in (select pm from site where pm is not null) then 'Site'
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
  left join lateral (
    select min(o.created_at) primeira_prop,
           (array_agg(o.total_proposta order by o.created_at desc))[1] valor_prop
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
  case when rastreaveis > 0 then round((100*(( prop::float8/rastreaveis + 3.8416/(2*rastreaveis)
         - 1.96*sqrt((prop::float8/rastreaveis)*(1-prop::float8/rastreaveis)/rastreaveis + 3.8416/(4.0*rastreaveis*rastreaveis)))
         / (1+3.8416/rastreaveis)))::numeric, 1) end as ic_min,
  case when rastreaveis > 0 then round((100*(( prop::float8/rastreaveis + 3.8416/(2*rastreaveis)
         + 1.96*sqrt((prop::float8/rastreaveis)*(1-prop::float8/rastreaveis)/rastreaveis + 3.8416/(4.0*rastreaveis*rastreaveis)))
         / (1+3.8416/rastreaveis)))::numeric, 1) end as ic_max,
  compr, round(rs_prop) as rs_prop, round(rs_prop/nullif(rastreaveis,0)) as rs_prop_lead, round(med_prop::numeric) as med_prop,
  round(rs_vend) as rs_vend, round(rs_vend/nullif(compr,0)) as ticket, round(dias::numeric,1) as dias,
  nf, lixo, bov, sui, aves, peixe, bovcab, bov200,
  case when rastreaveis::numeric/nullif(leads,0) < 0.5 then 'canal sem telefone (pouco rastreável)'
       when rastreaveis < 100 or prop < 5 then 'amostra pequena'
       else null end as selo
from agg
order by (canal='TOTAL'), leads desc;
$function$;

create or replace function public.dashboard_marketing_fontes(p_from timestamptz, p_to timestamptz)
returns table(
  tipo text, chave text, nome text,
  leads int, leads_rastreaveis int, qualificados int, com_proposta int,
  prop_por_100 numeric, prop_ic95_min numeric, prop_ic95_max numeric, rs_proposto numeric,
  compraram int, rs_vendido numeric,
  fechados int, nunca_respondeu int, nao_respondeu_mais int, sem_interesse int, preco int, concorrente int, nada_a_ver int,
  bovino_200_mais int, nao_fabricamos int, fora_escopo int)
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
    bool_or(e.n = 'NAO FABRICAMOS') nfab,
    bool_or(e.n in ('OUTROS ASSUNTOS','TRANSPORTADORAS','SUPORTE TECNICO')) fora
  from public.wa_chat_labels w
  left join lateral (select we.etiqueta_nome_normalizado n
                     from unnest(w.label_ids::int[]) lid(id)
                     join public.wascript_etiquetas we
                       on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = w.vendedor_nome) e on true
  where nullif(auditoria.wa_phone_strip9(w.phone),'') in (select pm from l)
  group by 1
),
-- v3 (20/10): o site manda "Olá, vim pelo site da Branorte…" (antes de 28/08: "Achei vocês no Google…").
-- O ReplyAgent só reconhecia a frase antiga, então desde setembro o site caía em "WhatsApp direto" /
-- "Não identificado". A 1ª mensagem do cliente em qualquer WhatsApp da casa resolve.
site as materialized (
  select distinct nullif(auditoria.wa_phone_strip9(w.phone),'') pm
  from public.wa_chat_messages w
  where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
    and w.body ~* '(vim pelo site da branorte|achei voc[eê]s no google)'
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
      when l.origem = 'Facebook'       then 'Facebook orgânico'
      when l.origem = 'Instagram'      then 'Instagram orgânico'
      when l.origem = 'Bio Instagram'  then 'Bio Instagram'
      -- (21/10) o script do site separa: Google Ads, Google (busca) e Site. "Google" de antes de out/2026 era a
      -- frase antiga do botão do site ("Achei vocês no Google"): continua Site.
      when l.origem = 'Google Ads'     then 'Google Ads'
      when l.origem ilike 'google%' and l.data >= '2026-10-01' then 'Google (busca)'
      when l.origem ilike 'google%'    then 'Site'
      when l.origem = 'Site'         then 'Site'
      -- origens do script do site (21/10, v2): cada uma vira o próprio canal
      when l.origem in ('YouTube','TikTok','LinkedIn','ChatGPT/IA','E-mail','Link no WhatsApp','Outros buscadores','Outros sites') then l.origem
      when l.origem ilike 'LP %'       then 'Landing pages'
      when l.origem ilike 'whatsapp %' then 'WhatsApp ANA'
      when l.pm in (select pm from site where pm is not null) then 'Site'
      when coalesce(btrim(l.origem),'')='' and c.pm is not null then 'WhatsApp direto'
      else 'Não identificado' end as canal,
    (l.qualif_ia or coalesce(c.has_adv,false)) qualif,
    coalesce(c.fechado,false) fechado,
    -- um motivo só por lead (o WA de dois vendedores pode ter etiquetas diferentes): o mais específico ganha
    case when not coalesce(c.fechado,false) then null
         when c.nfab then 'nfab' when c.fora then 'fora' when c.conc then 'conc' when c.preco then 'preco'
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
    count(*) filter (where motivo='conc')::int conc, count(*) filter (where motivo in ('nfab','fora'))::int nada,
    count(*) filter (where motivo='nfab')::int nfab, count(*) filter (where motivo='fora')::int fora,
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
  a.fech, a.nunca, a.sumiu, a.sem_int, a.preco, a.conc, a.nada, a.boi200, a.nfab, a.fora
from agg a
left join auditoria.criativos cr on a.tipo = 'criativo' and cr.codigo = a.chave
where a.chave is not null;
$$;
revoke all on function public.dashboard_marketing_fontes(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_marketing_fontes(timestamptz, timestamptz) to authenticated, service_role;
