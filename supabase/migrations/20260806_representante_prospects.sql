-- Mapa de POSSÍVEIS representantes (prospecção outbound) — /mapa-potenciais.
-- Fonte: Mapeamento_Representantes_BraNorte_Brasil.xlsx, pesquisa pública de 06/08/2026,
-- 54 candidatos, 2 por UF, levantados nos localizadores oficiais de Plasson,
-- Big Dutchman, MSD, Grupo Real e em empresas locais.
--
-- NÃO confundir com public.representante_candidaturas, que é a ponta INBOUND
-- (o formulário público /seja-representante).
--
-- Coordenada: cidade-base do candidato, resolvida por, nesta ordem,
-- cidade_geocache → Nominatim (validando estado+município) → vendas_mapa →
-- centroide da malha do IBGE. Os 2 casos em que uf <> uf_cidade são candidatos
-- que atendem um estado a partir da base em outro (Castelo/ES → RJ, Maceió/AL → SE).
create table if not exists public.representante_prospects (
  id              bigserial primary key,
  origem_id       int,                 -- ID na planilha de origem
  uf              text not null,       -- UF que o candidato ATENDE
  estado          text,
  regiao          text,
  cidade_texto    text,                -- como veio da pesquisa ("Macapá e Santana")
  cidade          text,                -- cidade-base resolvida (a do pino)
  uf_cidade       text,                -- UF da cidade-base; difere de uf quando atende de fora
  lat             double precision,
  lng             double precision,
  geo_precisao    text,                -- cidade | regiao | fora_da_uf
  nota_geo        text,
  empresa         text not null,
  contato         text,
  telefone        text,
  email           text,
  site            text,
  segmento        text,
  rede            text,                -- rede/marca de origem (Plasson, Big Dutchman, MSD…)
  especies        text,
  tipo            text,
  cobertura       text,
  fonte           text,                -- URL da fonte pública
  verificado_em   timestamptz,
  fit             smallint,            -- 0-4
  carteira        smallint,            -- 0-2
  contato_pts     smallint,            -- 0-2
  presenca        smallint,            -- 0-2
  pontuacao_bruta smallint,
  pontuacao       smallint,            -- ajustada pelo desconto do risco
  risco           text,                -- Baixo | Médio | Alto
  prioridade      text,                -- Alta | Média | Exploratória
  status          text not null default 'Não abordado',
  responsavel     text,
  proxima_acao    text,
  observacoes     text,
  anotacoes       text,                -- campo livre da equipe
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create index if not exists idx_rep_prospects_uf on public.representante_prospects (uf);
create index if not exists idx_rep_prospects_status on public.representante_prospects (status);

alter table public.representante_prospects enable row level security;

-- Mesma trava do painel de representantes: admin OU quem tem 'representantes.gerir'
-- (hoje: Daniel e Patrick). Sem SELECT pro anon — é carteira de prospecção com
-- telefone e e-mail de 54 empresas.
drop policy if exists rp_select_gestor on public.representante_prospects;
create policy rp_select_gestor on public.representante_prospects
  for select to authenticated using (public.pode_gerir_representantes());

drop policy if exists rp_update_gestor on public.representante_prospects;
create policy rp_update_gestor on public.representante_prospects
  for update to authenticated
  using (public.pode_gerir_representantes())
  with check (public.pode_gerir_representantes());

-- Inserir/apagar só admin: a base é importada da pesquisa, não digitada na tela.
drop policy if exists rp_insert_admin on public.representante_prospects;
create policy rp_insert_admin on public.representante_prospects
  for insert to authenticated with check (public.is_admin());

drop policy if exists rp_delete_admin on public.representante_prospects;
create policy rp_delete_admin on public.representante_prospects
  for delete to authenticated using (public.is_admin());

create or replace function public.fn_rep_prospect_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_rep_prospect_touch on public.representante_prospects;
create trigger trg_rep_prospect_touch before update on public.representante_prospects
  for each row execute function public.fn_rep_prospect_touch();
