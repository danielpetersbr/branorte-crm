-- Runtime da IA, separado da fila de leads sem responsável e dos filtros históricos.
-- Mantém o contrato da RPC. A leitura respeita as RLS do chamador e não altera chats.
create or replace function public.ia_status_contagem()
returns jsonb language sql stable security invoker set search_path=''
as $function$
  with base as (
    select public.fone_canon(cl.phone) as canon,
      coalesce(ia.respostas_hoje,0) > 0
        and ia.dia_ref=(current_timestamp at time zone 'America/Sao_Paulo')::date as respondeu_hoje
    from public.ia_atendimentos ia
    join public.wa_chat_labels cl on cl.chat_id=ia.chat_id and cl.vendedor_nome=ia.vendedor_nome
    where ia.ativo is true and ia.estado='AI_ACTIVE'
      and ia.bloqueado_em is null and ia.motivo_desligamento is null
      and public.fone_canon(cl.phone) is not null
  )
  select jsonb_build_object(
    'ligados',count(distinct canon),
    'conversando',count(distinct canon) filter(where respondeu_hoje)
  ) from base;
$function$;
revoke all on function public.ia_status_contagem() from public,anon;
grant execute on function public.ia_status_contagem() to authenticated,service_role;
notify pgrst,'reload schema';
