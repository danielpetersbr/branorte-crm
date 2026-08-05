-- ============================================================================
-- BANCO NUTRICIONAL — composição das matérias-primas em venda_racao_ingredientes
--
-- POR QUE
-- Até aqui a tabela guardava `nome, preco, unidade_preco, peso_saco`. O sistema
-- sabia o PREÇO de cada ingrediente e absolutamente nada sobre o que ele entrega
-- ao animal. O estudo de viabilidade comparava custos e aplaudia a economia sem
-- ter como saber se a ração tinha proteína suficiente.
--
-- O QUE ESTA MIGRATION FAZ
-- Só ACRESCENTA colunas, todas nullable e sem default que mude comportamento.
-- Nenhuma linha existente é tocada, nenhum código atual quebra: quem lê a tabela
-- hoje (useVendaRacao.ts e usePrecificacaoRacao.ts) faz select de colunas
-- nomeadas e continua funcionando igual.
--
-- ⚠️ A TABELA ESTÁ VAZIA hoje (0 linhas) e as duas telas caem no fallback local
-- `INGREDIENTES_PADRAO`. O banco de composição que já funciona é o do código
-- (`src/lib/nutricao/ingredientes.ts`), com fonte conferida. Estas colunas
-- existem para o dia em que o time quiser sobrescrever um valor com o LAUDO do
-- fornecedor — que é o caso de uso do §4: "atualizar de acordo com laudo
-- laboratorial, fornecedor, região, safra, umidade".
--
-- A REGRA DE FONTE VALE AQUI TAMBÉM
-- `fonte_nutricional` é NOT NULL quando existe composição — o CHECK abaixo
-- garante que ninguém grave número sem dizer de onde veio. É a mesma trava que o
-- TypeScript faz no banco em código.
-- ============================================================================

-- ── composição ──────────────────────────────────────────────────────────────

-- Perfil completo, no mesmo shape de `PerfilNutricional` (src/lib/nutricao/tipos.ts).
-- JSONB e não 25 colunas porque o conjunto de nutrientes vai crescer (aminoácidos
-- digestíveis, energia líquida) e cada novo nutriente seria uma migration.
-- Ausência de chave = "não cadastrado", que NÃO é zero.
alter table public.venda_racao_ingredientes
  add column if not exists nutricao jsonb;

-- Base dos percentuais do `nutricao`. Sem isto o número é ambíguo: milho é 9,11%
-- de proteína em matéria seca e 7,93% em matéria natural. Errar aqui erra ~12%.
alter table public.venda_racao_ingredientes
  add column if not exists base_nutriente text;

alter table public.venda_racao_ingredientes
  add column if not exists categoria_nutricional text;

-- ── procedência (§22: fonte, data, base, unidade, região, confiabilidade) ────

alter table public.venda_racao_ingredientes
  add column if not exists fonte_nutricional text;

-- Ano da referência. Tabela de 1999 e laudo de 2026 não têm o mesmo peso, e
-- quem lê precisa saber disso sem abrir a fonte.
alter table public.venda_racao_ingredientes
  add column if not exists fonte_ano int;

alter table public.venda_racao_ingredientes
  add column if not exists confiabilidade text;

alter table public.venda_racao_ingredientes
  add column if not exists nutricao_atualizada_em timestamptz;

alter table public.venda_racao_ingredientes
  add column if not exists nutricao_atualizada_por uuid references auth.users(id);

-- ── estoque e disponibilidade (§17) ─────────────────────────────────────────

alter table public.venda_racao_ingredientes
  add column if not exists disponibilidade text;

alter table public.venda_racao_ingredientes
  add column if not exists quantidade_estoque numeric;

alter table public.venda_racao_ingredientes
  add column if not exists fornecedor text;

alter table public.venda_racao_ingredientes
  add column if not exists regiao text;

-- Data do PREÇO, separada da data da composição. As duas envelhecem em ritmos
-- diferentes: preço de milho muda toda semana, proteína do milho não.
alter table public.venda_racao_ingredientes
  add column if not exists preco_atualizado_em date;

-- ── travas ──────────────────────────────────────────────────────────────────

do $$
begin
  -- Base só pode ser matéria natural ou matéria seca.
  if not exists (
    select 1 from pg_constraint where conname = 'venda_racao_ing_base_chk'
  ) then
    alter table public.venda_racao_ingredientes
      add constraint venda_racao_ing_base_chk
      check (base_nutriente is null or base_nutriente in ('MN', 'MS'));
  end if;

  -- Composição SEM fonte não entra. É a regra do projeto escrita no banco: o
  -- número vai virar decisão de investimento na fazenda de alguém.
  if not exists (
    select 1 from pg_constraint where conname = 'venda_racao_ing_fonte_chk'
  ) then
    alter table public.venda_racao_ingredientes
      add constraint venda_racao_ing_fonte_chk
      check (
        nutricao is null
        or (
          fonte_nutricional is not null
          and length(btrim(fonte_nutricional)) >= 20
          and base_nutriente is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'venda_racao_ing_disp_chk'
  ) then
    alter table public.venda_racao_ingredientes
      add constraint venda_racao_ing_disp_chk
      check (disponibilidade is null
        or disponibilidade in ('propriedade', 'compra', 'indisponivel'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'venda_racao_ing_conf_chk'
  ) then
    alter table public.venda_racao_ingredientes
      add constraint venda_racao_ing_conf_chk
      check (confiabilidade is null
        or confiabilidade in ('tabela', 'laudo', 'fornecedor', 'estimativa'));
  end if;
end $$;

comment on column public.venda_racao_ingredientes.nutricao is
  'Composição no shape de PerfilNutricional (src/lib/nutricao/tipos.ts). Chave AUSENTE = não cadastrado, que não é zero. Preencher com 0 faz a fórmula parecer deficiente quando o que houve foi falta de dado.';
comment on column public.venda_racao_ingredientes.base_nutriente is
  'MN = matéria natural (como entra no misturador) | MS = matéria seca. Obrigatório junto com nutricao — sem a base o percentual é ambíguo.';
comment on column public.venda_racao_ingredientes.confiabilidade is
  'tabela = média de levantamento publicado | laudo = análise do lote do cliente | fornecedor = garantia de rótulo | estimativa = não conferido.';

-- ⚠️ RLS NÃO FOI ALTERADA DE PROPÓSITO.
-- A policy desta tabela é ALL/true: qualquer usuário autenticado escreve, e só a
-- UI protege. Isso é um problema REAL e conhecido, mas apertar aqui, junto com
-- uma mudança de schema, arriscaria derrubar a edição de ingredientes sem que
-- ninguém relacionasse a causa. Fica registrado para entrar sozinho, com teste.
