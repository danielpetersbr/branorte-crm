create table public.orcamento_ai_eventos (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  conversation_id uuid not null,
  vendedor_id uuid not null references auth.users(id) on delete cascade,
  orcamento_id bigint null,
  proposal_id text null,
  event_type text not null check (event_type in ('requested', 'proposed', 'blocked', 'applied', 'finalized', 'failed')),
  request_summary jsonb null,
  proposal_summary jsonb null,
  result_summary jsonb null,
  created_at timestamptz not null default now()
);

create index orcamento_ai_eventos_vendedor_created_idx
  on public.orcamento_ai_eventos (vendedor_id, created_at desc);
create index orcamento_ai_eventos_trace_idx
  on public.orcamento_ai_eventos (trace_id);
create index orcamento_ai_eventos_orcamento_idx
  on public.orcamento_ai_eventos (orcamento_id)
  where orcamento_id is not null;

alter table public.orcamento_ai_eventos enable row level security;

revoke all on table public.orcamento_ai_eventos from anon;
revoke insert, update, delete on table public.orcamento_ai_eventos from authenticated;
grant select on table public.orcamento_ai_eventos to authenticated;

create policy "vendedor le propria auditoria de orcamento"
  on public.orcamento_ai_eventos
  for select
  to authenticated
  using ((select auth.uid()) = vendedor_id);

create policy "administrador le auditoria de orcamentos"
  on public.orcamento_ai_eventos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.id = (select auth.uid())
        and profile.approved_at is not null
        and profile.role in ('admin', 'financeiro')
    )
  );
