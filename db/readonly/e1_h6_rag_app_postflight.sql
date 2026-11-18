-- E1/H6 rag_app pre-catalog POST-CREATION read-only proof.
-- This checks structure and grants, NOT password existence or login success.
-- Never query pg_authid, credential verifiers or sensitive settings.
-- Re-check project ref independently; the SQL cannot prove provider identity.
WITH r AS (
  SELECT oid,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
         rolreplication,rolbypassrls
  FROM pg_catalog.pg_roles WHERE rolname='rag_app'
)
SELECT json_build_object(
  'role_count', (SELECT count(*) FROM r),
  'flags_minimal', (
    SELECT (rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls) FROM r
  ),
  'membership_count', (
    SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN r ON m.member=r.oid
  ),
  'owns_schema', (
    SELECT count(*) FROM pg_catalog.pg_namespace n JOIN r ON n.nspowner=r.oid
  ),
  'owns_rag_relations', (
    SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN r ON c.relowner=r.oid WHERE n.nspname='rag'
  ),
  'extensions_usage', CASE WHEN EXISTS(SELECT 1 FROM r)
    THEN has_schema_privilege('rag_app','extensions','USAGE') ELSE false END,
  'extensions_create', CASE WHEN EXISTS(SELECT 1 FROM r)
    THEN has_schema_privilege('rag_app','extensions','CREATE') ELSE true END,
  'rag_usage_before_catalog', CASE WHEN EXISTS(SELECT 1 FROM r)
    THEN has_schema_privilege('rag_app','rag','USAGE') ELSE true END,
  'rag_create', CASE WHEN EXISTS(SELECT 1 FROM r)
    THEN has_schema_privilege('rag_app','rag','CREATE') ELSE true END,
  'public_create', CASE WHEN EXISTS(SELECT 1 FROM r)
    THEN has_schema_privilege('rag_app','public','CREATE') ELSE true END,
  'catalog_table_count', (
    SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='rag' AND c.relkind IN ('r','p')
  )
)::text AS rag_app_postflight_json;
