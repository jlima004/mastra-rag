# E1 — H5 authenticated Supabase CLI remote-history gate (read-only)

| Property | State |
| --- | --- |
| Requested by owner | 2026-11-17: authorization to advance **only the read-only H5 migration-list gate** |
| Source baseline | `master` @ `20a1fb7c2487665c4d9749094d4fadd4ddba6b7a` (PR #18 merged; post-merge CI/deployment owner-confirmed) |
| Target | `mastra-rag` / `lmocjhpajhxegzobydau`, `sa-east-1`, PostgreSQL 17 |
| CLI | **Exactly 3.1.0**, pinned in previous E1 CI; operator binary/session not available inside the connected agent tools |
| Read-only MCP status | `MCP_REMOTE_LEDGER_MATCH`: foundation version `20261113233720` only |
| Required proof | `CLI_REMOTE_MIGRATION_LIST` executed through owner's own authenticated CLI v3.1.0 session, with human comparison of both columns |
| Present gate status | **`CLI_REMOTE_HISTORY_PENDING`** until that independent CLI output is reviewed |
| Prohibitions | `db push`, `db reset`, `migration up`, `migration repair`, `migration fetch`, `link`, privilege/role writes, backups, secrets, vector creation, paid calls, ingest |

This is the independent *historian read-only* checkpoint after [PR #18 Hosted Execution Readiness](e1-hosted-execution-readiness.md). It is **not** the later permission to run a catalog migration or provision `rag_app`.

## 1. Known remote state — authenticated MCP, NOT CLI

Revalidated using the connected Supabase project-specific read-only migration list after PR #18 merge:

| Version | Name | MCP observation | Local file |
| --- | --- | --- | --- |
| `20261113233720` | `enable_pgvector_create_private_rag_schema` | **Applied** | `supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql` |
| `20261117213614` | `rag_catalog` | **Not present remotely** | `supabase/migrations/20261117213614_rag_catalog.sql` |

Foundation SQL SHA-256 was previously verified via a read-only query of `supabase_migrations.schema_migrations.statements[1]`: `9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13`. Candidate catalog SQL SHA-256: `19a6cc2b841e5670db4da7aad11f8c2fa8a886bd1f4dae5d65c72cc4dbe3d070`, bytewise identical to `db/migrations/0001_rag_catalog.up.sql` in the prior local operator CI.

**IMPORTANT:** the MCP OAuth session is **not the user's authenticated Supabase CLI session**. The GitHub Action runs the CLI only **offline**, with no remotely provisioned tokens. Neither is proof that `supabase migration list --remote=lmocjhpajhxegzobydau` has executed.

## 2. Human operator command — narrow, explicitly read-only

The owner must execute this with the CLI 3.1.0 installed and authenticated in a **private terminal** within a current checkout of this branch:

```bash
supabase --version
bash scripts/e1-h5-remote-history-readonly.sh --read-only
```

The script, not CI, calls precisely:

```bash
supabase migration list --remote=lmocjhpajhxegzobydau
```

This explicit target syntax was checked against [Supabase CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3). It requires `--remote=<ref>` with `=`; a bare `--remote` could select a linked project and omitting `--remote` could query local state.

The script validates the local repo's **exact two migration filenames** and both SHA-256s, confirms `supabase --version` is precisely **3.1.0**, verifies `migration list --help` advertises `--remote`, then runs only the migration-list command. It does **not** source `.env`, set tokens, log a password, capture a DSN, create a link, invoke `--debug`, push, repair or write a remote migration. It refuses ambiguous `SUPABASE_DB_URL`, `DATABASE_URL` or `DIRECT_URL` environment overrides.

Authentication must occur in the owner's existing CLI session, or through the CLI's official **interactive** login flow in the private terminal. **Never paste Supabase access tokens, passwords, DSNs, terminal debugging output or GitHub secret values into the PR or chat.** If authentication fails or requests unfamiliar privileges, STOP; do not work around by adding a privileged token to CI.

### Required manual interpretation of output

**Expected two rows (column order from the real CLI output):**

1. `20261113233720`: Local **present**, Remote **present**.
2. `20261117213614`: Local **present**, Remote **absent**.

No extra local or remote migration versions. A successful exit status from `migration list` does **NOT** prove this comparison automatically. The script prints `E1_H5_CLI_LIST_EXECUTED__HUMAN_COLUMN_COMPARISON_REQUIRED`, intentionally not `PASS`.

**STOP conditions:** wrong version, wrong target/project, any extra/absent version, a mismatch in the applied/pending columns, SQL/hash drift, unexpected CLI prompt requesting schema updates/repair, or refusal to authenticate. Never run `migration repair` or try `db push` to resolve mismatched versions.

Once the owner has reviewed the output, they can report only the **migration-version table with Local/Remote columns** (redact all other session/connection metadata). The resulting evidence is separately reconciled with the existing Supabase MCP read-only state. Only then can this gate be marked `CLI_REMOTE_HISTORY_VERIFIED`.

## 3. Test and review evidence

- [`scripts/e1-h5-remote-history-readonly.sh`](../../scripts/e1-h5-remote-history-readonly.sh): exact-target CLI operation, no remote mutation commands.
- [`scripts/test-e1-h5-remote-history-offline.sh`](../../scripts/test-e1-h5-remote-history-offline.sh): creates a disposable Git worktree-like temporary repo with synthetic fake CLI, verifies one exact `migration list --remote=...` call; fails on wrong CLI pin, missing remote flag, ambiguous URL env and foundation drift. **Never uses real CLI auth or connects remotely**.
- CI job `e1-operator-cli`: runs existing offline CLI 3.1.0 check and the new mock-CLI safety test.
- Independent Codex review on exact candidate HEAD and human merge permission remain separate gates.

## 4. Authority and next gate

The owner authorized **this read-only H5 reconciliation**, not any write. H6 security disposition (including `rls_auto_enable()`), `rag_app` role, catalog migration, vector `flat` provisioning, runtime DSN, H10 organization-wide capacity/disk/WAL, H7/H11/H12 and paid E2 ingestion all remain separate pending gates.

**NO_BACKUP_MVP** is unchanged. No remote database backup, PITR, real restore or RPO/RTO is introduced.

**State:** `E1_H5 / MCP_LEDGER_MATCH / CLI_3_1_0_OFFLINE_PROVEN / CLI_AUTH_REMOTE_LIST_PENDING / REMOTE_WRITES_BLOCKED`.
