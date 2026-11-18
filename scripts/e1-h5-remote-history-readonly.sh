#!/usr/bin/env bash
set -euo pipefail

# Human-operated E1/H5. The only EXPLICIT remote CLI command is
# migration LIST. Supabase CLI 3.1.0 can nevertheless POST /cli/login-role
# (read_only:false) when DB password is absent, so fail closed up front.
# GitHub Actions exercises this with a fake CLI and synthetic fake password.
# No unattended production use or permission for ANY hosted mutation.

readonly E1_PROJECT_REF='lmocjhpajhxegzobydau'
readonly E1_FOUNDATION_VERSION='20261113233720'
readonly E1_CATALOG_VERSION='20261117213614'
readonly E1_FOUNDATION_SHA256='9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13'
readonly E1_CATALOG_SHA256='19a6cc2b841e5670db4da7aad11f8c2fa8a886bd1f4dae5d65c72cc4dbe3d070'

if [[ "${1:-}" != '--read-only' || "${#}" != 1 ]]; then
  echo 'Usage: bash scripts/e1-h5-remote-history-readonly.sh --read-only' >&2
  exit 2
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo 'E1_H5_CLI_NOT_INSTALLED' >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1; then
  echo 'E1_H5_GIT_UNAVAILABLE' >&2
  exit 2
fi
repo_root="$(git rev-parse --show-toplevel)"
cd -- "${repo_root}"
if [[ ! -f scripts/e1-h5-remote-history-readonly.sh ]]; then
  echo 'E1_H5_WRONG_REPOSITORY' >&2
  exit 2
fi

# CLI v3 honors SUPABASE_WORKDIR independently of Bash cwd. Refuse all
# overrides: the validated migrations, linked ref and CLI workdir must match.
if [[ -n "${SUPABASE_WORKDIR:-}" ]]; then
  echo 'E1_H5_SUPABASE_WORKDIR_OVERRIDE_PROHIBITED' >&2
  exit 2
fi

# Never turn on shell tracing. Do not echo secrets, tokens, DSNs or CLI debug.
# The CLI may use existing login/session in the human operator's environment.
# Explicit --remote=<ref> is mandatory in Supabase CLI v3.
if [[ -n "${SUPABASE_DB_URL:-}" || -n "${DATABASE_URL:-}" || -n "${DIRECT_URL:-}" ]]; then
  echo 'E1_H5_AMBIGUOUS_DATABASE_URL_ENVIRONMENT' >&2
  exit 2
fi
# CLI 3.1.0's migration-list SIDE_EFFECTS.md documents POST
# /v1/projects/{ref}/cli/login-role {read_only:false} without a DB password.
# Requiring a nonempty password in the *operator's private process environment*
# avoids that implicit provider-side role creation path. The script NEVER logs
# the secret or sets it itself. Do NOT rerun for H5 once evidence is captured.
if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo 'E1_H5_DB_PASSWORD_REQUIRED_TO_AVOID_CLI_TEMP_LOGIN_ROLE' >&2
  exit 2
fi
# The v3 CLI can remove remote network bans on failed temp-role connects if
# automatic confirmation is enabled. It is never appropriate at this gate.
if [[ -n "${SUPABASE_YES:-}" ]]; then
  echo 'E1_H5_AUTOMATIC_REMOTE_CONFIRMATION_PROHIBITED' >&2
  exit 2
fi
# CLI v3 can deliberately withhold a shell database password from an ad-hoc
# remote ref different from the worktree's linked project, then mint a role.
# Fail closed rather than relying on a misleading password environment.
# v3 also supports stack-mode links in supabase/.link.json. The operator
# guard below validates only legacy .temp/project-ref; reject stack-mode
# rather than assume its linked identity agrees with the target.
if [[ -e supabase/.link.json ]]; then
  echo 'E1_H5_STACK_MODE_LINK_REQUIRES_SEPARATE_IDENTITY_REVIEW' >&2
  exit 2
fi
linked_ref='supabase/.temp/project-ref'
if [[ -f "${linked_ref}" && "$(tr -d '\r\n' < "${linked_ref}")" != "${E1_PROJECT_REF}" ]]; then
  echo 'E1_H5_LINKED_PROJECT_REF_MISMATCH__PASSWORD_COULD_BE_WITHHELD' >&2
  exit 2
fi
if [[ -n "${SUPABASE_PROJECT_ID:-}" && "${SUPABASE_PROJECT_ID}" != "${E1_PROJECT_REF}" ]]; then
  echo 'E1_H5_AMBIGUOUS_PROJECT_REF_ENVIRONMENT' >&2
  exit 2
fi
if [[ "$(supabase --version)" != '3.1.0' ]]; then
  echo 'E1_H5_EXACT_CLI_3_1_0_REQUIRED' >&2
  exit 2
fi
if ! supabase migration list --help | grep -q -- '--remote'; then
  echo 'E1_H5_REMOTE_TARGET_FLAG_NOT_VERIFIED' >&2
  exit 2
fi

foundation="supabase/migrations/${E1_FOUNDATION_VERSION}_enable_pgvector_create_private_rag_schema.sql"
catalog="supabase/migrations/${E1_CATALOG_VERSION}_rag_catalog.sql"
original='db/migrations/0001_rag_catalog.up.sql'
for file in "${foundation}" "${catalog}" "${original}"; do
  if [[ ! -s "${file}" ]]; then
    echo 'E1_H5_EXPECTED_MIGRATION_MISSING' >&2
    exit 2
  fi
done
mapfile -t migration_files < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)
if [[ "${#migration_files[@]}" -ne 2 ||
      "${migration_files[0]}" != "${E1_FOUNDATION_VERSION}_enable_pgvector_create_private_rag_schema.sql" ||
      "${migration_files[1]}" != "${E1_CATALOG_VERSION}_rag_catalog.sql" ]]; then
  echo 'E1_H5_UNEXPECTED_LOCAL_MIGRATION_VERSION' >&2
  exit 2
fi
foundation_sha="$(sha256sum "${foundation}")"
foundation_sha="${foundation_sha%% *}"
catalog_sha="$(sha256sum "${catalog}")"
catalog_sha="${catalog_sha%% *}"
if [[ "${foundation_sha}" != "${E1_FOUNDATION_SHA256}" ||
      "${catalog_sha}" != "${E1_CATALOG_SHA256}" ]] ||
   ! cmp -s "${catalog}" "${original}"; then
  echo 'E1_H5_LOCAL_MIGRATION_SQL_DRIFT' >&2
  exit 2
fi

printf '%s\n'   'E1_H5_READONLY_TARGET=lmocjhpajhxegzobydau (mastra-rag, sa-east-1)'   'E1_H5_CLI_VERSION=3.1.0'   'E1_H5_EXPECTED_APPLIED=20261113233720'   'E1_H5_EXPECTED_LOCAL_PENDING=20261117213614'   'E1_H5_RUNNING_REMOTE_MIGRATION_LIST_ONLY'

# Explicit project-ref equality syntax matters in v3: --remote <ref> is WRONG.
# This is the only hosted command executed by this file. Login/database
# authentication must be handled privately and interactively by the owner.
supabase --workdir "${repo_root}" migration list "--remote=${E1_PROJECT_REF}"

# A successful CLI exit code means a listing ran, NOT that either migration
# was applied or that the history reconciled. Human must inspect both columns
# and compare with independently obtained Supabase read-only ledger data.
echo 'E1_H5_CLI_LIST_EXECUTED__HUMAN_COLUMN_COMPARISON_REQUIRED'
echo 'E1_H5_EXPLICIT_MIGRATION_COMMAND_READ_ONLY__PROVIDER_SIDE_EFFECTS_NOT_INDEPENDENTLY_PROVEN'
