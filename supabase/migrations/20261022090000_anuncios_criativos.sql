-- /anuncios/criativos (22/10/2026, Daniel: "qual criativo traz cliente qualificado, orçamento, venda… e qual traz quem
-- nunca respondeu / outros assuntos / não interessado").
-- Linhas:
--   tipo 'anuncio' (chave = ad_id): motivos de quem chegou pela conversa da Ana daquele anúncio no período
--     base = conversas com a Ana vindas do anúncio que começaram no período (inclui cliente antigo que voltou)
--     motivos = etiqueta de encerramento (mesma régua do dashboard_marketing_fontes); boi200 = informou 200+ cabeças
--     + vendas do período atribuídas ao anúncio exato (ver abaixo) + nome do anúncio/conjunto/campanha
--   tipo 'codigo' (chave = &NN): vendas do período atribuídas só pelo código do criativo (sem anúncio exato)
--   tipo 'nome'   (chave = &NN): nome oficial do criativo (auditoria.criativos), na coluna anuncio
--   perfil (22/10): espécie e finalidade (consumo/revenda) informadas à Ana, e os estados pelo DDD (top 4) de quem chegou
-- Venda do período: cada pedido fechado no período é atribuído UMA vez, pela 1ª evidência até 365 dias antes:
--   conversa com a Ana vinda de um anúncio (ad_id) → senão contato no CRM com código de criativo &NN.
set lock_timeout = '5s';
drop function if exists public.anuncios_criativos(timestamptz, timestamptz);
create function public.anuncios_criativos(p_from timestamptz, p_to timestamptz)
returns table(tipo text, chave text, base int, fechados int, nunca int, parou int, sem_interesse int, preco int, concorrente int,
              nao_fabricamos int, outros int, boi200 int, vendas_periodo int, rs_vendas_periodo numeric,
              anuncio text, conjunto text, campanha text, anuncio_status text,
              bovino int, suino int, aves int, outro_animal int, consumo int, revenda int, ufs text)
language plpgsql stable security definer
set search_path to 'public', 'auditoria'
set enable_nestloop to 'off'
as $$
begin
  return query execute $q$
  with conv as materialized (
    select x.ad_id, x.ligado_em, public.fone_canon(w.phone) fc, nullif(auditoria.wa_phone_strip9(w.phone), '') pm
    from (
      select ia.chat_id, ia.ligado_em,
             coalesce((ia.dados_coletados->>'_origem')::jsonb->>'ad_id',
                      substring((ia.dados_coletados->>'_origem')::jsonb->>'url' from '/([0-9]{15,})$')) ad_id
      from public.ia_atendimentos ia
      where ia.vendedor_nome = 'ANA' and ia.dados_coletados ? '_origem' and ia.ligado_em > $1 - interval '400 days' and ia.ligado_em < $2
    ) x
    join lateral (select w.phone from public.wa_chat_messages w where w.vendedor_nome = 'ANA' and w.chat_id = x.chat_id
                  and coalesce(w.phone, '') ~ '[0-9]{10}' limit 1) w on true
    where x.ad_id is not null
  ),
  base as materialized (
    select distinct on (c.pm) c.ad_id, c.pm, c.fc from conv c
    where c.ligado_em >= $1 and c.ligado_em < $2 and c.pm is not null
    order by c.pm, c.ligado_em
  ),
  etq as materialized (
    select nullif(auditoria.wa_phone_strip9(w.phone), '') pm,
      bool_or(e.n = 'NUNCA RESPONDEU') nunca,
      bool_or(e.n = 'NAO RESPONDEU MAIS') parou,
      bool_or(e.n = 'NAO TEM INTERESSE') sem_int,
      bool_or(e.n in ('SO BASE DE PRECO', 'BASE DE PRECO', 'FORA DO ORCAMENTO')) preco,
      bool_or(e.n like 'COMPROU %') conc,
      bool_or(e.n = 'NAO FABRICAMOS') nfab,
      bool_or(e.n in ('OUTROS ASSUNTOS', 'TRANSPORTADORAS', 'SUPORTE TECNICO')) fora
    from public.wa_chat_labels w
    join lateral (select we.etiqueta_nome_normalizado n from unnest(w.label_ids::int[]) lid(id)
                  join public.wascript_etiquetas we on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = w.vendedor_nome) e on true
    where nullif(auditoria.wa_phone_strip9(w.phone), '') in (select pm from base)
    group by 1
  ),
  boi as materialized (
    select distinct public.fone_canon(a.telefone_norm) fc
    from auditoria.atendimentos_por_cliente a
    where a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
      and public.fone_canon(a.telefone_norm) in (select fc from base where fc is not null)
      and btrim(coalesce(a.quantos_animais, '')) ~ '^[0-9]{1,7}$' and btrim(a.quantos_animais)::int >= 200
  ),
  perfil as materialized (
    select distinct on (fc) public.fone_canon(a.telefone_norm) fc, lower(coalesce(a.qual_animal, '')) animal, lower(coalesce(a.finalidade_fabrica, '')) fin
    from auditoria.atendimentos_por_cliente a
    where a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13
      and public.fone_canon(a.telefone_norm) in (select fc from base where fc is not null)
    order by public.fone_canon(a.telefone_norm), (coalesce(a.qual_animal, '') <> '') desc, a.data desc
  ),
  ddd(ddd, uf) as (values
    ('11','SP'),('12','SP'),('13','SP'),('14','SP'),('15','SP'),('16','SP'),('17','SP'),('18','SP'),('19','SP'),
    ('21','RJ'),('22','RJ'),('24','RJ'),('27','ES'),('28','ES'),('31','MG'),('32','MG'),('33','MG'),('34','MG'),('35','MG'),
    ('37','MG'),('38','MG'),('41','PR'),('42','PR'),('43','PR'),('44','PR'),('45','PR'),('46','PR'),('47','SC'),('48','SC'),
    ('49','SC'),('51','RS'),('53','RS'),('54','RS'),('55','RS'),('61','DF'),('62','GO'),('63','TO'),('64','GO'),('65','MT'),
    ('66','MT'),('67','MS'),('68','AC'),('69','RO'),('71','BA'),('73','BA'),('74','BA'),('75','BA'),('77','BA'),('79','SE'),
    ('81','PE'),('82','AL'),('83','PB'),('84','RN'),('85','CE'),('86','PI'),('87','PE'),('88','CE'),('89','PI'),('91','PA'),
    ('92','AM'),('93','PA'),('94','PA'),('95','RR'),('96','AP'),('97','AM'),('98','MA'),('99','MA')
  ),
  ufs as (
    select z.ad_id, string_agg(z.uf || ' ' || z.n, ', ' order by z.n desc, z.uf) ufs
    from (select b.ad_id, d.uf, count(*) n, row_number() over (partition by b.ad_id order by count(*) desc, d.uf) rk
            from base b join ddd d on d.ddd = left(b.fc, 2) group by b.ad_id, d.uf) z
    where z.rk <= 4 group by z.ad_id
  ),
  mot as (
    select b.ad_id, count(*)::int base,
      count(*) filter (where e.nunca or e.parou or e.sem_int or e.preco or e.conc or e.nfab or e.fora)::int fechados,
      count(*) filter (where e.nunca)::int nunca, count(*) filter (where e.parou and not coalesce(e.nunca, false))::int parou,
      count(*) filter (where e.sem_int)::int sem_int, count(*) filter (where e.preco)::int preco, count(*) filter (where e.conc)::int conc,
      count(*) filter (where e.nfab)::int nfab, count(*) filter (where e.fora)::int fora,
      count(*) filter (where b.fc in (select fc from boi))::int boi200,
      count(*) filter (where pf.animal ~ 'bovin')::int bovino, count(*) filter (where pf.animal ~ 'su[ií]n')::int suino,
      count(*) filter (where pf.animal ~ '\mave')::int aves,
      count(*) filter (where pf.animal <> '' and pf.animal !~ '(bovin|su[ií]n|\mave)' and pf.animal ~ '[a-z]')::int outro_animal,
      count(*) filter (where pf.fin ~ 'consumo')::int consumo, count(*) filter (where pf.fin ~ '(vend|revenda)')::int revenda
    from base b left join etq e on e.pm = b.pm left join perfil pf on pf.fc = b.fc
    group by b.ad_id
  ),
  pv as materialized (
    select distinct on (p.pedido_numero) p.pedido_numero, p.data_venda, public.fone_canon(nullif(p.raw->>'telefone', '')) fc,
      (case when coalesce(nullif(p.payment_plan_json->>'total', '')::numeric, 0) > 0 then (p.payment_plan_json->>'total')::numeric
            else coalesce(p.valor_total, 0) end) + coalesce(p.ajuste_valor, 0) v
    from public.mirror_pedidos_venda p
    where coalesce(upper(p.status), '') <> 'CANCELADO' and lower(coalesce(p.raw->>'fonte_origem', '')) <> 'garantia'
      and p.data_venda >= ($1 at time zone 'America/Sao_Paulo')::date and p.data_venda < ($2 at time zone 'America/Sao_Paulo')::date
  ),
  ev as (
    -- evidências por pedido: anúncio exato (Ana) e código do criativo no CRM
    select p.pedido_numero, p.v, c.ligado_em em, c.ad_id, null::text cod, 1 prio
      from pv p join conv c on c.fc = p.fc
     where c.ligado_em::date <= p.data_venda and c.ligado_em::date > p.data_venda - 365
    union all
    select p.pedido_numero, p.v, a.data, null, substring(a.criativo_codigo from '^&[0-9]+'), 2
      from pv p join auditoria.atendimentos_por_cliente a
        on a.telefone_norm like '55%' and length(a.telefone_norm) between 12 and 13 and public.fone_canon(a.telefone_norm) = p.fc
     where a.criativo_codigo ~ '^&[0-9]+' and a.data::date <= p.data_venda and a.data::date > p.data_venda - 365
  ),
  atrib as (
    select distinct on (pedido_numero) pedido_numero, v, ad_id, cod from ev order by pedido_numero, prio, em
  ),
  vend_ad as (select ad_id, count(*)::int n, round(sum(v)) v from atrib where ad_id is not null group by 1),
  vend_cod as (select cod, count(*)::int n, round(sum(v)) v from atrib where ad_id is null and cod is not null group by 1),
  nomes as (
    -- nome do anúncio: o cadastro atual, ou o último gasto carregado (anúncio que já saiu do Gerenciador)
    select distinct on (g.ad_id) g.ad_id, g.anuncio, g.conjunto, g.campanha from public.meta_gasto_anuncio_dia g
    where g.ad_id in (select ad_id from mot union select ad_id from vend_ad) order by g.ad_id, g.data desc
  ), ads_out as (
  select 'anuncio'::text tipo, coalesce(m.ad_id, v.ad_id) chave, coalesce(m.base, 0) base, coalesce(m.fechados, 0), coalesce(m.nunca, 0), coalesce(m.parou, 0),
         coalesce(m.sem_int, 0), coalesce(m.preco, 0), coalesce(m.conc, 0), coalesce(m.nfab, 0), coalesce(m.fora, 0),
         coalesce(m.boi200, 0), coalesce(v.n, 0), coalesce(v.v, 0),
         coalesce(an.nome, nm.anuncio) anuncio, coalesce(an.conjunto, nm.conjunto) conjunto, coalesce(mc.nome, nm.campanha) campanha, an.status anuncio_status,
         coalesce(m.bovino, 0) bovino, coalesce(m.suino, 0) suino, coalesce(m.aves, 0) aves, coalesce(m.outro_animal, 0) outro_animal,
         coalesce(m.consumo, 0) consumo, coalesce(m.revenda, 0) revenda, u.ufs
  from mot m full join vend_ad v on v.ad_id = m.ad_id
  left join ufs u on u.ad_id = coalesce(m.ad_id, v.ad_id)
  left join public.meta_anuncio an on an.ad_id = coalesce(m.ad_id, v.ad_id)
  left join public.meta_campanha mc on mc.campanha_id = an.campanha_id
  left join nomes nm on nm.ad_id = coalesce(m.ad_id, v.ad_id)
  )
  select * from ads_out
  union all
  select 'codigo', c.cod, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, c.n, c.v, null, null, null, null, 0, 0, 0, 0, 0, 0, null from vend_cod c
  union all
  -- nome oficial do criativo (cadastro auditoria.criativos) para cada código que aparece
  select 'nome', cr.codigo, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::numeric, coalesce(nullif(btrim(cr.nome_oficial), ''), cr.headline), null, null, null, 0, 0, 0, 0, 0, 0, null
  from auditoria.criativos cr
  where cr.codigo in (select substring(o.anuncio from '&[0-9]{1,3}') from ads_out o union select cod from vend_cod
                      union select substring(g.anuncio from '&[0-9]{1,3}') from public.meta_gasto_anuncio_dia g
                       where g.data >= ($1 at time zone 'America/Sao_Paulo')::date and g.data < ($2 at time zone 'America/Sao_Paulo')::date + 1)
    and coalesce(nullif(btrim(cr.nome_oficial), ''), cr.headline) is not null
  $q$ using p_from, p_to;
end $$;
revoke all on function public.anuncios_criativos(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_criativos(timestamptz, timestamptz) to authenticated, service_role;

-- Aba Google da /anuncios/criativos: cliques no WhatsApp do site (rodapé v4, private.site_clique) por campanha do
-- Google e quantos viraram conversa (o código invisível apareceu numa mensagem de cliente).
create or replace function public.anuncios_google_cliques(p_from timestamptz, p_to timestamptz)
returns table(campanha text, origem text, cliques int, com_gclid int, viraram_conversa int)
language sql stable security definer
set search_path to 'public'
as $$
  with c as (
    select k.ref, k.origem, k.gclid, k.gad_campaignid
    from private.site_clique k where k.criado_em >= p_from and k.criado_em < p_to
  ),
  conv as (
    select distinct public.site_ref_de_texto(w.body) ref
    from public.wa_chat_messages w
    where not w.from_me and w.data_msg >= p_from - interval '1 day' and w.data_msg < p_to + interval '2 days'
      and strpos(coalesce(w.body, ''), chr(8288)) > 0
  ),
  gcamp as (select distinct on (campanha_id) campanha_id, campanha from public.google_ads_gasto_dia order by campanha_id, data desc)
  select coalesce(g.campanha, case when c.gad_campaignid is not null then 'campanha ' || c.gad_campaignid end, '(sem campanha)'),
         coalesce(c.origem, '—'), count(*)::int, count(c.gclid)::int, count(*) filter (where c.ref in (select ref from conv))::int
  from c left join gcamp g on g.campanha_id = c.gad_campaignid
  group by 1, 2 order by 3 desc;
$$;
revoke all on function public.anuncios_google_cliques(timestamptz, timestamptz) from public, anon;
grant execute on function public.anuncios_google_cliques(timestamptz, timestamptz) to authenticated, service_role;
