-- E1/H6 rag_app: hosted PRE-CREATION metadata observation only.
-- SELECT only; never reads passwords, auth secrets, pg_authid or server files.
-- Verify Supabase project ref lmocjhpajhxegzobydau via official project API
-- BEFORE execution: PostgreSQL database name 'postgres' does not prove identity.
-- This result is evidence, NOT permission to CREATE ROLE.
SELECT json_build_object(
  'database_name', current_database(),
  'operator_role', current_user,
  'operator_can_create_role', (
    SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user
  ),
  'pg_major', current_setting('server_version_num')::integer / 10000,
  'password_encryption', current_setting('password_encryption', true),
  'rag_app_absent', NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rag_app'
  ),
  'rag_schema_present', EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'rag'
  ),
  'extensions_schema_present', EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions'
  ),
  'vector_installed_in_extensions', EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'extensions'
  ),
  'rag_table_count', (
    SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rag' AND c.relkind IN ('r','p')
  ),
  'foundation_applied', EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261113233720'
  ),
  'catalog_not_applied', NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261117213614'
  ),
  'rag_private_from_anon', NOT has_schema_privilege('anon','rag','USAGE'),
  'rag_private_from_authenticated', NOT has_schema_privilege('authenticated','rag','USAGE'),
  'rag_private_from_service_role', NOT has_schema_privilege('service_role','rag','USAGE'),
  'h6_s1_anon_execute_revoked', NOT has_function_privilege('anon','public.rls_auto_enable()','EXECUTE'),
  'h6_s1_authenticated_execute_revoked', NOT has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
)::text AS rag_app_preflight_json;
