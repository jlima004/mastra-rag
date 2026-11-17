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
# Confirmed by read-only Supabase SQL at foundation migration 20261113233720:
# encode(extensions.digest(statements[1],'sha256'),'hex') => exact value below.
[[ "${expected_file_hash}" = '9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13' ]] || {
  echo 'E1_FOUNDATION_SQL_MISMATCH_WITH_HOSTED_LEDGER' >&2
  exit 1
}
canonical='db/migrations/0001_rag_catalog.up.sql'
generated='supabase/migrations/20261117213614_rag_catalog.sql'
# The timestamp above was created by CLI v3.1.0 on CI run #44181461137
# (E1_CLI_GENERATED_FILE evidence), never chosen by the operator.
[[ -s "${canonical}" && -s "${generated}" ]] || {
  echo 'E1_CATALOG_MIGRATION_MISSING' >&2; exit 2;
}
cmp -s "${canonical}" "${generated}" || {
  echo 'E1_CATALOG_SQL_DRIFT' >&2; exit 1;
}
echo "E1_CATALOG_SQL_SHA256=$(sha256sum "${canonical}" | cut -d ' ' -f 1)"

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
