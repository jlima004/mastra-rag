-- E1/H6 rag_app: OPERATOR-ONLY CANDIDATE. NOT A SUPABASE MIGRATION.
-- DO NOT RUN against hosted Supabase without a SECOND explicit owner approval
-- for role creation and a separate interactive password operation.
-- Safe to run ONLY by CI against a disposable PG17 / pgvector service.
-- No password is stored or transmitted by this SQL. LOGIN has PASSWORD NULL
-- until the human operator runs psql's protected interactive \password command.
-- H5 catalog and runtime DSN are separate gates. H10 remains canceled for MVP.
BEGIN;

DO $e1_rag_app$
DECLARE
  r record;
BEGIN
  IF current_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR current_setting('password_encryption', true) <> 'scram-sha-256'
  THEN
    RAISE EXCEPTION 'E1_RAG_APP_OPERATOR_OR_PG_CONFIG_MISMATCH';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rag_app')
  THEN
    RAISE EXCEPTION 'E1_RAG_APP_ALREADY_EXISTS_STOP_NO_SILENT_REPAIR';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'rag')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'vector' AND n.nspname = 'extensions'
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='rag' AND c.relkind IN ('r','p')
    )
  THEN
    RAISE EXCEPTION 'E1_RAG_APP_FOUNDATION_OR_CATALOG_DRIFT';
  END IF;

  EXECUTE 'CREATE ROLE rag_app WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL';
  EXECUTE 'GRANT USAGE ON SCHEMA extensions TO rag_app';

  SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls INTO STRICT r
  FROM pg_catalog.pg_roles WHERE rolname = 'rag_app';
  IF r.rolcanlogin IS DISTINCT FROM true OR r.rolinherit IS DISTINCT FROM false
    OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
    OR r.rolreplication OR r.rolbypassrls
    OR NOT has_schema_privilege('rag_app','extensions','USAGE')
    OR has_schema_privilege('rag_app','extensions','CREATE')
    OR has_schema_privilege('rag_app','rag','USAGE')
    OR has_schema_privilege('rag_app','rag','CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles member ON member.oid=m.member
      WHERE member.rolname='rag_app'
    )
  THEN
    RAISE EXCEPTION 'E1_RAG_APP_MINIMAL_PROVISIONING_POSTCONDITION_FAILED';
  END IF;
END $e1_rag_app$;
COMMIT;
