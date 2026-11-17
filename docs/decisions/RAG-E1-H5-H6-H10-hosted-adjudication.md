# RAG-E1 — H5/H6/H10 hosted operational adjudication (proposal)

> **Subsequent owner ratification (2026-11-17):** The six recommended H5-D1/D2, H6-D1/D2, H10-C1/C2 directions and numerical capacity limits were **ratified** in [the owner decision](RAG-E1-H5-H6-H10-owner-ratification.md) after PR #15 merged at `d7f745e73acd0601ad7067e6905a46f807ae20ef`. Sections below are the *historical proposal* and their unchecked options were pending at authorship. Ratification does **not** approve hosted DDL, credential changes, paid calls or ingestion; physical measurements, exact CLI pin, security disposition and enforced admission remain outstanding.

| Property | Value |
| --- | --- |
| Date | 2026-11-17 |
| Base | `master` @ `9b62857a366932b5742fe61e1b511c3cae6da580` (PR #14 merged; post-merge CI SUCCESS; Mastra Cloud deployment owner-confirmed) |
| Scope | **H5 hosted migration historian / H6 runtime role / H10 capacity** |
| Decision state | **PROPOSED_FOR_OWNER_RATIFICATION**, not an approved remote execution plan |
| Hard boundary | **READ-ONLY HOSTED ASSAY / NO DDL / NO ROLE OR DSN CHANGE / NO PERSISTENT INGESTION / NO PAID CALLS** |
| Owner H10 exception | [No backup in MVP](RAG-H10-mvp-no-backup.md), already ratified. **Do not reintroduce** pre-migration dumps, PITR, external backup, real restores, RPO or RTO gates |

This is a **new decision proposal**, not an amendment to historic human approvals. Ratifying its direction later still will not authorize executing hosted SQL, secrets rotation, vector provisioning, source fetching or paid embeddings. Distinct human execution gates follow.

## 1. Verified baseline — read-only Supabase project assay

Verified through the connected Supabase project and read-only SQL on 2026-11-17:

| Property | Observed result | Interpretation |
| --- | --- | --- |
| Supabase org | `Alquem.io` (`bciquteonwtxyyerveik`), **Free** | Database-size quota applies at the **organization** level |
| Project | `mastra-rag`, `lmocjhpajhxegzobydau`, `sa-east-1`, `ACTIVE_HEALTHY` | Only intended hosted target for a later, separately approved E1 operation |
| DB | `postgres`, PostgreSQL `17.11.0.019` | CI independently uses disposable PostgreSQL 17 |
| Foundation migration | **Only** `20261113233720_enable_pgvector_create_private_rag_schema` | Never replay, delete, re-label or silently repair this recorded migration |
| `rag` | Private schema exists; **zero tables**, `rag_relation_bytes=0` | Neither catalog E1 nor PgVector space is deployed |
| Role `rag_app` | **Absent** | Local fixture must not be confused with a production role |
| pgvector | `vector` v0.8.2 installed in `extensions` | Role needs minimal schema `USAGE` to use `extensions.vector` |
| DB size | **11,228,851 bytes** (~10.7 MiB) | Live baseline only; no actual corpus or WAL/disk sizing evidence |
| Schema `rag` privileges | `anon`, `authenticated`, `service_role` have **no USAGE** | Preserve private, non-Data-API model |
| Security advisors | **2 WARNs** for `public.rls_auto_enable()` executable by `anon` and `authenticated` | Independent security adjudication required; do not silently revoke or assert RPC exploitation |

Read-only function inspection: `public.rls_auto_enable()` is a `postgres`-owned `SECURITY DEFINER` **event-trigger** function (`RETURNS event_trigger`, `search_path=pg_catalog`), attached to `ensure_rls` at `ddl_command_end`, and its function body filters to `public` table creation. Both SQL `has_function_privilege(..., 'EXECUTE')` checks return true. This confirms exposed grants and advisor warnings, **not** that calling `/rest/v1/rpc/rls_auto_enable` actually executes privileged DDL; no invocation or security modification was performed. Review [anon WARN](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated WARN](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

**Organization-capacity caveat:** Supabase lists two **other inactive projects** in the same Free organization. Their database-size contribution to current aggregate billing usage has **not been measured**. No `mastra-rag`-only budget can prove organization-wide headroom. Official docs: [pricing](https://supabase.com/pricing), [database/disk quota and fair use](https://supabase.com/docs/guides/platform/database-size).

## 2. H5 — Recommended single hosted migration historian

### Decision requested: H5-D1

**Recommendation:** treat `supabase_migrations.schema_migrations` as the **sole authoritative ledger for the hosted database**. The project owner is the only human authorizing/performing remote migrations. The versioned SQL in `db/migrations/0001_rag_catalog.up.sql` remains the reviewed **source candidate**, not an applied Supabase migration version. Maintain separate, explicit approvals for:

1. Privileged role prerequisite (`rag_app`), before catalog SQL referencing that role.
2. Catalog DDL under the sole ledger.
3. Operator-owned PgVector `flat` space provisioning and space RLS/grants.
4. Runtime DSN/secret configuration and any subsequent live write.

**No direct ad-hoc hosted SQL followed by fabricated migration-ledger records. No replay of the foundation migration. No automatic remote `down` or destructive rollback, especially without backups.**

### Decision requested: H5-D2 — CLI and file mapping

**Recommendation:** use **Supabase CLI v3**, pinned to a single exact release in a future operator PR; **v3.0.0 is a documented starting candidate, not installed or compatibility-verified in this checkpoint**. The operator must prove the actual executable version and inspect `--help` output before choosing flags. Do not install floating `latest` in a privileged operation.

CLI v3 changed default targets to local. An explicit `--remote=<project-ref>` is required for hosted database reads, and a hosted write requires a separate interactive human confirmation. See [CLI v3 migration guidance](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3). **Do not use `--yes` to bypass human confirmation on hosted operations.**

Proposed **read-only / local preparation** operator sequence (not permission to execute remote changes):

1. Confirm `supabase --version`, and inspect `supabase migration fetch --help`, `supabase migration list --help`, `supabase migration new --help`, `supabase db push --help`. Record command/version fingerprints. `supabase migration list --remote=lmocjhpajhxegzobydau` is a candidate **read-only** history check, subject to the verified CLI help, authentication and target identity.
2. The repo currently has **no `supabase/` directory**. Reconcile the **single** existing hosted foundation version with the locally represented history using supported CLI tooling. A version name alone does **not** prove that the old SQL bytes match a new local file: verify semantics/DDL against the actual read-only schema before accepting any local baseline. **Never call `migration repair` to force an unexplained mismatch.**
3. Use `supabase migration new <name>` in that exact pinned local toolchain to generate the future E1 migration filename; do **not invent a timestamp or retroactively claim that `0001_rag_catalog.up.sql` is already recorded.** Record SHA-256 of the reviewed SQL and the correspondence with the generated migration file. Avoid two independent canonical SQL bodies drifting.
4. Confirm dependencies and ordering (role, schema extension, catalog, space), SQL non-destructiveness, transaction boundaries, current remote ledger and data-free initial state. Stage a complete disposable PostgreSQL 17 dry-run with RLS/grants and no remote target.
5. Publish a future **operator PR** containing the exact generated version, diff, command/identity preflight, rollback limits, and CI evidence. Owner approves remote role/catalog/space steps **separately**. A command returning exit code 0 is not alone evidence of successful hosted readiness.
6. After each separately authorized operation, independently re-read the ledger and inspect actual PostgreSQL constraints, RLS, grants, `rag_app`, and vector table before advancing to the next gate.

**Required stop:** unknown migration baseline, unsupported CLI command, unexpected hosted migration entry, missing role dependency, difference between reviewed candidate and generated SQL, or destructive/irreversible SQL without independent impact adjudication.

**H5 proposal status:** `SINGLE_LEDGER_RECOMMENDED / CLI_VERSION_UNVERIFIED / REMOTE_APPLIER_NOT_AUTHORIZED`.

## 3. H6 — Proposed runtime role and security policy

### Decision requested: H6-D1 — runtime role

**Recommendation:** adopt the locally verified, constrained role `rag_app` for **server-side** connection only. No runtime use of `postgres`, `service_role`, superuser or a `BYPASSRLS` principal.

| Property | Proposed contract |
| --- | --- |
| Authentication | `LOGIN`, secret created/rotated **interactively** by approved owner; no plaintext in Git, SQL files, CI, shell history, chat or PR |
| Negative flags | `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`; no privileged inherited membership |
| Ownership | Must **not** own `rag`, the catalog, vector tables, policies or extensions; no `CREATE` on private schemas |
| Schema grants | `USAGE` on private `rag` and on `extensions` for pgvector type/cast, **not** `CREATE` |
| Catalog | `rag.embedding_space`: `SELECT` only; eight remaining catalog tables: scoped `SELECT/INSERT/UPDATE/DELETE` as reviewed in candidate SQL |
| PgVector space | Explicit post-provision grants and matching `SELECT/INSERT/UPDATE` RLS policies for `ON CONFLICT DO UPDATE`; namespace must remain `public` |
| Data API | Keep `rag` unexposed and deny schema `USAGE` to `anon`, `authenticated` and `service_role` |
| Runtime | No PgVector startup initialization (`disableInit:true`); never register public vector routes with `new Mastra({ vectors })` |
| DSN | Server-only secret in Mastra Cloud; TLS verification never disabled; connection method and rotation independently reviewed/authorized |

**Ordering requirement:** create/verify the role and extension-schema USAGE **before** applying catalog SQL using `TO rag_app` policies/GRANTs. The local restored-role test from PR #13 specifically validates `GRANT USAGE ON SCHEMA extensions TO rag_app` as a necessary prerequisite; do not omit it. Provision the vector space as a privileged owner **after** catalog SQL and apply its own RLS/grants; avoid letting `rag_app` own or create vector tables.

Future test gate: no role escalation, explicit role identity, namespace-scoped positive read/upsert, denial of foreign namespace, denial of schema CREATE, `anon`/`authenticated` denial, catalog/space RLS active, no startup connection without credentials, and no real fixtures without separate human approval.

### Decision requested: H6-D2 — pre-existing security WARNs

**Recommendation:** do **not** equate the two advisor WARNs with proven exploitability, and do **not** accept them silently. Before any hosted H6 change:

- Independently review the actual `RETURNS event_trigger` function, privilege chain, PostgREST exposure and event-trigger behavior in an **isolated equivalent instance**. Do not invoke the production RPC as an experiment.
- Decide whether to **revoke EXECUTE for PUBLIC/anon/authenticated in an authorized security change** (preferred if isolated regressions confirm no event-trigger breakage), or document a formally accepted residual risk with evidence and expiry. Verify applicable advisor state after a separately authorized security change.
- Keep `public.rls_auto_enable()`, its `ensure_rls` event trigger and grants unchanged within this adjudication-only PR.

**H6 proposal status:** `LEAST_PRIVILEGE_PROFILE_RECOMMENDED / ADVISORS_NOT_ADJUDICATED / HOSTED_ROLE_ABSENT / SECRET_SETUP_NOT_AUTHORIZED`.

## 4. H10 — Proposed capacity and admission policy, without backup

**H10 backup** remains **NO_BACKUP_MVP (already decided)**; RPO/RTO are undefined. Loss of catalog/versions/publication pointers/vectors can be irreversible. This proposal addresses **capacity only**.

Supabase Free published quota is **500 MB per organization** in aggregate; disk capacity is a separate **2 GB fixed physical allocation per project** with read-only risk near 95% disk. `pg_database_size` is **not** a measurement of filesystem WAL/disk occupancy. The other two inactive projects have unknown contribution to organization quota. Relevant [Supabase documentation](https://supabase.com/docs/guides/platform/database-size).

### Decision requested: H10-C1 — conservative initial MVP limits

| Control | Proposed limit | Action |
| --- | --- | --- |
| Active embedding-space vector rows | **2,000** | Reject a job whose projected active rows would exceed this |
| Rebuild/retiring vector space | **At most one** additional complete space | No third concurrent space; retention/GC requires H12 decision |
| Total app-owned `rag` relations | **100 MiB** hard stop; **80 MiB** warning | Measured from table+index+TOAST footprint, not raw vector float count |
| `mastra-rag` DB total | **250 MiB** warning; **300 MiB** hard stop | Avoid approaching Free shared quota |
| `Alquem.io` org aggregate DB usage | **350 MB** warning; **400 MB** hard stop | Maintain minimum ~100 MB headroom against 500 MB org quota; verify actual billing metric and whether paused projects count |
| Physical database disk/WAL | Monitor independently; no fabricated numeric measurement | If disk dashboard/telemetry unavailable or nearing read-only threshold, fail closed for new bulk ingestion |
| Provider spend | Not decided here | H11 must set hard provider limit and job budget before paid calls |

These are **recommendations, not approved or enforced values**. Numerical MiB (binary) and MB (decimal) thresholds are intentionally distinct. For 1,536-dimensional float32 vectors, raw value payload alone is **6,144 bytes/vector**, before rows, indexes, TOAST, WAL or duplicate spaces. At 2,000 active vectors that lower bound is ~12.3 MB, but **not** a corpus sizing measurement.

### Decision requested: H10-C2 — measurement and fail-closed behavior

1. Confirm representative LGPD/ANPD source manifest, real document/chunk counts and 1536-dim vector footprint through bounded **local synthetic estimates**, then measure actual hosted storage after separately approved initial provision/ingestion.
2. Before enabling E2, obtain the **organization-wide usage** from the Supabase billing/usage UI/API and document which inactive projects contribute. A PostgreSQL query in `mastra-rag` alone does not prove aggregate Free quota headroom; if the organization metric is unavailable, **do not approve bulk ingest**.
3. Implement a read-only preflight and periodic measurements, plus **projected post-job admission** for all caps. Reject new ingest/reindex before an operation that might exceed limits; require owner review to resume. Do not treat cleanup/GC as authorized until H12.
4. For hosted `rag` relation measurement, sum `pg_total_relation_size(c.oid)` for app-owned ordinary tables; verify no double counting if future partitioning is introduced. Whole database size: `pg_database_size(current_database())`. Disk usage/WAL and organization quota need independent metrics.
5. Test threshold boundaries, failures, missing/partial metrics, a second vector space, failed job resume, concurrent admissions and observed growth; a static markdown limit does not itself enforce H10.

**H10 capacity status:** `LIMITS_PROPOSED_NOT_RATIFIED / ORG_USAGE_UNMEASURED / ADMISSION_NOT_IMPLEMENTED`.

## 5. Cross-gate order and mandatory stop conditions

| Gate | Required evidence | Approval level |
| --- | --- | --- |
| G0: This adjudication PR | Read-only Supabase evidence, decisions and caveats, exact-HEAD CI, independent Codex review | **Human document merge** (does not ratify operational choices by itself) |
| G1: H5/H6/H10 owner ratification | Explicit selection of H5-D1/D2, H6-D1/D2 and H10-C1/C2 with scope, values and exceptions | **Separate human architectural/operational decision** |
| G2: Operator migration package | Single-ledger baseline mapping, pinned CLI, immutable reviewed SQL and dry-run, role-first dependency ordering, risk review | **Separate human approval for package** |
| G3: Hosted role and security operation | Interactive privilege procedure, isolated security regressions, safe secret handling | **Separate human execution authorization** |
| G4: Hosted catalog migration | Exact SQL/version/target + preflight snapshot + non-destructive proof + postflight checks | **Separate human execution authorization** |
| G5: Hosted `flat` vector space | Creation as privileged operator, explicit RLS/grants, no runtime auto-init, postflight | **Separate human execution authorization** |
| G6: E2 real ingestion | H7 access, H11 paid budget, H12 retention/GC, H10 capacity admission implemented, operator authentication, approved source content | **Separate human authorization** |

Explicitly **not authorized** by this PR or by the owner's “vamos avançar”: hosted DDL, creating `rag_app`, changing `public.rls_auto_enable()`, SQL grants, vector/index creation, secrets/DSN, provider calls, live ingestion, backup generation, or deployment/merge.

## 6. Human adjudication matrix (pending)

- [ ] **H5-D1:** approve single Supabase hosted ledger (`supabase_migrations.schema_migrations`) and owner-only remote applier.
- [ ] **H5-D2:** approve CLI v3 direction and exact pinned-version + historical foundation mapping in a subsequent operator PR; no remote push until independent proof.
- [ ] **H6-D1:** approve least-privilege, server-only `rag_app` contract and strict operator-controlled role/catalog/space order, without allowing hosted creation yet.
- [ ] **H6-D2:** approve separate analysis of the two `public.rls_auto_enable()` advisor WARNs, with isolated testing and later remediation/acceptance decision; no automatic revocation.
- [ ] **H10-C1:** approve or revise **2,000 active vectors / one extra rebuild space / 100 MiB rag / 250+300 MiB project / 350+400 MB organization** limits.
- [ ] **H10-C2:** approve organization quota verification, independent physical disk/WAL review and fail-closed E2 capacity admission.
- [x] **H10 backup:** already decided `NO_BACKUP_MVP`; **not** a question to reopen in this checkpoint.

**Checkpoint:** `RAG-E1 / HOSTED_ADJUDICATION_PROPOSED / H5_H6_H10_CAPACITY_PENDING / NO_HOSTED_WRITES`.
