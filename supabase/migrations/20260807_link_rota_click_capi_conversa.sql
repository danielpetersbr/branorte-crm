-- Controle de envio do evento de CONVERSA pro Meta (Conversions API).
--
-- O evento sai por varredura (/api/capi-conversa), nao pelo gatilho: pendurar
-- chamada HTTP dentro de link_rota_casar_msg() colocaria o Meta no caminho de
-- TODA mensagem de cliente que a frota grava.
--
-- capi_enviado_at e marcado inclusive quando o envio falha. Reenviar e pior que
-- perder: evento repetido vira conversao dobrada no Gerenciador. O motivo fica
-- em capi_resultado pra dar pra achar e reprocessar na mao.

alter table public.link_rota_click
  add column if not exists capi_enviado_at timestamptz,
  add column if not exists capi_resultado  text;

comment on column public.link_rota_click.capi_enviado_at is
  'Quando a varredura tentou avisar o Meta. Preenchido mesmo em erro (evita reenvio duplicado).';

comment on column public.link_rota_click.capi_resultado is
  'ok | erro | off — resultado da tentativa. Linha com erro e candidata a reprocessamento manual.';

-- A varredura busca por (matched_at not null, capi_enviado_at null). Indice
-- parcial: so as pendentes entram, entao ele fica minusculo pra sempre.
create index if not exists link_rota_click_capi_pendente_idx
  on public.link_rota_click (matched_at)
  where matched_at is not null and capi_enviado_at is null;
