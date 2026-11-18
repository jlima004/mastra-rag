-- E1 H6 — READ-ONLY catalog preflight for an explicitly selected Supabase project.
-- Do not confuse database_name=postgres with an authenticated project-ref check.
-- This is not a migration; it does not grant/revoke, mutate functions, or
-- authorize executing the separate proposed REVOKE statement.
-- Compare this result to docs/decisions/RAG-E1-H6-security-adjudication.md;
-- any missing or drifted field blocks future H6 hosted privilege action.
WITH f AS (
  SELECT p.oid, p.proacl, p.proowner, p.prosecdef, p.prorettype, p.proconfig
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'rls_auto_enable'
    AND p.pronargs = 0
),
acl AS (
  SELECT a.grantee, a.privilege_type, a.is_grantable
  FROM f
  CROSS JOIN LATERAL aclexplode(
    COALESCE(f.proacl, acldefault('f', f.proowner))
  ) a
)
SELECT json_build_object(
  'database_name', current_database(),
  'pg_major', current_setting('server_version_num')::integer / 10000,
  'function_count', (SELECT count(*) FROM f),
  'owner', (SELECT pg_get_userbyid(proowner) FROM f),
  'security_definer', (SELECT prosecdef FROM f),
  'returns_event_trigger', (SELECT prorettype = 'event_trigger'::regtype FROM f),
  'search_path_configuration', (SELECT proconfig FROM f),
  'definition_sha256', (
    SELECT encode(extensions.digest(pg_get_functiondef(oid), 'sha256'), 'hex')
    FROM f
  ),
  'explicit_function_acl', (SELECT proacl IS NOT NULL FROM f),
  'effective_anon_execute', (
    SELECT has_function_privilege('anon', oid, 'EXECUTE') FROM f
  ),
  'effective_authenticated_execute', (
    SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM f
  ),
  'effective_service_role_execute', (
    SELECT has_function_privilege('service_role', oid, 'EXECUTE') FROM f
  ),
  'grantees_with_execute', (
    SELECT COALESCE(
      json_agg(
        CASE
          WHEN grantee = 0 THEN 'PUBLIC'
          ELSE (SELECT rolname FROM pg_catalog.pg_roles WHERE oid = grantee)
        END
        ORDER BY grantee
      ), '[]'::json
    )
    FROM acl WHERE privilege_type = 'EXECUTE'
  ),
  'event_triggers', (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'name', e.evtname, 'event', e.evtevent, 'enabled', e.evtenabled,
          'tags', e.evttags
        ) ORDER BY e.evtname
      ), '[]'::json
    )
    FROM pg_catalog.pg_event_trigger e
    JOIN f ON e.evtfoid = f.oid
  ),
  'rag_app_exists', (
    SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rag_app')
  ),
  'rag_table_count', (
    SELECT count(*)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rag' AND c.relkind IN ('r','p')
  )
)::text AS h6_security_preflight_json;
