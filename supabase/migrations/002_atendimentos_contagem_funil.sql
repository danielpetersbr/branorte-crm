-- ============================================================
-- RPC: atendimentos_contagem_funil
-- Conta atendimentos "abertos" vs "fechados" no estado ATUAL do funil
-- (etiqueta do WhatsApp), sobre a base INTEIRA (independe do filtro de data).
--
--   Aberto  = telefone SEM nenhuma etiqueta OU com alguma etiqueta de funil
--             ativo (PROSPECCAO / NOVO LEAD / FOLLOW UP / LEAD QUENTE).
--   Fechado = telefone com etiqueta(s), porém NENHUMA delas de funil ativo
--             (VENDIDO, ORCAMENTO ENVIADO, NAO TEM INTERESSE, etc.).
--
-- p_responsavel_prefix: 1º nome do vendedor logado (escopa: vê os seus +
--   não-atribuídos). NULL = admin (base inteira).
--
-- Usada em /atendimentos (badge "🟢 N em aberto") via useAtendimentoFunilContagem.
-- Aplicada em produção via MCP em 2026-07-10.
-- ============================================================
CREATE OR REPLACE FUNCTION public.atendimentos_contagem_funil(p_responsavel_prefix text DEFAULT NULL)
RETURNS TABLE(
  total                bigint,
  abertos              bigint,
  fechados             bigint,
  sem_etiqueta         bigint,
  com_etiqueta_aberta  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'auditoria', 'public'
AS $function$
  with atend as (
    select apc.telefone_norm, auditoria.wa_phone_strip9(apc.telefone) as pm
    from auditoria.atendimentos_por_cliente apc
    where apc.is_internal = false
      and apc.telefone_norm is not null and apc.telefone_norm <> ''
      and (
        p_responsavel_prefix is null
        or apc.responsavel ilike p_responsavel_prefix || '%'
        or apc.responsavel is null
        or apc.responsavel = ''
        or apc.responsavel = 'a definir'
      )
  ),
  labels as (
    select distinct auditoria.wa_phone_strip9(wcl.phone) as pm,
           we.etiqueta_nome_normalizado as et
    from public.wa_chat_labels wcl
    cross join lateral unnest(wcl.label_ids::int[]) lid(id)
    join public.wascript_etiquetas we
      on we.etiqueta_id_wascript = lid.id
     and we.vendedor_nome = wcl.vendedor_nome
  ),
  phone_labels as (
    select a.telefone_norm,
           bool_or(l.et is not null) as tem_qualquer,
           bool_or(l.et in (
             'PROSPECCAO','NOVO LEAD',
             'FOLLOW UP','FALLOW UP','FOLLOWUP',
             'LEAD QUENTE','QUENTE'
           )) as tem_aberta
    from atend a
    left join labels l on l.pm = a.pm
    group by a.telefone_norm
  )
  select
    count(*)::bigint                                                      as total,
    count(*) filter (where (not tem_qualquer) or tem_aberta)::bigint      as abertos,
    count(*) filter (where tem_qualquer and not tem_aberta)::bigint       as fechados,
    count(*) filter (where not tem_qualquer)::bigint                      as sem_etiqueta,
    count(*) filter (where tem_aberta)::bigint                            as com_etiqueta_aberta
  from phone_labels;
$function$;

grant execute on function public.atendimentos_contagem_funil(text) to anon, authenticated;
