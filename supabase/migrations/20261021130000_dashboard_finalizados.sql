-- Dashboard › Visão geral: "Atendimentos finalizados" no período, por motivo = a etiqueta de encerramento que o vendedor (ou a Ana)
-- pôs no WhatsApp (21/10/2026, pedido do Daniel: "um gráfico mostrando quantos atendimentos finalizamos e qual foi o motivo, que
-- seria a etiqueta que foi colocada").
--
-- Fonte: wa_etiqueta_movimentos (toda troca de etiqueta que a extensão vê). Lida direto é pesada demais pro Dashboard: 2,7 mi de linhas,
-- 425 mil só de etiqueta de encerramento em outubro (cópias duplicadas da extensão trocam etiqueta sem parar), 38 s pra contar o mês.
-- Então: um resumo por conversa e dia (dash_fechamentos_dia), alimentado pelo id da movimentação a cada 2 min (dash_fechamentos_tick),
-- e a RPC do Dashboard lê só o resumo.
--
-- Só conta TROCA de verdade (etiqueta_de preenchida): movimento "do nada" é quase sempre a extensão relendo o WhatsApp do zero (cópia
-- nova, recarga — em 21/10 o EDER e o JARDEL geraram 60 "VENDIDO" assim numa manhã; na semana, 2.093 conversas "do nada" contra 671
-- trocas reais). E cada conversa entra no período pela PRIMEIRA vez que chegou naquela etiqueta: o vai e volta das cópias duplicadas
-- (133 mil movimentos dessas 671 conversas na semana) não conta de novo.

-- etiqueta de encerramento → motivo mostrado no gráfico (NULL = não encerra atendimento). Nome já normalizado (o mesmo de etiqueta_para).
create or replace function public.etiqueta_motivo_fechamento(p_nome text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_nome in ('VENDIDO', 'VENDIDOS') then 'Vendido'
    when p_nome = 'NAO RESPONDEU MAIS' then 'Não respondeu mais'
    when p_nome = 'NUNCA RESPONDEU' then 'Nunca respondeu'
    when p_nome = 'NAO TEM INTERESSE' then 'Não tem interesse'
    when p_nome in ('COMPROU DO CONCORRENTE', 'COMPROU DO COMCORRENTE', 'COMPROU NA CONCORRENCIA') then 'Comprou do concorrente'
    when p_nome = 'FORA DO ORCAMENTO' then 'Fora do orçamento'
    when p_nome in ('SO BASE DE PRECO', 'BASE DE PRECO') then 'Só base de preço'
    when p_nome = 'NAO FABRICAMOS' then 'Não fabricamos'
    when p_nome = 'OUTROS ASSUNTOS' then 'Outros assuntos'
    when p_nome = 'TRANSPORTADORAS' then 'Transportadora'
    when p_nome = 'SUPORTE TECNICO' then 'Suporte técnico'
    when p_nome = 'INTERESSE FUTURO' then 'Interesse futuro'
    when p_nome in ('RESOLVIDO', 'RESOLVIDOS') then 'Resolvido'
  end
$fn$;

-- uma linha por conversa (conta + telefone), dia do Brasil e etiqueta de encerramento: a última vez no dia
create table if not exists public.dash_fechamentos_dia (
  vendedor_nome text not null,
  phone text not null,
  dia date not null,
  etiqueta text not null,
  ultimo_em timestamptz not null,
  primary key (vendedor_nome, phone, dia, etiqueta)
);
create index if not exists dash_fechamentos_dia_dia on public.dash_fechamentos_dia (dia);
alter table public.dash_fechamentos_dia enable row level security;   -- sem policy: só as funções abaixo leem
comment on table public.dash_fechamentos_dia is
  'Resumo de wa_etiqueta_movimentos para o Dashboard (Atendimentos finalizados): conversa × dia × etiqueta de encerramento. Alimentado por dash_fechamentos_tick (pg_cron dash-fechamentos-2min).';

create table if not exists public.dash_fechamentos_cursor (
  id int primary key default 1 check (id = 1),
  ultimo_id bigint not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.dash_fechamentos_cursor enable row level security;
insert into public.dash_fechamentos_cursor (id, ultimo_id) values (1, 0) on conflict (id) do nothing;

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
  insert into public.dash_fechamentos_dia (vendedor_nome, phone, dia, etiqueta, ultimo_em)
  select m.vendedor_nome, m.phone, (m.detectado_em at time zone 'America/Sao_Paulo')::date, m.etiqueta_para, max(m.detectado_em)
  from public.wa_etiqueta_movimentos m
  where m.id > v_de and m.id <= v_ate
    and m.phone is not null and m.vendedor_nome is not null and m.detectado_em is not null
    and m.etiqueta_de is not null   -- troca de verdade; "do nada" é releitura do WhatsApp
    and public.etiqueta_motivo_fechamento(m.etiqueta_para) is not null
  group by 1, 2, 3, 4
  on conflict (vendedor_nome, phone, dia, etiqueta) do update set ultimo_em = greatest(public.dash_fechamentos_dia.ultimo_em, excluded.ultimo_em);
  update public.dash_fechamentos_cursor set ultimo_id = v_ate, atualizado_em = now() where id = 1;
  return v_n;
end
$fn$;
revoke all on function public.dash_fechamentos_tick(int) from public, anon, authenticated;

-- RPC do Dashboard: conta a conversa no período em que ela chegou PELA PRIMEIRA VEZ numa etiqueta de encerramento; se no período ela
-- chegou em duas, vale a última (a etiqueta que ficou)
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
  with primeira as (
    select vendedor_nome, phone, etiqueta, min(dia) as dia, min(ultimo_em) as em
    from public.dash_fechamentos_dia group by vendedor_nome, phone, etiqueta
  ),
  r as (
    select vendedor_nome, phone, etiqueta, em as ultimo_em from primeira
    where (de is null or dia >= de) and (ate is null or dia < ate)
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
  'Dashboard › Atendimentos finalizados: conversas que receberam etiqueta de encerramento no período, cada uma pelo último encerramento (dash_fechamentos_dia).';
revoke all on function public.dashboard_finalizados(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_finalizados(timestamptz, timestamptz) to authenticated, service_role;

-- a cada 2 min lê as movimentações novas (job 99, criado em 21/10/2026 depois de preencher o histórico com chamadas de 250 mil)
select cron.schedule('dash-fechamentos-2min', '*/2 * * * *', $$set statement_timeout = '25s'; set lock_timeout = '2s'; select public.dash_fechamentos_tick(100000)$$);
