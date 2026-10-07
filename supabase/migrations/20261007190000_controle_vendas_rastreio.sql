-- Rastreio da ORIGEM DA VENDA pelo telefone (pedido do Daniel, 07/10/2026).
--
-- O Painel de Vendas (/controle) mostrava só o que o vendedor marcou no pedido
-- ("Como o cliente encontrou a empresa?"). Esta função entrega, pra cada venda do período, as
-- EVIDÊNCIAS de como aquele cliente chegou de verdade, casando o telefone do pedido E o telefone do
-- orçamento ligado a ele (o do CRM e o da pasta) com os registros de chegada:
--   lead    = auditoria.auditoria_atendimentos (origem, criativo)
--   repasse = outbound_dispatch (lead entregue a vendedor; a Ana grava o anúncio clicado em origem_anuncio)
--   clique  = anuncio_clique (clique em anúncio lido da própria mensagem)
--
-- A função NÃO decide a origem: devolve os fatos. Quem decide é src/lib/vendas-origem.ts
-- (origemFinalVenda), que tem teste: rastreio com origem identificada vale; sem ele, vale o que o
-- vendedor marcou. Assim a regra fica num lugar só e a tela de rastreio mostra os dois lados.
--
-- Recortes que são regra, não detalhe:
--   * só chegada ATÉ o dia da venda (lead que nasce depois da venda não explica a venda);
--   * se o cliente já tinha pedido antes, só vale chegada DEPOIS daquele pedido (o anúncio que
--     trouxe a 1ª compra não é a origem da 2ª);
--   * 'Não identificou' e origem vazia contam como contato, não como origem;
--   * garantia e cancelado ficam fora, como no painel.
--
-- Telefone sempre por fone_canon nos dois lados (DDD + 8 dígitos; estrangeiro não casa).
-- SECURITY DEFINER lê auditoria.* e fura RLS: por isso o guard de papel é da PRÓPRIA função.
-- (No banco entrou em duas passadas no mesmo dia: controle_vendas_rastreio e ..._v2, que só acrescentou a
--  distinção de origem forte x porta de entrada; e uma terceira trouxe fones_canon_do_campo. Este arquivo é
--  a versão final.)

-- Campo de telefone com MAIS DE UM número (2 pedidos em 277 nos 6 meses medidos em 07/10/2026).
-- fone_canon do campo inteiro junta os dígitos e corta os 10 da direita: fica só com o último número,
-- ou fabrica um DDD ("(77) 99971-3032 e (11) 98888-7777" virava 1988887777). Esta função devolve uma
-- chave por número do campo. Campo com um número só continua indo direto pro fone_canon.
create or replace function public.fones_canon_do_campo(p text)
returns setof text
language sql
immutable
set search_path to 'public'
as $f$
  with d as (
    select coalesce(p, '') as t, length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) as n
  ),
  um as (select public.fone_canon(d.t) as fc from d where d.n <= 13),
  -- números colados, sem formatação: "77999713032 / 1133334444"
  colados as (
    select public.fone_canon(m[1]) as fc from d, lateral regexp_matches(d.t, '(\d{10,13})', 'g') m where d.n > 13
  ),
  -- números formatados: "(77) 99971-3032 e (11) 98888-7777"
  formatados as (
    select public.fone_canon(m[1]) as fc
    from d, lateral regexp_matches(regexp_replace(d.t, '\d{10,}', ' ', 'g'),
                                   '(\(?\d{2}\)?[\s.-]*\d?[\s.-]*\d{4}[\s.-]*\d{4})', 'g') m
    where d.n > 13
  )
  select distinct x.fc from (select fc from um union all select fc from colados union all select fc from formatados) x
  where x.fc is not null
$f$;

revoke all on function public.fones_canon_do_campo(text) from public, anon;
grant execute on function public.fones_canon_do_campo(text) to authenticated, service_role;

create or replace function public.controle_vendas_rastreio(p_from date, p_to date)
returns table (
  pedido_id text,
  pedido_numero text,
  numero_orcamento text,
  cliente text,
  vendedor text,
  vendedor_2 text,
  data_venda date,
  valor numeric,
  fonte_declarada text,
  data_primeiro_contato text,
  telefone_pedido text,
  telefone_orcamento text,
  chegada_em timestamptz,
  chegada_origem text,
  chegada_criativo text,
  chegada_anuncio text,
  chegada_fonte text,
  chegada_via text,
  chegadas_com_origem integer,
  ultima_chegada_em timestamptz,
  ultima_chegada_origem text,
  contato_sem_origem_em timestamptz,
  pedido_anterior_numero text,
  pedido_anterior_data date,
  na_base_desde timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'auditoria'
as $function$
with pode as (
  select (not public.papel_restrito())
     and (public.is_admin() or coalesce((
           select (rp.permissions->>'menu.controle')::boolean
           from public.user_profiles up
           join public.role_permissions rp on rp.role = up.role
           where up.id = auth.uid() and up.approved_at is not null), false)) as ok
),
-- todo pedido que conta como venda, com o telefone já canônico (uma passada só no espelho)
todos as materialized (
  select mp.id, mp.pedido_numero, mp.numero_orcamento, mp.cliente, mp.vendedor, mp.vendedor_2, mp.data_venda,
         (case when coalesce(nullif(mp.payment_plan_json->>'total','')::numeric, 0) > 0
               then (mp.payment_plan_json->>'total')::numeric
               else coalesce(mp.valor_total, 0) end) as valor,
         mp.raw->>'fonte_origem' as fonte_declarada,
         mp.raw->>'data_primeiro_contato' as data_primeiro_contato,
         nullif(btrim(mp.raw->>'telefone'), '') as telefone_pedido,
         public.fone_canon(mp.raw->>'telefone') as fc,
         regexp_replace(coalesce(mp.raw->>'cpf_cnpj', ''), '\D', '', 'g') as doc,
         substring(coalesce(mp.numero_orcamento, '') from '(\d{4})\s*-\s*\d{4,5}') as orc_ano,
         substring(coalesce(mp.numero_orcamento, '') from '\d{4}\s*-\s*(\d{4,5})') as orc_num
  from public.mirror_pedidos_venda mp, pode
  where pode.ok
    and mp.data_venda is not null
    and coalesce(upper(mp.status), '') <> 'CANCELADO'
    and lower(btrim(coalesce(mp.raw->>'fonte_origem', ''))) <> 'garantia'
),
ped as (
  select * from todos t where t.data_venda between p_from and p_to
),
-- orçamento montado no CRM ligado ao pedido (numero_base = "2026 - 1234"; o pedido grava "2026-1234" ou "XX-2026-1234")
og as (
  select distinct on (p.id) p.id, nullif(btrim(o.cliente_dados->>'fone'), '') as fone,
         public.fone_canon(o.cliente_dados->>'fone') as fc
  from ped p
  join public.orcamentos_gerados o
    on p.orc_ano is not null
   and regexp_replace(coalesce(o.numero_base, o.numero), '\s', '', 'g') = p.orc_ano || '-' || p.orc_num
  where public.fone_canon(o.cliente_dados->>'fone') is not null
  order by p.id, o.created_at desc
),
-- orçamento da pasta (docx) ligado ao pedido
ofi as (
  select distinct on (p.id) p.id, nullif(btrim(f.docx_phone), '') as fone,
         coalesce(nullif(btrim(f.docx_phone), ''), f.docx_phone_normalizado) as fone_txt,
         public.fone_canon(coalesce(f.docx_phone_normalizado, f.docx_phone)) as fc
  from ped p
  join public.orcamentos_files f
    on p.orc_ano is not null and f.numero = p.orc_num and f.ano = p.orc_ano::smallint
  where public.fone_canon(coalesce(f.docx_phone_normalizado, f.docx_phone)) is not null
  order by p.id, f.mtime_iso desc nulls last
),
-- uma chave por NÚMERO do campo (fones_canon_do_campo): campo com dois telefones casa pelos dois
fones as (
  select p.id, x.fc, 'pedido'::text as via from ped p, lateral public.fones_canon_do_campo(p.telefone_pedido) x(fc)
  union
  select og.id, x.fc, 'orcamento' from og, lateral public.fones_canon_do_campo(og.fone) x(fc)
  union
  select ofi.id, x.fc, 'orcamento' from ofi, lateral public.fones_canon_do_campo(ofi.fone_txt) x(fc)
),
fcs as (
  select distinct f.fc from fones f
),
-- venda anterior do MESMO cliente (telefone do pedido ou CPF/CNPJ), pra separar recompra de cliente novo
ant as (
  select distinct on (p.id) p.id, a.pedido_numero as numero, a.data_venda as data
  from ped p
  join todos a
    on a.id <> p.id and a.data_venda < p.data_venda
   and ((p.fc is not null and a.fc = p.fc) or (length(p.doc) >= 11 and a.doc = p.doc))
  order by p.id, a.data_venda desc
),
-- todo registro de chegada dos telefones do período
ev as (
  select x.fc, x.quando, x.origem, x.criativo, x.anuncio, x.fonte
  from (
    select public.fone_canon(coalesce(a.telefone, a.telefone_norm)) as fc, a.created_at as quando,
           nullif(btrim(a.origem), '') as origem, nullif(btrim(a.criativo_codigo), '') as criativo,
           null::text as anuncio, 'lead'::text as fonte
    from auditoria.auditoria_atendimentos a
    where coalesce(a.is_internal, false) = false
    union all
    select public.fone_canon(coalesce(d.cliente_telefone_norm, d.cliente_telefone)), d.created_at,
           case when jsonb_typeof(d.raw_payload->'origem_anuncio') = 'object' then 'Meta ADS'
                else nullif(btrim(d.raw_payload->>'origem'), '') end,
           coalesce(nullif(btrim(d.raw_payload->>'criativo'), ''), cr.codigo, substring(m.anuncio from '&[0-9]+')),
           coalesce(cr.nome_oficial, m.anuncio, nullif(btrim(d.raw_payload->>'anuncio'), '')),
           'repasse'
    from public.outbound_dispatch d
    left join public.meta_anuncio_mapa m on m.ad_id = d.raw_payload->'origem_anuncio'->>'ad_id'
    left join auditoria.criativos cr on cr.source_id = d.raw_payload->'origem_anuncio'->>'ad_id'
    where jsonb_typeof(d.raw_payload) = 'object'
    union all
    select public.fone_canon(k.telefone_norm), k.recebido_em, 'Meta ADS',
           coalesce(cr.codigo, substring(m.anuncio from '&[0-9]+')),
           coalesce(cr.nome_oficial, m.anuncio, nullif(k.titulo, '')),
           'clique'
    from public.anuncio_clique k
    left join public.meta_anuncio_mapa m on m.ad_id = k.ad_id
    left join auditoria.criativos cr on cr.source_id = k.ad_id
    where k.ad_id is not null or k.payload->>'fonte' = 'ANA_ctwa'
  ) x
  join fcs on fcs.fc = x.fc
),
-- só o que cabe no ciclo desta venda: depois do pedido anterior (se houve) e até o fim do dia da venda.
-- `forte` = origem que diz COMO o cliente achou a empresa (anúncio, LP, bio...). "WhatsApp 1144/4502/ANA"
-- e "Link" só dizem por qual porta ele entrou: valem como contato, e só viram a origem se não houver outra.
evp as (
  select f.id, f.via, e.quando, e.origem, e.criativo, e.anuncio, e.fonte,
         (e.origem is not null and lower(e.origem) not in ('não identificou', 'nao identificou', 'não identificado', 'nao identificado')) as tem_origem,
         (e.origem is not null and lower(e.origem) not in ('não identificou', 'nao identificou', 'não identificado', 'nao identificado')
            and lower(e.origem) not like 'whatsapp%' and lower(e.origem) <> 'link') as forte
  from fones f
  join ped p on p.id = f.id
  join ev e on e.fc = f.fc
  left join ant on ant.id = f.id
  where e.quando < ((p.data_venda + 1)::timestamp at time zone 'America/Sao_Paulo')
    and (ant.data is null or e.quando >= ((ant.data + 1)::timestamp at time zone 'America/Sao_Paulo'))
),
agg as (
  select e.id,
         (count(*) filter (where e.tem_origem))::integer as n_origem,
         min(e.quando) filter (where not e.tem_origem) as sem_origem_em
  from evp e group by e.id
),
-- a chegada que vale: a PRIMEIRA com origem forte; sem nenhuma forte, a primeira que houver
pri as (
  select distinct on (e.id) e.id, e.quando, e.origem, e.criativo, e.anuncio, e.fonte, e.via
  from evp e where e.tem_origem
  order by e.id, e.forte desc, e.quando asc, (e.criativo is not null) desc
),
ult as (
  select distinct on (e.id) e.id, e.quando, e.origem
  from evp e where e.tem_origem
  order by e.id, e.quando desc
),
-- código de criativo de qualquer chegada do ciclo, se a primeira não trouxe
cri as (
  select distinct on (e.id) e.id, e.criativo, e.anuncio
  from evp e where e.tem_origem and e.criativo is not null
  order by e.id, e.quando asc
),
ctt as (
  select f.id, min(c.created_at) as desde
  from fones f
  join public.contacts c on public.fone_canon(c.phone) = f.fc and public.fone_canon(c.phone) is not null
  group by f.id
)
select
  p.id, p.pedido_numero, p.numero_orcamento, p.cliente, p.vendedor, p.vendedor_2, p.data_venda, p.valor,
  p.fonte_declarada, p.data_primeiro_contato, p.telefone_pedido,
  coalesce(og.fone, ofi.fone) as telefone_orcamento,
  pri.quando, pri.origem,
  coalesce(pri.criativo, cri.criativo),
  coalesce(pri.anuncio, c1.nome_oficial, c1.headline, cri.anuncio),
  pri.fonte, pri.via,
  coalesce(agg.n_origem, 0),
  ult.quando, ult.origem,
  agg.sem_origem_em,
  ant.numero, ant.data,
  ctt.desde
from ped p
left join og on og.id = p.id
left join ofi on ofi.id = p.id
left join agg on agg.id = p.id
left join pri on pri.id = p.id
left join ult on ult.id = p.id
left join cri on cri.id = p.id
left join auditoria.criativos c1 on c1.codigo = coalesce(pri.criativo, cri.criativo)
left join ant on ant.id = p.id
left join ctt on ctt.id = p.id
order by p.data_venda desc, p.pedido_numero desc;
$function$;

comment on function public.controle_vendas_rastreio(date, date) is
  'Evidências de origem por venda (telefone do pedido e do orçamento x lead, repasse e clique em anúncio). A regra da origem final mora em src/lib/vendas-origem.ts. 07/10/2026.';

-- Função nova nasce com EXECUTE pra PUBLIC: fecha pra anon e deixa só quem loga (o guard de papel é interno).
revoke all on function public.controle_vendas_rastreio(date, date) from public, anon;
grant execute on function public.controle_vendas_rastreio(date, date) to authenticated, service_role;
