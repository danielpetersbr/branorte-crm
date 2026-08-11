-- ============================================================================
-- ARENA DE TESTE DA IA ATENDENTE (/ia-teste)
-- Aplicada em producao em 11/08/2026. Arquivo aqui pro schema ficar versionado.
--
-- O vendedor conversa com a MESMA IA que atende no WhatsApp dele e marca "errou"
-- na resposta ruim. A sessao NAO mora em ia_atendimentos de proposito: se morasse,
-- a action `listar` da edge devolveria esses chats pra extensao da frota, que
-- tentaria buscar mensagens de um chat que nao existe no WhatsApp — e 3 falhas
-- seguidas abortam o ciclo inteiro daquele vendedor (bug real de 28/07).
-- Tabela separada = a frota nunca ve o teste.
--
-- As colunas de ia_teste_sessoes espelham ia_atendimentos porque a edge, em modo
-- sandbox (chat_id com prefixo 'teste:'), REDIRECIONA a tabela e roda o mesmo
-- codigo — sem branch de comportamento, entao o teste nao vira uma IA diferente.
-- ============================================================================

create table if not exists public.ia_teste_sessoes (
  id                   bigserial primary key,
  chat_id              text not null unique,
  vendedor_nome        text not null,
  nome_contato         text,
  ativo                boolean not null default true,
  respostas_hoje       integer not null default 0,
  dia_ref              date default ((now() at time zone 'America/Sao_Paulo')::date),
  ligado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  temperatura          text,
  dados_coletados      jsonb not null default '{}'::jsonb,
  motivo_desligamento  text,
  memoria_limpa_em     timestamptz,
  origem               text not null default 'vendedor',
  ultima_msg_t         bigint,
  estado               text not null default 'AI_ACTIVE',
  estado_desde         timestamptz not null default now(),
  estado_motivo        text,
  assumido_por         text,
  assumido_em          timestamptz,
  bloqueado_em         timestamptz,
  bloqueado_por        text,
  criado_por           uuid references auth.users(id) on delete set null,
  titulo               text,
  encerrada_em         timestamptz,
  criado_em            timestamptz not null default now()
);
create index if not exists ia_teste_sessoes_vendedor_idx on public.ia_teste_sessoes (vendedor_nome, criado_em desc);
create index if not exists ia_teste_sessoes_criado_por_idx on public.ia_teste_sessoes (criado_por, criado_em desc);

create table if not exists public.ia_teste_mensagens (
  id          bigserial primary key,
  chat_id     text not null,
  papel       text not null check (papel in ('cliente','ia','sistema')),
  texto       text not null default '',
  midias      jsonb,
  acoes       jsonb,
  payload     jsonb,
  t           bigint not null,
  created_at  timestamptz not null default now()
);
create index if not exists ia_teste_mensagens_chat_idx on public.ia_teste_mensagens (chat_id, t);

create table if not exists public.ia_teste_feedback (
  id             bigserial primary key,
  chat_id        text,
  mensagem_id    bigint references public.ia_teste_mensagens(id) on delete set null,
  vendedor_nome  text not null,
  criado_por     uuid references auth.users(id) on delete set null,
  categoria      text not null,
  comentario     text,
  esperado       text,
  contexto       jsonb,
  status         text not null default 'novo' check (status in ('novo','analisando','resolvido','rejeitado')),
  prioridade     text check (prioridade in ('baixa','media','alta','critica')),
  resposta_time  text,
  resolvido_em   timestamptz,
  created_at     timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists ia_teste_feedback_status_idx on public.ia_teste_feedback (status, created_at desc);
create index if not exists ia_teste_feedback_vendedor_idx on public.ia_teste_feedback (vendedor_nome, created_at desc);

alter table public.ia_teste_sessoes   enable row level security;
alter table public.ia_teste_mensagens enable row level security;
alter table public.ia_teste_feedback  enable row level security;

create or replace function public.ia_teste_eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.role = 'admin');
$$;

drop policy if exists ia_teste_sessoes_rw on public.ia_teste_sessoes;
create policy ia_teste_sessoes_rw on public.ia_teste_sessoes
  for all to authenticated
  using (criado_por = auth.uid() or public.ia_teste_eh_admin())
  with check (criado_por = auth.uid() or public.ia_teste_eh_admin());

drop policy if exists ia_teste_mensagens_rw on public.ia_teste_mensagens;
create policy ia_teste_mensagens_rw on public.ia_teste_mensagens
  for all to authenticated
  using (exists (select 1 from public.ia_teste_sessoes s
                 where s.chat_id = ia_teste_mensagens.chat_id
                   and (s.criado_por = auth.uid() or public.ia_teste_eh_admin())))
  with check (exists (select 1 from public.ia_teste_sessoes s
                 where s.chat_id = ia_teste_mensagens.chat_id
                   and (s.criado_por = auth.uid() or public.ia_teste_eh_admin())));

-- Roadmap: todo mundo LE todos os apontamentos (evita dez vendedores apontando a
-- mesma coisa e mostra o que ja foi corrigido). Escrever, so o proprio.
drop policy if exists ia_teste_feedback_select on public.ia_teste_feedback;
create policy ia_teste_feedback_select on public.ia_teste_feedback
  for select to authenticated using (true);

drop policy if exists ia_teste_feedback_insert on public.ia_teste_feedback;
create policy ia_teste_feedback_insert on public.ia_teste_feedback
  for insert to authenticated with check (criado_por = auth.uid());

drop policy if exists ia_teste_feedback_update on public.ia_teste_feedback;
create policy ia_teste_feedback_update on public.ia_teste_feedback
  for update to authenticated
  using (criado_por = auth.uid() or public.ia_teste_eh_admin())
  with check (criado_por = auth.uid() or public.ia_teste_eh_admin());

drop policy if exists ia_teste_feedback_delete on public.ia_teste_feedback;
create policy ia_teste_feedback_delete on public.ia_teste_feedback
  for delete to authenticated
  using (criado_por = auth.uid() or public.ia_teste_eh_admin());

revoke all on public.ia_teste_sessoes, public.ia_teste_mensagens, public.ia_teste_feedback from anon;

-- Portao 1 de 3 do RBAC (os outros dois sao App.tsx e Layout.tsx, no codigo).
update public.role_permissions
set permissions = coalesce(permissions, '{}'::jsonb) || '{"menu.ia_teste": true}'::jsonb
where role in ('admin','vendor','marketing');
