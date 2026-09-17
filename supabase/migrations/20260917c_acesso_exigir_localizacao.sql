-- Gate de geolocalização: sem permitir a localização, não usa o CRM.
--
-- ⚠️ NÃO existe captura silenciosa. `navigator.geolocation` sempre mostra o
-- popup do navegador, e o popup só dispara a partir de um gesto do usuário.
-- Isto é um gate de CONSENTIMENTO — e é justamente por isso que é defensável
-- como monitoramento de ferramenta corporativa: a pessoa vê, aceita, e entra.

alter table public.acesso_eventos
  add column if not exists lat          double precision,
  add column if not exists lon          double precision,
  add column if not exists precisao_m   double precision,
  -- granted | denied | prompt | indisponivel | erro — 'denied' é o que denuncia
  -- quem está fugindo do registro.
  add column if not exists geo_estado   text;

create index if not exists acesso_eventos_geo_idx
  on public.acesso_eventos (at desc) where lat is not null;

create table if not exists public.acesso_config (
  id                     boolean primary key default true check (id),
  exigir_localizacao     boolean not null default false,
  papeis_obrigatorios    text[]  not null default array['vendor'],
  atualizado_em          timestamptz not null default now(),
  atualizado_por         uuid
);

insert into public.acesso_config (id) values (true) on conflict (id) do nothing;

alter table public.acesso_config enable row level security;

-- Todo logado LÊ (o app precisa saber se deve pedir); só admin ESCREVE.
drop policy if exists acesso_config_le on public.acesso_config;
create policy acesso_config_le on public.acesso_config
  for select to authenticated using (true);

drop policy if exists acesso_config_admin_escreve on public.acesso_config;
create policy acesso_config_admin_escreve on public.acesso_config
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.acesso_config from anon, authenticated;
grant select, insert, update on public.acesso_config to authenticated;

comment on table public.acesso_config is
  'Config da trilha. exigir_localizacao liga o gate de geolocalizacao para os papeis em papeis_obrigatorios (admin nunca e exigido).';
