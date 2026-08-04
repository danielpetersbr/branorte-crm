-- Override de localização por cliente.
-- Uma linha aqui SOBREPÕE o centroide de cidade vindo de cidade_geocache/vendas_mapa.
-- É o mecanismo único pra: confirmação do vendedor, endereço digitado à mão e
-- o backfill futuro de geocoding por CEP/endereço.
create table if not exists public.cliente_localizacao (
  cli_key        text primary key,
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  precisao       text not null default 'endereco'
                 check (precisao in ('endereco','confirmada','manual')),
  fonte          text,          -- 'geocode_cep' | 'geocode_endereco' | 'vendedor' | 'manual'
  endereco       text,
  observacao     text,
  confirmado_por uuid references auth.users(id) on delete set null,
  confirmado_em  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.cliente_localizacao is
  'Localização real (endereço) do cliente. Sobrepõe o centroide de cidade no mapa. cli_key = mesma chave de mapa_orcamentos().';

alter table public.cliente_localizacao enable row level security;

-- Quem enxerga o mapa enxerga a localização (é o mesmo dado do pino).
drop policy if exists cliente_localizacao_sel on public.cliente_localizacao;
create policy cliente_localizacao_sel on public.cliente_localizacao
  for select to authenticated using (true);

-- Escrita: papéis internos. 'mapa' e 'consultor' são contas externas — só leem.
drop policy if exists cliente_localizacao_ins on public.cliente_localizacao;
create policy cliente_localizacao_ins on public.cliente_localizacao
  for insert to authenticated with check (
    exists (select 1 from public.user_profiles up
            where up.id = auth.uid()
              and up.role not in ('mapa','consultor','pending','rejected'))
  );

drop policy if exists cliente_localizacao_upd on public.cliente_localizacao;
create policy cliente_localizacao_upd on public.cliente_localizacao
  for update to authenticated using (
    exists (select 1 from public.user_profiles up
            where up.id = auth.uid()
              and up.role not in ('mapa','consultor','pending','rejected'))
  );

drop policy if exists cliente_localizacao_del on public.cliente_localizacao;
create policy cliente_localizacao_del on public.cliente_localizacao
  for delete to authenticated using (
    exists (select 1 from public.user_profiles up
            where up.id = auth.uid() and up.role = 'admin')
  );

revoke all on public.cliente_localizacao from anon;
