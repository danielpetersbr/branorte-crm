-- ---------------------------------------------------------------------------
-- "Monte sua fábrica" — quiz PÚBLICO (/monte-sua-fabrica)
--
-- O produtor responde 7 perguntas sem login e vê a linha de equipamentos que
-- atende a rotina dele, do recebimento à expedição. A resposta cai aqui e vira
-- lead pro time comercial.
--
-- Segue o mesmo desenho de `representante_candidaturas`, que já roda em
-- produção com formulário público:
--   • INSERT liberado pro anon, com os campos INTERNOS pinados no with_check —
--     assim o DevTools não consegue nascer um lead já "atendido" nem plantar
--     nota interna.
--   • ZERO select pro anon. Quem envia não lê de volta (e por isso o código do
--     front NÃO pode usar .insert().select(): o Postgres devolve "violates row
--     level security" quando pede a linha de volta).
--   • SELECT/UPDATE só pra quem já enxerga o módulo de estudo.
-- ---------------------------------------------------------------------------

create table if not exists public.quiz_fabrica_respostas (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),

  -- contato
  nome     text not null check (length(nome) between 2 and 120),
  telefone text not null check (length(telefone) between 8 and 30),
  cidade   text check (cidade is null or length(cidade) <= 120),
  uf       text check (uf is null or length(uf) = 2),

  -- o que ele respondeu
  especie   text check (especie in ('bovinos','suinos','aves','milho')),
  categoria text check (categoria is null or length(categoria) <= 60),
  -- 'peixe' e 'peletizada' = fora de escopo (a Branorte só faz ração FARELADA;
  -- não fabrica peletizadora nem extrusora). Guardamos assim mesmo: saber
  -- QUANTA gente chega pedindo isso é informação de produto, não lixo.
  fora_de_escopo text check (fora_de_escopo is null or fora_de_escopo in ('peixe','peletizada')),

  modo text check (modo in ('animais','direto')),
  numero_animais integer check (numero_animais is null or numero_animais between 0 and 10000000),
  consumo_por_animal_mes numeric check (consumo_por_animal_mes is null or consumo_por_animal_mes between 0 and 100000),
  toneladas_mes numeric check (toneladas_mes is null or toneladas_mes between 0 and 1000000),

  dias_por_semana integer check (dias_por_semana is null or dias_por_semana between 1 and 7),
  horas_por_dia   integer check (horas_por_dia is null or horas_por_dia between 1 and 24),

  recebimento  text check (recebimento is null or recebimento in ('granel','ensacado','propria')),
  estoque_grao text check (estoque_grao is null or estoque_grao in ('nenhum','mes','safra')),
  expedicao    text check (expedicao is null or expedicao in ('ensacada','granel','ambos')),
  pesagem_automatica boolean,
  energia text check (energia is null or energia in ('trifasico','monofasico','nao_sei')),

  -- o que ELE VIU. Guardar o resultado junto é o que permite o vendedor ligar
  -- sabendo exatamente qual fábrica apareceu na tela do produtor — recalcular
  -- depois daria outra resposta assim que a escada de produtos mudasse.
  demanda_mensal_kg numeric,
  capacidade_kg_h   numeric,
  compacta_linha    text,
  compacta_codigo   text,
  resultado jsonb,

  -- controle interno. O anon é proibido de tocar nestes (ver policy de insert).
  status text not null default 'novo'
    check (status in ('novo','contatado','em_estudo','virou_orcamento','descartado')),
  notas_internas text,
  vendedor_id uuid references auth.users(id) on delete set null,
  atendido_em timestamptz,

  -- carimbo de origem: de qual link/campanha veio. Texto curto e opcional.
  origem text check (origem is null or length(origem) <= 60)
);

comment on table public.quiz_fabrica_respostas is
  'Respostas do quiz público /monte-sua-fabrica. INSERT anon, SELECT só pra quem vê o módulo de estudo.';
comment on column public.quiz_fabrica_respostas.resultado is
  'Snapshot da recomendação que o produtor VIU. Não recalcular — a escada de produtos muda.';

create index if not exists quiz_fabrica_respostas_criado_em_idx
  on public.quiz_fabrica_respostas (criado_em desc);
create index if not exists quiz_fabrica_respostas_status_idx
  on public.quiz_fabrica_respostas (status) where status = 'novo';

alter table public.quiz_fabrica_respostas enable row level security;

-- ---------------------------------------------------------------------------
-- INSERT público
--
-- O with_check é a trava: mesmo mandando o payload na mão pelo DevTools, o anon
-- não consegue gravar um lead já marcado como atendido, com vendedor apontado
-- ou com nota interna plantada.
-- ---------------------------------------------------------------------------
drop policy if exists qfr_insert_publico on public.quiz_fabrica_respostas;
create policy qfr_insert_publico
  on public.quiz_fabrica_respostas
  for insert to anon, authenticated
  with check (
    status = 'novo'
    and notas_internas is null
    and vendedor_id is null
    and atendido_em is null
  );

-- ---------------------------------------------------------------------------
-- Leitura e triagem — o staff interno
--
-- `papel_conhecido()` = admin, owner, vendor, marketing, visualizador. É o time
-- que atende lead. Não usei `venda_racao_ve_todas()` (o gate do Estudo) porque
-- hoje só o admin o satisfaz: o vendedor não enxergaria o próprio lead, e a
-- tela nasceria vazia pra quem mais precisa dela.
--
-- `(select papel_conhecido())` com o SELECT por fora NÃO é firula: sem ele o
-- Postgres chama a função UMA VEZ POR LINHA. Numa tabela de leads que só cresce,
-- isso já derrubou tela por statement timeout neste mesmo banco.
-- ---------------------------------------------------------------------------
drop policy if exists qfr_select_comercial on public.quiz_fabrica_respostas;
create policy qfr_select_comercial
  on public.quiz_fabrica_respostas
  for select to authenticated
  using ((select public.papel_conhecido()));

drop policy if exists qfr_update_comercial on public.quiz_fabrica_respostas;
create policy qfr_update_comercial
  on public.quiz_fabrica_respostas
  for update to authenticated
  using ((select public.papel_conhecido()))
  with check ((select public.papel_conhecido()));

-- ---------------------------------------------------------------------------
-- Trava dos papéis EXTERNOS (consultor, representante, mapa).
--
-- Precisa ser RESTRICTIVE. Policy permissiva nova só SOMA permissão — ela nunca
-- tira o que outra já deu. Sem o RESTRICTIVE, bastaria um dia alguém conceder
-- 'venda_racao.ver_todas' a um papel externo pra ele baixar a carteira de leads
-- inteira, com telefone, pelo DevTools.
--
-- Cobre SELECT e UPDATE. INSERT fica FORA de propósito: o consultor logado que
-- abre /monte-sua-fabrica pra preencher junto com o produtor precisa conseguir
-- enviar. Um `for all` travaria isso e o formulário morreria em silêncio pra ele.
-- ---------------------------------------------------------------------------
drop policy if exists qfr_bloqueia_papel_externo on public.quiz_fabrica_respostas;
create policy qfr_bloqueia_papel_externo
  on public.quiz_fabrica_respostas
  as restrictive
  for select to authenticated
  using (not (select public.papel_restrito()));

drop policy if exists qfr_bloqueia_papel_externo_upd on public.quiz_fabrica_respostas;
create policy qfr_bloqueia_papel_externo_upd
  on public.quiz_fabrica_respostas
  as restrictive
  for update to authenticated
  using (not (select public.papel_restrito()))
  with check (not (select public.papel_restrito()));

-- Sem GRANT não há RLS que valha: a policy filtra linha, o grant abre a porta.
grant insert on public.quiz_fabrica_respostas to anon, authenticated;
grant select, update on public.quiz_fabrica_respostas to authenticated;
