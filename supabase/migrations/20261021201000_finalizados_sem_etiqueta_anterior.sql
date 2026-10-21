-- Dashboard › "Atendimentos finalizados" (21/10/2026, auditoria pedida pelo Daniel): o cartão perdia encerramento de verdade.
--
-- 1. dash_fechamentos_tick só aceitava troca com etiqueta_de preenchida. Ficavam de fora dois casos legítimos:
--    (a) conversa que nunca teve etiqueta naquela conta e recebe direto uma de encerramento, com conversa nas 48 h antes
--        (ex.: ANA …8127 escreveu 09:36, RESOLVIDO 09:38);
--    (b) troca gravada em dois passos: X → vazio e, em até 2 min, vazio → encerramento (X diferente do encerramento).
--    A releitura do WhatsApp (cópia nova da extensão, recarga) continua fora: movimento "do nada" numa RAJADA da mesma conta
--    (mais de 30 em ±2 min) não entra, e o vai e volta da mesma etiqueta (X → vazio → X) também não. Medido de 14 a 21/10:
--    2 a 20 encerramentos por dia a mais (sem o filtro de rajada, o caso (b) dava 4.587 só do EDER em 15/10).
--    A regra mora em dash_fechamentos_processa(de, ate), que o tick usa e que serve pra refazer o histórico por faixa de id.
-- 2. dashboard_finalizados: a conversa contava só na PRIMEIRA vez da vida em cada etiqueta. Cliente que volta e é encerrado
--    de novo com a mesma etiqueta não contava mais (EDER …5888 "SÓ BASE DE PREÇO" em 09/06 e de novo em 21/10). Agora conta de
--    novo se a mesma etiqueta não apareceu nos 30 dias antes E ele mandou mensagem nos 7 dias antes (sem a exigência da
--    mensagem, releitura de etiqueta velha virava "volta": 65 num dia só).

create or replace function public.dash_fechamentos_processa(p_de bigint, p_ate bigint)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare v_n int;
begin
  with mov as materialized (
    select m.id, m.vendedor_nome, m.phone, m.chat_id, m.etiqueta_de, m.etiqueta_para, m.detectado_em
    from public.wa_etiqueta_movimentos m
    where m.id > p_de and m.id <= p_ate and m.vendedor_nome is not null and m.detectado_em is not null
  ),
  -- releitura do WhatsApp: etiquetas "do nada" da mesma conta, somadas em ±2 min (uma conta por conta e minuto)
  rajada as (
    select vendedor_nome, minuto,
           sum(n) over (partition by vendedor_nome order by minuto
                        range between interval '2 minutes' preceding and interval '2 minutes' following) as n5
    from (select vendedor_nome, date_trunc('minute', detectado_em) as minuto, count(*) as n
          from mov where etiqueta_de is null group by 1, 2) x
  ),
  fech as materialized (
    select * from mov where phone is not null and public.etiqueta_motivo_fechamento(etiqueta_para) is not null
  ),
  -- encerramento "do nada" fora de rajada: só esses passam pelas checagens (a) e (b)
  cand as materialized (
    select f.* from fech f
    join rajada r on r.vendedor_nome = f.vendedor_nome and r.minuto = date_trunc('minute', f.detectado_em)
    where f.etiqueta_de is null and r.n5 <= 30
  ),
  valido as (
    select vendedor_nome, phone, etiqueta_para, detectado_em from fech where etiqueta_de is not null   -- troca de verdade
    union all
    select c.vendedor_nome, c.phone, c.etiqueta_para, c.detectado_em from cand c
    where
      -- (a) conversa sem nenhuma etiqueta antes nesta conta, com conversa nas 48 h antes
      (not exists (select 1 from public.wa_etiqueta_movimentos p
                   where p.phone = c.phone and p.vendedor_nome = c.vendedor_nome and p.detectado_em < c.detectado_em)
       and exists (select 1 from public.wa_chat_messages w
                   where w.vendedor_nome = c.vendedor_nome and w.chat_id = c.chat_id
                     and w.data_msg >= c.detectado_em - interval '48 hours' and w.data_msg <= c.detectado_em + interval '5 minutes'))
      -- (b) troca em dois passos: X → vazio há menos de 2 min, X diferente do encerramento
      or exists (select 1 from public.wa_etiqueta_movimentos p
                 where p.phone = c.phone and p.vendedor_nome = c.vendedor_nome
                   and p.detectado_em < c.detectado_em and p.detectado_em >= c.detectado_em - interval '2 minutes'
                   and p.etiqueta_de is not null and p.etiqueta_para is null and p.etiqueta_de is distinct from c.etiqueta_para)
  ),
  ins as (
    insert into public.dash_fechamentos_dia (vendedor_nome, phone, dia, etiqueta, ultimo_em)
    select v.vendedor_nome, v.phone, (v.detectado_em at time zone 'America/Sao_Paulo')::date, v.etiqueta_para, max(v.detectado_em)
    from valido v
    group by 1, 2, 3, 4
    on conflict (vendedor_nome, phone, dia, etiqueta) do update set ultimo_em = greatest(public.dash_fechamentos_dia.ultimo_em, excluded.ultimo_em)
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end
$fn$;
revoke all on function public.dash_fechamentos_processa(bigint, bigint) from public, anon, authenticated;

-- processa as movimentações novas (id > cursor), no máximo p_lote por chamada; devolve quantas leu
create or replace function public.dash_fechamentos_tick(p_lote int default 100000)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare v_de bigint; v_ate bigint; v_n int;
begin
  -- uma por vez (pg_cron + chamada à mão no mesmo minuto)
  if not pg_try_advisory_xact_lock(hashtext('dash_fechamentos_tick')) then return 0; end if;
  select ultimo_id into v_de from public.dash_fechamentos_cursor where id = 1 for update;
  select max(id), count(*) into v_ate, v_n
    from (select id from public.wa_etiqueta_movimentos where id > v_de order by id limit p_lote) s;
  if v_ate is null then return 0; end if;
  perform public.dash_fechamentos_processa(v_de, v_ate);
  update public.dash_fechamentos_cursor set ultimo_id = v_ate, atualizado_em = now() where id = 1;
  return v_n;
end
$fn$;
revoke all on function public.dash_fechamentos_tick(int) from public, anon, authenticated;

-- RPC do Dashboard: a conversa conta no dia em que chegou numa etiqueta de encerramento que ela não tinha recebido nos 30 dias antes;
-- se no período ela chegou em duas, vale a última (a etiqueta que ficou)
create or replace function public.dashboard_finalizados(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare de date; ate date; v jsonb;
begin
  -- SECURITY DEFINER passa por cima da RLS (inclusive a RESTRICTIVE bloqueia_papel_restrito): papel externo não lê nada
  if public.papel_restrito() then return null; end if;
  de := case when p_from is null then null else (p_from at time zone 'America/Sao_Paulo')::date end;
  ate := case when p_to is null then null else (p_to at time zone 'America/Sao_Paulo')::date end;   -- exclusivo
  with d as (
    select vendedor_nome, phone, etiqueta, dia, ultimo_em,
           lag(dia) over (partition by vendedor_nome, phone, etiqueta order by dia) as dia_ant
    from public.dash_fechamentos_dia
  ),
  r as (
    select d.vendedor_nome, d.phone, d.etiqueta, d.ultimo_em from d
    where (de is null or d.dia >= de) and (ate is null or d.dia < ate)
      and (d.dia_ant is null
           -- cliente que VOLTA: a mesma etiqueta só conta de novo depois de 30 dias e se ele mandou mensagem nos 7 dias antes
           -- (sem a mensagem, era releitura de etiqueta velha: 06/10 dava 65 "voltas" em 3 contas, só 1 com conversa)
           or (d.dia_ant < d.dia - 30
               and exists (select 1 from public.wa_chat_messages w
                           where w.vendedor_nome = d.vendedor_nome and not w.from_me
                             and auditoria.wa_phone_strip9(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'))
                                 = auditoria.wa_phone_strip9(regexp_replace(d.phone, '\D', '', 'g'))
                             and w.data_msg between d.ultimo_em - interval '7 days' and d.ultimo_em)))
  ),
  ult as (
    select distinct on (vendedor_nome, phone) vendedor_nome, etiqueta
    from r order by vendedor_nome, phone, ultimo_em desc
  ),
  m as (select public.etiqueta_motivo_fechamento(etiqueta) as motivo, vendedor_nome = 'ANA' as ana from ult)
  select jsonb_build_object(
    'total', (select count(*) from m),
    'ana', (select count(*) from m where ana),
    'por_motivo', coalesce((
      select jsonb_agg(jsonb_build_object('motivo', motivo, 'total', total, 'ana', ana_n) order by total desc, motivo)
      from (select motivo, count(*)::int as total, count(*) filter (where ana)::int as ana_n from m group by motivo) t), '[]'::jsonb),
    'lido_ate', (select atualizado_em from public.dash_fechamentos_cursor where id = 1)
  ) into v;
  return v;
end
$fn$;
comment on function public.dashboard_finalizados(timestamptz, timestamptz) is
  'Dashboard › Atendimentos finalizados: conversas que receberam etiqueta de encerramento no período (sem a mesma etiqueta nos 30 dias antes), cada uma pelo último encerramento (dash_fechamentos_dia).';
revoke all on function public.dashboard_finalizados(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_finalizados(timestamptz, timestamptz) to authenticated, service_role;
