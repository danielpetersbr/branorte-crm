-- Request-only STABLE helpers must run once per statement, not for each file.
-- Keep the same policies, commands, roles, row predicates and write checks.
-- No grants, function bodies or business records change.
DO $migration$
DECLARE
  policy_row record;
  helper_name text;
  new_qual text;
  new_check text;
  altered_count integer := 0;
BEGIN
  FOR policy_row IN
    SELECT policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orcamentos_files'
      AND policyname IN ('bloqueia_papel_restrito', 'orc_admin_all', 'orc_vendor_select', 'rls_select_approved')
  LOOP
    new_qual := policy_row.qual;
    new_check := policy_row.with_check;
    FOREACH helper_name IN ARRAY ARRAY['papel_restrito', 'is_admin', 'is_approved', 'current_vendor_id']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = helper_name
          AND p.pronargs = 0 AND p.provolatile = 's'
      ) THEN
        RAISE EXCEPTION 'Expected request-only STABLE helper public.%()', helper_name;
      END IF;
      -- Current pg_policies deparses these calls without a schema prefix.
      -- Refuse to run twice or against an unexpectedly schema-qualified policy.
      IF position('public.' || helper_name || '()' in coalesce(new_qual, '') || coalesce(new_check, '')) > 0
        OR position('SELECT ' || helper_name || '()' in coalesce(new_qual, '') || coalesce(new_check, '')) > 0 THEN
        RAISE EXCEPTION 'Unexpected or already optimized policy %', policy_row.policyname;
      END IF;
      new_qual := replace(new_qual, helper_name || '()', '(SELECT public.' || helper_name || '())');
      new_check := replace(new_check, helper_name || '()', '(SELECT public.' || helper_name || '())');
    END LOOP;
    -- auth.uid() also depends only on this request, including the profile lookup.
    new_qual := replace(new_qual, 'auth.uid()', '(SELECT auth.uid())');
    new_check := replace(new_check, 'auth.uid()', '(SELECT auth.uid())');
    IF new_qual IS NOT DISTINCT FROM policy_row.qual THEN
      RAISE EXCEPTION 'Expected helper in policy %', policy_row.policyname;
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.orcamentos_files USING (%s)%s',
      policy_row.policyname, new_qual,
      CASE WHEN new_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', new_check) END);
    altered_count := altered_count + 1;
  END LOOP;
  IF altered_count <> 4 THEN
    RAISE EXCEPTION 'Expected four existing policies, found %', altered_count;
  END IF;
END
$migration$;
