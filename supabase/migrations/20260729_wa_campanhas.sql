-- Campanhas de chamada em massa disparadas pelo WhatsApp do proprio vendedor.
--
-- POR QUE NAO REUSAR outbound_dispatch:
-- aquela fila foi desenhada para ABORDAGEM FRIA de lead novo e tem tres travas
-- que matariam esta feature:
--   1. o worker chama jaTemConversa() e marca skipped quem ja tem historico --
--      e a lista de /atendimentos e exatamente quem ja conversou;
--   2. cooldown de 30 dias por numero, cruzado entre vendedores;
--   3. idx_outbound_dispatch_um_ativo_por_fone = so 1 disparo ativo por numero
--      no sistema inteiro.
-- Reusar aquilo daria a impressao de funcionar e nao enviaria nada. Fila propria,
-- mesma mecanica (claim atomico + report + recovery), regras diferentes.

create table if not exists public.wa_campanhas (
  id             uuid primary key default gen_random_uuid(),
  vendedor_nome  text not null,
  titulo         text not null,
  -- A mensagem vem de uma sequencia ja cadastrada (quick_sequences): o vendedor
  -- ja monta texto/audio/imagem com delay por passo naquele construtor. Nao
  -- duplicamos editor de mensagem aqui.
  sequencia_id   uuid not null references public.quick_sequences(id) on delete restrict,
  -- Ritmo em faixas fechadas, nao numero livre: se der pra digitar 5s, alguem digita 5s.
  ritmo          text not null default 'cauteloso' check (ritmo in ('cauteloso','normal')),
  status         text not null default 'rascunho'
                 check (status in ('rascunho','ativa','pausada','concluida','cancelada')),
  -- Snapshot do filtro que gerou a lista (etiqueta, data, uf...) so para auditoria:
  -- "de onde saiu essa lista?" seis meses depois.
  origem_filtro  jsonb,
  total_alvos    integer not null default 0,
  criado_por     text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

create index if not exists idx_wa_campanhas_vendedor on public.wa_campanhas (vendedor_nome, status, created_at desc);
create index if not exists idx_wa_campanhas_ativas   on public.wa_campanhas (vendedor_nome) where status = 'ativa';

create table if not exists public.wa_campanha_alvos (
  id            uuid primary key default gen_random_uuid(),
  campanha_id   uuid not null references public.wa_campanhas(id) on delete cascade,
  telefone      text not null,
  telefone_norm text generated always as (public.fn_norm_fone_br(telefone)) stored,
  nome          text,
  status        text not null default 'pending'
                check (status in ('pending','sending','sent','failed','skipped')),
  erro          text,
  claimed_at    timestamptz,   -- base do recovery (nao created_at: ver licao do outbound_dispatch)
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Claim: pega o pending mais antigo da campanha ativa do vendedor.
create index if not exists idx_wa_campanha_alvos_claim
  on public.wa_campanha_alvos (campanha_id, status, created_at)
  where status = 'pending';

-- Recovery de alvo presoem 'sending'.
create index if not exists idx_wa_campanha_alvos_sending
  on public.wa_campanha_alvos (claimed_at) where status = 'sending';

-- Contagem de ritmo (envios por hora/dia do vendedor) e progresso.
create index if not exists idx_wa_campanha_alvos_sent
  on public.wa_campanha_alvos (campanha_id, sent_at) where status = 'sent';

-- Mesmo numero nao entra duas vezes na MESMA campanha. Entre campanhas
-- diferentes e permitido de proposito (follow-up e sequencia de campanhas).
create unique index if not exists idx_wa_campanha_alvos_unico
  on public.wa_campanha_alvos (campanha_id, telefone_norm);

-- ---------------------------------------------------------------- RLS
alter table public.wa_campanhas      enable row level security;
alter table public.wa_campanha_alvos enable row level security;

-- Vendedor mexe so nas proprias campanhas; admin ve tudo. A edge roda com
-- service_role, que ignora RLS por definicao.
drop policy if exists wa_campanhas_rw on public.wa_campanhas;
create policy wa_campanhas_rw on public.wa_campanhas
  for all to authenticated
  using      (public.is_admin() or vendedor_nome = public.current_vendedor_nome())
  with check (public.is_admin() or vendedor_nome = public.current_vendedor_nome());

drop policy if exists wa_campanha_alvos_rw on public.wa_campanha_alvos;
create policy wa_campanha_alvos_rw on public.wa_campanha_alvos
  for all to authenticated
  using (exists (
    select 1 from public.wa_campanhas c
    where c.id = campanha_id
      and (public.is_admin() or c.vendedor_nome = public.current_vendedor_nome())
  ))
  with check (exists (
    select 1 from public.wa_campanhas c
    where c.id = campanha_id
      and (public.is_admin() or c.vendedor_nome = public.current_vendedor_nome())
  ));

revoke all on public.wa_campanhas      from anon;
revoke all on public.wa_campanha_alvos from anon;
grant select, insert, update, delete on public.wa_campanhas      to authenticated;
grant select, insert, update, delete on public.wa_campanha_alvos to authenticated;

comment on table public.wa_campanhas is
  'Campanha de chamada em massa pelo WhatsApp do proprio vendedor. Mensagem vem de quick_sequences; ritmo em faixas fechadas; execucao pela edge campanha-poll + worker da extensao.';
comment on table public.wa_campanha_alvos is
  'Alvos de uma campanha. Claim atomico pending->sending pela edge; recovery por claimed_at.';
