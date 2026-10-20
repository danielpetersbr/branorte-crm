-- Gráfico "Evolução diária" da aba Geral (19/10/2026): a série Propostas
--   1) cortava o dia em UTC (created_at::date): proposta das 21h–24h caía no dia seguinte,
--      enquanto a série Ligações já usa o dia de Brasília — o mesmo gráfico misturava fusos;
--   2) fazia DISTINCT ON (cliente_key) na janela INTEIRA de 30 dias: cliente re-cotado
--      contava só no 1º dia, contra a ajuda da tela ("clientes distintos com orçamento
--      montado no dia"). Medido: 215 na série × 266 pares cliente-dia.
-- `fechados_por_dia` (sem uso na tela) também passa a usar o dia de Brasília.
--
-- Troca por texto exato, com trava: se a definição no ar mudou, a migração aborta
-- em vez de recriar a função a partir de um texto que não existe mais.
SET lock_timeout = '5s';
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.dashboard_extra'::regproc);
  a1 text := E'SELECT DISTINCT pm, chg::date AS d FROM labels';
  b1 text := E'SELECT DISTINCT pm, (chg AT TIME ZONE ''America/Sao_Paulo'')::date AS d FROM labels';
  a2 text := E'    SELECT dia, count(*) AS total FROM (\n      SELECT DISTINCT ON (cliente_key) created_at::date AS dia, cliente_key\n';
  b2 text := E'    SELECT dia, count(DISTINCT cliente_key) AS total FROM (\n      SELECT (created_at AT TIME ZONE ''America/Sao_Paulo'')::date AS dia, cliente_key\n';
  a3 text := E'      ) b\n      ORDER BY cliente_key, created_at\n    ) c GROUP BY dia';
  b3 text := E'      ) b\n    ) c GROUP BY dia';
BEGIN
  IF strpos(d, a1) = 0 OR strpos(d, a2) = 0 OR strpos(d, a3) = 0 THEN
    RAISE EXCEPTION 'dashboard_extra mudou desde 19/10/2026: revisar a migração antes de aplicar';
  END IF;
  d := replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
  EXECUTE d;
END
$mig$;
