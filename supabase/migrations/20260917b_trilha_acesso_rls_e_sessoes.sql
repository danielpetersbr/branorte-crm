-- Parte 2 da trilha de acesso: a trava no DADO e o controle de sessão.
--
-- A parte 1 (20260917_trilha_acesso.sql) criou as tabelas e a função que decide.
-- Sozinha, ela só barrava a NAVEGAÇÃO — e o guard do App.tsx é client-side, o
-- DevTools passa por cima. É esta migration que faz a janela valer de verdade.

-- ============================================================
-- 1. A TRAVA: policy RESTRICTIVE de horário nas tabelas de dado
-- ============================================================
-- Não afeta ninguém enquanto não houver janela cadastrada: acesso_liberado()
-- é fail-open. Só passa a valer pra quem receber regra em /admin/acessos.
--
-- Para estender a outras tabelas, é só acrescentar ao array.
do $$
declare
  t text;
  alvos text[] := array[
    'contacts', 'orcamentos_gerados', 'precos_branorte',
    'wa_chat_messages', 'leads', 'orcamento_clientes', 'vendas_mapa'
  ];
begin
  foreach t in array alvos loop
    execute format('drop policy if exists bloqueia_fora_do_horario on public.%I', t);
    -- ⚠️ (select ...) obriga o planner a avaliar a função UMA vez (InitPlan).
    -- Escrita crua, ela roda POR LINHA e custa 52x — foi exatamente o que
    -- derrubou /atendimentos com statement timeout em 19/08/2026.
    execute format(
      'create policy bloqueia_fora_do_horario on public.%I
         as restrictive for all to authenticated
         using ((select public.acesso_liberado_agora()))',
      t
    );
  end loop;
end $$;

-- ============================================================
-- 2. Derrubar sessão
-- ============================================================
-- As sessões deste projeto não expiram (not_after nulo): em 16/09/2026 eram 75
-- vivas, a mais antiga de 06/03. Tirar o papel de alguém NÃO o desconecta.
-- Apagar de auth.sessions invalida o refresh token por cascade — a pessoa cai
-- na próxima renovação (o access token corrente vale até expirar, ~1 h).
create or replace function public.derrubar_sessoes(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare v_n integer;
begin
  -- ⚠️ SECURITY DEFINER bypassa RLS: o guard tem que estar DENTRO da função.
  if not public.is_admin() then
    raise exception 'apenas administrador pode derrubar sessao';
  end if;
  if p_user is null then
    raise exception 'usuario obrigatorio';
  end if;

  delete from auth.sessions where user_id = p_user;
  get diagnostics v_n = row_count;

  insert into public.acesso_eventos (user_id, email, rota, bloqueado)
  select p_user, up.email, '(sessoes derrubadas por admin)', true
  from public.user_profiles up where up.id = p_user;

  return v_n;
end;
$$;

revoke all on function public.derrubar_sessoes(uuid) from public, anon;
grant execute on function public.derrubar_sessoes(uuid) to authenticated;

-- ============================================================
-- 3. Listar sessões ativas
-- ============================================================
-- auth.sessions não é exposto pelo PostgREST; esta RPC é o caminho da tela.
-- O guard de admin vai no WHERE (mesmo motivo do item 2).
create or replace function public.sessoes_ativas()
returns table (
  session_id uuid,
  user_id    uuid,
  email      text,
  papel      text,
  ip         text,
  user_agent text,
  criada_em  timestamptz,
  ultimo_uso timestamptz
)
language sql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
  select s.id, s.user_id, up.email, up.role,
         host(s.ip), s.user_agent, s.created_at, s.updated_at
  from auth.sessions s
  join public.user_profiles up on up.id = s.user_id
  where public.is_admin()
  order by s.updated_at desc
  limit 200;
$$;

revoke all on function public.sessoes_ativas() from public, anon;
grant execute on function public.sessoes_ativas() to authenticated;
