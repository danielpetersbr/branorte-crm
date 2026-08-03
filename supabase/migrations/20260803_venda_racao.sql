-- ============================================================================
-- Módulo "Venda de Ração" (/venda-racao)
--
-- Sistema SEPARADO do estudo de viabilidade (/viabilidade, que é um iframe sem
-- persistência). Aqui o vendedor precifica ração farelada (bovinos/suínos/aves)
-- e milho triturado: monta a fórmula, soma custos, aplica margem/impostos/
-- comissão e gera a proposta pro cliente.
--
-- 3 tabelas:
--   venda_racao_config       — defaults da empresa (margem por espécie, impostos…)
--   venda_racao_ingredientes — catálogo de matérias-primas com preço
--   venda_racao_formulas     — fórmulas salvas (composição reutilizável)
--   venda_racao_simulacoes   — as propostas em si (histórico)
--
-- RLS: cada vendedor vê o que criou; admin (ou quem tem venda_racao.ver_todas)
-- vê tudo. Mesmo padrão de due_diligence_consultas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.venda_racao_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quem pode ver TODAS as simulações (não só as próprias)
-- ---------------------------------------------------------------------------
create or replace function public.venda_racao_ve_todas()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from user_profiles up
    left join role_permissions rp on rp.role = up.role
    where up.id = auth.uid()
      and (
        up.role = 'admin'
        or coalesce((rp.permissions ->> 'venda_racao.ver_todas')::boolean, false) = true
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 1) CONFIG — linha única (id=1) com os defaults da empresa em JSONB.
--    JSONB porque a lista de defaults cresce (nova espécie, novo custo padrão)
--    sem exigir migration a cada ajuste comercial.
-- ---------------------------------------------------------------------------
create table if not exists public.venda_racao_config (
  id          smallint primary key default 1 check (id = 1),
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

insert into public.venda_racao_config (id, config)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

drop trigger if exists trg_venda_racao_config_touch on public.venda_racao_config;
create trigger trg_venda_racao_config_touch
  before update on public.venda_racao_config
  for each row execute function public.venda_racao_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) INGREDIENTES — catálogo de matéria-prima com preço de referência.
--    unidade_preco: 'kg' | 'saco' | 't'  (peso_saco só importa quando 'saco')
-- ---------------------------------------------------------------------------
create table if not exists public.venda_racao_ingredientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  preco         numeric(14,4) not null default 0 check (preco >= 0),
  unidade_preco text not null default 'kg' check (unidade_preco in ('kg','saco','t')),
  peso_saco     numeric(10,3) check (peso_saco is null or peso_saco > 0),
  observacao    text,
  ativo         boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists venda_racao_ingredientes_nome_uk
  on public.venda_racao_ingredientes (lower(nome));

drop trigger if exists trg_venda_racao_ingredientes_touch on public.venda_racao_ingredientes;
create trigger trg_venda_racao_ingredientes_touch
  before update on public.venda_racao_ingredientes
  for each row execute function public.venda_racao_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3) FÓRMULAS — composição salva pra reaproveitar entre propostas.
--    itens: [{ nome, participacao, unidade_participacao, preco, unidade_preco, peso_saco }]
--    NÃO é recomendação nutricional: é o que o vendedor/nutricionista cadastrou.
-- ---------------------------------------------------------------------------
create table if not exists public.venda_racao_formulas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  especie     text check (especie in ('bovinos','suinos','aves','milho')),
  categoria   text,
  itens       jsonb not null default '[]'::jsonb,
  observacoes text,
  ativo       boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists venda_racao_formulas_especie_idx
  on public.venda_racao_formulas (especie) where ativo;

drop trigger if exists trg_venda_racao_formulas_touch on public.venda_racao_formulas;
create trigger trg_venda_racao_formulas_touch
  before update on public.venda_racao_formulas
  for each row execute function public.venda_racao_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4) SIMULAÇÕES — a proposta. Colunas "planas" servem pra listar/filtrar;
--    `dados` guarda o estado COMPLETO do formulário pra reabrir igualzinho.
-- ---------------------------------------------------------------------------
create table if not exists public.venda_racao_simulacoes (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique
                       default ('VR-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),

  created_by         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vendedor_nome      text,

  cliente_nome       text not null,
  cliente_empresa    text,
  cliente_cidade     text,
  cliente_uf         text,
  cliente_telefone   text,

  especie            text not null check (especie in ('bovinos','suinos','aves','milho')),
  categoria          text,

  quantidade_kg        numeric(16,3) not null default 0 check (quantidade_kg >= 0),
  quantidade_mensal_kg numeric(16,3) not null default 0 check (quantidade_mensal_kg >= 0),
  peso_saco            numeric(10,3) not null default 40 check (peso_saco > 0),

  custo_base_kg       numeric(14,6) not null default 0,
  margem_desejada_pct numeric(7,4)  not null default 0,
  margem_minima_pct   numeric(7,4)  not null default 0,
  preco_sugerido_kg   numeric(14,6) not null default 0,
  preco_minimo_kg     numeric(14,6) not null default 0,
  preco_negociado_kg  numeric(14,6) not null default 0,
  margem_real_pct     numeric(9,4)  not null default 0,

  valor_total   numeric(16,2) not null default 0,
  lucro_total   numeric(16,2) not null default 0,
  lucro_mensal  numeric(16,2) not null default 0,

  status      text not null default 'rascunho'
                check (status in ('rascunho','enviada','negociacao','aprovada','vendida','perdida','cancelada')),
  validade    date,
  observacoes text,

  dados      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists venda_racao_simulacoes_created_by_idx
  on public.venda_racao_simulacoes (created_by, created_at desc);
create index if not exists venda_racao_simulacoes_status_idx
  on public.venda_racao_simulacoes (status, created_at desc);
create index if not exists venda_racao_simulacoes_especie_idx
  on public.venda_racao_simulacoes (especie, created_at desc);
create index if not exists venda_racao_simulacoes_cliente_idx
  on public.venda_racao_simulacoes using gin (lower(cliente_nome) gin_trgm_ops);

drop trigger if exists trg_venda_racao_simulacoes_touch on public.venda_racao_simulacoes;
create trigger trg_venda_racao_simulacoes_touch
  before update on public.venda_racao_simulacoes
  for each row execute function public.venda_racao_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.venda_racao_config       enable row level security;
alter table public.venda_racao_ingredientes enable row level security;
alter table public.venda_racao_formulas     enable row level security;
alter table public.venda_racao_simulacoes   enable row level security;

-- Config: todo mundo logado lê (a simulação precisa dos defaults); só quem vê
-- todas (admin) escreve.
drop policy if exists vr_config_select on public.venda_racao_config;
create policy vr_config_select on public.venda_racao_config
  for select to authenticated using (true);

drop policy if exists vr_config_update on public.venda_racao_config;
create policy vr_config_update on public.venda_racao_config
  for update to authenticated
  using (public.venda_racao_ve_todas())
  with check (public.venda_racao_ve_todas());

-- Ingredientes e fórmulas: catálogo compartilhado do time comercial.
drop policy if exists vr_ingredientes_select on public.venda_racao_ingredientes;
create policy vr_ingredientes_select on public.venda_racao_ingredientes
  for select to authenticated using (true);

drop policy if exists vr_ingredientes_write on public.venda_racao_ingredientes;
create policy vr_ingredientes_write on public.venda_racao_ingredientes
  for all to authenticated using (true) with check (true);

drop policy if exists vr_formulas_select on public.venda_racao_formulas;
create policy vr_formulas_select on public.venda_racao_formulas
  for select to authenticated using (true);

drop policy if exists vr_formulas_write on public.venda_racao_formulas;
create policy vr_formulas_write on public.venda_racao_formulas
  for all to authenticated using (true) with check (true);

-- Simulações: cada vendedor vê/edita as suas; admin vê todas.
drop policy if exists vr_simulacoes_select on public.venda_racao_simulacoes;
create policy vr_simulacoes_select on public.venda_racao_simulacoes
  for select to authenticated
  using (created_by = auth.uid() or public.venda_racao_ve_todas());

drop policy if exists vr_simulacoes_insert on public.venda_racao_simulacoes;
create policy vr_simulacoes_insert on public.venda_racao_simulacoes
  for insert to authenticated
  with check (created_by = auth.uid() and auth.uid() is not null);

drop policy if exists vr_simulacoes_update on public.venda_racao_simulacoes;
create policy vr_simulacoes_update on public.venda_racao_simulacoes
  for update to authenticated
  using (created_by = auth.uid() or public.venda_racao_ve_todas())
  with check (created_by = auth.uid() or public.venda_racao_ve_todas());

drop policy if exists vr_simulacoes_delete on public.venda_racao_simulacoes;
create policy vr_simulacoes_delete on public.venda_racao_simulacoes
  for delete to authenticated
  using (created_by = auth.uid() or public.venda_racao_ve_todas());

-- ---------------------------------------------------------------------------
-- GRANTS — anon NÃO enxerga nada (proposta tem custo interno e telefone de cliente)
-- ---------------------------------------------------------------------------
revoke all on public.venda_racao_config       from anon;
revoke all on public.venda_racao_ingredientes from anon;
revoke all on public.venda_racao_formulas     from anon;
revoke all on public.venda_racao_simulacoes   from anon;

grant select, update            on public.venda_racao_config       to authenticated;
grant select, insert, update, delete on public.venda_racao_ingredientes to authenticated;
grant select, insert, update, delete on public.venda_racao_formulas     to authenticated;
grant select, insert, update, delete on public.venda_racao_simulacoes   to authenticated;

revoke all on function public.venda_racao_ve_todas() from anon;
grant execute on function public.venda_racao_ve_todas() to authenticated;
