# RAG-E1 — Owner ratification: hosted H5/H6 and H10 capacity (MVP)

> **SUPERSEDED IN PART (2026-11-18):** H10-C1/C2 telemetry, budgets and capacity gates were **canceled by the owner for the Free-tier MVP**. H6-S1's previously pending hosted revocation has since been executed and independently verified. All H5/H6 principles not specifically changed stay in force. See [latest overriding owner decision](RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md). Preserve the historical text below as dated evidence only.

| Field | Value |
| --- | --- |
| Decision date | 2026-11-17 |
| Owner statement | **"Decisões ratificadas e deploy feito com sucesso."** — in response to the [six-choice H5/H6/H10 adjudication matrix](RAG-E1-H5-H6-H10-hosted-adjudication.md) |
| Baseline | PR [#15](https://github.com/jlima004/mastra-rag/pull/15) merged into `master` @ `d7f745e73acd0601ad7067e6905a46f807ae20ef`; post-merge [CI #44177541850](https://github.com/jlima004/mastra-rag/actions/runs/44177541850) **SUCCESS** |
| Deployment evidence | Owner reported success; Mastra Cloud build succeeded and `/health` healthcheck passed on the deployed container |
| Authority | **Architectural/operational direction ratified**; **NO hosted execution authorization**, no secret provisioning, live RAG ingestion or paid model calls |
| Previously decided | [H10 NO_BACKUP_MVP](RAG-H10-mvp-no-backup.md) remains in force, no backup or real-restore prerequisite |

## 1. Ratified decisions and exact boundaries

The owner's plural confirmation is recorded as approval of the **six choices explicitly presented by the merged PR #15**. It does not retroactively attest to any technical test, provider-spend permission, exact CLI installation, physical resource measurement or completed live Supabase operation.

### H5-D1 — Hosted migration history and application owner: RATIFIED

- **Sole hosted migration ledger:** `supabase_migrations.schema_migrations`. Preserve immutable foundation version `20261113233720_enable_pgvector_create_private_rag_schema`.
- **Remote applier:** owner-controlled only, with separate explicit human approval for each privileged hosted operation.
- `db/migrations/0001_rag_catalog.up.sql` remains a **reviewed candidate source**. It is **not** a Supabase timestamp migration and is **not applied remotely**.
- No out-of-band SQL followed by fabricated ledger entries; no silent history repair, repeat foundation application, destructive automatic rollback or schema mutation in this documentation ratification.

### H5-D2 — CLI tooling and baseline reconciliation: RATIFIED DIRECTION

- Use **Supabase CLI v3** as tooling direction, with one exact version **selected/pinned and verified in the future operator package**. No particular CLI patch/minor version or command semantics were proven or authorized in PR #15.
- Verify installed CLI and `--help` before assuming remote-target flags, especially v3 local-by-default semantics; do **not** assume the illustrative command examples were executed.
- Reconcile hosted foundation history with local representation before generating the new E1 migration using the actual pinned CLI. Record reviewed SQL hash, provenance, executable command and non-destructive PostgreSQL 17 dry-run.
- **No hosted `db push`**, no `migration repair`, no role setup or DDL is authorized by H5-D2 ratification.

### H6-D1 — Minimal server-only `rag_app`: RATIFIED CONTRACT

- `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`; no inherited elevation and no schema/table ownership or DDL permissions.
- Runtime `rag_app` gets `USAGE` (not `CREATE`) on private `rag` and `extensions`, `rag.embedding_space` **SELECT only**, reviewed catalog CRUD and explicit PgVector SELECT/INSERT/UPDATE grants with RLS compatible with `ON CONFLICT DO UPDATE`.
- Maintain `public` namespace isolation and no `rag` schema USAGE for `anon`, `authenticated` or `service_role`. Do not expose `rag` on Data API.
- Creation and password assignment are **owner-only future interactive operations**; no password in CI, shell history, PR, SQL, logs or chat. Never configure runtime `postgres` / `service_role` / `BYPASSRLS`.
- Role/extension USAGE preflight **before** catalog policies/grants; operator-only vector `flat` provisioning after catalog, separately approved. Runtime `disableInit:true`; no public vector registration.

### H6-D2 — Existing SECURITY DEFINER warnings: RATIFIED INVESTIGATION, NOT RISK ACCEPTANCE

- Keep `public.rls_auto_enable()` and event trigger `ensure_rls` untouched until **separately authorized** security work.
- Independently assess both WARNs (executable by `anon` and `authenticated`) in an equivalent isolated setup, including `RETURNS event_trigger` and RPC semantics, without asserting exploitability solely from the advisor output.
- Then request a **distinct human decision**: revoke excess EXECUTE safely, or formally accept residual risk with reasoning and review trigger. The present ratification is **not permission to revoke** and **not risk acceptance**.

### H10-C1 — Initial MVP capacity ceilings: RATIFIED VALUES, NOT IMPLEMENTATION

| Metric | Ratified policy |
| --- | --- |
| Active rendered vectors | At most **2,000** |
| Concurrent rebuild / retiring vector spaces | At most **one additional** full space |
| App-owned `rag` relations | **80 MiB warning**, **100 MiB hard stop** |
| Total `mastra-rag` database | **250 MiB warning**, **300 MiB hard stop** |
| Aggregate database quota across Free organization `Alquem.io` | **350 MB warning**, **400 MB hard stop** |

MiB is binary and MB decimal. The Free organization allowance used in the proposal is 500 MB aggregated database size; **the contribution of the two other inactive projects has not been measured**. A local `pg_database_size` query against `mastra-rag` does not establish total organization headroom. Physical disk/WAL is a distinct control. These limits require **measurement and enforced E2 admission**, not merely documentation.

### H10-C2 — Capacity evidence / fail-closed admission: RATIFIED REQUIREMENT

- Capture organization-wide database quota consumption and determine how inactive projects count, plus independent disk/WAL telemetry. If necessary metrics are unavailable or inconsistent, **stop new bulk ingestion**.
- Use representative bounded corpus counts, projected vector/catalog/duplicate-space growth, warning/stop checks and periodic verification; refuse jobs before projected limits are breached.
- Test missing-metric failures, concurrent jobs, reindex/second-space scenarios and storage headroom; owner review is required to resume on hard stop. No paid embedding budget is approved by this gate.
- **NO_BACKUP_MVP remains settled**; there are no pre-migration backups, offsite backups, PITR, real-database restore drills, RPO/RTO targets or backup purchases in this MVP. Potential permanent loss of catalogue, publication history and derived vectors remains accepted as a limitation of scope.

## 2. Evidence versus remaining execution prerequisites

| Gate | Status |
| --- | --- |
| PR #15 document merge, exact-head Codex review, post-merge CI, Mastra Cloud build/health | **COMPLETE** (document and application packaging only) |
| Owner architectural/operational H5-D1/D2, H6-D1/D2, H10-C1/C2 ratification | **RATIFIED** by owner communication, captured here |
| Hosted foundation migration history | **READ-ONLY CONFIRMED**: only version `20261113233720` at last assay |
| `rag_app`, catalog/space schema, vectors | **NOT DEPLOYED** in Supabase at last assay |
| Pinned exact CLI release, local baseline mapping, reviewed generated migration, operator procedure | **NOT YET PROVEN** |
| Security advisor investigation/remediation-or-acceptance | **OPEN** |
| Aggregated organization usage, physical disk/WAL, representative source sizing, hard-stop enforcement | **OPEN** |
| Role creation, SQL migration, vector table/index, runtime DSN change, any live ingestion | **EACH REQUIRES EXPLICIT SEPARATE HUMAN AUTHORIZATION** |
| H7 access model, H11 paid spend cap, H12 retention/GC | **OPEN** |

The successful Mastra Cloud deployment is a **health/build gate**, not evidence that E1 hosted persistence is operational.

## 3. Recommended next operator-package checkpoint (documentation and local-only)

1. Prepare an exact pinned Supabase CLI v3 candidate and capture real `--version` and relevant `--help` outputs in a **local, non-secret** execution environment.
2. Reconcile the historical foundation without changing hosted migration records. Generate a reviewed, timestamped E1 migration using actual CLI tooling and record correspondence/hash to `db/migrations/0001_rag_catalog.up.sql`.
3. Define a minimal `rag_app` interactive provisioning/verification procedure that does not expose credentials; prove grants and `extensions` USAGE with disposable PG17 regressions.
4. Produce an **isolated** security-advisor investigation plan (including `event_trigger` RPC limitations), with independent review before any production privilege change.
5. Specify H10 organization-usage and disk/WAL evidence sources and testable admission/stop behavior, leaving runtime implementation to an authorized E2 PR.
6. Require independent Codex review, exact-head CI and human approval of the operator package before any other hosted or paid action.

**No hosted SQL, Supabase role/grant/schema change, secret rotation, cloud provisioning, database backup, paid embedding call or E2 ingestion is authorized by this documentation checkpoint.**

**State:** `RAG-E1 / H5_H6_H10_DIRECTION_RATIFIED / OPERATOR_PACKAGE_PENDING / H10_NO_BACKUP_MVP / HOSTED_WRITES_BLOCKED`.
