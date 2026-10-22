-- 22/10/2026: card "Precisa de atenção" ganha a regra 6 — anúncio ATIVO com R$ 500+ em 14 dias e nenhum cliente que a Ana passou
-- ao vendedor (conversas do anúncio × outbound_dispatch enviado, pelo índice strip9: 0,1 s). Aviso de carga do Meta atrasada
-- agora fala da carga do servidor (de hora em hora desde 22/10), com 3 h de tolerância entre 8 h e 23 h.
set lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.anuncios_problemas()
 RETURNS TABLE(gravidade text, plataforma text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with conv14 as materialized (
  -- conversas da Ana vindas de anúncio nos últimos 14 dias e se a Ana passou o cliente a um vendedor
  select x.ad_id, exists (select 1 from outbound_dispatch o where o.status = 'sent' and o.created_at >= x.ligado_em - interval '1 hour'
                            and auditoria.wa_phone_strip9(o.cliente_telefone) = auditoria.wa_phone_strip9(w.phone)) repassou
  from (select ia.chat_id, ia.ligado_em,
               coalesce((ia.dados_coletados->>'_origem')::jsonb->>'ad_id',
                        substring((ia.dados_coletados->>'_origem')::jsonb->>'url' from '/([0-9]{15,})$')) ad_id
          from ia_atendimentos ia
         where ia.vendedor_nome = 'ANA' and ia.dados_coletados ? '_origem' and ia.ligado_em > now() - interval '14 days') x
  join lateral (select w.phone from wa_chat_messages w where w.vendedor_nome = 'ANA' and w.chat_id = x.chat_id
                and coalesce(w.phone, '') ~ '[0-9]{10}' limit 1) w on true
  where x.ad_id is not null
),
ontem as (select (now() at time zone 'America/Sao_Paulo')::date - 1 d),
meta_orc as (
  -- orçamento/dia da campanha ativa: o da campanha, ou a soma dos conjuntos ativos (orçamento no conjunto)
  select c.campanha_id, c.nome,
         coalesce(c.orcamento_dia, (select sum(distinct_orc) from (select distinct a.conjunto_id, a.conjunto_orcamento_dia distinct_orc
                                                                     from meta_anuncio a where a.campanha_id = c.campanha_id and a.conjunto_status = 'ACTIVE') z)) orc
  from meta_campanha c where c.status = 'ACTIVE'
),
meta_ontem as (
  select g.campanha_id, sum(g.gasto) gasto from meta_gasto_anuncio_dia g, ontem where g.data = ontem.d group by 1
)
-- 1. Meta: conta quase parada ontem (gastou menos de 30% da soma dos orçamentos ativos) — o 19/10
select 'alta', 'Meta', 'O Meta quase não gastou ontem',
       'Gastou ' || to_char(coalesce((select sum(gasto) from meta_ontem), 0), 'FM999G990') || ' de ' ||
       to_char((select sum(orc) from meta_orc), 'FM999G990') || ' de orçamento/dia. Ver no Gerenciador: pagamento recusado, anúncio reprovado ou limite da conta.'
where (select sum(orc) from meta_orc) > 0
  and coalesce((select sum(gasto) from meta_ontem), 0) < 0.3 * (select sum(orc) from meta_orc)
union all
-- 2. Meta: anúncio reprovado / com problema num conjunto que está rodando
select 'alta', 'Meta', 'Anúncio ' || case a.status when 'DISAPPROVED' then 'reprovado' else 'com problema' end || ': ' || a.nome,
       'Conjunto ' || a.conjunto || ' · campanha ' || c.nome || ' (visto em ' || to_char(a.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ')'
from meta_anuncio a join meta_campanha c on c.campanha_id = a.campanha_id
where c.status = 'ACTIVE' and a.conjunto_status = 'ACTIVE' and a.status in ('DISAPPROVED', 'WITH_ISSUES')
union all
-- 3. Meta: campanha ativa que gastou menos da metade do orçamento ontem
select 'atencao', 'Meta', 'Campanha gastou pouco ontem: ' || o.nome,
       to_char(coalesce(m.gasto, 0), 'FM999G990') || ' de ' || to_char(o.orc, 'FM999G990') || '/dia (' ||
       round(100 * coalesce(m.gasto, 0) / o.orc) || '%)'
from meta_orc o left join meta_ontem m on m.campanha_id = o.campanha_id
where o.orc >= 20 and coalesce(m.gasto, 0) < 0.5 * o.orc
  and not (o.nome ~* 'vaga|emprego')
union all
-- 4. Google: campanha ativa que gastou menos da metade do orçamento ontem
select 'atencao', 'Google', 'Campanha gastou pouco ontem: ' || g.campanha,
       to_char(g.gasto, 'FM999G990') || ' de ' || to_char(g.orcamento_dia, 'FM999G990') || '/dia (' || round(100 * g.gasto / g.orcamento_dia) || '%)'
from google_ads_gasto_dia g, ontem
where g.data = ontem.d and g.status = 'ENABLED' and g.orcamento_dia >= 20 and g.gasto < 0.5 * g.orcamento_dia
union all
-- 5. Carga atrasada (o Meta carrega 8h30/12h30/15h30; o Google de hora em hora)
select 'atencao', 'Meta', 'A carga do Meta está atrasada',
       'Última carga ' || to_char(max(atualizado_em) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '. A carga roda no servidor de hora em hora (06h–23h): ver private.meta_gasto_carga_log.'
from meta_gasto_anuncio_dia having max(atualizado_em) < now() - interval '3 hours' and extract(hour from now() at time zone 'America/Sao_Paulo') between 8 and 23
union all
select 'atencao', 'Google', 'A carga do Google está atrasada',
       'Última carga ' || to_char(max(atualizado_em) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '. Ver o script "CRM Branorte - envia dados" na conta do Google Ads.'
from google_ads_gasto_dia having max(atualizado_em) < now() - interval '4 hours'
union all
-- 6. Anúncio ativo que gastou R$ 500+ nos últimos 14 dias e não trouxe NENHUM cliente que a Ana passou ao vendedor (22/10)
select 'alta', 'Meta', 'Anúncio sem cliente qualificado: ' || x.anuncio,
       to_char(x.gasto, 'FM999G990') || ' gastos em 14 dias, ' || x.conversas || ' conversa' || case when x.conversas = 1 then '' else 's' end ||
       ' com a Ana e nenhuma passada ao vendedor. Conjunto ' || coalesce(x.conjunto, '—') || ' — pausar ou trocar o criativo.'
from (
  select g.ad_id, max(g.anuncio) anuncio, max(g.conjunto) conjunto, sum(g.gasto) gasto,
    (select count(*) from conv14 c where c.ad_id = g.ad_id) conversas,
    (select count(*) from conv14 c where c.ad_id = g.ad_id and c.repassou) repasses
  from meta_gasto_anuncio_dia g
  where g.data >= (now() at time zone 'America/Sao_Paulo')::date - 14
    and g.ad_id in (select a.ad_id from meta_anuncio a where a.status = 'ACTIVE')
    and not (coalesce(g.campanha, '') ~* 'vaga|emprego')
  group by g.ad_id
  having sum(g.gasto) >= 500
) x
where x.repasses = 0;
$function$
;
