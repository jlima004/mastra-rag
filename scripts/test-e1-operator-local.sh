#!/usr/bin/env bash
set -euo pipefail

# E1/H6: local-only operator privilege proof + equivalent event-trigger test.
# This script runs SQL ONLY using a verified disposable pgvector PG17 container.
cid="${E1_LOCAL_TEST_CONTAINER:-}"
[[ -n "${cid}" ]] || { echo 'E1_SECURITY_LOCAL_CONTAINER_REQUIRED' >&2; exit 2; }
image="$(docker inspect --format '{{.Config.Image}}' "${cid}")"
[[ "${image}" = 'pgvector/pgvector:pg17' ]] || { echo 'E1_SECURITY_CONTAINER_REJECTED' >&2; exit 2; }
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${cid}" |
  grep -qx 'POSTGRES_DB=rag_e1' || { echo 'E1_SECURITY_DATABASE_REJECTED' >&2; exit 2; }

pg() {
  local database="$1"
  shift
  docker exec -i "${cid}" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d "${database}" "$@"
}

# These assertions are intentionally non-mutating.
pg rag_e1 < db/local/0004_e1_operator_privilege_proofs.sql
echo 'E1_OPERATOR_ROLE_CONTRACT_PASS'

# Exercise a replica of the observed hosted PUBLIC event-trigger function in
# a DIFFERENT disposable local database. Does not touch hosted or rag_e1.
pg rag_e1 -c 'CREATE DATABASE rag_e1_security;' >/dev/null
pg rag_e1_security <<'SQL'
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%'
      AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid=cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security',cmd.schema_name,tbl);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$function$;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  EXECUTE FUNCTION public.rls_auto_enable();
CREATE TABLE public.before_revocation (id integer);
DO $assert$
BEGIN
  IF NOT has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.before_revocation'::regclass) THEN
    RAISE EXCEPTION 'E1_SECURITY_BASELINE_NOT_REPRODUCED';
  END IF;
END;
$assert$;
SQL

# PostgreSQL event_trigger functions cannot be SELECT-called as normal
# functions. This assertion does NOT model PostgREST RPC or prove safety.
call_result=''
if call_result="$(printf 'SET ROLE anon; SELECT public.rls_auto_enable();\n' | pg rag_e1_security 2>&1)"; then
  echo 'E1_SECURITY_UNEXPECTED_DIRECT_CALL_SUCCESS' >&2
  exit 1
fi
if [[ "${call_result}" != *'can only be called as triggers'* ]]; then
  echo 'E1_SECURITY_DIRECT_CALL_DENIAL_DIFFERENT' >&2
  exit 1
fi

# Equivalent isolated change: revoking PUBLIC/anon/authenticated EXECUTE must
# leave DDL event-trigger behavior functional (without touching hosted roles).
pg rag_e1_security <<'SQL'
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
CREATE TABLE public.after_revocation (id integer);
DO $assert$
BEGIN
  IF has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
    OR has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.after_revocation'::regclass)
    OR (SELECT count(*) FROM pg_event_trigger WHERE evtname='ensure_rls' AND evtenabled='O') <> 1 THEN
    RAISE EXCEPTION 'E1_SECURITY_REVOKE_ISOLATED_REGRESSION';
  END IF;
END;
$assert$;
SQL

echo 'E1_EVENT_TRIGGER_LOCAL_REVOKE_REGRESSION_PASS'
