-- Etapa 2 do Modo Planejamento de Viagem (/mapa-visitas).
-- Nomes em pt-BR pra bater com o resto do schema (orcamentos_gerados, cidade_geocache,
-- mapa_marcacoes). O spec sugeria travel_plans/travel_plan_stops e mandava "adequar ao
-- padrão atual do projeto" — é isso.

-- ── Helpers (molde: is_admin() / venda_racao_ve_todas()) ─────────────────────

-- Quem pode CRIAR/EDITAR viagem. 'mapa' e 'consultor' são contas externas.
create or replace function public.viagem_pode_editar()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from user_profiles up
    where up.id = auth.uid()
      and up.approved_at is not null
      and up.role not in ('mapa','consultor','pending','rejected')
  );
$$;

-- Quem vê a viagem dos OUTROS. Admin sempre; demais por flag em role_permissions.
create or replace function public.viagens_ve_todas()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from user_profiles up
    left join role_permissions rp on rp.role = up.role
    where up.id = auth.uid()
      and (up.role = 'admin'
           or coalesce((rp.permissions ->> 'viagens.ver_todas')::boolean, false))
  );
$$;

-- ── viagens ──────────────────────────────────────────────────────────────────
create table if not exists public.viagens (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null,
  status                 text not null default 'rascunho'
                         check (status in ('rascunho','aguardando_localizacoes','aguardando_confirmacoes',
                                           'pronta','em_andamento','concluida','cancelada')),
  criado_por             uuid not null default auth.uid() references auth.users(id) on delete cascade,

  data_inicio            date,
  dias                   int  not null default 1 check (dias between 1 and 60),

  origem_nome            text,
  origem_lat             double precision check (origem_lat between -90 and 90),
  origem_lng             double precision check (origem_lng between -180 and 180),
  destino_nome           text,
  destino_lat            double precision check (destino_lat between -90 and 90),
  destino_lng            double precision check (destino_lng between -180 and 180),
  retornar_origem        boolean not null default true,

  hora_inicio            time not null default '08:00',
  hora_fim               time not null default '18:00',
  almoco_inicio          time,
  almoco_minutos         int  not null default 60 check (almoco_minutos between 0 and 240),
  visita_minutos_padrao  int  not null default 90 check (visita_minutos_padrao between 5 and 600),
  modo_otimizacao        text not null default 'otimizar' check (modo_otimizacao in ('otimizar','manual')),

  -- totais do último cálculo (cache; nunca fonte de verdade)
  total_metros           bigint,
  total_deslocamento_seg bigint,
  total_visita_seg       bigint,
  provedor_rota          text,
  calculado_em           timestamptz,

  observacoes            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint viagens_jornada_valida check (hora_fim > hora_inicio)
);

comment on table public.viagens is
  'Planejamento de viagem de visitas montado no /mapa-visitas.';

-- ── viagem_paradas ───────────────────────────────────────────────────────────
-- Uma parada é: um CLIENTE (tem endereço real), uma CIDADE (agrupa N clientes que
-- só têm centroide de município) ou um ponto livre (origem/hotel/aeroporto).
create table if not exists public.viagem_paradas (
  id                     uuid primary key default gen_random_uuid(),
  viagem_id              uuid not null references public.viagens(id) on delete cascade,
  tipo                   text not null default 'cliente'
                         check (tipo in ('cliente','cidade','origem','destino','hotel','parada')),

  cli_key                text,           -- tipo='cliente'  → chave de mapa_orcamentos_v2()
  cli_keys               text[],         -- tipo='cidade'   → os clientes agrupados nela
  rotulo                 text,           -- ponto livre     → "Aeroporto de Teresina"

  -- SNAPSHOT: a viagem não pode mudar sozinha se o orçamento mudar depois
  cliente_nome           text,
  vendedor               text,
  telefone               text,
  equipamento            text,
  valor                  numeric,
  cidade                 text,
  uf                     text,
  endereco               text,

  lat                    double precision check (lat between -90 and 90),
  lng                    double precision check (lng between -180 and 180),
  precisao               text check (precisao in ('endereco','confirmada','manual','cidade','estado')),

  dia                    int  not null default 1 check (dia >= 1),
  ordem                  int  not null default 0,
  ordem_travada          boolean not null default false,

  visita_minutos         int check (visita_minutos between 0 and 1440),
  janela_inicio          time,
  janela_fim             time,
  chegada_prevista       timestamptz,
  saida_prevista         timestamptz,

  metros_anterior            bigint,
  deslocamento_anterior_seg  bigint,
  polyline_anterior          text,

  confirmacao            text not null default 'nao_solicitado'
                         check (confirmacao in ('nao_solicitado','aguardando_vendedor','aguardando_cliente',
                                                'localizacao_recebida','visita_confirmada','indisponivel')),
  confirmacao_em         timestamptz,
  notas                  text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint viagem_paradas_janela_valida check (janela_fim is null or janela_inicio is null or janela_fim > janela_inicio),
  constraint viagem_paradas_cliente_tem_key check (tipo <> 'cliente' or cli_key is not null)
);

comment on column public.viagem_paradas.cli_keys is
  'Clientes dentro de uma parada-cidade. Existe porque 68,85% dos clientes compartilham o centroide do município — não dá pra ordenar entre eles.';

-- §6 do spec: impedir cliente duplicado na mesma viagem
create unique index if not exists viagem_paradas_sem_cliente_repetido
  on public.viagem_paradas (viagem_id, cli_key)
  where cli_key is not null;

create index if not exists viagem_paradas_por_viagem on public.viagem_paradas (viagem_id, dia, ordem);
create index if not exists viagens_por_dono          on public.viagens (criado_por, created_at desc);

-- ── updated_at ───────────────────────────────────────────────────────────────
create or replace function public.viagem_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists viagens_touch on public.viagens;
create trigger viagens_touch before update on public.viagens
  for each row execute function public.viagem_touch();

drop trigger if exists viagem_paradas_touch on public.viagem_paradas;
create trigger viagem_paradas_touch before update on public.viagem_paradas
  for each row execute function public.viagem_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.viagens        enable row level security;
alter table public.viagem_paradas enable row level security;

drop policy if exists viagens_sel on public.viagens;
create policy viagens_sel on public.viagens for select to authenticated
  using (criado_por = auth.uid() or public.viagens_ve_todas());

drop policy if exists viagens_ins on public.viagens;
create policy viagens_ins on public.viagens for insert to authenticated
  with check (criado_por = auth.uid() and public.viagem_pode_editar());

drop policy if exists viagens_upd on public.viagens;
create policy viagens_upd on public.viagens for update to authenticated
  using  ((criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin())
  with check ((criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin());

drop policy if exists viagens_del on public.viagens;
create policy viagens_del on public.viagens for delete to authenticated
  using ((criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin());

-- Paradas herdam a permissão da viagem-mãe.
drop policy if exists viagem_paradas_sel on public.viagem_paradas;
create policy viagem_paradas_sel on public.viagem_paradas for select to authenticated
  using (exists (select 1 from public.viagens v where v.id = viagem_id
                 and (v.criado_por = auth.uid() or public.viagens_ve_todas())));

drop policy if exists viagem_paradas_ins on public.viagem_paradas;
create policy viagem_paradas_ins on public.viagem_paradas for insert to authenticated
  with check (exists (select 1 from public.viagens v where v.id = viagem_id
                      and ((v.criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin())));

drop policy if exists viagem_paradas_upd on public.viagem_paradas;
create policy viagem_paradas_upd on public.viagem_paradas for update to authenticated
  using (exists (select 1 from public.viagens v where v.id = viagem_id
                 and ((v.criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin())));

drop policy if exists viagem_paradas_del on public.viagem_paradas;
create policy viagem_paradas_del on public.viagem_paradas for delete to authenticated
  using (exists (select 1 from public.viagens v where v.id = viagem_id
                 and ((v.criado_por = auth.uid() and public.viagem_pode_editar()) or public.is_admin())));

revoke all on public.viagens        from anon;
revoke all on public.viagem_paradas from anon;

-- ── cliente_localizacao: trocar exists() inline pelo helper ──────────────────
drop policy if exists cliente_localizacao_ins on public.cliente_localizacao;
create policy cliente_localizacao_ins on public.cliente_localizacao
  for insert to authenticated with check (public.viagem_pode_editar());

drop policy if exists cliente_localizacao_upd on public.cliente_localizacao;
create policy cliente_localizacao_upd on public.cliente_localizacao
  for update to authenticated using (public.viagem_pode_editar());

drop policy if exists cliente_localizacao_del on public.cliente_localizacao;
create policy cliente_localizacao_del on public.cliente_localizacao
  for delete to authenticated using (public.is_admin());
