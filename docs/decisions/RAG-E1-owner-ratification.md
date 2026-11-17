# RAG-E1 — Human architectural direction ratification

> **Later owner decision (2026-11-17):** [H10 no backup in the MVP](RAG-H10-mvp-no-backup.md) supersedes the H10 backup/restore prerequisite in this *historical* ratification. Capacity and all other gates remain open; no hosted operation is authorized by that decision.

| Field | Value |
| --- | --- |
| Decision date | 2026-11-17 |
| Authority | Project owner, explicit `Ratifico` in the continuation of the Rag-Masttra Product Manager conversation |
| Reviewed baseline | `master` @ `8030b63e24aed4dab8d558b892846fc0b75d3278` (PR #11 merged, CI success) |
| Prior review | [RAG-E1 adjudication proposal](RAG-E1-adjudication-proposal.md) and [PR #11](https://github.com/jlima004/mastra-rag/pull/11) |
| Decision state | **H4/H5/H6 DIRECTION_RATIFIED_FOR_LOCAL_E1; H10 POLICY_DIRECTION_RATIFIED / OPERATIONAL_EVIDENCE_PENDING** |
| Implementation authorization | Start a **separate E1 Draft PR** for offline/local database schema, tests, and operator provisioning scripts. No remote execution. |

## Ratified directions (narrow scope)

| Gate | Ratified direction | Remaining acceptance gate |
| --- | --- | --- |
| H4 | Private `rag` schema; app-owned relational catalog is authoritative for publication; Mastra PgVector space tables are rebuildable projections; exact (`flat`) vector scan first; keep Mastra state in Turso | Resolve E1-P2-01/02/03 in executable contracts and review the complete DDL/constraints, publication integrity and RLS before applying remotely |
| H5 | Versioned `db/migrations/` SQL with reviewed up/down and local PostgreSQL 17 + pgvector tests; only owner applies remote migration or rollback | Designate a single migration history and reconcile the already-applied Supabase migration `20261113233720_enable_pgvector_create_private_rag_schema`; review SQL and backup before any application |
| H6 | `rag_app` is a dedicated server-side low-privilege runtime role, non-superuser, without `BYPASSRLS`, DDL, database/role creation; scoped grants, explicit RLS and namespace | Pass local RLS/upsert/role/constructor/connection tests and independent review; handle existing `public.rls_auto_enable()` security-advisor findings as a separately authorized investigation, with **no privilege change now** |
| H10 | Stay on Supabase Free for this phase; persistent ingestion requires an explicitly approved capacity ceiling, external logical backups and successfully tested isolated restore, or separately approved paid backup/PITR | Actual corpus sizing, backup implementation, restore evidence, owner-accepted RPO/RTO and spend remain **PENDING**; do not infer production/persistent-ingestion approval |

This ratifies **architectural direction and permission to prepare/implement/test local E1**, not the exact physical schema, production privileges, or operational runbooks.

## Mandatory E1-P2 reconciliation and test outcomes

- **E1-P2-01 / effective ID:** Do not change frozen Step B `chunkSetId(versionId, profileId)` or golden hashes. Store effective `rendered_chunk_set_id` v2 as authoritative `rag.chunk_set.chunk_set_id`, with base ID, normalized-content SHA, optional structural title-header metadata hash/sentinel and explicit rendering identity version. The proposed `UNIQUE(version_id, pipeline_profile_id)` must not block distinct valid renderings. Assert charset/title and same-render golden cases offline.
- **E1-P2-02 / job identity:** Distinguish historical `rag:job:v1` from proposed `rag:job:v2` derived from document ID, effective rendered chunk set ID and space ID. Durable job admission follows deterministic rendering and precedes embedding/upsert. Assert collisions, repeated render, reverted content, and concurrent inputs in local tests; preserve no-paid-calls invariant.
- **E1-P2-03 / no-op:** Only an **equal effective rendered ID** at the current publication pointer is an automatic no-op; advance publication freshness watermark under lock. Same normalized text with a different raw version is not automatically reused across rendered-v2 identities. Version provenance and content reversion must remain correct.
- **Token accounting:** UTF-8 byte proxy (Step C) and Step D byte+8 reservations are **not** measured model tokens; do not claim verified token counts or enable paid ingestion. H9/H11 remain withheld.

## Explicit limits of current authorization

**Permitted:** Create/modify versioned files on an isolated Git branch and PR Draft; generate proposed `.up.sql`, `.down.sql` and operator provisioning scripts; apply those files **only to disposable local PostgreSQL 17 + pgvector test instances**; add fixtures/tests; perform exact-HEAD CI and independent code review. No dependency installation without a separately justified and reviewed decision.

**Not permitted:** Execute DDL/SQL/role changes in hosted Supabase; create `rag_app` remotely; rotate runtime DSN; make pgvector space tables remotely; grant or revoke security privileges on `public.rls_auto_enable()`; live fetch or ingestion; real embedding calls; change billing or backup plan; deploy E1; merge E1 without a separate owner approval. H7/H8/H9 exact packages/H11/H12 remain pending.

## E1 implementation acceptance criteria

1. Versioned SQL and local **up/down/up** migration test, including constraints, composite publication FKs, role permissions and rollback; migration history reconciled with pre-existing Supabase schema/setup.
2. Positive and negative local role/RLS tests including PgVector `ON CONFLICT UPDATE`, required SELECT policy, namespace isolation, `rag_app` inability to DDL, and no Data API exposure.
3. Provisioning script with `createIndex({ indexName: 'chunks_te3s_1536_v1', dimension: 1536, metric: 'cosine', indexConfig: { type: 'flat' } })`; no silent provisioning by application startup, no `new Mastra({ vectors })` registration, `disableInit: true` in future runtime integration.
4. Golden identity and job-key regression tests, with race/content reversion/freshness/GC risks documented for the E2 implementation. No claim that E2 has been implemented.
5. H10 capacity sizing/proposed logical backup and restoration runbook documented **without** performing hosted modifications or representing untested recovery as PASS.
6. `npm run test`, `npm run typecheck`, `npm run build`, dev/prod auth smokes and disposable local PgVector integration CI PASS on exact PR HEAD; independent review resolves all material P0/P1/P2. Human approves merge separately.

**Checkpoint decision:** `RAG-E1 / HUMAN_DIRECTION_RATIFIED / LOCAL_IMPLEMENTATION_AUTHORIZED / HOSTED_OPERATIONS_BLOCKED`.
