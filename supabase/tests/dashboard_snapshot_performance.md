# Dashboard snapshot performance regression

Run `dashboard_compact_snapshot.sql` after applying the migration. The SQL checks all 22 fields against the original view for an approved administrator and an active approved vendor, anonymous execution denial, compact column order, row lengths, limit and SECURITY INVOKER. It rolls back and does not write commercial records.

2026-10-13 production validation: 18,700 rows equal for both roles; administrator 745.25 ms, vendor 521.40 ms. Authenticated EXPLAIN ANALYZE measured 1,115.38 ms. Prior incident included 504 responses at approximately 125 seconds and concurrent pg_cron workload; these are observations at different loads, not a controlled whole-page speedup ratio.

The rewrite preserves every original intra-journey ORDER BY including implicit NULLS FIRST on descending data, selects the representative before filtering is_internal, joins its primary key, and retains the JSON shape and ACL. The removed creative lookup is on PRIMARY KEY(codigo), and the removed dispatch lookup has LIMIT 1. Existing unresolved ordering ties remain unspecified.

Real Chrome verification showed the Dashboard KPIs, monthly target and daily chart loaded after the database migration. Whole-page duration and a physical phone were not certified. Background business schedules were preserved.
