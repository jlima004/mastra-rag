-- E1/H6: NON-MUTATING assertions against disposable PG17 + PgVector after
-- scripts/test-e1-local.sh; never use as a hosted migration.
DO $e1$
DECLARE
  r record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls, rolinherit
  INTO STRICT r
  FROM pg_roles WHERE rolname='rag_app';

  IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb
    OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'E1_OPERATOR_ROLE_FLAGS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE member_role.rolname='rag_app'
  ) THEN
    RAISE EXCEPTION 'E1_OPERATOR_ROLE_MEMBERSHIP_DETECTED';
  END IF;

  IF NOT has_schema_privilege('rag_app','rag','USAGE')
    OR has_schema_privilege('rag_app','rag','CREATE')
    OR NOT has_schema_privilege('rag_app','extensions','USAGE')
    OR has_schema_privilege('rag_app','extensions','CREATE') THEN
    RAISE EXCEPTION 'E1_OPERATOR_SCHEMA_GRANTS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('rag','extensions')
      AND n.nspowner=(SELECT oid FROM pg_roles WHERE rolname='rag_app')
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='rag'
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='rag_app')
  ) THEN
    RAISE EXCEPTION 'E1_OPERATOR_OWNS_PRIVILEGED_OBJECT';
  END IF;

  IF has_schema_privilege('anon','rag','USAGE')
     OR has_schema_privilege('authenticated','rag','USAGE')
     OR NOT has_table_privilege('rag_app','rag.embedding_space','SELECT')
     OR has_table_privilege('rag_app','rag.embedding_space','INSERT')
     OR has_table_privilege('rag_app','rag.embedding_space','UPDATE')
     OR has_table_privilege('rag_app','rag.embedding_space','DELETE')
     OR NOT has_table_privilege('rag_app','rag.chunk','INSERT')
     OR NOT has_table_privilege('rag_app','rag.chunk','SELECT')
     OR NOT has_table_privilege('rag_app','rag.chunks_te3s_1536_v1','SELECT')
     OR NOT has_table_privilege('rag_app','rag.chunks_te3s_1536_v1','INSERT')
     OR NOT has_table_privilege('rag_app','rag.chunks_te3s_1536_v1','UPDATE') THEN
    RAISE EXCEPTION 'E1_OPERATOR_TABLE_GRANTS_INVALID';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='rag' AND c.relkind IN ('r','p')
      AND NOT c.relrowsecurity
  ) <> 0 OR (
    SELECT count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='rag' AND c.relkind IN ('r','p')
  ) <> 10 THEN
    RAISE EXCEPTION 'E1_OPERATOR_RLS_DISABLED_OR_TABLE_COUNT_CHANGED';
  END IF;
END $e1$;
