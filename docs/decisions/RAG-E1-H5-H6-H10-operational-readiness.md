# RAG-E1 — H5/H6/H10 operational readiness checkpoint

**2026-11-17.** Baseline: `master` @ `4547f6abe15a414b65a09d710888d8bbaa2f86a6` (PR #12 merged; post-merge CI SUCCESS). **State:** `H5_H6_H10_PREPARATION / LOCAL_RESTORE_DRILL_PENDING / HOSTED_PERSISTENCE_BLOCKED`.

This is an implementation-independent **readiness proposal**, not authority to run DDL, provision `rag_app` on hosted Supabase, export a real database, purchase services, rotate credentials or ingest any content. The owner approved preparing the operational H5/H6/H10 evidence and an **isolated** backup/restore proof; execution on the hosted database still requires explicit, separately scoped owner approval. See [owner architectural ratification](../decisions/RAG-E1-owner-ratification.md) and [Step E1 local baseline](../rag/step-e1-local.md).

## 1. Current read-only evidence (SB-H5-01; 2026-11-17)

| Control | Verified value | Boundary |
| --- | --- | --- |
| Project | Supabase `mastra-rag`, `lmocjhpajhxegzobydau`, Alquem.io | Hosted, `sa-east-1`, status ACTIVE_HEALTHY |
| Subscription | Free | No included automatic daily backups or PITR |
| PostgreSQL | 17.11, pgvector 0.8.2 | Local CI `pgvector/pgvector:pg17` may have different minor version |
| Existing migration history | **Only** `20261113233720_enable_pgvector_create_private_rag_schema` | This entry must remain applied and immutable |
| `rag` schema | Exists, **0 tables** | Catalog E1 not applied |
| Role `rag_app` | **Absent** | Local fixture role is not a hosted role |
| Private schema protection | `anon`, `authenticated`, `service_role` currently have **no USAGE** on `rag` | Do not change public Data API exposure |
| DB size | 11,228,851 bytes (~10.7 MiB) | Not a corpus or vector sizing measurement |
| Security advisors | Two WARNs: `public.rls_auto_enable()` SECURITY DEFINER visible as executable by `anon` and `authenticated` | Event-trigger function; actual RPC exploitability **not demonstrated**; requires a separate least-privilege adjudication, no changes authorized |

The [Supabase Free pricing](https://supabase.com/pricing) lists 500 MB database quota. [Backup docs](https://supabase.com/docs/guides/platform/backups) recommend logical off-site exports on Free. The [November 2026 CLI v3 breaking change](https://supabase.com/changelog/supabase-cli-v3) changes local/remote defaults; **do not assume a CLI command targets hosted without explicit target flags and version checks**.

## 2. H5 — Single migration historian and applier (proposed)

**Proposed decision for owner adjudication:** preserve Supabase's existing migration ledger as the **sole authoritative hosted migration history**, with the owner as **sole remote applier**. The repository's `db/migrations/0001_rag_catalog.up.sql` / `.down.sql` remains the reviewed SQL source but is **not yet** a Supabase CLI migration version. Before execution, a future operator PR must reconcile SQL duplication/identity and freeze a new CLI-generated timestamp migration file using the pinned CLI, or obtain a human decision for a different single-ledger mechanism. **Never run unrecorded manual SQL and separately pretend the migration was applied through Supabase's ledger.**

Adjudication/verification contract:

1. Read `supabase_migrations.schema_migrations` and the namespace/extension ownership through **read-only** approved access, compare with `list_migrations`, and record a SHA-256 manifest of the intended reviewed SQL. Confirm exactly the 20261113233720 foundation migration before E1.
2. Select and **pin** a specific Supabase CLI version. Validate `supabase --version`, `supabase migration new --help`, `supabase migration list --help`, and `supabase db dump --help`. Prefer explicit remote-target flags and interactive target confirmation; do not infer v2 semantics in v3.
3. Using the CLI, generate the **new filename** (do not invent timestamps). Compare the finalized migration content with `db/migrations/0001_rag_catalog.up.sql` and record how the checked-in SQL remains the canonical source without undocumented drift. Capture a preflight diff and an owner-approved, external logical backup first.
4. Stage role/provisioning boundaries separately: foundational `rag`/vector extension already exists; E1 tables depend on an operator-provisioned `rag_app`. Catalog SQL requires the role to exist before its `CREATE POLICY` and `GRANT` statements. Privileged role setup, catalog migration, and PgVector `flat` provisioning need **distinct execution approvals**.
5. For execution, verify project reference, hostname/port/database, `rag` schema, migration SQL SHA and backup/restore manifest **before** application. Take an immutable preflight evidence snapshot. A failed check is a hard stop.
6. On approved application, re-read hosted ledger and verify catalog constraints/FKs, RLS, permissions, PgVector table, `disableInit:true`, and security advisories. Never mark success from a successful SQL exit code alone. Rollback is owner-only and backup-aware, never automatic `down` against hosted.

**H5 status:** `REMOTE_HISTORY_RECONCILED_READ_ONLY / OPERATOR_APPLIER_AND_MIGRATION_FORMAT_PENDING_RATIFICATION`.

## 3. H6 — Least-privilege role readiness (proposed, no hosted writes)

The [local role fixture](../../db/local/0000_e1_disposable_setup.sql) has no password and is **not** a credential management procedure. The [E1 catalog SQL](../../db/migrations/0001_rag_catalog.up.sql) assumes `rag_app` exists. The [local SQL proof](../../db/local/0003_e1_positive_proofs.sql) and [PgVector policies](../../db/local/0002_e1_space_role_policies.sql) cover a single public namespace and require no hosted access.

**Production provisioning sequence (design only):**

- Operator creates `rag_app` through an interactive, approved secured PostgreSQL session, with LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION and **without ownership/CREATE on schema**. The password is set/rotated interactively or through an approved secrets manager; never put it in SQL, shell history, PRs, CI logs or this document.
- Verify `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, and no ownership/inheritance privilege escalation. Verify `anon` and `authenticated` lack schema USAGE and the schema is not enabled for Data API exposure.
- Apply reviewed catalog DDL, then operator-owned `flat` space provisioning and explicit RLS/GRANT policies. Space-definition rows are **read-only** to `rag_app`; PgVector requires SELECT, INSERT and UPDATE with corresponding policies for `ON CONFLICT DO UPDATE`.
- Test `rag_app` positive reads/writes in `public` namespace and expected denial of DDL, space-status mutation, foreign namespace writes, and anonymous reads; if remote tests would mutate data, require another approval and reversible synthetic fixtures.
- Only after verified role readiness, arrange server-only DSN through a separately approved secure rotation. Do not expose it to the browser/agent Studio, and never enable implicit `@mastra/pg` initialization.
- Review existing `public.rls_auto_enable()` SECURITY DEFINER event-trigger advisors **without changing it in this checkpoint**; any privilege change requires independent security review and explicit authorization.

**H6 status:** `LOCAL_ROLE_RLS_PROOFS_PASS / HOSTED_ROLE_AND_CREDENTIALS_NOT_AUTHORIZED`.

## 4. H10 — Capacity guardrails and recovery design (proposed limits)

### Capacity

Free lists a **500 MB** database quota; this is a plan quota, not the suggested operational working limit. Current DB is ~10.7 MiB with **zero RAG tables**. For `text-embedding-3-small` d=1536, raw float32 values are **6144 bytes/vector**, excluding row/TOAST/index/catalog/WAL overhead. These are estimates, not real corpus measurements.

| Control | Proposed conservative MVP ceiling; not ratified or enforced |
| --- | --- |
| Unique active-space rendered vector rows | 2,000 |
| Concurrent rebuild/retiring spaces | 1 additional space only, with H12 retention/GC separately ratified |
| Combined `rag` schema footprint | 100 MiB, measured by `pg_total_relation_size` for catalog+space tables |
| Whole database warning | 250 MiB |
| Whole database hard stop for new ingestion | 300 MiB |
| Storage budget / ownership | Owner-approved limit must be selected; E2 admission and periodic checks must enforce it; no automatic increased spend |

For 2,000 vectors, numeric payload alone is ~12.3 MB (~11.7 MiB); a second complete space doubles that lower bound. Actual size includes catalog text, metadata, indexes, retired versions, future GC, WAL and platform overhead. **H12 retention policy is still pending**, so bounded growth cannot yet be claimed. Any observed 100 MiB rag or 300 MiB global usage requires freezing ingestion and owner review; those thresholds require human ratification before implementing enforcement.

Read-only measurement examples for an approved operator:
```sql
SELECT pg_database_size(current_database()) AS db_bytes;
SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) AS rag_relation_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='rag' AND c.relkind IN ('r','m','p');
```

### Recovery

**Proposed (not approved RPO/RTO):** daily external logical exports; 7 separately restorable daily generations; example RPO **24 hours** and target RTO **4 hours**, only if repeated measured drills prove feasibility. No automated backup, external destination, storage credentials, retention or alerting is currently configured. An RTO is **not established** by a paper procedure.

- Use documented, **version-verified** Supabase CLI export of **roles**, **schema** and **data** (with Supabase filtering), rather than raw full-cluster `pg_dump` against hosted Supabase. Read CLI v3 `db dump --help` first and use explicit source-target syntax. Operator approval and a secure hosted connection are prerequisites.
- Retain a signed/checksummed manifest (project ref, timestamp, CLI/Postgres version, tool flags, source migration ledger SHA, row counts, masked schema summary, archive SHA-256 and expiry). Never store URI/credentials in manifests/logs.
- Encrypt *before* off-site transfer using an approved, audited encryption mechanism and keys maintained outside the backup destination. Restrict backup/restore access, set expiration policy, and test decryptability without logging raw data. Avoid commit, artifact upload, issue attachment or chat of any real backup.
- In an **isolated** restore environment, preinstall compatible extensions and necessary roles, restore in correct dependency order, verify migrations, metadata, table counts, RLS/grants and application read-only readiness. Supabase-managed internals need Supabase-compatible restore procedures; the local synthetic test below validates **only the private `rag` schema**, not those internals.
- Schedule a fail-closed job with monitoring, alert if age exceeds 24 hours or checksum/backup fails, and conduct restoration drills periodically (proposed monthly) and on schema change. Document measured recovery elapsed time, data-loss window and owner acceptance.
- On Free, a backup that only exists within the project or has never been successfully restored **does not satisfy H10**. Paid backup/PITR would be a separate spending decision if these requirements cannot be met.

Documentation: [Supabase database backups](https://supabase.com/docs/guides/platform/backups), [Supabase backup/restore using CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Supabase CLI v3 changes](https://supabase.com/changelog/supabase-cli-v3).

## 5. Isolated synthetic restore drill

The CI job `e1-local-postgres` now runs `scripts/test-e1-local.sh` **followed by** `scripts/test-e1-restore-local.sh` against the same verified disposable `pgvector/pgvector:pg17` service. Its only input is **synthetic test fixtures**, and its logical dump is deleted on exit. No hosted connections, remote dumps, external transfer or cloud credentials exist in this test.

The script creates a **different database** `rag_e1_restore` in the disposable service, exports the original private `rag` schema and ACLs using local `pg_dump`, atomically restores with local `pg_restore`, and compares full-row count+digest across all **10** app-owned catalog/vector tables. It rechecks pgvector presence, schema/RLS policies and least-privilege grants, and proves `rag_app` RLS is active after recovery.

**Evidence to capture:** CI exact commit, source/restore DB separation, table count+hash matches, restored RLS and grants, execution status `E1_SYNTHETIC_LOGICAL_BACKUP_ISOLATED_RESTORE_PASS`. This demonstrates recoverability of **synthetic E1 catalog+space fixtures only**. It is **not** a production Supabase export, encrypted off-site backup, recovery automation, full Supabase restore, accepted RPO or measured RTO.

## 6. Remaining human gates

- [ ] Independent Codex review and exact-HEAD CI of the H5/H6/H10 preparation PR, including local restore drill and regressions.
- [ ] Owner decides single migration applier/historian, CLI version/format and reviewed new migration identity.
- [ ] Owner adjudicates `rag_app` operator-role procedure, explicit security advisor risk and eventual secrets/DSN rotation.
- [ ] Owner approves actual corpus/storage ceiling and formal H10 RPO/RTO policy.
- [ ] Operator selects and configures encrypted external backup destination/key/retention, under separate authorization.
- [ ] Operator obtains **separate** authorization to export the real hosted database and proves a complete isolated restore, with evidence and access controls.
- [ ] Owner separately authorizes any hosted DDL, role provisioning, space creation, credential changes, backup service or real ingestion.

**Checkpoint state:** `RAG-E1 / H5_H6_H10_PREPARATION_OPEN / HOSTED_OPERATIONS_BLOCKED`.
