-- Assinatura do clique do anuncio Meta, guardada junto do clique.
--
-- O ?fbclid=... so existe no INSTANTE do clique: e o unico elo entre aquele
-- visitante e a campanha que pagou por ele. Se nao gravar agora, some.
--
-- Guardar habilita o passo que realmente importa: hoje o /l/<slug> manda ao
-- Meta um evento no CLIQUE; com o fbc em maos da pra mandar o evento quando a
-- CONVERSA acontece (matched_at preenchido pelo gatilho), que e o que a analise
-- de 07/08/2026 mostrou fazer diferenca -- o ranking de "conversa barata" do
-- Gerenciador se INVERTE quando medido pelo caixa.
--
-- Duas colunas anulaveis, sem default e sem indice: clique organico (a maioria)
-- fica com NULL nas duas.

alter table public.link_rota_click
  add column if not exists fbclid text,
  add column if not exists fbc    text;

comment on column public.link_rota_click.fbclid is
  'Parametro fbclid da URL: identifica o clique no anuncio do Meta. NULL = trafego nao pago.';

comment on column public.link_rota_click.fbc is
  'fbclid no formato exigido pela Conversions API: fb.1.<timestamp_ms>.<fbclid>.';
