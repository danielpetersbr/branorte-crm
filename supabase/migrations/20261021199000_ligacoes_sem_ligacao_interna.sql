-- Ligações (Dashboard › Visão geral e tela Ligações), 21/10/2026, auditoria pedida pelo Daniel: ligação entre números da CASA
-- (um vendedor ligando pro outro) contava como ligação com cliente e em dobro (aparece nas duas pontas: feita num, recebida no
-- outro), e o eco órfão do WhatsApp (call_id …_out sem a ligação de verdade; o gatilho wa_ligacoes_normaliza deixa peer NULL)
-- contava como feita. Em 21/10: 90 → 85 tentativas e 26 → 24 conversadas; em 30 dias saíram 112 feitas e 81 recebidas.
-- Já aplicado no banco em 21/10; este arquivo guarda a versão exata.

CREATE OR REPLACE FUNCTION public.wa_ligacoes_lids_frota()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- (21/10/2026) Identificador (LID) de cada conta da frota: numa ligação FEITA, o criador é a própria conta.
  -- Usado pelas RPCs de ligação pra tirar ligação entre números da casa (aparece nas duas pontas).
  select distinct regexp_replace(l.payload->>'criador', ':\d+@', '@')
  from public.wa_ligacoes l
  where l.outgoing is true and l.payload ? 'criador' and l.payload->>'criador' like '%@lid'
$function$;
revoke all on function public.wa_ligacoes_lids_frota() from public, anon;
grant execute on function public.wa_ligacoes_lids_frota() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ligacoes_resumo(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_vendedor text DEFAULT NULL::text)
 RETURNS TABLE(vendedor text, fez integer, recebeu integer, atendidas integer, atendidas_fez integer, perdidas integer, perdidas_recebidas integer, retornadas integer, tempo_seg bigint, dur_media integer, clientes integer, clientes_fez integer, clientes_recebeu integer, clientes_falados integer, video_fez integer, clientes_video integer, ultima timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select l.*,
      (l.outgoing is false and l.estado in ('Missed','Rejected','miss','Canceled')) as sem_atender
    from public.wa_ligacoes l
    where l.offer_time is not null
      and (p_from is null or l.offer_time >= p_from)
      and (p_to   is null or l.offer_time <  p_to)
      and (p_vendedor is null or l.vendedor_nome = p_vendedor)
      -- (21/10/2026) fora: ligação entre números da casa (o contato é o LID de uma conta da frota e a mesma
      -- chamada aparece nas duas pontas) e eco órfão do WhatsApp (call_id …_out sem a de verdade; peer NULL)
      and not (l.peer is null and l.call_id like '%\_out')
      and (l.peer is null or l.peer not in (select public.wa_ligacoes_lids_frota()))
  ),
  marc as (
    -- a busca do retorno NÃO é limitada pela janela: chamada perdida às 17h50 pode ter
    -- sido devolvida às 18h10, já fora do período que o gestor está olhando.
    select b.*,
      (b.sem_atender and b.peer is not null and exists (
        select 1 from public.wa_ligacoes o
        where o.vendedor_nome = b.vendedor_nome
          and o.peer = b.peer
          and o.outgoing is true
          and o.offer_time >  b.offer_time
          and o.offer_time <  b.offer_time + interval '2 hours'
      )) as retornou
    from base b
  )
  select
    m.vendedor_nome,
    count(*) filter (where m.outgoing is true)::int,
    count(*) filter (where m.outgoing is false)::int,
    count(*) filter (where m.estado in ('Completed','AcceptedElsewhere'))::int,
    count(*) filter (where m.outgoing is true and m.estado in ('Completed','AcceptedElsewhere'))::int,
    -- só das FEITAS
    count(*) filter (where m.outgoing is true and m.estado in ('Missed','Rejected','miss'))::int,
    -- chamada de cliente que ficou sem atendimento, tendo ele desligado antes ou não
    count(*) filter (where m.sem_atender)::int,
    count(*) filter (where m.retornou)::int,
    coalesce(sum(m.duracao_seg),0)::bigint,
    coalesce(round(avg(m.duracao_seg) filter (where m.duracao_seg > 0)),0)::int,
    count(distinct m.peer)::int,
    count(distinct m.peer) filter (where m.outgoing is true)::int,
    count(distinct m.peer) filter (where m.outgoing is false)::int,
    -- com quem ele CONVERSOU: contato distinto com chamada atendida, nos dois sentidos
    count(distinct m.peer) filter (where m.estado in ('Completed','AcceptedElsewhere'))::int,
    count(*) filter (where m.is_video and m.outgoing is true)::int,
    count(distinct m.peer) filter (where m.is_video and m.outgoing is true)::int,
    max(m.offer_time)
  from marc m
  group by m.vendedor_nome
$function$;

CREATE OR REPLACE FUNCTION public.ligacoes_serie_dia(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_vendedor text DEFAULT NULL::text)
 RETURNS TABLE(dia date, feitas integer, atendidas integer, perdidas integer, video integer, recebidas integer)
 LANGUAGE sql
 STABLE
AS $function$
  select
    (l.offer_time at time zone 'America/Sao_Paulo')::date,
    count(*) filter (where l.outgoing is true)::int,
    count(*) filter (where l.outgoing is true and l.estado in ('Completed','AcceptedElsewhere'))::int,
    count(*) filter (where l.outgoing is true and l.estado in ('Missed','Rejected','miss'))::int,
    count(*) filter (where l.outgoing is true and l.is_video)::int,
    count(*) filter (where l.outgoing is false)::int
  from public.wa_ligacoes l
  where l.offer_time is not null
    and (p_from is null or l.offer_time >= p_from)
    and (p_to   is null or l.offer_time <  p_to)
    and (p_vendedor is null or l.vendedor_nome = p_vendedor)
      -- (21/10/2026) fora: ligação entre números da casa (o contato é o LID de uma conta da frota e a mesma
    -- chamada aparece nas duas pontas) e eco órfão do WhatsApp (call_id …_out sem a de verdade; peer NULL)
    and not (l.peer is null and l.call_id like '%\_out')
    and (l.peer is null or l.peer not in (select public.wa_ligacoes_lids_frota()))
  group by 1
$function$;

CREATE OR REPLACE FUNCTION public.ligacoes_por_hora(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_vendedor text DEFAULT NULL::text)
 RETURNS TABLE(hora integer, feitas integer, atenderam integer)
 LANGUAGE sql
 STABLE
AS $function$
  select
    extract(hour from l.offer_time at time zone 'America/Sao_Paulo')::int,
    count(*)::int,
    count(*) filter (where l.estado in ('Completed','AcceptedElsewhere'))::int
  from public.wa_ligacoes l
  where l.outgoing is true and l.offer_time is not null
    and (p_from is null or l.offer_time >= p_from)
    and (p_to   is null or l.offer_time <  p_to)
    and (p_vendedor is null or l.vendedor_nome = p_vendedor)
      -- (21/10/2026) fora: ligação entre números da casa (o contato é o LID de uma conta da frota e a mesma
    -- chamada aparece nas duas pontas) e eco órfão do WhatsApp (call_id …_out sem a de verdade; peer NULL)
    and not (l.peer is null and l.call_id like '%\_out')
    and (l.peer is null or l.peer not in (select public.wa_ligacoes_lids_frota()))
  group by 1
$function$;
