#!/usr/bin/env bash
set -euo pipefail

# Run after scripts/test-e1-local.sh on its CI-only service container.
container="${E1_LOCAL_TEST_CONTAINER:?E2_LOCAL_CONTAINER_REQUIRED}"
[[ "$(docker inspect --format '{{.Config.Image}}' "$container")" == 'pgvector/pgvector:pg17' ]]
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -qx 'POSTGRES_DB=rag_e1'

sql() {
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d rag_e1 "$@"
}
[[ "$(sql -Atc "SELECT current_setting('server_version_num')::int / 10000")" == 17 ]]
sql <<'SQL'
ALTER ROLE rag_app PASSWORD 'e1-local-ci-only';
CREATE TABLE rag.e2_disposable_test_marker(marker text PRIMARY KEY);
INSERT INTO rag.e2_disposable_test_marker VALUES ('E2_DISPOSABLE_LOCAL_POSTGRES17');
GRANT SELECT ON rag.e2_disposable_test_marker TO rag_app;
UPDATE rag.embedding_space SET status='active' WHERE space_id='chunks_te3s_1536_v1';
SQL

migration='supabase/migrations/20261127135647_rag_durable_ingestion.sql'
sql < "$migration"
sql < db/local/0005_e2_durable_ingestion.down.sql
sql < "$migration"

node --experimental-strip-types --test scripts/test-e2-ingestion-local.ts
node --experimental-strip-types --test scripts/test-e2-retention-local.ts
node --experimental-strip-types --test scripts/test-e2-budget-local.ts
