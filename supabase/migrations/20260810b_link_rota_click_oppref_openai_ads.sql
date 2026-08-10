-- Rastreio do OpenAI Ads no /l/<slug>.
--
-- `oppref` e o click id do OpenAI -- o equivalente ao fbclid do Meta. Ele chega
-- como query param na URL de destino do anuncio e SO existe no instante do
-- clique. Sem ele o evento de conversao chega anonimo: conta como conversao e
-- nao casa com anuncio nenhum, exatamente como acontecia no Meta antes do fbc.
--
-- ⚠️ Diferente do Meta, a Conversions API do OpenAI PROIBE telefone: "Don't send
-- raw email addresses, raw external IDs, phone numbers, or phone number hashes."
-- Entao aqui nao existe a rede de seguranca do `ph` -- ou tem oppref, ou o
-- evento nao vale a pena mandar.
--
-- Colunas de controle separadas das do Meta de proposito: um destino pode
-- falhar sem contaminar o outro, e capi_enviado_at ja significa "Meta".
--
-- Aplicado em producao em 10/08/2026. A COLUNA VAI ANTES DO DEPLOY: api/l.ts
-- grava `oppref` no insert do clique, e coluna inexistente derruba o registro do
-- clique inteiro.
alter table public.link_rota_click
  add column if not exists oppref            text,
  add column if not exists openai_enviado_at timestamptz,
  add column if not exists openai_resultado  text;

comment on column public.link_rota_click.oppref is
  'Click id do OpenAI Ads (query param oppref). Equivalente ao fbclid. Sem ele o evento chega anonimo.';
comment on column public.link_rota_click.openai_enviado_at is
  'Quando o evento lead_created foi mandado ao OpenAI Ads. Marcado MESMO em erro (evento repetido = conversao dobrada).';
comment on column public.link_rota_click.openai_resultado is
  'ok | erro | off -- resultado do ultimo envio ao OpenAI Ads.';

-- Mesma forma do indice que ja existe pro Meta: so as pendentes.
create index if not exists link_rota_click_openai_pendente_idx
  on public.link_rota_click (matched_at)
  where oppref is not null and openai_enviado_at is null;
