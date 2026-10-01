-- PostgREST schema cache reloads were failing with SQLSTATE 57014 at the
-- authenticator's 8-second timeout, leaving the Data API reconnecting/503.
-- Give metadata/cache work 30 seconds without extending client query budgets.
-- service_role previously inherited authenticator's 8s; pin that effective limit.
-- References:
-- https://supabase.com/docs/guides/database/postgres/timeouts
-- https://docs.postgrest.org/en/v12/references/schema_cache.html
alter role service_role set statement_timeout = '8s';
alter role authenticator set statement_timeout = '30s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Reversal if needed: authenticator -> 8s; RESET service_role statement_timeout;
-- notify pgrst, 'reload config'; notify pgrst, 'reload schema'.
