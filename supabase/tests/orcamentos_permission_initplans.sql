-- Read-only integration assertions against existing profiles; all transactions roll back.
-- Existing rules allow approved admin/vendor and reject the remaining current profiles.
-- Each request has its own JWT context; never change a user's context within one SELECT.

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', (SELECT count(*)::text FROM public.orcamentos_files), true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'admin' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing admin fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'admin visibility changed';
  END IF;
END $test$;
SELECT 'admin' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', (SELECT count(*)::text FROM public.orcamentos_files), true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'vendor' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing vendor fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'vendor visibility changed';
  END IF;
END $test$;
SELECT 'vendor' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'pending' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing pending fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'pending visibility changed';
  END IF;
END $test$;
SELECT 'pending' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'rejected' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing rejected fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'rejected visibility changed';
  END IF;
END $test$;
SELECT 'rejected' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'mapa' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing mapa fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'mapa visibility changed';
  END IF;
END $test$;
SELECT 'mapa' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'mapa_visual' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing mapa_visual fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'mapa_visual visibility changed';
  END IF;
END $test$;
SELECT 'mapa_visual' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'representante' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing representante fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'representante visibility changed';
  END IF;
END $test$;
SELECT 'representante' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'marketing' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing marketing fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'marketing visibility changed';
  END IF;
END $test$;
SELECT 'marketing' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT set_config('branorte.expected_count', '0', true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.user_profiles WHERE role = 'visualizador' ORDER BY id LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Missing visualizador fixture'; END IF;
  IF (SELECT count(*) FROM public.orcamentos_files) <> current_setting('branorte.expected_count')::bigint THEN
    RAISE EXCEPTION 'visualizador visibility changed';
  END IF;
END $test$;
SELECT 'visualizador' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

BEGIN READ ONLY;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
DO $test$ BEGIN
  IF (SELECT count(*) FROM public.orcamentos_files) <> 0 THEN RAISE EXCEPTION 'Anonymous access expanded'; END IF;
END $test$;
SELECT 'anon' AS profile, count(*) AS visible_rows, true AS passed FROM public.orcamentos_files;
ROLLBACK;

