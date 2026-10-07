-- Aberto é atendimento em etapa ativa, de Prospecção até Lead quente.
-- Sem etiqueta e etiquetas fora dessas etapas não são atendimentos abertos.
-- Um encerramento prevalece sobre uma etapa antiga que ficou pendurada.
-- Prioriza etiquetas da conta do responsável, quando disponíveis: fechamento
-- antigo em outro WhatsApp não pode encerrar o atendimento do vendedor atual.
-- Mantém contrato, permissões e escopo por vendedor da RPC existente.
create or replace function public.atendimentos_contagem_funil(p_responsavel_prefix text default null)
returns table(total bigint, abertos bigint, fechados bigint, sem_etiqueta bigint, com_etiqueta_aberta bigint)
language sql stable security definer
set search_path to 'auditoria', 'public'
as $function$
  with atend as (
    select apc.telefone_norm, auditoria.wa_phone_strip9(apc.telefone) as pm,
           translate(upper(split_part(btrim(apc.responsavel), ' ', 1)),
                     'ÁÀÂÃÉÈÊÍÓÔÕÚÇ', 'AAAAEEEIOOOUC') as dono
    from auditoria.atendimentos_por_cliente apc
    where apc.is_internal = false
      and apc.telefone_norm is not null and apc.telefone_norm <> ''
      and (
        p_responsavel_prefix is null
        or apc.responsavel ilike p_responsavel_prefix || '%'
        or apc.responsavel is null or apc.responsavel = '' or apc.responsavel = 'a definir'
      )
  ),
  labels as (
    select distinct auditoria.wa_phone_strip9(wcl.phone) as pm,
           translate(upper(split_part(btrim(wcl.vendedor_nome), ' ', 1)),
                     'ÁÀÂÃÉÈÊÍÓÔÕÚÇ', 'AAAAEEEIOOOUC') as vendedor,
           public.wa_etiqueta_canonica(we.etiqueta_nome_normalizado) as et
    from public.wa_chat_labels wcl
    cross join lateral unnest(wcl.label_ids::int[]) lid(id)
    join public.wascript_etiquetas we
      on we.etiqueta_id_wascript = lid.id and we.vendedor_nome = wcl.vendedor_nome
  ),
  contas as (select distinct pm, vendedor from labels),
  phone_labels as (
    select a.telefone_norm,
           bool_or(l.et is not null) as tem_qualquer,
           coalesce(bool_or(l.et in (
             'PROSPECCAO', '2A TENTATIVA', '3A TENTATIVA', '4A TENTATIVA',
             'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE'
           )), false) as tem_aberta,
           coalesce(bool_or(l.et in (
             'VENDIDO', 'NAO RESPONDEU MAIS', 'NUNCA RESPONDEU', 'NAO TEM INTERESSE',
             'COMPROU DO CONCORRENTE', 'SO BASE DE PRECO', 'BASE DE PRECO',
             'FORA DO ORCAMENTO', 'NAO FABRICAMOS', 'OUTROS ASSUNTOS', 'RESOLVIDO',
             'ORCAMENTO ENVIADO', 'INTERESSE FUTURO'
           )), false) as tem_encerrada
    from atend a
    left join contas dono on dono.pm = a.pm and dono.vendedor = a.dono
    left join labels l on l.pm = a.pm and (l.vendedor = a.dono or dono.pm is null)
    group by a.telefone_norm
  )
  select count(*)::bigint,
         count(*) filter (where tem_aberta and not tem_encerrada)::bigint,
         count(*) filter (where tem_qualquer and (not tem_aberta or tem_encerrada))::bigint,
         count(*) filter (where not tem_qualquer)::bigint,
         count(*) filter (where tem_aberta and not tem_encerrada)::bigint
  from phone_labels;
$function$;
