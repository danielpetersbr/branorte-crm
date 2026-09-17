-- 1) PRECISAO MINIMA da leitura de GPS.
-- Leitura com raio maior que isto nao conta como localizado.
-- Referencia medida em 17/09/2026: celular chega a 10-50 m; PC de mesa ligado
-- por cabo devolveu 50.000 m (so tem o IP). Ligar o Wi-Fi do PC e o que mais
-- melhora, porque habilita a triangulacao por redes proximas.
alter table public.acesso_config
  add column if not exists precisao_maxima_m integer;

comment on column public.acesso_config.precisao_maxima_m is
  'Raio maximo aceito (metros) da leitura de geolocalizacao. NULL = sem exigencia.';

-- 2) FUSO: a sede e Laguna/SC, nao Mato Grosso. O default anterior
-- (America/Cuiaba, UTC-4) deslocava toda janela em 1 hora.
alter table public.acesso_janelas alter column fuso set default 'America/Sao_Paulo';
update public.acesso_janelas set fuso = 'America/Sao_Paulo' where fuso = 'America/Cuiaba';
