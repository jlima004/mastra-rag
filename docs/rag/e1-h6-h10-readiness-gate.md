# E1 — H6/H10 evidence readiness (read-only; Draft preparation)

> **HISTORICAL READINESS SNAPSHOT — NOT AN ACTIVE H10 GATE (2026-11-18).** Owner canceled all H10 organization, physical disk/WAL and internal capacity-measurement requirements for this Free-tier MVP. H6-S1 was subsequently executed and verified; its earlier WARNs/ACL baseline are no longer current. [Latest decision and evidence](../decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md).

**Date:** 2026-11-18. **Baseline:** `master` `b3b7cfd0650af4fe9b370b2520d2be78bd28917a` (PR #19 merged; exact-head CI passed; deployment and `/health` confirmed by owner).

**Decision authority:** [H5/H6/H10 ratification](../decisions/RAG-E1-H5-H6-H10-owner-ratification.md), [H10 NO_BACKUP_MVP](../decisions/RAG-H10-mvp-no-backup.md). **Scope:** read-only observations, local/offline evidence-envelope tests, and human review preparation. No Supabase hosted DDL, role/grant/secret change, backup, paid call, provider-side command or E2 ingestion.

## 1. Read-only re-observation (2026-11-18)

Supabase MCP project-targeted reads (get_project, list_projects, get_advisors/security, and **SELECT-only** PostgreSQL catalog/size query; **no authenticated CLI rerun**):

| Domain | Observation | Status |
| --- | --- | --- |
| Target | `mastra-rag` / `lmocjhpajhxegzobydau`; `sa-east-1`; `ACTIVE_HEALTHY`; PG major 17 | Identified |
| H5 ledger | Foundation `20261113233720` present; catalog `20261117213614` absent | H5 history previously verified; no rerun |
| H6 role and catalog | `rag_app` absent, private `rag` exists with **0 tables** and **0 relation bytes** | Hosted setup **not started** |
| H6 advisor | 2 unchanged WARNs on `public.rls_auto_enable()` for `anon` and `authenticated`; function `SECURITY DEFINER` and `RETURNS event_trigger`, `ensure_rls` active | Security decision **pending** |
| H10 project | `pg_database_size(postgres) = 11,228,851` bytes | Project-only, not quota headroom |
| H10 organization | `Alquem.io`: 3 projects, 2 INACTIVE | **Aggregate usage unknown** |
| H10 physical | Physical disk used/total and WAL metrics | **Unknown** |
| H10 corpus/concurrency | Representative official corpus estimate and transactional reservation/enforcement | **Not established** |

A DB-only metric **cannot** be substituted for organization-wide Free quota or filesystem disk/WAL. Inactive projects may count; their contribution remains unknown until an authoritative organization-usage reading. No paused project was restored.

Advisor references: [anon WARN](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated WARN](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## 2. H6 — security and operator decisions

**Ratified role design, not permission to apply it:** `rag_app` must be server-only LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION; no privileged membership or ownership, no CREATE in `rag` or `extensions`. Grant `USAGE` on `extensions` **before** reviewed catalog, `USAGE` on `rag`, `SELECT` on `embedding_space`, reviewed scoped catalog DML and per-space SELECT/INSERT/UPDATE with RLS. No runtime `postgres` / `service_role`, no public Data API schema exposure, `disableInit: true`.

**Security adjudication still required:** existing local disposable PostgreSQL test (`scripts/test-e1-operator-local.sh`) reproduces `EXECUTE`/event-trigger behavior but does **not** simulate production-equivalent PostgREST RPC routing. Do not infer exploitability or remediation safety from advisor text alone. Obtain an independent isolated equivalent review and a **distinct owner decision** (specific privilege remediation or documented risk acceptance) before touching hosted `public.rls_auto_enable()` or `ensure_rls`. This PR does neither.

**Future role operator procedure** remains described in [e1-operator-package.md](e1-operator-package.md); interactive `psql \password rag_app` is not to be executed as part of this PR. Actual role, SQL, vector space and DSN each need explicit authorization.

## 3. H10 — evidence acquisition contract, no backup

Preserve ratified boundaries: 2,000 active rendered vectors; maximum one extra rebuild/retiring space; `rag` 80/100 MiB warning/stop; project 250/300 MiB; organization 350/400 **decimal** MB warning/stop. Physical disk/WAL are **independent** evidence; missing readings fail closed for E2. A conservative 95% physical-disk stop is implemented in local candidate code but is **not** a newly ratified SLO.

Before a human can consider enabling E2 admission, gather a **time-stamped, provider-verified** organization-wide usage reading (inclusive of inactive projects and current project count); independent physical used/total + WAL readings; project-only size; representative source/chunk/vector/rebuild estimates; and a proven transactional concurrency reservation mechanism. Document metric source, freshness and units. Operator must compare totals and identify provider limits/measurement semantics. No screenshot containing tokens, credentials or private user data should enter this PR.

For missing organization or disk data, **STOP**. `scripts/e1-capacity-policy.ts` remains a pure offline capacity candidate; its positive return does **not** permit writes and does **not** reserve resources. `scripts/e1-h6-h10-evidence-gate.ts` is an **additional pure review-envelope validator**, with no SQL, network or runtime wiring. It intentionally forces `hostedWritesAuthorized: false` and `e2IngestionAuthorized: false` even for a synthetically complete fixture. Source strings and reference IDs are not cryptographic verification. The reviewer supplies an explicit age window; 24 hours in tests is a **test assumption, not an approved production freshness SLO**. Real provider measurements and human signatures must be evaluated outside this script.

[Official role guidance](https://supabase.com/docs/guides/database/postgres/roles), [database-size guidance](https://supabase.com/docs/guides/platform/database-size), [disk-usage guidance](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size).

**H10 backup policy:** `NO_BACKUP_MVP` is unchanged. Do not add a hosted backup, dump/export, PITR, recovery drill, RPO/RTO or paid plan requirement. The risk of loss without recovery guarantee remains documented.

## 4. CI and acceptance gates

- [x] PR #19 merged in `master` and deployment health confirmed (reported owner evidence).
- [x] Current project, role, catalog, advisors and project size re-observed through read-only Supabase tools.
- [x] Existing PG17 local role and RLS fixture suite preserved.
- [ ] Candidate PR exact-HEAD CI and independent Codex review complete, no material findings.
- [ ] Human merge/deploy decision for **this Draft only**, with no hosted execution.
- [ ] Independent equivalent PostgREST H6 review; owner security disposition.
- [ ] H10 actual org-wide usage incl. inactive projects; physical disk/WAL; representative corpus and concurrent admission verified.
- [ ] H7 operator access, H11 paid budget and H12 retention/GC independently ratified.
- [ ] Explicit human approval **per** role, hosted migration, vector space, DSN and E2 ingest action.

**State:** `E1_H6_H10_READONLY_PREPARATION / H6_SECURITY_PENDING / H10_TELEMETRY_UNKNOWN / HOSTED_WRITES_BLOCKED / E2_BLOCKED`.
