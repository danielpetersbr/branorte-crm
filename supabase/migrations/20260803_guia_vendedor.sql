-- ============================================================================
-- Guia do Vendedor (/guia) — schema
--
-- Substitui o guia.html estático que rodava em iframe de
-- branorte-viabilidade.vercel.app. Motivo da troca (auditoria 03/08/2026):
--
--   • 49 cards hardcoded em 2 linhas de HTML — impossível revisar, versionar
--     ou corrigir sem redeploy de OUTRO projeto Vercel.
--   • 0 de 49 cards com fonte por afirmação ou data de revisão.
--   • 44 imagens sem alt, sem data de verificação, sem aprovador; 8 reprovadas
--     na inspeção visual (genéricas, de concorrente, de ativismo).
--   • Conteúdo recomendando processo que a Branorte não faz (peletização) e
--     ingredientes que o equipamento não processa (silagem, óleo) — os mesmos
--     que o motor de /producao-propria BLOQUEIA. Dois módulos se contradiziam.
--   • Guia público na internet, sem login.
--
-- Princípio: NENHUM conteúdo técnico fica fixo no código. Tudo aqui, com
-- workflow editorial (rascunho → em_revisao → aprovado → desatualizado →
-- arquivado), fonte rastreável, data de revisão e histórico de versões.
--
-- 6 tabelas:
--   guia_fontes     — catálogo de fontes citáveis (Embrapa, manual X ed. Y ano Z)
--   guia_imagens    — acervo de imagens com licença, autor, verificação e aprovador
--   guia_animais    — espécie/raça/linhagem/categoria
--   guia_materias   — matérias-primas (nutrição + FICHA MECÂNICA pro equipamento)
--   guia_versoes    — histórico de versões (snapshot jsonb a cada update)
--   guia_favoritos  — favoritos por vendedor
--
-- RLS: todo mundo logado LÊ o que está aprovado; quem tem `guia.editar` lê
-- tudo (inclusive rascunho) e escreve. Mesmo padrão de venda_racao_*.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.guia_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quem pode EDITAR o guia (ver rascunhos, criar, alterar, aprovar).
-- Admin sempre pode; os demais dependem da permissão `guia.editar`.
-- ---------------------------------------------------------------------------
create or replace function public.guia_pode_editar()
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
        or coalesce((rp.permissions ->> 'guia.editar')::boolean, false) = true
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 1) FONTES — o que sustenta cada afirmação.
--
-- A auditoria achou 60 percentuais e 56 faixas numéricas sem NENHUMA fonte, e
-- 2 menções a "manual" sem edição, ano, sexo, idade ou condição de teste. Um
-- número de linhagem só vale com essas colunas preenchidas.
-- ---------------------------------------------------------------------------
create table if not exists public.guia_fontes (
  id            bigserial primary key,
  chave         text not null unique,           -- 'embrapa-051-comunicado', 'cobb500-manual-2022'
  titulo        text not null,
  organizacao   text,                           -- Embrapa, Aviagen, MAPA, ABCZ…
  tipo          text not null default 'literatura'
                check (tipo in ('embrapa','mapa','universidade','associacao_raca',
                                'manual_linhagem','literatura','legislacao','branorte')),
  edicao        text,                           -- "Broiler Performance Objectives 2022"
  ano           smallint,
  url           text,
  consultada_em date,
  observacao    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) IMAGENS — acervo verificado.
--
-- `status` é o coração: 'verificada' exige autor + licença + url_original +
-- verificada_em + aprovada_por. Sem isso a imagem NÃO aparece como retrato do
-- item — cai no fallback.
--
-- `identifica_item` responde à pergunta que a auditoria levantou: a foto PROVA
-- a identidade do animal/ingrediente, ou é só contexto? Linhagens comerciais de
-- aves (Cobb, Ross, Hy-Line, Isa, Lohmann) NÃO são visualmente distinguíveis —
-- nenhuma foto, nem a oficial da genética, permite verificação. Nesses casos
-- identifica_item = false e a UI rotula "imagem ilustrativa".
-- ---------------------------------------------------------------------------
create table if not exists public.guia_imagens (
  id             bigserial primary key,
  slug           text not null unique,
  arquivo_url    text,                          -- caminho servido pelo CRM ou storage
  alt            text not null default '',      -- OBRIGATÓRIO pra publicar (ver constraint no status)
  legenda        text,
  autor          text,
  fonte_url      text,                          -- página da obra
  url_original   text,                          -- arquivo original
  licenca        text,                          -- CC BY-SA 4.0, CC0, Domínio público, Branorte…
  status         text not null default 'pendente'
                 check (status in ('pendente','verificada','reprovada')),
  identifica_item boolean not null default false,
  verificada_em  date,
  aprovada_por   text,
  motivo_reprovacao text,
  largura_px     integer,
  peso_kb        integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Uma imagem só é 'verificada' com a papelada completa.
  constraint guia_imagens_verificada_completa check (
    status <> 'verificada' or (
      arquivo_url is not null and alt <> '' and autor is not null
      and licenca is not null and verificada_em is not null and aprovada_por is not null
    )
  )
);

-- ---------------------------------------------------------------------------
-- Colunas editoriais compartilhadas (documentação; repetidas nas 2 tabelas)
--
--   status             rascunho → em_revisao → aprovado → desatualizado → arquivado
--   pendente_validacao números/faixas que aguardam nutricionista ou engenharia.
--                      A UI mostra selo visível; nunca apresenta como fechado.
--   fontes             chaves de guia_fontes
--   revisado_em        data da última revisão técnica
--   proxima_revisao    quando expira
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3) ANIMAIS
--
-- Eixo primário = espécie + sistema; raça/linhagem é o TERCEIRO nível, não o
-- primeiro. O guia antigo só tinha raça, por isso não ajudava o vendedor a
-- entender a criação do cliente.
-- ---------------------------------------------------------------------------
create table if not exists public.guia_animais (
  id                bigserial primary key,
  slug              text not null unique,
  nome              text not null,
  sinonimos         text[] not null default '{}',   -- busca por apelido regional
  -- 1. Identificação
  especie           text not null
                    check (especie in ('bovinos','suinos','aves','ovinos','caprinos')),
  subgrupo          text,                            -- 'corte','leite','frango_corte','postura','caipira'
  tipo              text not null default 'raca'
                    check (tipo in ('raca','linhagem','cruzamento','composto','categoria')),
  classificacao     text,                            -- "Zebuíno (Bos indicus)"
  finalidade        text,                            -- corte, leite, ovos, dupla aptidão
  resumo            text not null,                   -- identificação em 2-3 linhas
  -- 2. Sistemas e fases
  sistemas          text[] not null default '{}',
  fases             text[] not null default '{}',    -- casa com CATEGORIAS de /producao-propria
  fase_estudo       text,                            -- chave default pro botão "usar no estudo"
  peso_min_kg       numeric,
  peso_max_kg       numeric,
  peso_nota         text,
  -- 3. Consumo
  consumo_ref       text,                            -- texto legível ("~110–120 g/ave/dia")
  consumo_unidade   text,
  consumo_fatores   text[] not null default '{}',    -- o que altera o consumo
  -- 4. Alimentação
  tipos_alimentacao text[] not null default '{}',    -- sal mineral, proteinado, concentrado, ração completa
  forma_fisica      text[] not null default '{}',    -- farelada, peletizada, TMR…
  materias_comuns   text[] not null default '{}',    -- slugs de guia_materias
  restricoes        text[] not null default '{}',
  -- 5. Venda
  perguntas         text[] not null default '{}',    -- o que perguntar ao cliente
  sinais_falta_info text[] not null default '{}',    -- como saber que falta dado
  processo          text,                            -- processo de fabricação relacionado
  equipamentos      text[] not null default '{}',    -- categorias de precos_branorte
  argumento         text,                            -- argumento comercial PERMITIDO
  promessas_proibidas text[] not null default '{}',  -- o que NÃO prometer
  branorte          jsonb not null default '{}'::jsonb, -- {atende:[],nao_atende:[],ressalvas:[]}
  explicar_cliente  text,                            -- "como explicar pro cliente"
  resumo_30s        text,
  regiao            text,
  -- Mídia
  imagem_slug       text references public.guia_imagens(slug) on delete set null,
  emoji             text,
  -- Editorial
  status            text not null default 'rascunho'
                    check (status in ('rascunho','em_revisao','aprovado','desatualizado','arquivado')),
  pendente_validacao boolean not null default false,
  pendencias        text[] not null default '{}',
  fontes            text[] not null default '{}',
  autor             text,
  revisor_tecnico   text,
  revisado_em       date,
  proxima_revisao   date,
  ordem             integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) MATÉRIAS-PRIMAS
--
-- Duas metades explícitas:
--   NUTRIÇÃO  — pra que serve, quanto entra, em quem, restrições
--   MECÂNICA  — o que o ingrediente faz COM A MÁQUINA
--
-- A metade mecânica não existia no guia antigo. Era o buraco central: 18
-- ingredientes e nenhuma palavra sobre moagem, poeira, corrosão, ponte no silo,
-- pré-mistura ou misturador indicado. O vendedor não conseguia dimensionar nada.
-- ---------------------------------------------------------------------------
create table if not exists public.guia_materias (
  id                bigserial primary key,
  slug              text not null unique,
  nome              text not null,
  sinonimos         text[] not null default '{}',
  categoria         text not null
                    check (categoria in ('energetico','proteico','fibroso','mineral',
                                         'nucleo_premix','aditivo','coproduto','liquido','risco')),
  -- Nutrição
  resumo            text not null,
  funcao            text,                            -- pra que serve
  composicao        text,                            -- composição de referência
  inclusao          jsonb not null default '{}'::jsonb, -- {aves:"55–70%", bovinos:"…"} — REFERÊNCIA
  especies          text[] not null default '{}',
  restricoes        text[] not null default '{}',
  -- Física / mecânica (dimensionamento de equipamento)
  umidade           text,
  densidade_kg_m3   text,
  forma_fisica      text,                            -- grão, farelo, pó, líquido, torta, volumoso
  fluidez           text check (fluidez in ('livre','media','dificil','nao_flui') or fluidez is null),
  empedra           boolean,
  forma_ponte       boolean,
  abrasivo          boolean,
  oleoso            boolean,
  gera_poeira       boolean,
  corrosivo         boolean,
  risco_micotoxina  boolean,
  precisa_moer      boolean,
  granulometria     text,
  direto_misturador boolean,
  exige_pre_mistura boolean,
  microingrediente  boolean,
  compat_rosca      boolean,
  exige_exaustao    boolean,
  exige_limpeza_rapida boolean,
  misturador_indicado text check (misturador_indicado in ('vertical','horizontal','qualquer','nenhum')
                                  or misturador_indicado is null),
  afeta_homogeneidade boolean,
  armazenamento     text,
  -- Compatibilidade Branorte (a pergunta que o vendedor precisa responder)
  compat_branorte   text not null default 'avaliar'
                    check (compat_branorte in ('ok','ressalva','incompativel','avaliar')),
  compat_motivo     text,
  equipamentos      text[] not null default '{}',
  -- Segurança
  nivel_risco       text not null default 'informacao'
                    check (nivel_risco in ('informacao','atencao','alto_risco','incompativel')),
  alerta            text,
  -- Venda
  perguntas         text[] not null default '{}',
  explicar_cliente  text,
  resumo_30s        text,
  regiao            text,
  -- Mídia
  imagem_slug       text references public.guia_imagens(slug) on delete set null,
  emoji             text,
  -- Editorial
  status            text not null default 'rascunho'
                    check (status in ('rascunho','em_revisao','aprovado','desatualizado','arquivado')),
  pendente_validacao boolean not null default false,
  pendencias        text[] not null default '{}',
  fontes            text[] not null default '{}',
  autor             text,
  revisor_tecnico   text,
  revisado_em       date,
  proxima_revisao   date,
  ordem             integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5) VERSÕES — histórico. Snapshot completo do registro ANTES de cada update.
--    Barato (o volume é baixo) e resolve "quem mudou esse número e quando".
-- ---------------------------------------------------------------------------
create table if not exists public.guia_versoes (
  id          bigserial primary key,
  tabela      text not null check (tabela in ('guia_animais','guia_materias','guia_imagens')),
  registro_id bigint not null,
  slug        text,
  versao      integer not null,
  snapshot    jsonb not null,
  alterado_por uuid references auth.users(id) on delete set null,
  alterado_em timestamptz not null default now()
);

create index if not exists idx_guia_versoes_registro
  on public.guia_versoes (tabela, registro_id, versao desc);

create or replace function public.guia_registrar_versao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  prox integer;
begin
  select coalesce(max(versao), 0) + 1 into prox
  from public.guia_versoes
  where tabela = tg_table_name and registro_id = old.id;

  insert into public.guia_versoes (tabela, registro_id, slug, versao, snapshot, alterado_por)
  values (tg_table_name, old.id, old.slug, prox, to_jsonb(old), auth.uid());

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) FAVORITOS — por vendedor.
-- ---------------------------------------------------------------------------
create table if not exists public.guia_favoritos (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('animal','materia')),
  slug       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tipo, slug)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_guia_fontes_touch on public.guia_fontes;
create trigger trg_guia_fontes_touch before update on public.guia_fontes
  for each row execute function public.guia_touch_updated_at();

drop trigger if exists trg_guia_imagens_touch on public.guia_imagens;
create trigger trg_guia_imagens_touch before update on public.guia_imagens
  for each row execute function public.guia_touch_updated_at();

drop trigger if exists trg_guia_animais_touch on public.guia_animais;
create trigger trg_guia_animais_touch before update on public.guia_animais
  for each row execute function public.guia_touch_updated_at();

drop trigger if exists trg_guia_materias_touch on public.guia_materias;
create trigger trg_guia_materias_touch before update on public.guia_materias
  for each row execute function public.guia_touch_updated_at();

drop trigger if exists trg_guia_animais_versao on public.guia_animais;
create trigger trg_guia_animais_versao before update on public.guia_animais
  for each row execute function public.guia_registrar_versao();

drop trigger if exists trg_guia_materias_versao on public.guia_materias;
create trigger trg_guia_materias_versao before update on public.guia_materias
  for each row execute function public.guia_registrar_versao();

drop trigger if exists trg_guia_imagens_versao on public.guia_imagens;
create trigger trg_guia_imagens_versao before update on public.guia_imagens
  for each row execute function public.guia_registrar_versao();

-- ---------------------------------------------------------------------------
-- Índices de busca
--
-- Busca global do vendedor: "gado confinamento", "ração para suínos", "milho",
-- "ingrediente que não pode ir para aves", "misturador para sal".
-- unaccent + pg_trgm pra tolerar acento e erro de digitação.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create index if not exists idx_guia_animais_busca
  on public.guia_animais using gin ((nome || ' ' || coalesce(resumo,'')) gin_trgm_ops);
create index if not exists idx_guia_materias_busca
  on public.guia_materias using gin ((nome || ' ' || coalesce(resumo,'')) gin_trgm_ops);
create index if not exists idx_guia_animais_especie on public.guia_animais (especie, subgrupo, ordem);
create index if not exists idx_guia_materias_categoria on public.guia_materias (categoria, ordem);
create index if not exists idx_guia_animais_status on public.guia_animais (status);
create index if not exists idx_guia_materias_status on public.guia_materias (status);

-- ---------------------------------------------------------------------------
-- RLS
--
-- Leitura: autenticado vê o que está 'aprovado' ou 'desatualizado' (conteúdo
-- desatualizado continua visível COM selo — sumir com ele no meio de um
-- atendimento é pior que mostrá-lo marcado). Rascunho e arquivado só pra editor.
-- Escrita: só quem tem guia.editar.
-- ---------------------------------------------------------------------------
alter table public.guia_fontes    enable row level security;
alter table public.guia_imagens   enable row level security;
alter table public.guia_animais   enable row level security;
alter table public.guia_materias  enable row level security;
alter table public.guia_versoes   enable row level security;
alter table public.guia_favoritos enable row level security;

drop policy if exists guia_fontes_select on public.guia_fontes;
create policy guia_fontes_select on public.guia_fontes
  for select to authenticated using (true);
drop policy if exists guia_fontes_write on public.guia_fontes;
create policy guia_fontes_write on public.guia_fontes
  for all to authenticated
  using (public.guia_pode_editar()) with check (public.guia_pode_editar());

drop policy if exists guia_imagens_select on public.guia_imagens;
create policy guia_imagens_select on public.guia_imagens
  for select to authenticated using (true);
drop policy if exists guia_imagens_write on public.guia_imagens;
create policy guia_imagens_write on public.guia_imagens
  for all to authenticated
  using (public.guia_pode_editar()) with check (public.guia_pode_editar());

drop policy if exists guia_animais_select on public.guia_animais;
create policy guia_animais_select on public.guia_animais
  for select to authenticated
  using (status in ('aprovado','desatualizado') or public.guia_pode_editar());
drop policy if exists guia_animais_write on public.guia_animais;
create policy guia_animais_write on public.guia_animais
  for all to authenticated
  using (public.guia_pode_editar()) with check (public.guia_pode_editar());

drop policy if exists guia_materias_select on public.guia_materias;
create policy guia_materias_select on public.guia_materias
  for select to authenticated
  using (status in ('aprovado','desatualizado') or public.guia_pode_editar());
drop policy if exists guia_materias_write on public.guia_materias;
create policy guia_materias_write on public.guia_materias
  for all to authenticated
  using (public.guia_pode_editar()) with check (public.guia_pode_editar());

drop policy if exists guia_versoes_select on public.guia_versoes;
create policy guia_versoes_select on public.guia_versoes
  for select to authenticated using (public.guia_pode_editar());

drop policy if exists guia_favoritos_all on public.guia_favoritos;
create policy guia_favoritos_all on public.guia_favoritos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants — anon NÃO entra. O guia antigo era público na internet; este não é.
-- ---------------------------------------------------------------------------
revoke all on public.guia_fontes    from anon;
revoke all on public.guia_imagens   from anon;
revoke all on public.guia_animais   from anon;
revoke all on public.guia_materias  from anon;
revoke all on public.guia_versoes   from anon;
revoke all on public.guia_favoritos from anon;

grant select, insert, update, delete on public.guia_fontes    to authenticated;
grant select, insert, update, delete on public.guia_imagens   to authenticated;
grant select, insert, update, delete on public.guia_animais   to authenticated;
grant select, insert, update, delete on public.guia_materias  to authenticated;
grant select                         on public.guia_versoes   to authenticated;
grant select, insert, delete         on public.guia_favoritos to authenticated;

grant usage, select on sequence public.guia_fontes_id_seq   to authenticated;
grant usage, select on sequence public.guia_imagens_id_seq  to authenticated;
grant usage, select on sequence public.guia_animais_id_seq  to authenticated;
grant usage, select on sequence public.guia_materias_id_seq to authenticated;

revoke all on function public.guia_pode_editar() from anon;
grant execute on function public.guia_pode_editar() to authenticated;
