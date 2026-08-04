-- DORMIR NA ESTRADA
--
-- Faltava a diferença entre "volto pra base todo dia" e "durmo onde parei".
-- Sem ela o planejador voltava pro ponto de partida TODA noite e recomeçava de
-- lá: com a base a 465 km, cada dia gastava ~930 km só pra ir e voltar dormir,
-- e o segundo cliente nunca cabia por mais dias que se colocasse. A viagem
-- aparecia recusada quando o problema era o modelo, não a rota.
--
-- `true` (padrão) = dorme na estrada; a volta entra uma vez, no fim do último
-- dia. `false` = o comportamento antigo, que continua certo pra vendedor urbano
-- que sai e volta pra casa.
--
-- Default `true` não reescreve viagem nenhuma: `viagens` está zerada (a tela
-- ficou um dia sem subir pra produção, então ninguém salvou nada ainda).

alter table public.viagens
  add column if not exists pernoitar boolean not null default true;

comment on column public.viagens.pernoitar is
  'true = dia termina na última visita e o seguinte começa dali; volta pro ponto de partida só no fim. false = volta pra base todo dia.';
