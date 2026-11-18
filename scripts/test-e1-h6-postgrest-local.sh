#!/usr/bin/env bash
set -euo pipefail
# H6: actual HTTP RPC against a disposable PostgreSQL 17 + PostgREST.
# No hosted credentials, projects, network targets or persistent writes.
if [[ -z "$(printenv E1_LOCAL_TEST_CONTAINER 2>/dev/null || true)" ]]; then
  echo 'E1_H6_DISPOSABLE_CONTAINER_REQUIRED' >&2; exit 2
fi
cid="$E1_LOCAL_TEST_CONTAINER"
image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
if [[ "$image" != 'pgvector/pgvector:pg17' ]] ||
   ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" |
      grep -qx 'POSTGRES_DB=rag_e1'; then
  echo 'E1_H6_WRONG_LOCAL_POSTGRES_CONTAINER' >&2; exit 2
fi
for key in SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY DATABASE_URL DIRECT_URL; do
  if [[ -n "$(printenv "$key" 2>/dev/null || true)" ]]; then
    echo 'E1_H6_HOSTED_CREDENTIAL_ENVIRONMENT_PROHIBITED' >&2; exit 2
  fi
done
pg() {
  local db="$1"; shift
  docker exec -i "$cid" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}
pgrst_name="e1-h6-pgrst-$$"
tmp="$(mktemp -d -t e1-h6-pgrst-XXXXXXXX)"
cleanup() {
  docker rm -f "$pgrst_name" >/dev/null 2>&1 || true
  pg rag_e1 -c 'DROP DATABASE IF EXISTS rag_e1_h6_rpc WITH (FORCE);' >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
pg rag_e1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$roles$;
CREATE DATABASE rag_e1_h6_rpc;
SQL
# This body reproduces the hosted read-only catalog inspection of 2026-11-18
# with only formatting changes; exact deployed binary/config parity is NOT proven.
pg rag_e1_h6_rpc <<'SQL'
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  EXECUTE FUNCTION public.rls_auto_enable();
-- Positive control proves the PostgREST request actually uses the intended role.
CREATE FUNCTION public.e1_h6_rpc_control()
RETURNS text LANGUAGE sql STABLE AS $control$
  SELECT current_user::text;
$control$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e1_h6_rpc_control() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated;
CREATE TABLE public.before_revocation (id integer);
DO $verify$
BEGIN
 IF NOT has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') OR
    NOT has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') OR
    NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.before_revocation'::regclass) THEN
   RAISE EXCEPTION 'E1_H6_LOCAL_PRE_REVOKE_BASELINE_FAILED';
 END IF;
END
$verify$;
SQL
docker run --rm --detach --name "$pgrst_name" --network host \
  -e PGRST_DB_URI='postgres://postgres:e1-local-ci-only@127.0.0.1:54329/rag_e1_h6_rpc' \
  -e PGRST_DB_SCHEMAS='public' \
  -e PGRST_DB_ANON_ROLE='anon' \
  -e PGRST_JWT_SECRET='e1-h6-isolated-test-only-jwt-secret-0123456789' \
  -e PGRST_SERVER_PORT='3105' \
  -e PGRST_SERVER_HOST='127.0.0.1' \
  postgrest/postgrest:v16.6 >/dev/null
ready=0
for attempt in $(seq 1 60); do
  status="$(curl -s --max-time 3 --output "$tmp/ready.json" --write-out '%{http_code}' \
    http://127.0.0.1:3105/rpc/e1_h6_rpc_control || true)"
  if [[ "$status" == '200' ]]; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != '1' ]]; then echo 'E1_H6_POSTGREST_CONTROL_NOT_READY' >&2; exit 1; fi
# Non-secret ephemeral HS256 token used ONLY inside this runner.
jwt="$(node -e '
const {createHmac}=require("node:crypto");
const secret="e1-h6-isolated-test-only-jwt-secret-0123456789";
const part=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
const header=part({alg:"HS256",typ:"JWT"});
const payload=part({role:"authenticated",exp:Math.floor(Date.now()/1000)+600});
const signing=header+"."+payload;
process.stdout.write(signing+"."+createHmac("sha256",secret).update(signing).digest("base64url"));
')"
request_control() {
  local role="$1" status
  if [[ "$role" == anon ]]; then
    status="$(curl -sS --max-time 10 -o "$tmp/response.json" -w '%{http_code}' \
      http://127.0.0.1:3105/rpc/e1_h6_rpc_control)"
  else
    status="$(curl -sS --max-time 10 -o "$tmp/response.json" -w '%{http_code}' \
      -H "Authorization: Bearer $jwt" http://127.0.0.1:3105/rpc/e1_h6_rpc_control)"
  fi
  node -e '
    const fs=require("node:fs"); const [file,code,role]=process.argv.slice(1);
    if(code!=="200" || JSON.parse(fs.readFileSync(file,"utf8"))!==role){
      console.error("E1_H6_RPC_AUTH_CONTROL_FAILED"); process.exit(1);
    }
  ' "$tmp/response.json" "$status" "$role"
}
probe_rpc() {
  local phase="$1" role="$2" status
  if [[ "$role" == anon ]]; then
    status="$(curl -sS --max-time 10 -o "$tmp/rpc.json" -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' --data '{}' \
      http://127.0.0.1:3105/rpc/rls_auto_enable)"
  else
    status="$(curl -sS --max-time 10 -o "$tmp/rpc.json" -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $jwt" --data '{}' \
      http://127.0.0.1:3105/rpc/rls_auto_enable)"
  fi
  node -e '
    const fs=require("node:fs"); const [file,code,phase,role]=process.argv.slice(1);
    let body; try {body=JSON.parse(fs.readFileSync(file,"utf8"));} catch {}
    // This is deliberately phase-sensitive: a pre-revocation event-trigger
    // RPC fails at invocation (0A000), while explicit revocation fails earlier
    // at PostgreSQL privilege enforcement (42501). PostgREST maps SQLSTATE
    // 42501 to 401 for anon and 403 for authenticated.
    const understood=phase==="BASELINE"
      ? code==="400" && body?.code==="0A000"
      : role==="anon"
        ? code==="401" && body?.code==="42501"
        : code==="403" && body?.code==="42501";
    if (!understood) {
      console.error("E1_H6_RPC_UNEXPECTED_HTTP_"+code+"_CODE_"+String(body?.code??"UNKNOWN"));
      process.exit(1);
    }
    console.log("E1_H6_"+phase+"_"+role.toUpperCase()+"_RPC_REJECTED_HTTP_"+code+"_CODE_"+body.code);
  ' "$tmp/rpc.json" "$status" "$phase" "$role"
}
for role in anon authenticated; do request_control "$role"; probe_rpc BASELINE "$role"; done
pg rag_e1_h6_rpc <<'SQL'
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
CREATE TABLE public.after_revocation (id integer);
DO $verify$
BEGIN
 IF has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') OR
    has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') OR
    NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.after_revocation'::regclass) OR
    (SELECT count(*) FROM pg_event_trigger WHERE evtname='ensure_rls' AND evtenabled='O') <> 1
 THEN RAISE EXCEPTION 'E1_H6_POST_REVOKE_EVENT_TRIGGER_REGRESSION'; END IF;
END
$verify$;
NOTIFY pgrst, 'reload schema';
SQL
sleep 2
for role in anon authenticated; do request_control "$role"; probe_rpc POST_REVOKE "$role"; done
echo 'E1_H6_ISOLATED_POSTGREST_HTTP_PROOF_COMPLETE__HUMAN_DISPOSITION_PENDING'
