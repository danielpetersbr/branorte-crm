-- ============================================================================
-- Virada do módulo: "Venda de Ração" → "Estudo de Viabilidade da Produção
-- Própria" (/producao-propria).
--
-- A Branorte NÃO vende ração. A tela deixou de precificar ração pra provar ao
-- produtor que produzir a própria numa fábrica Branorte sai mais barato — e em
-- quanto tempo o equipamento se paga.
--
-- As TABELAS mantêm o nome `venda_racao_*`: renomeá-las quebraria RLS, grants,
-- policies e os estudos já salvos, sem ganho nenhum pro usuário. O que muda é o
-- SIGNIFICADO das colunas.
--
-- Esta migration é IDEMPOTENTE e NÃO APAGA NADA:
--   1) acrescenta as colunas do estudo (custo atual, economia, capacidade,
--      investimento, payback, arquivado);
--   2) migra os status antigos pros novos, preservando o histórico;
--   3) migra o JSONB `dados` das simulações antigas pro formato do estudo;
--   4) as colunas do módulo de precificação (margem, preço sugerido, lucro…)
--      ficam onde estão, sem uso, pra não destruir dado já gravado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Colunas do estudo
-- ---------------------------------------------------------------------------
alter table public.venda_racao_simulacoes
  add column if not exists custo_atual_kg     numeric(14,6) not null default 0,
  add column if not exists custo_proprio_kg   numeric(14,6) not null default 0,
  add column if not exists economia_kg        numeric(14,6) not null default 0,
  add column if not exists economia_mensal    numeric(16,2) not null default 0,
  add column if not exists economia_anual     numeric(16,2) not null default 0,
  add column if not exists reducao_pct        numeric(9,4)  not null default 0,
  add column if not exists capacidade_kg_hora numeric(12,2) not null default 0,
  add column if not exists investimento_total numeric(16,2) not null default 0,
  -- null de propósito: sem economia NÃO existe payback, e 0 mentiria
  add column if not exists payback_meses      numeric(12,2),
  add column if not exists arquivado          boolean not null default false;

comment on column public.venda_racao_simulacoes.custo_atual_kg is
  'R$/kg que o cliente gasta hoje (ração comprada ou operação própria informada).';
comment on column public.venda_racao_simulacoes.custo_proprio_kg is
  'R$/kg estimado produzindo na propriedade (ingredientes + perda + operacionais).';
comment on column public.venda_racao_simulacoes.payback_meses is
  'Meses pro investimento se pagar. NULL quando não há economia — não existe payback.';

create index if not exists venda_racao_simulacoes_arquivado_idx
  on public.venda_racao_simulacoes (arquivado, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Status: proposta comercial → andamento do projeto
--
--    rascunho   → rascunho        enviada  → apresentado
--    negociacao → negociacao      aprovada → aprovado
--    vendida    → vendido         perdida  → nao_avancou
--    cancelada  → cancelado       (novo)   → analisando
-- ---------------------------------------------------------------------------
alter table public.venda_racao_simulacoes
  drop constraint if exists venda_racao_simulacoes_status_check;

update public.venda_racao_simulacoes
   set status = case status
     when 'enviada'   then 'apresentado'
     when 'aprovada'  then 'aprovado'
     when 'vendida'   then 'vendido'
     when 'perdida'   then 'nao_avancou'
     when 'cancelada' then 'cancelado'
     else status
   end
 where status in ('enviada', 'aprovada', 'vendida', 'perdida', 'cancelada');

-- qualquer coisa fora da lista nova volta pra rascunho antes de travar o check
update public.venda_racao_simulacoes
   set status = 'rascunho'
 where status not in ('rascunho','apresentado','analisando','negociacao',
                      'aprovado','vendido','nao_avancou','cancelado');

alter table public.venda_racao_simulacoes
  add constraint venda_racao_simulacoes_status_check
  check (status in ('rascunho','apresentado','analisando','negociacao',
                    'aprovado','vendido','nao_avancou','cancelado'));

alter table public.venda_racao_simulacoes
  alter column status set default 'rascunho';

-- ---------------------------------------------------------------------------
-- 3) JSONB `dados`: formato da precificação → formato do estudo
--
--    quantidade                    → necessidade (mensal, com margem de segurança)
--    venda.precoAtualClientePorKg  → atual.preco (R$/kg da ração comprada)
--    custos.custosFixosMensais     → {ativo, valor}
--    cenarios.*.materiaPrimaPct    → cenarios.*.ingredientesPct
--
--    O front (`normalizarInput`) faz a MESMA conversão ao abrir, então isto aqui
--    é redundância proposital: deixa o banco consultável (economia, custo) sem
--    depender de alguém abrir a tela.
-- ---------------------------------------------------------------------------
update public.venda_racao_simulacoes s
   set dados = s.dados
     - 'quantidade' - 'venda'
     || jsonb_build_object(
          'necessidade', jsonb_build_object(
            'modo',                coalesce(s.dados #>> '{quantidade,modo}', 'animais'),
            'numeroAnimais',       coalesce((s.dados #>> '{quantidade,numeroAnimais}')::numeric, 0),
            'consumoPorAnimal',    coalesce((s.dados #>> '{quantidade,consumoPorAnimal}')::numeric, 0),
            'baseConsumo',         coalesce(s.dados #>> '{quantidade,baseConsumo}', 'mes'),
            'dias',                coalesce((s.dados #>> '{quantidade,dias}')::numeric, 30),
            'consumoConfirmado',   false,
            'margemSegurancaPct',  coalesce((s.dados #>> '{quantidade,sobraPct}')::numeric, 0),
            -- no modelo antigo a quantidade era do PEDIDO e se repetia N vezes no mês
            'quantidadeInformada', coalesce((s.dados #>> '{quantidade,quantidadeInformada}')::numeric, 0)
                                   * greatest(coalesce((s.dados #>> '{quantidade,pedidosPorMes}')::numeric, 1), 1),
            'unidadeQuantidade',   coalesce(s.dados #>> '{quantidade,unidadeQuantidade}', 'kg'),
            'periodoQuantidade',   'mes',
            'pesoSaco',            coalesce((s.dados #>> '{quantidade,pesoSaco}')::numeric, 40)
          ),
          'atual', jsonb_build_object(
            'modo',            'compra',
            'preco',           coalesce((s.dados #>> '{venda,precoAtualClientePorKg}')::numeric, 0),
            'unidadePreco',    'kg',
            'pesoSacoCompra',  coalesce((s.dados #>> '{quantidade,pesoSaco}')::numeric, 40),
            'frete',           jsonb_build_object('ativo', false, 'valor', 0),
            'descarga',        jsonb_build_object('ativo', false, 'valor', 0),
            'outros',          jsonb_build_object('ativo', false, 'valor', 0),
            'perdasPct',       0,
            'custoManualPorKg', 0,
            'observacoes',     ''
          )
        )
 where s.dados ? 'quantidade'
   and not (s.dados ? 'necessidade');

-- custosFixosMensais numérico → {ativo, valor}
update public.venda_racao_simulacoes s
   set dados = jsonb_set(
         s.dados, '{custos,custosFixosMensais}',
         jsonb_build_object(
           'ativo', coalesce((s.dados #>> '{custos,custosFixosMensais}')::numeric, 0) > 0,
           'valor', coalesce((s.dados #>> '{custos,custosFixosMensais}')::numeric, 0)
         )
       )
 where jsonb_typeof(s.dados #> '{custos,custosFixosMensais}') = 'number';

-- materiaPrimaPct → ingredientesPct nos três cenários
update public.venda_racao_simulacoes s
   set dados = jsonb_set(
         s.dados, array['cenarios', c.chave, 'ingredientesPct'],
         to_jsonb(coalesce((s.dados #>> array['cenarios', c.chave, 'materiaPrimaPct'])::numeric, 0))
       )
  from (values ('conservador'), ('provavel'), ('otimista')) as c(chave)
 where s.dados #> array['cenarios', c.chave, 'materiaPrimaPct'] is not null
   and s.dados #> array['cenarios', c.chave, 'ingredientesPct'] is null;

-- status dentro do JSONB acompanha a coluna
update public.venda_racao_simulacoes s
   set dados = jsonb_set(s.dados, '{status}', to_jsonb(s.status))
 where coalesce(s.dados ->> 'status', '') <> s.status;

-- ---------------------------------------------------------------------------
-- 4) Config: a linha única perde os defaults comerciais (margem por espécie,
--    impostos, comissão, taxas, prazo/forma de pagamento e entrega). Nada disso
--    faz sentido num estudo de viabilidade. O que sobrar é mesclado com os
--    defaults do código em `mesclarConfig`.
-- ---------------------------------------------------------------------------
update public.venda_racao_config
   set config = config
     - 'margemPorEspecie' - 'margemMinimaPorEspecie' - 'impostosPct' - 'comissaoPct'
     - 'taxaFinanceiraPct' - 'taxaCartaoPct' - 'prazoPadrao' - 'formaPagamentoPadrao'
     - 'condicaoEntregaPadrao' - 'textoComercial'
 where id = 1;

-- ---------------------------------------------------------------------------
-- 5) Grants: nada muda de alcance, mas as colunas novas herdam o grant de
--    tabela. Reafirmado aqui pra migration ficar autocontida.
-- ---------------------------------------------------------------------------
revoke all on public.venda_racao_simulacoes from anon;
grant select, insert, update, delete on public.venda_racao_simulacoes to authenticated;
