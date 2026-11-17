# RAG-E1 — Adjudication checkpoint (proposal; not ratified)

> **Subsequent owner decision — 2026-11-17:** The owner explicitly ratified the **directions** H4/H5/H6 and H10's Free-with-backup-prerequisites policy. See [RAG-E1 owner ratification](RAG-E1-owner-ratification.md). This file preserves the earlier proposed checkpoint and its evidence; statements below that those *directions* remain unratified are **historical**. Exact DDL/roles, H10 operational evidence and any hosted execution remain pending. A separate **local-only E1 Draft PR** may be prepared; no merge, paid usage or hosted operations are authorized by that decision.

| Field | Value |
| --- | --- |
| Opened | 2026-11-17 |
| Repository baseline | `master` @ `0075155cb6da360487ea59dee47c7bb3fd3449c4` (PR #10 merged) |
| Authority | Owner authorized the recommended documentation-only checkpoint and Draft PR; **not** production DDL, credentials, paid usage, deploy or final H4/H5/H6/H10 ratification |
| State | **ADJUDICATION_OPEN / DESIGN_RECONCILIATION_REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED** |
| Normative references | [SPEC](../specs/SPEC-rag-ingestion.md), [ADR](../architecture/ADR-rag-ingestion.md), [plan](../../tasks/rag-ingestion/plan.md), [checklist](../../tasks/rag-ingestion/todo.md), [Stage A](RAG07-stage-a-ratification.md) |

## 1. Boundary and evidence

This is a **proposed** physical-contract adjudication, not a ratification document or a migration. The previous Stage A decision accepted D4–D6 **principles only**. This checkpoint does not lift its explicit gates.

| Evidence | Verified observation | Limits |
| --- | --- | --- |
| GH-E1-01 | PR [#10](https://github.com/jlima004/mastra-rag/pull/10) merged at `0075155` on 2026-11-17; [CI 44096339186](https://github.com/jlima004/mastra-rag/actions/runs/44096339186) SUCCESS, 105 tests, typecheck/build/dev+prod auth smoke | Step D is offline, no billed embeddings or persistence |
| SB-E1-01 | Supabase project `mastra-rag` in Alquem.io, `sa-east-1`, ACTIVE_HEALTHY, PostgreSQL 17.11; organization tier Free | Read-only metadata check, 2026-11-17; no assertion of operational SLA |
| SB-E1-02 | Schema `rag` exists, zero tables; pgvector extension installed at 0.8.2; migration `20261113233720_enable_pgvector_create_private_rag_schema` recorded | No E1 DDL or space table has been provisioned |
| SB-E1-03 | Role `rag_app` absent; `anon`, `authenticated`, and `service_role` have no USAGE on schema `rag`; database size about 11 MB | Current size is not projected vector footprint, nor a quota check |
| SB-E1-04 | Security advisors flag `public.rls_auto_enable()` SECURITY DEFINER EXECUTE grants to `anon` and `authenticated`; inspected function is an event-trigger function behind enabled `ensure_rls` DDL event trigger | Exposure of EXECUTE is confirmed, an exploitable RPC path is **not** established; resolve via separate least-privilege review before any E1 DB application |
| SB-E1-05 | Supabase Free has no included automated daily backups or PITR; paid tiers/backups vary by plan and add-ons | [Backup documentation](https://supabase.com/docs/guides/platform/backups); actual backup/recovery capability not yet demonstrated for this project |

No database writes, credentials, permission changes, production fetch, provider calls, DDL, pricing changes or deployment were performed by this checkpoint.

## 2. Proposed decisions and blockers

| Gate | Proposed direction | Status / ratification boundary |
| --- | --- | --- |
| **H4** | PgVector space tables are rebuildable projections; app-owned `rag` catalog is publication authority; exact `flat` vector scan first | **PROPOSED — NOT RATIFIED.** Resolve E1-P2-01/02/03 and review final physical DDL, constraints, indexes and RLS |
| **H5** | Version SQL in `db/migrations/`; have repeatable up/down scripts tested on disposable PostgreSQL 17 + pgvector; owner applies only after a separate approval | **PROPOSED — NOT RATIFIED.** Reconcile repo migration bookkeeping with Supabase migration `20261113233720`, designate one applier/history, review rollback and backup |
| **H6** | Dedicated direct/server-only `rag_app` with `NOSUPERUSER`, `NOBYPASSRLS`, no DDL/role/database creation; explicit grants, explicit namespace, RLS defense-in-depth | **PROPOSED — NOT RATIFIED.** Verify roles, policies, PgVector UPDATE + SELECT, DSN pooler shape and TLS in local tests; review SB-E1-04 |
| **H10** | Remain on Free for offline/local development; permit persistence only after approved storage ceiling and logical off-site backup with tested restore, or an approved paid-backup/PITR alternative | **PENDING / CONDITIONAL.** Free does not imply a backup RPO/RTO; no spend or persistent ingestion approved |

H7, H8, H9 (specific parser/tokenizer packages and calibrated accounting), H11 (provider-side hard paid spend cap) and H12 (GC/erasure windows) remain pending independently. Nothing here authorizes Step E2, Step F or paid calls.

## 3. Required reconciliation before freezing Step E1 DDL

### E1-P2-01 — Base identity versus actual rendered chunk set

Step B defines `base_chunk_set_id = chunkSetId(version_id, pipeline_profile_id)`, with frozen golden IDs. Step C **already** creates a distinct `rendered_chunk_set_id` v2 by binding `normalized_sha256` for both strategies and a hash of `source.title` metadata for structure-aware rendering. The true vector `chunk_id` is derived from that rendered ID.

**Proposed catalog contract:** keep the Step B base ID and its golden tests unchanged; persist the **rendered** ID as authoritative `rag.chunk_set.chunk_set_id`, retain `base_chunk_set_id`, `normalized_sha256`, and the rendering-header metadata hash/sentinel as verifiable metadata, and record the rendering identity-version. Remove `UNIQUE(version_id, pipeline_profile_id)`: it incorrectly forbids multiple renderings of the same raw version/profile. The rendered primary key provides uniqueness; only add a secondary composite constraint after proving it cannot reject valid recomputations or alternative identity versions. Do not silently change the Step C formula or pre-existing golden values.

**Acceptance cases:** same raw bytes + different effective charset/normalized output => different rendered ID; same source content + title-only change => structural strategy changes ID, recursive unchanged if its embedding input is unchanged; repeated identical render => stable IDs; no vector ID reuse for different embedding text. Verify title and charset are snapshotted before processing.

### E1-P2-02 — Ingestion idempotency key predates rendering

The Step B `rag:job:v1` key depends on raw content, document, profile and space, but does not depend on the final rendered chunk set. That could collapse different embedding inputs into one job. The Section 6.2 assertion that the persistent ingest job is inserted right after raw hashing is incompatible with a render-aware key.

**Proposed v2 key** (not yet implemented or ratified):

    sha256("rag:job:v2\ningest\n" + document_id + "\n" + rendered_chunk_set_id + "\n" + space_id)

The engine first fetches/hashes, then deterministically extracts/normalizes/renders, then persists the job and its immutable effective ID **before any embedding or vector writes**. Only after collision-safe job ownership, publication-pointer/freshness checks and H11/H9 gates may the executor initiate paid work. The existing Step B v1 golden remains historical, not the candidate key for E2.

**Acceptance cases:** title-only structural change and charset-dependent normalization cannot share a v2 key; same render/space is idempotent; content reversion republishes an existing non-purged build instead of being incorrectly skipped; concurrent executions do not charge twice for the same missing IDs; no provider operation precedes durable job admission. Include new independent SHA-256 v2 goldens.

### E1-P2-03 — Same normalized text does not imply identical rendered identity

SPEC §11.4 currently allows `no_op` for raw-content changes whose normalized text remains equal, but rendered ID v2 still includes `base_chunk_set_id`, hence `version_id` and raw content hash. Those are different render sets even if the extracted text happens to match.

**Proposed MVP semantics:** same published **rendered ID** is a zero-embedding no-op with a freshness-watermark advance under the document lock; raw changes with equivalent normalized content are **not automatically deduplicated** across versions. Any future cross-version content-addressed embedding reuse needs a separate, explicit contract with provenance, space, cost and publication safety tests. No hidden aliasing between version IDs.

**Acceptance cases:** raw-only footer change with equivalent normalized text creates a distinct render ID; correct version provenance is preserved, publication obeys newer-fetched wins; no-op shortcut only on equal effective render ID; reversion/GC still use existing verified non-purged builds when available.

### E1-P2-04 — Unit-of-measure evidence (follow-up, not a new implementation scope)

Step C outputs UTF-8 byte-budget proxy, and Step D reserves byte + overhead: **neither is measured `cl100k_base` token usage**. Do not persist proxy counts as verified `token_count` / `total_tokens` for real ingestion. Keep any production data-path authorization behind H9 tokenizer calibration and H11 spending controls.

## 4. Migration and security contract to review in E1

- **H5:** define one explicit migration historian/applier, compare current Supabase history with the repo before running any SQL, pin tooling versions and destination, and separate catalog migration from privileged PgVector `createIndex` operator provisioning. Local up/down/up checks must use isolated Postgres 17/pgvector; production down is emergency-only with owner authorization.
- **H6:** revoke public API exposure to `rag` by schema permissions and configuration; no `anon`/`authenticated` grants to `rag` tables; RLS policies for every catalog and vector table with SELECT and UPDATE where required by PgVector upsert. `rag_app` must not own schema/objects or have `CREATE`, `BYPASSRLS`, `SUPERUSER` or privileged default grants. Verify `disableInit: true` with injected runtime connection and keep PgVector out of public Mastra `vectors` registration.
- **Security advisor:** separately determine safe privilege handling for `public.rls_auto_enable()` and its event-trigger dependencies; proposal is a review item, **not** permission to revoke grants, alter triggers, drop functions or change RLS now.
- **H10:** establish real corpus capacity estimate (raw normalized text, vectors, metadata, indexes and growth headroom), a project-specific storage ceiling, scheduled external encrypted logical backups with credential/restore handling, a successful restore into an isolated environment, and owner-accepted RPO/RTO. If that cannot be met on Free, request separate explicit plan/cost approval before any persistent ingestion.
- **E1 boundary:** schema and provisioning code may be developed only **after separate ratification** of H4/H5/H6 and documented H10 handling. Running DDL, provisioning, grants/DSN rotation and production cutover each require distinct human approvals.

## 5. Exit criteria and review request

- [ ] Independent Codex review of the **exact current Draft HEAD**, with P0/P1/P2 findings reconciled.
- [ ] CI on the exact Draft HEAD (tests, typecheck, build, dev+prod auth smoke).
- [ ] Owner adjudicates H4 physical constraints and each E1-P2-01/02/03 resolution.
- [ ] Owner adjudicates H5 migration owner, history and rollback contract.
- [ ] Owner adjudicates H6 runtime access, current `rls_auto_enable` advisory and role boundaries.
- [ ] Owner explicitly accepts or changes H10 persistence backup/capacity prerequisites and residual risk.
- [ ] Only after these steps: scope and authorize a **separate E1 implementation Draft PR**; no auto-merge/deploy.

**Checkpoint status:** `RAG-E1 / ADJUDICATION_OPEN / DESIGN_RECONCILIATION_REQUIRED`. The current PR is documentation only and must remain Draft until reviewed. Even a document merge alone does not grant H4/H5/H6/H10 or persistent-operations authorization.
