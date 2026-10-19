-- Aplicada em 19/10/2026 logo depois da 20261019160000: dashboard_fone_situacao passou
-- a devolver só vendido/morto ou mensagem no WhatsApp nos últimos 15 dias (o card de
-- risco olha 14). Com as linhas "aberto" sem uso a resposta chegava a 7.857 linhas,
-- perto do corte SILENCIOSO de 10.000 do PostgREST; agora são ~4.700.
-- (Definição completa: a mesma da 20261019160000, com `msg` filtrado em 15 dias e
--  `where s.situacao in ('vendido','morto') or m.ultima_msg_wa is not null` no final.)
SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.dashboard_fone_situacao()
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
    where w.last_message_at >= now() - interval '15 days' and public.fone_canon(w.phone) is not null
    group by 1
  )
  select coalesce(s.fone_canon, m.fone_canon), coalesce(s.situacao, 'outros'), m.ultima_msg_wa
  from sit s full join msg m on m.fone_canon = s.fone_canon
  where s.situacao in ('vendido','morto') or m.ultima_msg_wa is not null;
$function$;
