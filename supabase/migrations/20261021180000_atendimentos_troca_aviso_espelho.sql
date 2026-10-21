-- Aviso "sem espelho" do cartão Atendimentos hoje sem alarme falso (21/10/2026, issue #227).
--
-- A 1ª versão comparava TODAS as conversas mexidas hoje na lista (wa_chat_labels) com as que o espelho copiou. Só que o
-- espelho da extensão copia, de propósito, só o FUNIL (Prospecção, 2ª tentativa, Novo lead, Follow up, Lead quente) e lead
-- novo sem etiqueta — e em 21/10 ALVARO, DANIEL e EDILSON JR mexeram quase só em conversa de RESOLVIDOS, VENDIDO, BRANORTE
-- (fora do escopo) ou que só recebeu aviso de sistema do WhatsApp (notification_template, sem mensagem nenhuma). O cartão
-- dizia "sem espelho" e o espelho estava certo: nas conversas do funil, copiou 32/32 da Ana, 27/29 do Eder, 25/25 do Gustavo,
-- 1/1 do Álvaro e do Daniel (conferido também lendo o WhatsApp Web do Daniel: o getMessages traz as mensagens).
-- Agora só conta conversa de FUNIL mexida hoje: avisa quando há 4 ou mais e o espelho copiou menos da metade.
-- (3ª tentativa fica de fora da conta até a extensão 1.70.64, que passa a copiá-la, chegar na frota.)

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
  -- conversas do FUNIL mexidas hoje (o escopo do espelho da extensão) e se o espelho tem mensagem de hoje delas
  funil_hoje as (
    select l.vendedor_nome conta, l.chat_id,
           exists (select 1 from msgs m where m.eh_hoje and m.conta = l.vendedor_nome and m.chat_id = l.chat_id) copiada
    from public.wa_chat_labels l
    where l.last_message_at >= v_hoje and l.chat_id not like '%@g.us' and l.chat_id not like '%@broadcast'
      and exists (select 1 from unnest(l.label_ids::int[]) lid(id)
                  join public.wascript_etiquetas we on we.vendedor_nome = l.vendedor_nome and we.etiqueta_id_wascript = lid.id
                  where we.etiqueta_nome_normalizado ~ '^(PROSPECC(AO|OES)|2A TENTATIVA|NOVOS? LEADS?|LEAD NOVO|FOLLOW ?UP|FALLOW ?UP|LEAD QUENTE|QUENTE)$')
  ),
  saude as (
    select conta, count(*) chats, count(*) filter (where copiada) copiadas from funil_hoje group by conta
  )
  select jsonb_build_object(
    'hoje',              (select count(*) from cli where eh_hoje),
    'hoje_com_vendedor', (select count(*) from cli where eh_hoje and com_vendedor),
    'hoje_so_ana',       (select count(*) from cli where eh_hoje and not com_vendedor),
    'ontem',             (select count(*) from cli where not eh_hoje),
    'ontem_ate_agora',   (select count(*) from cli where not eh_hoje and quando <= now() - interval '1 day'),
    'sem_espelho',       coalesce((select jsonb_agg(s.conta order by s.conta)
                                   from saude s where s.chats >= 4 and s.copiadas < s.chats * 0.5), '[]'::jsonb)
  ) into v;
  return v;
end
$function$;

revoke all on function public.dashboard_atendimentos_troca() from public, anon;
grant execute on function public.dashboard_atendimentos_troca() to authenticated, service_role;
