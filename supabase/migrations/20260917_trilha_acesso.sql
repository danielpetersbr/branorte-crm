-- Trilha de acesso + janela de horário por usuário/rota.
--
-- Contexto (auditoria de 16/09/2026): o CRM não tinha NENHUM rastro de acesso.
-- auth.audit_log_entries vem com ip_address vazio (bug do GoTrue), auth.sessions
-- é foto do agora e as 75 sessões nunca expiram — por isso a trava de horário
-- NÃO pode morar no login: ela mora no dado (RLS) e na navegação.
--
-- Postura: FAIL-OPEN. Quem não tem janela cadastrada acessa normalmente.
-- A trava é opt-in por usuário, feita em /admin/acessos.

-- ============================================================
-- 1. TRILHA — uma linha por página aberta
-- ============================================================
create table if not exists public.acesso_eventos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  email       text,
  rota        text not null,
  ip          inet,
  cidade      text,
  uf          text,
  pais        text,
  user_agent  text,
  plataforma  text,           -- 'mobile' | 'desktop'
  bloqueado   boolean not null default false,  -- tentou entrar fora da janela
  at          timestamptz not null default now()
);

create index if not exists acesso_eventos_at_idx        on public.acesso_eventos (at desc);
create index if not exists acesso_eventos_user_at_idx   on public.acesso_eventos (user_id, at desc);
create index if not exists acesso_eventos_rota_at_idx   on public.acesso_eventos (rota, at desc);
create index if not exists acesso_eventos_bloq_idx      on public.acesso_eventos (at desc) where bloqueado;

comment on table public.acesso_eventos is
  'Trilha de navegação do CRM: quem abriu qual página, de onde (geo do header da Vercel) e quando. Retenção 90 dias (cron limpa_acesso_eventos).';

-- ============================================================
-- 2. JANELAS — horário permitido por usuário (e opcionalmente por rota)
-- ============================================================
create table if not exists public.acesso_janelas (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  dias          int[] not null default '{1,2,3,4,5}',  -- isodow: 1=seg .. 7=dom
  hora_inicio   time not null default '07:30',
  hora_fim      time not null default '18:00',
  fuso          text not null default 'America/Cuiaba',
  -- NULL = janela GERAL (vale pro sistema inteiro).
  -- Preenchido = trava só as rotas que começam com esse prefixo (ex.: '/contatos').
  rota_prefixo  text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  constraint acesso_janelas_dias_validos check (
    dias <@ array[1,2,3,4,5,6,7] and array_length(dias, 1) >= 1
  )
);

create index if not exists acesso_janelas_user_idx on public.acesso_janelas (user_id) where ativo;

comment on table public.acesso_janelas is
  'Janela de horário permitida por usuário. Sem linha = acesso livre (fail-open). rota_prefixo NULL = vale pro sistema todo.';

-- ============================================================
-- 3. A FUNÇÃO QUE DECIDE
-- ============================================================
-- STABLE + SECURITY DEFINER + search_path fixo (advisor "Function Search Path Mutable").
create or replace function public.acesso_liberado(p_user uuid, p_rota text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
begin
  -- Fail-open em tudo que for ambíguo: sem usuário, sem perfil, sem janela.
  if p_user is null then return true; end if;

  select role into v_role from public.user_profiles where id = p_user;
  if v_role is null then return true; end if;

  -- ⚠️ Admin nunca é travado por janela — senão dá pra se trancar do lado de fora
  -- e não sobra ninguém que consiga reabrir. Se um dia quiser travar admin
  -- também, tire estas duas linhas sabendo do risco.
  if v_role = 'admin' then return true; end if;

  -- 1) Janela GERAL do usuário (rota_prefixo IS NULL)
  if exists (
    select 1 from public.acesso_janelas
    where user_id = p_user and ativo and rota_prefixo is null
  ) then
    if not exists (
      select 1 from public.acesso_janelas j
      where j.user_id = p_user and j.ativo and j.rota_prefixo is null
        and extract(isodow from (now() at time zone j.fuso))::int = any (j.dias)
        and public.hora_dentro((now() at time zone j.fuso)::time, j.hora_inicio, j.hora_fim)
    ) then
      return false;
    end if;
  end if;

  -- 2) Janela específica da rota pedida
  if p_rota is not null and exists (
    select 1 from public.acesso_janelas
    where user_id = p_user and ativo and rota_prefixo is not null
      and p_rota like rota_prefixo || '%'
  ) then
    if not exists (
      select 1 from public.acesso_janelas j
      where j.user_id = p_user and j.ativo and j.rota_prefixo is not null
        and p_rota like j.rota_prefixo || '%'
        and extract(isodow from (now() at time zone j.fuso))::int = any (j.dias)
        and public.hora_dentro((now() at time zone j.fuso)::time, j.hora_inicio, j.hora_fim)
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- Trata janela que cruza a meia-noite (ex.: 22:00 → 06:00).
create or replace function public.hora_dentro(p_agora time, p_ini time, p_fim time)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_ini <= p_fim then p_agora >= p_ini and p_agora <= p_fim
    else p_agora >= p_ini or p_agora <= p_fim
  end;
$$;

-- Wrapper pra usar na RLS: o usuário da sessão, janela geral.
create or replace function public.acesso_liberado_agora()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select public.acesso_liberado(auth.uid(), null);
$$;

-- ============================================================
-- 4. RLS DAS TABELAS NOVAS
-- ============================================================
alter table public.acesso_eventos enable row level security;
alter table public.acesso_janelas enable row level security;

-- Trilha: só admin lê. Escrita é exclusiva do endpoint (service_role bypassa RLS).
drop policy if exists acesso_eventos_admin_le on public.acesso_eventos;
create policy acesso_eventos_admin_le on public.acesso_eventos
  for select to authenticated
  using ((select public.is_admin()));

-- Janelas: admin gerencia; o próprio usuário lê a dele (a tela de bloqueio
-- precisa dizer "você acessa das 7h30 às 18h", senão o bloqueio é mudo).
drop policy if exists acesso_janelas_le on public.acesso_janelas;
create policy acesso_janelas_le on public.acesso_janelas
  for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

drop policy if exists acesso_janelas_admin_escreve on public.acesso_janelas;
create policy acesso_janelas_admin_escreve on public.acesso_janelas
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Padrão do banco: papel externo (mapa/consultor/representante) não entra.
-- RESTRICTIVE porque permissiva seria OR'd com as de cima e não barraria nada.
drop policy if exists acesso_eventos_bloqueia_papel_restrito on public.acesso_eventos;
create policy acesso_eventos_bloqueia_papel_restrito on public.acesso_eventos
  as restrictive for all to authenticated
  using (not (select public.papel_restrito()));

drop policy if exists acesso_janelas_bloqueia_papel_restrito on public.acesso_janelas;
create policy acesso_janelas_bloqueia_papel_restrito on public.acesso_janelas
  as restrictive for all to authenticated
  using (not (select public.papel_restrito()));

-- RLS sem GRANT = app quebra. GRANT explícito e mínimo.
revoke all on public.acesso_eventos from anon, authenticated;
revoke all on public.acesso_janelas from anon, authenticated;
grant select on public.acesso_eventos to authenticated;
grant select, insert, update, delete on public.acesso_janelas to authenticated;

-- Função nova nasce com EXECUTE pra PUBLIC — tirar.
revoke all on function public.acesso_liberado(uuid, text)  from public, anon;
revoke all on function public.acesso_liberado_agora()      from public, anon;
revoke all on function public.hora_dentro(time, time, time) from public, anon;
grant execute on function public.acesso_liberado(uuid, text)  to authenticated;
grant execute on function public.acesso_liberado_agora()      to authenticated;
grant execute on function public.hora_dentro(time, time, time) to authenticated;

-- ============================================================
-- 5. RETENÇÃO — 90 dias
-- ============================================================
create or replace function public.limpa_acesso_eventos()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  delete from public.acesso_eventos where at < now() - interval '90 days';
$$;
revoke all on function public.limpa_acesso_eventos() from public, anon, authenticated;

select cron.unschedule('limpa-acesso-eventos')
where exists (select 1 from cron.job where jobname = 'limpa-acesso-eventos');

select cron.schedule('limpa-acesso-eventos', '17 4 * * *', 'select public.limpa_acesso_eventos()');
