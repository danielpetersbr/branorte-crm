-- Tira o evento de CLIQUE do caminho do cliente.
--
-- Ate hoje o api/l.ts dava `await enviarEventoCapi(...)` ANTES do 302: o cliente
-- ficava parado esperando o graph.facebook.com responder, com TIMEOUT_MS = 1200
-- em api/_lib/meta-capi.ts. Ou seja, ate 1,2 s de espera pra entregar uma
-- ESTATISTICA -- coisa que nao interessa nada a quem clicou.
--
-- A doutrina da casa ja era essa; o /l/ e que estava fora dela. Do cabecalho do
-- api/capi-conversa.ts, sobre o evento de CONVERSA:
--
--   "Pendurar chamada HTTP la dentro significa que uma indisponibilidade do
--    Meta vira latencia (ou erro engolido) no caminho de TODA mensagem de
--    cliente. A varredura desacopla: se o Meta cair, as linhas ficam pendentes
--    e saem no minuto seguinte."
--
-- Vale igual pro clique. O evento passa a sair pela varredura do cron 36, que
-- ja roda de 5 em 5 min e ja tem cliente do Supabase, enviarEventoCapi e o
-- padrao de marcar-sempre-inclusive-no-erro.
--
-- NAO PERDE PRECISAO: enviarEventoCapi aceita `quandoMs`, entao o evento vai
-- carimbado com a hora do CLIQUE (created_at), nao com a hora da varredura. O
-- Meta aceita evento de ate 7 dias. Atraso de ate 5 min e ruido.
--
-- ⚠️ ZERAR O BACKLOG, senao a primeira rodada reenvia tudo.
-- Existem cliques antigos cujo ViewContent JA FOI enviado inline pelo codigo
-- velho. Com a coluna nova em NULL eles entrariam como "pendentes" e sairiam de
-- novo pro Meta. Mesmo erro que o credito de vez quase cometeu (391 cliques de
-- antes da regra fariam os proximos ~88 sorteios serem todos resgate).
--
-- A janela entre esta migration e o deploy do codigo novo e inofensiva: o
-- eventId do clique e o `codigo` puro, o MESMO valor nas duas vias, entao o
-- Meta deduplica por event_id se algum clique dessa fresta sair duas vezes.

alter table public.link_rota_click
  add column if not exists capi_clique_at        timestamptz,
  add column if not exists capi_clique_resultado text;

-- Tudo que existe agora ja foi enviado inline. 'inline' deixa auditavel de onde
-- veio, separado de 'ok'/'erro'/'off' que a varredura grava.
update public.link_rota_click
   set capi_clique_at = created_at,
       capi_clique_resultado = 'inline'
 where capi_clique_at is null;

-- A varredura busca por (capi_clique_at is null) ordenado por created_at.
-- Parcial: so as pendentes entram no indice, entao ele fica minusculo e nao
-- pesa nos inserts do caminho do clique.
create index if not exists link_rota_click_capi_clique_pend_idx
  on public.link_rota_click (created_at)
  where capi_clique_at is null;

comment on column public.link_rota_click.capi_clique_at is
  'Quando a varredura (cron 36) tentou mandar o ViewContent do clique. Marcado SEMPRE, inclusive em erro, pra nao reenviar e inflar conversao. ''inline'' no resultado = enviado pelo codigo antigo, dentro do api/l.ts, antes de 11/08/2026.';
