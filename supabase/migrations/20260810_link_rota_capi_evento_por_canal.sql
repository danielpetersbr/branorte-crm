-- Nome do evento que cada link manda pra Conversions API do Meta.
--
-- POR QUE: o /l/<slug> dispara ViewContent no clique e Lead na conversa, sempre
-- no MESMO pixel do Meta. Isso e correto pra trafego que veio de anuncio do
-- Meta. Para trafego de OUTRO canal (ChatGPT/OpenAI Ads, a partir de 10/08/2026)
-- o Lead leva o telefone hasheado (ph) e o Meta casa esse telefone com quem ja
-- viu anuncio dele -- creditando a campanha DELE uma conversa que o outro canal
-- pagou. Mesma doenca do criativo &79: numero bonito na conta errada.
--
-- NULL = comportamento historico ('ViewContent' / 'Lead'), que continua sendo o
-- certo pros links do Meta. Preenchido = evento CUSTOM, que aparece no
-- Gerenciador de Eventos mas nao entra na otimizacao das campanhas do Meta.
--
-- Aplicado em producao em 10/08/2026 (migration link_rota_capi_evento_por_canal).
-- A COLUNA VAI ANTES DO DEPLOY: api/l.ts e api/capi-conversa.ts passam a
-- selecionar esses campos, e select de coluna inexistente derruba a varredura
-- inteira em silencio.
alter table public.link_rota
  add column if not exists capi_evento_clique   text,
  add column if not exists capi_evento_conversa text;

comment on column public.link_rota.capi_evento_clique is
  'Evento CAPI do clique. NULL = ViewContent (padrao). Preencher so em link de canal que NAO e Meta.';
comment on column public.link_rota.capi_evento_conversa is
  'Evento CAPI da conversa. NULL = Lead (padrao). Preencher so em link de canal que NAO e Meta.';

-- Nome de evento do Meta: letras/numeros, sem espaco. Barra lixo e injecao.
alter table public.link_rota
  drop constraint if exists link_rota_capi_evento_ck;
alter table public.link_rota
  add constraint link_rota_capi_evento_ck check (
    (capi_evento_clique   is null or capi_evento_clique   ~ '^[A-Za-z][A-Za-z0-9_]{2,39}$') and
    (capi_evento_conversa is null or capi_evento_conversa ~ '^[A-Za-z][A-Za-z0-9_]{2,39}$')
  );

-- O link do OpenAI Ads. Os demais ficam NULL de proposito: sao trafego do Meta.
update public.link_rota
   set capi_evento_clique   = 'ViewContentChatGPT',
       capi_evento_conversa = 'LeadChatGPT'
 where slug = 'branorte';
