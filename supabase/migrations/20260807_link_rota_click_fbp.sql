-- O _fbp (cookie do navegador do Facebook) ja era LIDO em api/l.ts e usado no
-- evento do clique, mas nunca guardado -- nao existia coluna. Resultado: o
-- evento de CONVERSA, que sai depois por varredura, nao tinha como reusa-lo.
--
-- O proprio Gerenciador de Eventos aponta isso (07/08/2026, pixel
-- 1518870689502747): "Seu servidor esta enviando uma baixa cobertura de fbp
-- por meio da API de Conversoes. Anunciantes semelhantes que enviaram fbp
-- viram aumento mediano de 15,23% nas conversoes relatadas."
-- Qualidade da correspondencia medida no mesmo dia: 5,0/10.
alter table public.link_rota_click
  add column if not exists fbp text;

comment on column public.link_rota_click.fbp is
  'Cookie _fbp do navegador no instante do clique, formato fb.<n>.<ms>.<n>. '
  'Segundo melhor sinal de atribuicao depois do fbc, e ao contrario dele '
  'existe mesmo quando o clique nao trouxe fbclid. Vai EM CLARO pro Meta por '
  'especificacao -- nao e PII.';
