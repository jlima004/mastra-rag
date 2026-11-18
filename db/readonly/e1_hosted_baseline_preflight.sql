-- E1 hosted READ-ONLY preflight (human supervised). No DDL, no role changes,
-- no transactions with side effects, no secrets and no data export.
-- Run ONLY for project lmocjhpajhxegzobydau, on an independently confirmed
-- PostgreSQL 17 server/database. All results are metadata/aggregates.
--
-- The output verifies the *pre-H6* empty-catalog state. It does NOT authorize
-- any remote action or establish organization-wide Free quota/disk/WAL usage.
SELECT json_build_object(
  'database_name', current_database(),
  'pg_major', current_setting('server_version_num')::integer / 10000,
  'database_bytes', pg_database_size(current_database()),
  'rag_schema_exists', EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'rag'
  ),
  'rag_table_count', (
    SELECT count(*)::integer
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rag' AND c.relkind IN ('r','p')
  ),
  'rag_relation_bytes', (
    SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0)::bigint
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rag' AND c.relkind IN ('r','m','p')
  ),
  'rag_app_exists', EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'rag_app'
  ),
  'vector_version', (
    SELECT extversion FROM pg_extension WHERE extname = 'vector'
  ),
  'vector_schema', (
    SELECT n.nspname FROM pg_extension e JOIN pg_namespace n
      ON n.oid=e.extnamespace WHERE e.extname='vector'
  ),
  'anon_rag_usage', has_schema_privilege('anon','rag','USAGE'),
  'authenticated_rag_usage', has_schema_privilege('authenticated','rag','USAGE'),
  'service_role_rag_usage', has_schema_privilege('service_role','rag','USAGE'),
  'migration_versions', (
    SELECT COALESCE(json_agg(m.version ORDER BY m.version), '[]'::json)
    FROM supabase_migrations.schema_migrations m
  ),
  'foundation_sql_sha256', (
    SELECT encode(extensions.digest(m.statements[1],'sha256'),'hex')
    FROM supabase_migrations.schema_migrations m
    WHERE m.version='20261113233720'
  ),
  'foundation_statement_count', (
    SELECT cardinality(m.statements)
    FROM supabase_migrations.schema_migrations m
    WHERE m.version='20261113233720'
  ),
  'rls_auto_enable_security_definer', (
    SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND p.pronargs=0
    LIMIT 1
  ),
  'rls_auto_enable_returns_event_trigger', (
    SELECT p.prorettype='event_trigger'::regtype
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND p.pronargs=0
    LIMIT 1
  ),
  'anon_function_execute', (
    SELECT has_function_privilege('anon',p.oid,'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND p.pronargs=0
    LIMIT 1
  ),
  'authenticated_function_execute', (
    SELECT has_function_privilege('authenticated',p.oid,'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND p.pronargs=0
    LIMIT 1
  ),
  'ensure_rls_event_trigger_active', EXISTS (
    SELECT 1 FROM pg_event_trigger e
    JOIN pg_proc p ON p.oid=e.evtfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE e.evtname='ensure_rls' AND e.evtenabled='O'
      AND e.evtevent='ddl_command_end'
      AND n.nspname='public' AND p.proname='rls_auto_enable'
  )
)::text AS preflight_json;
