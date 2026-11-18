#!/usr/bin/env bash
set -euo pipefail

# ONLY disposable pgvector PG17 service container, distinct from the E1 local
# catalog fixture. No hosted Supabase ref, DNS, DSN or credentials used.
cid="${E1_RAG_APP_LOCAL_CONTAINER:-}"
if [[ -z "$cid" ]]; then echo 'E1_H6_LOCAL_CONTAINER_REQUIRED' >&2; exit 2; fi
image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
if [[ "$image" != 'pgvector/pgvector:pg17' ]] ||
   ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" |
     grep -qx 'POSTGRES_DB=rag_e1_role'; then
  echo 'E1_H6_LOCAL_CONTAINER_IDENTITY_INVALID' >&2; exit 2
fi
for secret in SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY DATABASE_URL DIRECT_URL; do
  if [[ -n "$(printenv "$secret" 2>/dev/null || true)" ]]; then
    echo 'E1_H6_HOSTED_CREDENTIAL_ENVIRONMENT_PROHIBITED' >&2; exit 2
  fi
done
pg() {
  docker exec -i "$cid" psql -X -qAt -v ON_ERROR_STOP=1     -U postgres -d rag_e1_role "$@"
}

# Local equivalent of foundation, NOT replay of hosted migration ledger.
pg <<'SQL'
CREATE SCHEMA rag AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA rag FROM PUBLIC;
CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE EXTENSION vector WITH SCHEMA extensions;
SQL

pg < db/operator/e1_h6_rag_app_pre_catalog_candidate.sql
pg < db/readonly/e1_h6_rag_app_postflight.sql | node -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const o = JSON.parse(fs.readFileSync(0,"utf8"));
assert.equal(o.role_count,1);
assert.equal(o.flags_minimal,true);
assert.equal(o.membership_count,0);
assert.equal(o.owns_schema,0);
assert.equal(o.owns_rag_relations,0);
assert.equal(o.extensions_usage,true);
for(const k of ["extensions_create","rag_usage_before_catalog","rag_create","public_create"])
  assert.equal(o[k],false,k);
assert.equal(o.catalog_table_count,0);
'

# Role exists with no privilege to create private objects.
deny_out=""
if deny_out="$(printf '%s\n' 'SET ROLE rag_app; CREATE TABLE rag.e1_forbidden(id integer);' | pg 2>&1)"; then
  echo 'E1_H6_UNEXPECTED_RAG_DDL_ALLOWED' >&2; exit 1
fi
if [[ "$deny_out" != *'permission denied for schema rag'* ]]; then
  echo 'E1_H6_UNEXPECTED_DDL_DENIAL' >&2; exit 1
fi

# Replaying the non-idempotent candidate MUST fail closed, not silently alter
# an existing role. Verify flags and grants remain after failed local replay.
second=""
if second="$(pg < db/operator/e1_h6_rag_app_pre_catalog_candidate.sql 2>&1)"; then
  echo 'E1_H6_REPLAY_UNEXPECTEDLY_SUCCEEDED' >&2; exit 1
fi
if [[ "$second" != *'E1_RAG_APP_ALREADY_EXISTS_STOP_NO_SILENT_REPAIR'* ]]; then
  echo 'E1_H6_REPLAY_WRONG_DENIAL' >&2; exit 1
fi
pg < db/readonly/e1_h6_rag_app_postflight.sql | node -e '
const a=require("node:assert/strict");
const fs=require("node:fs");
const o=JSON.parse(fs.readFileSync(0,"utf8"));
a.equal(o.role_count,1);
a.equal(o.flags_minimal,true);
a.equal(o.membership_count,0);
a.equal(o.extensions_usage,true);
a.equal(o.rag_usage_before_catalog,false);
'
echo 'E1_H6_RAG_APP_DISPOSABLE_PRE_CATALOG_PROVISION_PASS'
