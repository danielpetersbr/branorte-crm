-- Aba Geral do Dashboard, 2ª auditoria (19/10/2026). Cada bloco abaixo conserta um
-- número que a tela mostrava errado ou que não batia com outro da mesma tela.
SET lock_timeout = '5s';

-- 1) "R$ em negociação quente" (Decisões do gerente) e "Propostas por estágio" (aba Funil).
--    a) PROSPECÇÃO, 2ª TENTATIVA, INTERESSE FUTURO e AGUARDANDO caíam em `quente` via
--       etiqueta_categoria() e somavam como negociação (R$ 283.810 em out/26). São etapa
--       de cadência: vão para o rank de `novo`.
--    b) Na MESMA conversa, etiqueta de perda (FORA DO ORÇAMENTO, NUNCA RESPONDEU…) junto
--       de ORÇAMENTO ENVIADO valia como orçamento (R$ 446.476). Agora a conversa vale como
--       perdida, a não ser que tenha VENDIDO; entre conversas de vendedores diferentes
--       continua valendo a mais avançada.
--    c) `por_categoria` deduplicava por vendedor: cliente cotado por 2 vendedores contava
--       2× (134 × 131 do card). Agora deduplica por cliente (mesma chave do card);
--       `por_cat_vendedor` continua por vendedor, que é o que ele mostra.
CREATE OR REPLACE FUNCTION public.dashboard_propostas_status(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'auditoria', 'public'
AS $function$
declare v jsonb;
begin
  with etq as (
    select auditoria.wa_phone_strip9(wcl.phone) as pm,
           wcl.vendedor_nome as conta,
           case
             when we.etiqueta_nome_normalizado in ('PROSPECCAO','PROSPECCOES','2A TENTATIVA',
                  'INTERESSE FUTURO','AGUARDANDO','AGUARDANDO RESPOSTA') then 'novo'
             else public.etiqueta_categoria(we.etiqueta_nome_normalizado)
           end as cat
    from public.wa_chat_labels wcl
    cross join lateral unnest(wcl.label_ids::int[]) lid(id)
    join public.wascript_etiquetas we on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = wcl.vendedor_nome
  ),
  chat_rk as (
    select pm, conta,
      case
        when bool_or(cat = 'vendido') then 1
        when bool_or(cat = 'perdido') then 6
        else min(case cat when 'orcamento' then 2 when 'lead_quente' then 3
                          when 'quente' then 4 when 'novo' then 5 else 9 end)
      end as rk
    from etq group by pm, conta
  ),
  phone_cat as (select pm, min(rk) as rk from chat_rk group by pm),
  base as (
    select o.id, o.created_at,
      coalesce(nullif(trim(o.vendedor_nome),''),'—') as vendedor,
      coalesce(o.total_proposta,0)::numeric as brl,
      auditoria.wa_phone_strip9(
        case when regexp_replace(coalesce(o.cliente_dados->>'fone',''),'\D','','g') like '55%'
             then regexp_replace(o.cliente_dados->>'fone','\D','','g')
             else '55' || regexp_replace(coalesce(o.cliente_dados->>'fone',''),'\D','','g') end) as pm,
      coalesce(nullif(regexp_replace(coalesce(o.cliente_dados->>'fone',''),'\D','','g'),''),
               lower(trim(coalesce(o.cliente_dados->>'nome', o.cliente_nome, '')))) as cliente_key,
      coalesce(public.fone_canon(o.cliente_dados->>'fone'),
               nullif(lower(trim(coalesce(o.cliente_dados->>'nome', o.cliente_nome, ''))), ''),
               'id:'||o.id::text) as cliente_canon
    from public.orcamentos_gerados o
    where not (coalesce(o.vendedor_nome,'') ilike '%daniel%')
      and (p_from is null or o.created_at >= p_from)
      and (p_to   is null or o.created_at <  p_to)
  ),
  dedup as (
    select distinct on (vendedor, coalesce(nullif(cliente_key,''), 'id:'||id::text))
      id, vendedor, brl, pm
    from base
    order by vendedor, coalesce(nullif(cliente_key,''), 'id:'||id::text), created_at desc
  ),
  dedup_cli as (
    select distinct on (cliente_canon) id, vendedor, brl, pm
    from base
    order by cliente_canon, created_at desc
  ),
  prop as (
    select d.vendedor, d.brl,
      case coalesce(pc.rk,99)
        when 1 then 'vendido' when 2 then 'orcamento' when 3 then 'lead_quente'
        when 4 then 'quente'  when 5 then 'novo'      when 6 then 'perdido'
        when 9 then 'outros'  else 'sem_etiqueta' end as categoria
    from dedup d left join phone_cat pc on pc.pm = d.pm
  ),
  prop_cli as (
    select d.brl,
      case coalesce(pc.rk,99)
        when 1 then 'vendido' when 2 then 'orcamento' when 3 then 'lead_quente'
        when 4 then 'quente'  when 5 then 'novo'      when 6 then 'perdido'
        when 9 then 'outros'  else 'sem_etiqueta' end as categoria
    from dedup_cli d left join phone_cat pc on pc.pm = d.pm
  )
  select jsonb_build_object(
    'por_categoria', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select categoria, count(*)::int as n, round(sum(brl))::numeric as brl
        from prop_cli group by categoria
        order by min(case categoria
          when 'orcamento' then 1 when 'quente' then 2 when 'lead_quente' then 3
          when 'novo' then 4 when 'sem_etiqueta' then 5 when 'vendido' then 6
          when 'perdido' then 7 else 8 end)
      ) t), '[]'::jsonb),
    'por_cat_vendedor', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select categoria, vendedor, count(*)::int as n, round(sum(brl))::numeric as brl
        from prop where vendedor <> '—'
        group by categoria, vendedor
        order by categoria, sum(brl) desc
      ) t), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

-- 2) "N leads órfãos parados há mais de 7 dias — entraram, ninguém assumiu".
--    Em 19/10 os 6 eram do dono, com etiqueta posta em lote em 12/10 e mensagem no
--    WhatsApp HOJE: "parado" olhava só quando a etiqueta mudou. Agora: só começo do
--    funil (NOVO LEAD, PROSPECÇÃO, 2ª TENTATIVA), sem o dono, e sem mudança de etiqueta
--    NEM mensagem no WhatsApp há N dias.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_etiquetas_extras'::regproc);
  a text := E'      (SELECT COUNT(*) FROM lead_principal\n       WHERE categoria IN (''novo'',''quente'')\n         AND label_changed_at IS NOT NULL\n         AND label_changed_at < (now() - (p_orfao_dias || '' days'')::interval)),';
  b text := E'      (SELECT COUNT(DISTINCT lpr.telefone_norm) FROM lead_principal lpr\n       JOIN leads_periodo lp ON lp.telefone_norm = lpr.telefone_norm\n       WHERE (lpr.categoria = ''novo'' OR lpr.etiqueta_norm IN (''PROSPECCAO'',''PROSPECCOES'',''2A TENTATIVA''))\n         AND lpr.label_changed_at IS NOT NULL\n         AND lpr.label_changed_at < (now() - (p_orfao_dias || '' days'')::interval)\n         AND COALESCE(lp.responsavel,'''') !~* ''daniel''\n         AND NOT EXISTS (\n           SELECT 1 FROM public.wa_chat_labels w\n           WHERE auditoria.wa_phone_strip9(w.phone) = lp.phone_match\n             AND w.last_message_at >= now() - (p_orfao_dias || '' days'')::interval)),';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'dashboard_etiquetas_extras mudou: trecho dos órfãos não encontrado 1 vez';
  END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 3) "Atendimentos hoje": comparava o dia parcial com o dia INTEIRO de ontem (−44% às
--    16h, enquanto o tile Leads no filtro Hoje dizia −18%). Novo campo: ontem até a
--    mesma hora.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_extra'::regproc);
  a text := E'count(*) FILTER (WHERE (primeira_data AT TIME ZONE ''America/Sao_Paulo'')::date = v_hoje - 1) AS ontem\n';
  b text := E'count(*) FILTER (WHERE (primeira_data AT TIME ZONE ''America/Sao_Paulo'')::date = v_hoje - 1) AS ontem,\n      count(*) FILTER (WHERE (primeira_data AT TIME ZONE ''America/Sao_Paulo'')::date = v_hoje - 1\n                         AND primeira_data <= now() - interval ''1 day'') AS ontem_ate_agora\n';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'dashboard_extra mudou: trecho de atendimentos não encontrado 1 vez';
  END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 4) Modal "Clientes com proposta": "R$ montados" SOMAVA todas as re-cotações do
--    cliente (R$ 32,6 mi no mês) enquanto o bloco ao lado usa a última proposta de cada
--    cliente (R$ 17,98 mi). Agora o valor do cliente é o da proposta mais recente.
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_orcamentos_periodo_detalhe'::regproc);
  a text := E'coalesce(sum(o.total_proposta),0)::numeric as valor_total,';
  b text := E'coalesce((array_agg(o.total_proposta order by o.created_at desc))[1],0)::numeric as valor_total,';
BEGIN
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'dashboard_orcamentos_periodo_detalhe mudou: soma não encontrada 1 vez';
  END IF;
  EXECUTE replace(d, a, b);
END
$mig$;

-- 5) Card "leads quentes sem resposta há mais de 24h": a última atividade só via o canal
--    da IA e o orçamento montado. 28 dos 47 tinham mensagem no WhatsApp do vendedor mais
--    nova que isso. Esta função passa a devolver a última mensagem no WhatsApp (qualquer
--    vendedor, qualquer lado) por telefone. Mudar o RETURNS TABLE exige DROP; os GRANTs
--    voltam iguais aos de antes (authenticated e service_role; anon não).
DROP FUNCTION public.dashboard_fone_situacao();
CREATE FUNCTION public.dashboard_fone_situacao()
 RETURNS TABLE(fone_canon text, situacao text, ultima_msg_wa timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with etq as (
    select distinct etiqueta_id_wascript::text as id,
      case
        when etiqueta_nome_normalizado in ('VENDIDO','VENDIDOS','CLIENTE') or etiqueta_nome_normalizado like 'CLIENTES %' then 'vendido'
        when etiqueta_nome_normalizado like 'ORCAMENTO%'
          or etiqueta_nome_normalizado in ('PROSPECCAO','PROSPECCOES','FOLLOW UP','FOLLOWUP','FALLOW UP','INTERESSE FUTURO','2A TENTATIVA','LEAD QUENTE','QUENTE','AGUARDANDO','AGUARDANDO RESPOSTA','AGENDAMENTO','NOVO LEAD','NOVOS LEADS','LEAD NOVO') then 'aberto'
        when etiqueta_nome_normalizado in ('NUNCA RESPONDEU','NAO RESPONDEU MAIS','NAO TEM INTERESSE','COMPROU DO CONCORRENTE','NAO FABRICAMOS','FORA DO ORCAMENTO','SO BASE DE PRECO','RESOLVIDO','RESOLVIDOS') then 'morto'
        else 'outros' end as cat
    from public.wascript_etiquetas
  ),
  sit as (
    select public.fone_canon(w.phone) as fone_canon,
      case
        when bool_or(e.cat = 'vendido') then 'vendido'
        when bool_or(e.cat = 'aberto') then 'aberto'
        when bool_or(e.cat = 'morto') then 'morto'
        else 'outros' end as situacao
    from public.wa_chat_labels w
    cross join lateral unnest(w.label_ids) as lid(id)
    join etq e on e.id = lid.id
    where public.fone_canon(w.phone) is not null
    group by 1
  ),
  msg as (
    select public.fone_canon(w.phone) as fone_canon, max(w.last_message_at) as ultima_msg_wa
    from public.wa_chat_labels w
    where w.last_message_at is not null and public.fone_canon(w.phone) is not null
    group by 1
  )
  select coalesce(s.fone_canon, m.fone_canon), coalesce(s.situacao, 'outros'), m.ultima_msg_wa
  from sit s full join msg m on m.fone_canon = s.fone_canon;
$function$;
REVOKE ALL ON FUNCTION public.dashboard_fone_situacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_fone_situacao() TO authenticated, service_role;

-- 6) "X etiqueta Y% dos clientes que recebe": contava etiqueta posta em QUALQUER
--    WhatsApp (inclusive a PROSPECÇÃO automática da ANA) como se fosse do vendedor.
--    Agora só a etiqueta no WhatsApp do próprio vendedor; e `wa_capturado` diz se o
--    WhatsApp dele está sendo lido (JARDEL tinha 2 conversas contra 500+ dos outros —
--    a % dele seria 0 por falta de dado, não por falta de etiqueta).
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_vendedor_cobertura'::regproc);
  a1 text := E'    select distinct auditoria.wa_phone_strip9(wcl.phone) as pm\n    from public.wa_chat_labels wcl';
  b1 text := E'    select distinct auditoria.wa_phone_strip9(wcl.phone) as pm, split_part(upper(btrim(wcl.vendedor_nome)),'' '',1) as dono\n    from public.wa_chat_labels wcl';
  a2 text := E'      count(distinct la.pm) filter (where et.pm is null)     as sem_etiqueta\n    from la left join et on et.pm = la.pm';
  b2 text := E'      count(distinct la.pm) filter (where et.pm is null)     as sem_etiqueta,\n      coalesce((select count(*) >= 50 from public.wa_chat_labels w\n                where split_part(upper(btrim(w.vendedor_nome)),'' '',1) = split_part(upper(la.vendedor),'' '',1)), false) as wa_capturado\n    from la left join et on et.pm = la.pm and et.dono = split_part(upper(la.vendedor),'' '',1)';
BEGIN
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'dashboard_vendedor_cobertura mudou: trechos não encontrados 1 vez';
  END IF;
  EXECUTE replace(replace(d, a1, b1), a2, b2);
END
$mig$;
