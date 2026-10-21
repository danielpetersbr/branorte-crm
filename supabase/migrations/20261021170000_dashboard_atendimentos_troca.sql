-- "Atendimentos hoje" do Dashboard pela régua do Daniel (21/10/2026, issue #227): "pra considerar um atendimento tem que ter
-- troca de mensagem: o cliente mandou, o vendedor mandou, o cliente mandou e o vendedor mandou".
--
-- Régua:
--   . ida e volta = vez do cliente (uma ou mais mensagens seguidas dele) seguida de vez da Branorte (Ana, vendedor ou dono);
--   . atendimento = conversa com 2 idas e voltas ou mais NO MESMO DIA (horário de Brasília);
--   . 1 por cliente por dia: quem fala com a Ana e depois com o vendedor conta uma vez (telefone canônico, ou o chat @lid);
--     `hoje_com_vendedor` = teve as 2 idas e voltas com um vendedor; `hoje_so_ana` = só com a Ana;
--   . mensagem de verdade (texto, áudio, foto, vídeo, documento, figurinha, localização, contato); ligação não conta;
--   . grupo, lista de transmissão e conversa com número da casa (vendors.telefone) ficam de fora.
-- Fonte: o espelho de mensagens (wa_chat_messages). Conta cujo espelho não está copiando aparece em `sem_espelho`: a lista de
-- conversas (wa_chat_labels) tem 3+ conversas mexidas hoje e o espelho tem menos da metade disso.
-- `ontem_ate_agora` = clientes de ontem que já tinham as 2 idas e voltas na mesma hora de agora (a hora da 2ª).
--
-- Antes o cartão contava LEAD NOVO (primeira_data de hoje em atendimentos_por_cliente, dentro de dashboard_extra, que segue
-- igual): em 21/10 às 14h dava 49 contra 64 por esta régua (22 com vendedor, 42 só com a Ana); 20/10 inteiro, 77 × 109.
-- Uns 90 ms: o synced_at tem índice e nunca é anterior à mensagem, então 2 dias de espelho saem sem varrer a tabela.

create or replace function public.dashboard_atendimentos_troca()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_ontem timestamptz := v_hoje - interval '1 day';
begin
  if public.papel_restrito() then return null; end if;

  with internos as (
    select distinct public.fone_canon(vd.telefone) k from public.vendors vd where public.fone_canon(vd.telefone) is not null
  ),
  msgs as (
    select x.id, x.vendedor_nome conta, x.chat_id, coalesce(public.fone_canon(x.phone), x.chat_id) k, x.from_me, x.data_msg,
           (x.data_msg >= v_hoje) eh_hoje
    from public.wa_chat_messages x
    where x.synced_at >= v_ontem - interval '2 hours'
      and x.data_msg >= v_ontem and x.data_msg < now()
      and x.chat_id not like '%@g.us' and x.chat_id not like '%@broadcast' and x.chat_id not like '%@newsletter'
      and x.tipo in ('chat','ptt','audio','image','video','document','sticker','location','vcard')
  ),
  seq as (
    select m.*, lag(m.from_me) over (partition by m.eh_hoje, m.conta, m.chat_id order by m.data_msg, m.id) ant
    from msgs m
  ),
  conv as (  -- idas e voltas de cada conversa no dia (vez nossa logo depois de vez do cliente) e a hora da 2ª
    select eh_hoje, conta, chat_id, k, count(*) n, (array_agg(data_msg order by data_msg))[2] segunda
    from seq where from_me and ant = false
    group by 1, 2, 3, 4
  ),
  cli as (
    select eh_hoje, k, bool_or(conta <> 'ANA') com_vendedor, min(segunda) quando
    from conv
    where n >= 2 and k not in (select k from internos)
    group by 1, 2
  ),
  espelho as (select conta, count(distinct chat_id) chats from msgs where eh_hoje group by conta),
  lista as (
    select l.vendedor_nome conta, count(*) chats
    from public.wa_chat_labels l
    where l.last_message_at >= v_hoje and l.chat_id not like '%@g.us' and l.chat_id not like '%@broadcast'
    group by 1
  )
  select jsonb_build_object(
    'hoje',              (select count(*) from cli where eh_hoje),
    'hoje_com_vendedor', (select count(*) from cli where eh_hoje and com_vendedor),
    'hoje_so_ana',       (select count(*) from cli where eh_hoje and not com_vendedor),
    'ontem',             (select count(*) from cli where not eh_hoje),
    'ontem_ate_agora',   (select count(*) from cli where not eh_hoje and quando <= now() - interval '1 day'),
    'sem_espelho',       coalesce((select jsonb_agg(l.conta order by l.conta)
                                   from lista l left join espelho e on e.conta = l.conta
                                   where l.chats >= 3 and coalesce(e.chats, 0) < l.chats * 0.5), '[]'::jsonb)
  ) into v;
  return v;
end
$function$;

revoke all on function public.dashboard_atendimentos_troca() from public, anon;
grant execute on function public.dashboard_atendimentos_troca() to authenticated, service_role;
