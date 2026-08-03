-- As DUAS telas de ração gravam na mesma venda_racao_simulacoes:
--   /producao-propria = estudo de viabilidade (vale a pena o CLIENTE produzir)
--   /venda-racao      = precificação da venda da Branorte (margem, preço, proposta)
-- O `dados` jsonb tem formatos diferentes em cada uma. Sem discriminador, o
-- Histórico de uma listaria as linhas da outra, e abrir uma linha do tipo errado
-- quebraria o normalizarInput.
--
-- Default 'estudo' porque a tela de estudo é a que já gravava (e não seta o
-- campo). A de venda carimba 'venda' no insert.
-- Zero linhas na tabela no momento da migration — sem backfill de risco.
alter table public.venda_racao_simulacoes
  add column tipo text not null default 'estudo';

alter table public.venda_racao_simulacoes
  add constraint venda_racao_simulacoes_tipo_check check (tipo in ('estudo', 'venda'));

create index if not exists venda_racao_simulacoes_tipo_idx
  on public.venda_racao_simulacoes (tipo, created_at desc);

-- A config era linha única (CHECK id = 1) e as duas telas leem/gravam nela com
-- shapes diferentes — a primeira que salvasse apagaria os defaults da outra.
-- id=1 fica com o estudo (quem já usava), id=2 é a da venda.
alter table public.venda_racao_config drop constraint venda_racao_config_id_check;
alter table public.venda_racao_config add constraint venda_racao_config_id_check check (id in (1, 2));

insert into public.venda_racao_config (id, config)
values (2, '{}'::jsonb)
on conflict (id) do nothing;
