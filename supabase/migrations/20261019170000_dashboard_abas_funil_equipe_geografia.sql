-- 3ª bateria (19/10/2026): abas Funil, Equipe e Geografia.
-- Antes desta migração foi criada à parte (mesma conta de um refresh, ~1 min):
--   create materialized view public.mv_etiqueta_ciclo_v2 as
--     select fone_canon(phone) as fc, min(detectado_em) as primeira_etq,
--       min(detectado_em) filter (where etiqueta_para = 'VENDIDO') as vend_em,
--       min(detectado_em) filter (where upper(vendedor_nome) not in ('ANA','DANIEL')) as primeira_etq_vendedor
--     from public.wa_etiqueta_movimentos
--     where etiqueta_para is not null and fone_canon(phone) is not null
--     group by fone_canon(phone);
--   create unique index idx_mv_etiqueta_ciclo_v2_fc on public.mv_etiqueta_ciclo_v2 (fc);
SET lock_timeout = '5s';

-- 1) "Lead chega → 1ª etiqueta" dava 0h: em 456 de 632 leads a 1ª etiqueta era a
--    automática da ANA (PROSPECÇÃO/NOVO LEAD). A view ganha a 1ª etiqueta de VENDEDOR;
--    o cron `refresh_mv_etiqueta_ciclo` continua igual (refresh pelo nome).
DROP MATERIALIZED VIEW public.mv_etiqueta_ciclo;
ALTER MATERIALIZED VIEW public.mv_etiqueta_ciclo_v2 RENAME TO mv_etiqueta_ciclo;
ALTER INDEX public.idx_mv_etiqueta_ciclo_v2_fc RENAME TO idx_mv_etiqueta_ciclo_fc;

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_ciclo_venda'::regproc);
  a text := E'  SELECT l.primeira_data, mv.primeira_etq, o.orc_em\n';
  b text := E'  SELECT l.primeira_data, mv.primeira_etq_vendedor AS primeira_etq, o.orc_em\n';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'dashboard_ciclo_venda mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 2) Coluna "Quentes" da Equipe era 100% INTERESSE FUTURO (a categoria `quente` inclui
--    INTERESSE FUTURO, AGUARDANDO, AGENDAMENTO). Agora é só LEAD QUENTE, como a ajuda
--    promete; INTERESSE FUTURO sai numa coluna própria.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_painel_vendedores'::regproc);
  a text := E'      count(distinct le.pm) filter (where le.cat in (''quente'',''lead_quente'')\n        and le.et not in (''PROSPECCAO'',''PROSPECCOES'',''1A TENTATIVA'',''2A TENTATIVA'',''PRIMEIRA TENTATIVA'',''FOLLOW UP'',''FOLLOWUP'',''FALLOW UP'')) as quente,';
  b text := E'      count(distinct le.pm) filter (where le.et in (''LEAD QUENTE'',''QUENTE'')) as quente,\n      count(distinct le.pm) filter (where le.et = ''INTERESSE FUTURO'') as interesse_futuro,';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'dashboard_painel_vendedores mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 3) "Leads órfãos por vendedor" cobrava a ANA (é a IA, não vendedor).
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_orfaos_por_vendedor'::regproc);
  a text := E'      and wcl.vendedor_nome !~* ''daniel''';
  b text := E'      and upper(btrim(wcl.vendedor_nome)) not in (''DANIEL'',''ANA'')';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'dashboard_orfaos_por_vendedor mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 4) Etiquetas de perda que caíam em `outros` (não contavam como perda em lugar nenhum).
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.etiqueta_categoria'::regproc);
  a text := E'''FORA DO ORCAMENTO'',''SO BASE DE PRECO'',';
  b text := E'''FORA DO ORCAMENTO'',''SO BASE DE PRECO'',''BASE DE PRECO'',''COMPROU NA CONCORRENCIA'',';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'etiqueta_categoria mudou'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_fone_situacao'::regproc);
  a1 text := E'''FORA DO ORCAMENTO'',''SO BASE DE PRECO'',';
  b1 text := E'''FORA DO ORCAMENTO'',''SO BASE DE PRECO'',''BASE DE PRECO'',''COMPROU NA CONCORRENCIA'',';
  -- 31 dias: o "Dinheiro parado — sem resposta há" (aging até +30d) passa a olhar
  -- também a última mensagem no WhatsApp do vendedor.
  a2 text := E'where w.last_message_at >= now() - interval ''15 days''';
  b2 text := E'where w.last_message_at >= now() - interval ''31 days''';
BEGIN
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'dashboard_fone_situacao mudou'; END IF;
  EXECUTE replace(replace(d, a1, b1), a2, b2);
END
$mig$;

-- 5) "Em negociação" dava 39 na Geografia e 63 no Funil: a Geografia só contava quem
--    estava em atendimentos_por_cliente e dizia incluir ORÇAMENTO, que não incluía.
--    Agora parte das mesmas etiquetas do Funil (dashboard_extra.aberto.em_negociacao:
--    FOLLOW UP + LEAD QUENTE) e só perde quem não tem DDD brasileiro identificável.
CREATE OR REPLACE FUNCTION public.dashboard_negociacao_por_uf()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'auditoria', 'public'
AS $function$
declare v jsonb;
begin
  with ddd_uf(ddd, uf) as (values
    ('11','SP'),('12','SP'),('13','SP'),('14','SP'),('15','SP'),('16','SP'),('17','SP'),('18','SP'),('19','SP'),
    ('21','RJ'),('22','RJ'),('24','RJ'),('27','ES'),('28','ES'),
    ('31','MG'),('32','MG'),('33','MG'),('34','MG'),('35','MG'),('37','MG'),('38','MG'),
    ('41','PR'),('42','PR'),('43','PR'),('44','PR'),('45','PR'),('46','PR'),
    ('47','SC'),('48','SC'),('49','SC'),('51','RS'),('53','RS'),('54','RS'),('55','RS'),
    ('61','DF'),('62','GO'),('64','GO'),('63','TO'),('65','MT'),('66','MT'),('67','MS'),
    ('68','AC'),('69','RO'),
    ('71','BA'),('73','BA'),('74','BA'),('75','BA'),('77','BA'),('79','SE'),
    ('81','PE'),('87','PE'),('82','AL'),('83','PB'),('84','RN'),('85','CE'),('88','CE'),('86','PI'),('89','PI'),
    ('91','PA'),('93','PA'),('94','PA'),('92','AM'),('97','AM'),('95','RR'),('96','AP'),('98','MA'),('99','MA')
  ),
  neg as (
    select auditoria.wa_phone_strip9(wcl.phone) as pm, regexp_replace(wcl.phone, '\D', '', 'g') as dig
    from public.wa_chat_labels wcl
    cross join lateral unnest(wcl.label_ids::int[]) lid(id)
    join public.wascript_etiquetas we
      on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = wcl.vendedor_nome
    where we.etiqueta_nome_normalizado in ('FOLLOW UP','FOLLOWUP','FALLOW UP','LEAD QUENTE','QUENTE')
  ),
  por_pm as (
    select pm, max(case when dig ~ '^55' and length(dig) between 12 and 13 then substr(dig, 3, 2) end) as ddd
    from neg group by pm
  )
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    select du.uf, count(*) as total
    from por_pm c join ddd_uf du on du.ddd = c.ddd
    group by du.uf order by total desc
  ) t;
  return v;
end;
$function$;

-- 6) "Em negociação · previsão" (Funil) deduplicava por vendedor+cliente e somava cliente
--    que já tem VENDIDO em outro WhatsApp (R$ 7,71 mi). Agora: 1 por cliente (a proposta
--    mais recente) e sem quem já comprou.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_extra'::regproc);
  a1 text := E'    SELECT DISTINCT ON (vendedor, coalesce(nullif(cliente_key,''''),''id:''||id::text)) id, brl, pm\n    FROM prop_base ORDER BY vendedor, coalesce(nullif(cliente_key,''''),''id:''||id::text), created_at DESC';
  b1 text := E'    SELECT DISTINCT ON (coalesce(nullif(cliente_key,''''),''id:''||id::text)) id, brl, pm\n    FROM prop_base ORDER BY coalesce(nullif(cliente_key,''''),''id:''||id::text), created_at DESC';
  a2 text := E'  negoc_pm AS (SELECT DISTINCT pm FROM labels WHERE norm IN (''FOLLOW UP'',''FOLLOWUP'',''FALLOW UP'',''LEAD QUENTE'',''QUENTE'')),\n  followup_pm AS (SELECT DISTINCT pm FROM labels WHERE norm IN (''FOLLOW UP'',''FOLLOWUP'',''FALLOW UP'')),';
  b2 text := E'  vendido_pm AS (SELECT DISTINCT pm FROM labels WHERE cat = ''vendido''),\n  negoc_pm AS (SELECT DISTINCT pm FROM labels WHERE norm IN (''FOLLOW UP'',''FOLLOWUP'',''FALLOW UP'',''LEAD QUENTE'',''QUENTE'') AND pm NOT IN (SELECT pm FROM vendido_pm)),\n  followup_pm AS (SELECT DISTINCT pm FROM labels WHERE norm IN (''FOLLOW UP'',''FOLLOWUP'',''FALLOW UP'') AND pm NOT IN (SELECT pm FROM vendido_pm)),';
BEGIN
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'dashboard_extra mudou'; END IF;
  EXECUTE replace(replace(d, a1, b1), a2, b2);
END
$mig$;
