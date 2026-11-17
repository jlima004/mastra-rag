#!/usr/bin/env bash
set -euo pipefail

# E1/H5: inspect the exact CLI v3 pin and generate a timestamped migration
# solely in a disposable LOCAL directory. Does not read remote credentials,
# resolve project references, run db push, migration repair or connect to Supabase.
[[ "$(supabase --version)" = '3.1.0' ]] || {
  echo 'E1_CLI_VERSION_MISMATCH' >&2
  exit 2
}
for secret in SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL DATABASE_URL DIRECT_URL; do
  if [[ -n "${!secret:-}" ]]; then
    echo "E1_CLI_UNEXPECTED_CREDENTIAL_ENV: ${secret}" >&2
    exit 2
  fi
done
baseline='supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql'
[[ -s "${baseline}" ]] || { echo 'E1_FOUNDATION_MISSING' >&2; exit 2; }
expected_file_hash="$(sha256sum "${baseline}" | cut -d ' ' -f 1)"
# These commands have no server connection; capture help for future manual operator.
supabase migration new --help > /tmp/e1-migration-new-help.txt
supabase migration fetch --help > /tmp/e1-migration-fetch-help.txt
supabase migration list --help > /tmp/e1-migration-list-help.txt
supabase db push --help > /tmp/e1-db-push-help.txt
grep -q -- '--remote' /tmp/e1-migration-fetch-help.txt
grep -q -- '--remote' /tmp/e1-migration-list-help.txt
grep -q -- '--remote' /tmp/e1-db-push-help.txt

workdir="$(mktemp -d -t rag-e1-cli-XXXXXXXX)"
trap 'rm -rf "${workdir}"' EXIT
mkdir -p "${workdir}/supabase/migrations"
cp -- "${baseline}" "${workdir}/supabase/migrations/"
(
  cd "${workdir}"
  # v3 CLI produces the timestamp. This intentionally does NOT commit a
  # hand-invented filename nor alter local/hosted migration history.
  supabase migration new rag_catalog
  mapfile -t files < <(find supabase/migrations -maxdepth 1 -type f -name '*_rag_catalog.sql')
  if [[ "${#files[@]}" -ne 1 ]]; then
    echo 'E1_CLI_GENERATED_MIGRATION_IDENTITY_INVALID' >&2
    exit 1
  fi
  actual="${files[0]}"
  if [[ ! "${actual}" =~ ^supabase/migrations/[0-9]{14}_rag_catalog\.sql$ ]]; then
    echo 'E1_CLI_GENERATED_MIGRATION_NAME_INVALID' >&2
    exit 1
  fi
  [[ ! -s "${actual}" ]] || { echo 'E1_EXPECTED_EMPTY_MIGRATION_INVALID' >&2; exit 1; }
  [[ "$(sha256sum supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql | cut -d ' ' -f 1)" = "${expected_file_hash}" ]] || {
    echo 'E1_FOUNDATION_CHANGED' >&2; exit 1;
  }
  echo "E1_CLI_GENERATED_FILE=${actual}"
)
echo 'E1_CLI_3_1_0_LOCAL_GENERATION_PASS'
