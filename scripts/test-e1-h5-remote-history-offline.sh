#!/usr/bin/env bash
set -euo pipefail

# Contract tests for the E1/H5 manual remote-list script. Entirely offline:
# every "supabase" command is intercepted by a deliberately tiny fake binary.
root="$(git rev-parse --show-toplevel)"
cd -- "${root}"
tmp="$(mktemp -d -t e1-h5-cli-test-XXXXXXXX)"
trap 'rm -rf "${tmp}"' EXIT
mkdir -p "${tmp}/repo/scripts" "${tmp}/repo/supabase/migrations" "${tmp}/repo/db/migrations" "${tmp}/bin"
cp scripts/e1-h5-remote-history-readonly.sh "${tmp}/repo/scripts/"
cp scripts/e1-h5-operator-from-env.mjs "${tmp}/repo/scripts/"
cp supabase/migrations/*.sql "${tmp}/repo/supabase/migrations/"
cp db/migrations/0001_rag_catalog.up.sql "${tmp}/repo/db/migrations/"
git -C "${tmp}/repo" init -q

cat > "${tmp}/bin/supabase" <<'FAKECLI'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${E1_FAKE_CALL_LOG:?}"
case "$*" in
  '--version')
    if [[ "${E1_FAKE_MODE:-}" == 'wrong-version' ]]; then
      echo '3.0.0'
    else
      echo '3.1.0'
    fi
    ;;
  'migration list --help')
    if [[ "${E1_FAKE_MODE:-}" == 'missing-remote-help' ]]; then
      echo 'migration list'
    else
      echo 'migration list --remote=<project-ref>'
    fi
    ;;
  "--profile supabase --workdir ${E1_FAKE_EXPECTED_WORKDIR:?} migration list --remote=lmocjhpajhxegzobydau")
    if [[ "${E1_FAKE_DOTENV_ASSERT:-}" == 'yes' ]]; then
      [[ "${SUPABASE_DB_PASSWORD:-}" == 'alpha#beta$gamma spaces' ]] || exit 97
      [[ -z "${E1_H5_ENV_FROM_FILE_SHOULD_NOT_LEAK:-}" ]] || exit 97
    fi
    printf '%s\n' 'Local | Remote | Time (UTC)' \
      '20261113233720 | 20261113233720 | 2026-11-13' \
      '20261117213614 | | 2026-11-17'
    ;;
  *)
    echo 'E1_FAKE_UNEXPECTED_CLI_INVOCATION' >&2
    exit 98
    ;;
esac
FAKECLI
chmod 700 "${tmp}/bin/supabase"
cd "${tmp}/repo"
export PATH="${tmp}/bin:${PATH}"
export E1_FAKE_CALL_LOG="${tmp}/calls"
export E1_FAKE_EXPECTED_WORKDIR="${tmp}/repo"
unset SUPABASE_DB_URL DATABASE_URL DIRECT_URL SUPABASE_YES SUPABASE_PROJECT_ID || true
# Fake local password for fake CLI only. No real credentials in CI.
export SUPABASE_DB_PASSWORD='e1-fake-test-password-no-real-credential'

bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/result"
grep -q '^E1_H5_CLI_LIST_EXECUTED__HUMAN_COLUMN_COMPARISON_REQUIRED$' "${tmp}/result"
grep -q '^E1_H5_EXPLICIT_MIGRATION_COMMAND_READ_ONLY__PROVIDER_SIDE_EFFECTS_NOT_INDEPENDENTLY_PROVEN$' "${tmp}/result"
if [[ "$(grep -c '^--profile supabase --workdir .*/repo migration list --remote=lmocjhpajhxegzobydau$' "${tmp}/calls")" != 1 ||
      "$(wc -l < "${tmp}/calls")" != 3 ]]; then
  echo 'E1_H5_WRONG_CLI_COMMAND_OR_COUNT' >&2; exit 1
fi

: > "${tmp}/calls"
if E1_FAKE_MODE='wrong-version' bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_WRONG_VERSION_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_EXACT_CLI_3_1_0_REQUIRED' "${tmp}/err"
test "$(wc -l < "${tmp}/calls")" -eq 1

: > "${tmp}/calls"
if E1_FAKE_MODE='missing-remote-help' bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_REMOTE_HELP_MISSING_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_REMOTE_TARGET_FLAG_NOT_VERIFIED' "${tmp}/err"
test "$(wc -l < "${tmp}/calls")" -eq 2

: > "${tmp}/calls"
if SUPABASE_DB_URL='postgresql://blocked.invalid/no-connection' bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_AMBIGUOUS_HOST_ENV_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_AMBIGUOUS_DATABASE_URL_ENVIRONMENT' "${tmp}/err"
test ! -s "${tmp}/calls"

# P1: an untrusted CLI workdir must be rejected before invoking the fake CLI.
: > "${tmp}/calls"
if SUPABASE_WORKDIR="${tmp}/foreign-checkout" bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_FOREIGN_WORKDIR_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_SUPABASE_WORKDIR_OVERRIDE_PROHIBITED' "${tmp}/err"
test ! -s "${tmp}/calls"

# R3: foreign SUPABASE_PROFILE must fail closed before any CLI invocation.
mkdir -p "${tmp}/foreign-profile-home"
cat > "${tmp}/foreign-profile.yaml" <<'CUSTOM_PROFILE'
name: adversarial
api_url: https://api.invalid.example
project_host: db.invalid.example
pooler_host: pool.invalid.example
dashboard_url: https://invalid.example
CUSTOM_PROFILE
: > "${tmp}/calls"
if SUPABASE_PROFILE="${tmp}/foreign-profile.yaml" bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_AMBIENT_CUSTOM_PROFILE_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_NON_PRODUCTION_PROFILE_OVERRIDE_PROHIBITED' "${tmp}/err"
test ! -s "${tmp}/calls"

# v3.1.0 resolves explicit --profile before SUPABASE_HOME/profile. The fake
# CLI strictly requires that production-profile selector even when HOME is
# pointing to a persisted foreign YAML profile.
printf '%s\n' "${tmp}/foreign-profile.yaml" > "${tmp}/foreign-profile-home/profile"
: > "${tmp}/calls"
SUPABASE_HOME="${tmp}/foreign-profile-home" bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"
grep -q '^E1_H5_CLI_LIST_EXECUTED__HUMAN_COLUMN_COMPARISON_REQUIRED$' "${tmp}/out"
test "$(grep -c '^--profile supabase --workdir .*/repo migration list --remote=lmocjhpajhxegzobydau$' "${tmp}/calls")" -eq 1

# An ambient value equal to the builtin production profile is permitted.
: > "${tmp}/calls"
SUPABASE_PROFILE=supabase bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"
test "$(grep -c '^--profile supabase --workdir .*/repo migration list --remote=lmocjhpajhxegzobydau$' "${tmp}/calls")" -eq 1

# Unreviewed CLI v3 stack-mode links need a separate project-identity decision.
printf '{"project":{"ref":"unreviewed"}}\n' > supabase/.link.json
: > "${tmp}/calls"
if bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_STACK_LINK_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_STACK_MODE_LINK_REQUIRES_SEPARATE_IDENTITY_REVIEW' "${tmp}/err"
test ! -s "${tmp}/calls"
rm -f supabase/.link.json

# Node native dotenv parser, synthetic password containing #, dollar and spaces.
# Never evaluate the file as Bash; no other .env variable may enter the child.
cat > .env <<'FAKE_ENV'
SUPABASE_DB_PASSWORD='alpha#beta$gamma spaces'
E1_H5_ENV_FROM_FILE_SHOULD_NOT_LEAK=do-not-forward
E1_H5_UNTRUSTED_TEXT=$(touch DO_NOT_CREATE_THIS_FILE)
FAKE_ENV
chmod 600 .env
: > "${tmp}/calls"
E1_FAKE_DOTENV_ASSERT=yes env -u SUPABASE_DB_PASSWORD node scripts/e1-h5-operator-from-env.mjs --read-only > "${tmp}/out" 2> "${tmp}/err"
grep -q '^E1_H5_CLI_LIST_EXECUTED__HUMAN_COLUMN_COMPARISON_REQUIRED$' "${tmp}/out"
test ! -e DO_NOT_CREATE_THIS_FILE
test "$(grep -c '^--profile supabase --workdir .*/repo migration list --remote=lmocjhpajhxegzobydau$' "${tmp}/calls")" -eq 1

: > "${tmp}/calls"
if SUPABASE_DB_PASSWORD='other-synthetic-password' node scripts/e1-h5-operator-from-env.mjs --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_CONFLICTING_PASSWORD_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_DB_PASSWORD_ENV_FILE_CONFLICT' "${tmp}/err"
test ! -s "${tmp}/calls"

chmod 644 .env
: > "${tmp}/calls"
if env -u SUPABASE_DB_PASSWORD node scripts/e1-h5-operator-from-env.mjs --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_INSECURE_DOTENV_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_DOTENV_FILE_PERMISSIONS_UNSAFE__CHMOD_600' "${tmp}/err"
test ! -s "${tmp}/calls"
chmod 600 .env

git add -f .env
: > "${tmp}/calls"
if env -u SUPABASE_DB_PASSWORD node scripts/e1-h5-operator-from-env.mjs --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_TRACKED_DOTENV_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_DOTENV_MUST_NOT_BE_TRACKED' "${tmp}/err"
test ! -s "${tmp}/calls"
git rm -q --cached .env
rm -f .env

# Passwordless CLI 3.1.0 may POST /cli/login-role (read_only:false).
: > "${tmp}/calls"
if env -u SUPABASE_DB_PASSWORD bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_PASSWORDLESS_TEMP_ROLE_PATH_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_DB_PASSWORD_REQUIRED_TO_AVOID_CLI_TEMP_LOGIN_ROLE' "${tmp}/err"
test ! -s "${tmp}/calls"

: > "${tmp}/calls"
if SUPABASE_YES='true' bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_AUTO_CONFIRMATION_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_AUTOMATIC_REMOTE_CONFIRMATION_PROHIBITED' "${tmp}/err"
test ! -s "${tmp}/calls"

mkdir -p supabase/.temp
printf '%s' 'another-project-ref' > supabase/.temp/project-ref
: > "${tmp}/calls"
if bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_LINKED_PROJECT_PASSWORD_WITHHOLDING_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_LINKED_PROJECT_REF_MISMATCH__PASSWORD_COULD_BE_WITHHELD' "${tmp}/err"
test ! -s "${tmp}/calls"
rm -f supabase/.temp/project-ref

: > "${tmp}/calls"
if SUPABASE_PROJECT_ID='wrong-ref' bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_ENV_PROJECT_MISMATCH_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_AMBIGUOUS_PROJECT_REF_ENVIRONMENT' "${tmp}/err"
test ! -s "${tmp}/calls"

: > "${tmp}/calls"
printf '\n' >> 'supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql'
if bash scripts/e1-h5-remote-history-readonly.sh --read-only > "${tmp}/out" 2> "${tmp}/err"; then
  echo 'E1_H5_FOUNDATION_DRIFT_ADMITTED' >&2; exit 1
fi
grep -q 'E1_H5_LOCAL_MIGRATION_SQL_DRIFT' "${tmp}/err"
test "$(wc -l < "${tmp}/calls")" -eq 2

printf '%s\n' 'E1_H5_READONLY_CLI_OFFLINE_CONTRACT_PASS'
