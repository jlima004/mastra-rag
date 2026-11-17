#!/usr/bin/env bash
set -euo pipefail

# E1 test harness: ONLY an isolated service container based on pgvector/pgvector:pg17.
# Never accepts a hosted DSN or Supabase ref. No data leaves this disposable DB.
cid="${E1_LOCAL_TEST_CONTAINER:-}"
if [[ -z "${cid}" ]]; then
  echo "E1_LOCAL_CONTAINER_REQUIRED" >&2
  exit 2
fi
image="$(docker inspect --format '{{.Config.Image}}' "${cid}")"
if [[ "${image}" != "pgvector/pgvector:pg17" ]]; then
  echo "E1_NOT_DISPOSABLE_PGVECTOR" >&2
  exit 2
fi
if ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${cid}" |
    grep -qx 'POSTGRES_DB=rag_e1'; then
  echo "E1_UNEXPECTED_DATABASE" >&2
  exit 2
fi

psql_local() {
  docker exec -i "${cid}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d rag_e1 "$@"
}
expect_denied() {
  local name="$1"
  local sql="$2"
  local expected="$3"
  local error
  if error="$(printf '%s\n' "${sql}" | psql_local 2>&1)"; then
    echo "E1_NEGATIVE_ASSERTION_FAILED: ${name}" >&2
    exit 1
  fi
  if [[ "${error}" != *"${expected}"* ]]; then
    echo "E1_WRONG_DENIAL_REASON: ${name}" >&2
    exit 1
  fi
  echo "PASS: ${name} denied by expected control"
}

# The real hosted Supabase migration 20261113233720 is NOT re-applied.
psql_local < db/local/0000_e1_disposable_setup.sql
psql_local < db/migrations/0001_rag_catalog.up.sql
psql_local < db/migrations/0001_rag_catalog.down.sql
psql_local < db/migrations/0001_rag_catalog.up.sql

export E1_LOCAL_TEST_DATABASE_URL='postgresql://postgres:e1-local-ci-only@127.0.0.1:54329/rag_e1?sslmode=disable'
node --experimental-strip-types scripts/provision-e1-space-local.ts
psql_local < db/local/0002_e1_space_role_policies.sql
psql_local < db/local/0003_e1_positive_proofs.sql

expect_denied 'rag_app cannot create DDL' "SET ROLE rag_app; CREATE TABLE rag.e1_forbidden(id integer);" "permission denied for schema rag"
expect_denied 'anon cannot see private catalog' "SET ROLE anon; SELECT * FROM rag.source LIMIT 1;" "permission denied for schema rag"
expect_denied 'rag_app cannot write another namespace' "SET ROLE rag_app; INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,namespace,metadata) VALUES ('forbidden', ('[' || repeat('0.01,',1535) || '0.01]')::extensions.vector(1536), 'other','{}'::jsonb);" "row-level security policy"
expect_denied 'ingest v1 cannot bypass v2 persisted-identity guard' "SET ROLE rag_app; INSERT INTO rag.ingestion_job (idempotency_key,idempotency_version,kind,source_id,document_id,space_id,rendered_chunk_set_id) VALUES (repeat('7',64),1,'ingest','synthetic-lgpd',repeat('a',64),'chunks_te3s_1536_v1',repeat('d',64));" "violates check constraint"
expect_denied 'duplicate rendered set cannot overwrite PK' "SET ROLE rag_app; INSERT INTO rag.chunk_set (chunk_set_id,base_chunk_set_id,rendering_identity_version,version_id,document_id,pipeline_profile_id,pipeline_profile,normalized_text,normalized_sha256,effective_charset,chunk_count,total_byte_budget) VALUES (repeat('d',64),repeat('e',64),'rag:chunkset-rendered:v2',repeat('b',64),repeat('a',64),repeat('f',64),'{}'::jsonb,'synthetic',repeat('1',64),'utf-8',1,80);" "duplicate key value violates unique constraint"

echo 'E1_LOCAL_POSTGRES17_PGVECTOR_UP_DOWN_UP_RLS_PASS'
