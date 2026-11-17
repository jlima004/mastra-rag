# E1 — Hosted-execution readiness and independent human gates

**Recorded:** 2026-11-17. **Baseline:** `master` `737b13d9a0de0ff0c27d93a7422f9ed03291a931` (PR #17 merged, post-merge CI #44190064813 SUCCESS, Mastra Cloud deployment owner-confirmed).  
**Status:** `HOSTED_READONLY_PREFLIGHT_MATCH / REMOTE_CLI_LEDGER_UNVERIFIED / H6_SECURITY_NOT_ADJUDICATED / H10_ORG_DISK_UNKNOWN / NO_HOSTED_WRITES`.  
**Authority:** [owner H5/H6/H10 ratification](../decisions/RAG-E1-H5-H6-H10-owner-ratification.md), [local operator package](e1-operator-package.md), [H10 NO_BACKUP_MVP](../decisions/RAG-H10-mvp-no-backup.md).

## Scope and hard boundary

**This PR is a preparation and evidence package.** It has no Supabase migration push, role creation, credential change, vector provisioning, remote runtime configuration, real ingestion, backup or paid provider call. Neither this PR's merge nor a passing CI grants permission to perform any of these. Each future hosted operation has its **own** human execution gate. The private project reference is `lmocjhpajhxegzobydau` in `sa-east-1`; target database `postgres` and PostgreSQL 17.

**Completed in this checkpoint (READ-ONLY):** Supabase MCP project/organization/ledger/advisors and three metadata SELECTs, plus an exact read-only execution of [db/readonly/e1_hosted_baseline_preflight.sql](../../db/readonly/e1_hosted_baseline_preflight.sql) against that target. Pure [validator](../../scripts/e1-hosted-preflight.ts) and unit regressions exercise the observed shape without introducing any production client or remote write capability.

**No automatic preflight-to-apply path:** a passing read-only baseline permits only an owner to *consider* the separate privilege and migration procedures. A job must never call `db push`, `migration repair`, `CREATE ROLE`, `REVOKE` or another write based on that output.

## H5 — actual remote state and migration-historian readiness

| Control | Read-only evidence 2026-11-17 | Consequence |
| --- | --- | --- |
| Project | `mastra-rag`, ref `lmocjhpajhxegzobydau`, healthy | Exact remote target must be re-confirmed in owner's authenticated CLI session |
| Foundation history | Exactly `20261113233720_enable_pgvector_create_private_rag_schema` | The existing foundation must **never** be replayed |
| Foundation `statements[1]` SHA-256 | `9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13` | Matches committed local mirrored 183-byte SQL |
| Proposed catalog migration | `20261117213614_rag_catalog.sql` **not present** in hosted history | Candidate only; local SQL hash `19a6cc2b841e5670db4da7aad11f8c2fa8a886bd1f4dae5d65c72cc4dbe3d070` |
| Supabase CLI | v**3.1.0** pinned and validated locally in PR #17 CI | Authenticated **remote** CLI historian comparison and dry-run **not executed** |

**CLI-v3 remote step, to be run only after independent human authorization for read-only CLI use:** in a secure owner's local environment, confirm `supabase --version` = `3.1.0`, inspect `supabase migration list --help` and `supabase db push --help` at that exact installation, link/target identity explicitly, then list the remote migration history (read-only). Avoid printing access tokens, database URLs or passwords in terminal recordings or PR comments. If the CLI cannot reconcile `20261113233720` without adding/replaying/repairing records, **STOP** and adjudicate independently; **do not** attempt to force success with `migration repair`.

The local packaged SQL and the remote ledger SHA are matched via separate paths (CLI offline versus Supabase SQL read-only), but **this is not a CLI-authenticated remote rehearsal**. Subsequent candidate `db push --dry-run` also needs verification that the installed v3 command's specific target/dry-run flags do not invoke writes or modify migration history. **No `db push` from CI or this PR.**

**Proposed operator sequencing, not execution authorization:** G-H6-role → G-H5-catalog → G-H6-vector → G-runtime-DSN → G-E2-ingest. Create/verify minimal `rag_app` and `extensions` USAGE before applying catalog migration referencing that role. Apply catalog only through approved sole migration ledger. Provision the `flat` space separately as privileged owner, then explicit RLS/grants. `rag_app` must never become the owner or DDL applier. Never apply destructive `down` for recovery; **no backup in MVP**.

## H6 — minimal runtime role + existing two WARNs

**Read-only baseline:** `rag_app` does **not** exist; `rag` contains zero tables and remains private (`anon`, `authenticated`, `service_role` lack `USAGE`). pgvector v0.8.2 is installed in `extensions`. PostgreSQL local fixture proves the non-BYPASSRLS/no-DDL and namespace/upsert contract (PR #17). This is **not** a hosted privilege proof.

**Future role provisioning (owner-only interactive protocol, not executable SQL in this PR):**

1. Verify project ref, PostgreSQL version/identity and ledger in a private operator session. Require a TLS-verified administrative connection and explicit human approval for **role creation** before touching anything.
2. A privileged operator creates only the reviewed `rag_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` principal without embedding a password in command-line/CI/SQL files/history. Assign a strong runtime password inside an **interactive** psql session with `\password rag_app`; ensure no secret appears in logs, PR or chat.
3. After separate approval, grant only schema `extensions` **USAGE**, no CREATE, then separately apply the catalog SQL that defines private `rag` USAGE, appropriate DML and RLS. Separately provision the vector space with explicit `SELECT/INSERT/UPDATE` privileges and namespace-scoped policies for `ON CONFLICT DO UPDATE`.
4. Verify actual remote role attributes, memberships, ownership, grants, catalog RLS, `anon`/`authenticated` denial, event trigger effects, and *runtime* TLS connectivity in a distinct authorized postflight. Keep runtime DSN server-side in Mastra Cloud; no privileged `postgres` or `service_role` runtime.
5. On any mismatch **STOP**. Do not attempt fallback to owner/superuser credentials.

**Security WARN evidence:** the hosted `public.rls_auto_enable()` is `postgres`-owned `SECURITY DEFINER`, `RETURNS event_trigger`, `search_path=pg_catalog`; `anon` and `authenticated` both have EXECUTE and event trigger `ensure_rls` is active on `ddl_command_end`. Two WARNs remain at the latest advisor reading:
- [0028: anon SECURITY DEFINER executable](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [0029: authenticated SECURITY DEFINER executable](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

The PR #17 **isolated PostgreSQL 17** regression showed `REVOKE EXECUTE` from `PUBLIC, anon, authenticated` did not disable the `CREATE TABLE` event-trigger RLS behavior *in that fixture*. PostgreSQL direct `SELECT public.rls_auto_enable()` failed with event-trigger-only semantics. **No PostgREST HTTP RPC reproduction was performed; the database linter's assertion of potential RPC exposure is not independently proven or disproven by that SQL fixture.** Do not run production RPC probes. **H6-D2 is an investigation ratification, not privilege-revocation approval or residual-risk acceptance.** Future independent security owner must choose a separate reviewed REVOKE or formally accept risk; fresh advisor and RLS postflight mandatory.

## H10 — measurements, telemetry gap and fail-closed boundary

**Observed through hosted read-only SQL:** `pg_database_size('postgres')=11,228,851` bytes, `rag_relation_bytes=0`, `rag_table_count=0`, no vectors in deployed catalog. This is **only the current project/database**, not the Free organization quota and not physical disk/WAL.

**Plan:** `Alquem.io` is Free with three projects: `mastra-rag` ACTIVE_HEALTHY; `indicioCult` and `indicio-cult-nuv16-assay` are **INACTIVE**. The active project contributes ≈ 11.2 MB decimal; contribution of either inactive project to the organization-wide database quota is **UNKNOWN**. **Do not restore/wake or bill paused projects to learn their size without explicit separate authorization.** Read the actual **organization-wide billable database usage** from an authorized Supabase usage/billing surface before E2; document value, timestamp, unit and treatment of paused projects. If unavailable: **H10_ORG_USAGE_UNKNOWN / BULK_INGEST_BLOCKED**.

**Disk/WAL:** `pg_database_size` cannot prove disk filesystem occupancy, WAL volume or remaining physical headroom. Need authorized provider telemetry for disk used/total and independent WAL measurement/indicator; capture source, timestamp and freshness. If unavailable or critical: **H10_PHYSICAL_DISK_UNKNOWN / BULK_INGEST_BLOCKED**. No filesystem/server-file SQL or admin shell exploration will be attempted in this package.

Ratified **MVP limits** (see [owner decision](../decisions/RAG-E1-H5-H6-H10-owner-ratification.md)):

| Metric | Warning | Hard stop |
| --- | --- | --- |
| Active vectors | — | **2,000** |
| Concurrent additional rebuild space | — | **1** |
| `rag` relations | **80 MiB** | **100 MiB** |
| Project DB | **250 MiB** | **300 MiB** |
| Organization aggregate Free database size | **350 MB** | **400 MB** |

A **95% physical disk occupancy** rejection remains a conservative candidate guard in pure code, **not an independently ratified numeric SLO**. [Pure H10 policy](../../scripts/e1-capacity-policy.ts) and [read-only project meter](../../db/readonly/e1_h10_project_measurements.sql) do **not** enforce admission on real jobs; E2 must add freshness, org/disk sources, projected row/growth checks, transactional reservation/concurrency, rebuild-space accounting and fail-closed behavior **before** any real ingest. H7 operator-only access, H11 provider cap and H12 retention/GC also remain open.

**No-backup binding decision:** H10 `NO_BACKUP_MVP` remains in force. No pre-migration dump, hosted PITR, backup, off-site export, RPO/RTO or real restore is added as a requirement or performed here. The risk of permanent loss of unpublished and historical catalog/space state remains.

## Evidence-validator and runbook stop/go

The SQL file `db/readonly/e1_hosted_baseline_preflight.sql` emits one JSON string of project/ledger/role/RLS/security facts. [Pure validator](../../scripts/e1-hosted-preflight.ts) checks the exact expected **pre-E1 hosted baseline**, schema isolation, foundation SHA, migration versions, pgvector, and two known WARN characteristics. Its `remoteWritesAuthorized` is literally `false`, regardless of consistent evidence. CI uses synthetic inputs only; there is no Supabase client, key or database DSN.

**Note:** The baseline validator is intentionally a *before-first-write* instrument. After an independently approved hosted role/migration operation, its expected `rag_app_exists=false` and `rag_table_count=0` must no longer be reused for postflight; create an independent operation-scoped validator at that later gate.

| Gate | Evidence / required human action | Current state |
| --- | --- | --- |
| G0: present preparatory PR | Read-only hosted preflight + unit CI + independent Codex review | **IN PROGRESS** |
| G1: H5 remote CLI historian | Proven CLI v3.1.0 target and remote list read-only, history diff, no repair | **PENDING; separate authorization** |
| G2: H6 security disposition | Isolated PostgREST-equivalent assessment, later REVOKE or risk acceptance | **PENDING; separate security decision** |
| G3: H10 capacity telemetry | Verified organization aggregate incl. inactive projects and physical disk/WAL | **UNKNOWN → ingestion blocked** |
| G4: operator role package | Private interactive `rag_app` privilege procedure, exact SQL, independent CI/impact | **PENDING; separate human execution authorization** |
| G5: catalog migration / flat space | Operator approval of exact `20261117213614` SQL/version, catalog and vector space as separate operations | **PENDING; separate human authorizations** |
| G6: DSN + E2 | H7/H11/H12 decisions, spend, auth, H10 transactional admission | **PENDING; no live ingestion** |

**Non-goal:** This package does **not** assert a remote `supabase migration list` or dry-run occurred. Project-targeted metadata through Supabase MCP is **not** proof that Supabase CLI v3.1.0 has authenticated, linked and compared the remote migrations.

**End-state:** `E1_HOSTED_READINESS_PREPARED / H5_REMOTE_CLI_NOT_EXECUTED / H6_SECURITY_PENDING / H10_ORG_DISK_UNKNOWN / NO_HOSTED_WRITES`.
