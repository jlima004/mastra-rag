#!/usr/bin/env bash
set -euo pipefail

# E1/H10: disposable, synthetic-only logical backup + isolated restore drill.
# Never connect to, copy from, or modify the hosted Supabase project.
cid="${E1_LOCAL_TEST_CONTAINER:-}"
if [[ -z "${cid}" ]]; then
  echo "E1_RESTORE_LOCAL_CONTAINER_REQUIRED" >&2
  exit 2
fi
image="$(docker inspect --format '{{.Config.Image}}' "${cid}")"
if [[ "${image}" != "pgvector/pgvector:pg17" ]]; then
  echo "E1_RESTORE_WRONG_CONTAINER_IMAGE" >&2
  exit 2
fi
if ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${cid}" |
    grep -qx 'POSTGRES_DB=rag_e1'; then
  echo "E1_RESTORE_WRONG_SOURCE_DATABASE" >&2
  exit 2
fi

# Refuse unapproved environment-provided connection strings. All commands
# address only the verified disposable service container by its Docker ID.
pg() {
  local database="$1"
  shift
  docker exec -i "${cid}" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "${database}" "$@"
}

archive="$(mktemp -t rag-e1-synthetic-backup-XXXXXXXX.dump)"
chmod 600 "${archive}"
trap 'rm -f "${archive}"' EXIT

# Step 1: Back up the rag schema with data and ACLs from local fixtures.
# Preserve ACLs for the pre-existing local rag_app/anon roles but restore all
# objects as the local postgres owner. Nothing is uploaded as a CI artifact.
docker exec "${cid}" pg_dump -U postgres -d rag_e1 --format=custom \
  --schema=rag --no-owner > "${archive}"
if [[ ! -s "${archive}" ]]; then
  echo "E1_SYNTHETIC_DUMP_EMPTY" >&2
  exit 1
fi

# Step 2: Create a distinct empty database in the same disposable container.
# The pgvector extension lives outside rag; create its prerequisite schema.
pg postgres -c 'CREATE DATABASE rag_e1_restore;' >/dev/null
pg rag_e1_restore -c 'CREATE SCHEMA extensions; CREATE EXTENSION vector WITH SCHEMA extensions;' >/dev/null

# Step 3: Restore atomically; abort on any error (no partial imported schema).
docker exec -i "${cid}" pg_restore -U postgres -d rag_e1_restore \
  --single-transaction --exit-on-error --no-owner < "${archive}"

# Step 4: Compare every catalog and vector table's full row representation,
# not just total counts. Deterministic textual comparison is within one
# disposable PostgreSQL 17 image. Only hashes/counts reach stdout.
tables=(
  embedding_space source document document_version chunk_set
  chunk index_build document_publication ingestion_job
  chunks_te3s_1536_v1
)
for table in "${tables[@]}"; do
  statement="SELECT count(*)::text || ':' || md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) FROM rag.${table} t;"
  source_fingerprint="$(pg rag_e1 -c "${statement}")"
  restored_fingerprint="$(pg rag_e1_restore -c "${statement}")"
  if [[ "${source_fingerprint}" != "${restored_fingerprint}" ]]; then
    echo "E1_SYNTHETIC_RESTORE_MISMATCH: ${table}" >&2
    exit 1
  fi
done

# Step 5: Check the key security/structural invariants after restoration.
schema_check="SELECT (
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='rag' AND c.relkind IN ('r','p')) = 10
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='rag' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) = 0
  AND (SELECT count(*) FROM pg_policies WHERE schemaname='rag') >= 9
  AND has_schema_privilege('rag_app','rag','USAGE')
  AND NOT has_schema_privilege('anon','rag','USAGE')
  AND NOT has_schema_privilege('authenticated','rag','USAGE')
  AND NOT has_table_privilege('rag_app','rag.embedding_space','UPDATE')
  AND has_table_privilege('rag_app','rag.chunk','SELECT')
  AND (SELECT count(*) FROM pg_extension WHERE extname='vector') = 1
);"
if [[ "$(pg rag_e1_restore -c "${schema_check}")" != 't' ]]; then
  echo "E1_SYNTHETIC_RESTORE_SECURITY_OR_SCHEMA_FAILED" >&2
  exit 1
fi

# Prove role-level RLS is effective on the restored tables.
if [[ "$(pg rag_e1_restore -c "SET ROLE rag_app; SELECT
  row_security_active('rag.source'::regclass)
  AND row_security_active('rag.chunks_te3s_1536_v1'::regclass);")" != 't' ]]; then
  echo "E1_SYNTHETIC_RESTORE_RLS_INACTIVE" >&2
  exit 1
fi

echo 'E1_SYNTHETIC_LOGICAL_BACKUP_ISOLATED_RESTORE_PASS'
