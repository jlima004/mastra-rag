# RAG-E1 — Local-only implementation work order

**State:** IMPLEMENTATION_BRIEF_READY / CODE_PENDING. **Authority:** [owner ratification](../../docs/decisions/RAG-E1-owner-ratification.md). **Base:** `master` @ `8030b63e24aed4dab8d558b892846fc0b75d3278` (merged PR #11).

This work order prepares a **separate Draft PR**. A Draft opening is not evidence that E1 code, tests, SQL review, H10 operational readiness or merge gates are complete.

## Execution harness

- Work on the existing E1 feature branch, or a disposable worktree based on the exact ratified baseline. Confirm all `master` changes and existing repository contracts before editing.
- Treat [SPEC §6, §10–§11](../../docs/specs/SPEC-rag-ingestion.md), [ADR D4–D6](../../docs/architecture/ADR-rag-ingestion.md), [RAG-E1 adjudication proposal](../../docs/decisions/RAG-E1-adjudication-proposal.md) and the [human ratification](../../docs/decisions/RAG-E1-owner-ratification.md) together. The three identity contradictions are **known issues in pre-adjudication SPEC prose**.
- Start by writing a proposed SQL/role/migration-history reconciliation plan and independent test matrix. Resolve ambiguous DDL before coding. Do not silently change Step B/C hashes or trust uncalibrated token-proxy values.
- Any runtime dependency addition requires separate version/license/security/maintenance review and owner authorization. Use existing pinned Node/Mastra packages and an isolated PostgreSQL 17 + pgvector service first.

## E1 bounded tasks

### E1-01 — Reconcile identity contracts

1. Reconcile the full §10.2 DDL with `renderAwareChunkSetId` v2 and immutable source/title/charset snapshots from Step C.
2. Retain canonical Step B base ID and existing golden tests; persist rendered ID as effective unique `chunk_set_id`, with verifiable base ID, normalized SHA, header metadata hash and identity version.
3. Remove false `UNIQUE(version_id, pipeline_profile_id)` and replace it **only** with validated constraints that preserve valid distinct rendered sets.
4. Specify `rag:job:v2` input and golden hashes; job admission occurs post-render, pre-embedding. Distinguish v1 historical tests.
5. Explicitly define the current-published-rendered-ID no-op, freshness watermark and content-reversion cases. No automatic reuse across different version/render identities; no paid calls.

### E1-02 — Catalog schema and migrations

1. Author reviewed `db/migrations/` catalog `up/down` SQL only. **Do not apply remotely.**
2. Reconcile the already-applied Supabase `20261113233720_enable_pgvector_create_private_rag_schema` with the local file hierarchy and identify a single authoritative migration applier/history before final naming.
3. Include schema-qualified tables, identity/version/build/publication FKs, indexes, state constraints, RLS and explicit grants. Preserve immutable source provenance.
4. Test local `up → down → up`, with local assertions of objects, constraints, unique indexes and rollback order. Use disposable PostgreSQL 17 + pgvector test instance, never a hosted DSN.
5. Keep privilege-heavy provisioning/space creation separate from catalog migration. Document transaction versus nontransactional migration boundaries.

### E1-03 — Runtime role, RLS and PgVector provisioning

1. Model a `rag_app` role **only locally** with LOGIN/NOSUPERUSER/NOBYPASSRLS and without DDL/CREATEDB/CREATEROLE, scoped schema usage, table grants and relevant sequence grants.
2. Enable RLS on the catalog and PgVector space tables, with SELECT and UPDATE policies compatible with `ON CONFLICT DO UPDATE`, preserving enforced namespace semantics; no `anon`/`authenticated` access.
3. Author an operator-only provisioning script calling `createIndex({ indexName:'chunks_te3s_1536_v1', dimension:1536, metric:'cosine', indexConfig:{ type:'flat' } })` against **local** test DB. No automatic initialization at boot.
4. Add tests for `rag_app` privilege denials, runtime `disableInit:true`, schema-qualified queries and no `vectors` registration in public Mastra runtime. Avoid privilege escalation via SECURITY DEFINER.
5. Do not change the existing hosted `public.rls_auto_enable()` function/event trigger or its grants. Record security-advisor finding and proposed separate review, without implying exploitability.

### E1-04 — H10 recovery/capacity evidence (offline)

1. Estimate corpus footprint and index overhead as hypotheses using explicit assumptions and validation parameters, separating current ~11 MB database baseline from future vector footprint.
2. Document a versioned logical backup/off-site encryption and isolated restore procedure, including sensitive data controls, who executes it and failure handling. **Do not claim restore PASS until tested.**
3. Record proposed RPO/RTO, project storage ceiling, monitoring and owner approval requirements. Retain H10 OPERATIONAL_PENDING for hosted ingestion; free-tier limitations are not waived by direction ratification.

### E1-05 — Adversarial tests, review and handoff

- Extend only relevant test/glob/CI configuration; a container-backed local PG test matrix should exercise real DDL/unique keys, RLS/upsert, namespace, bad identity collision attempts, repeated construction, reversible migrations and forbidden operations.
- Assert no secrets, raw legal text/query text, token-proxy claims or DB credential echoes in logs. Existing missing-secret startup and dev/prod auth smoke must stay green.
- Run local check/typecheck/build + CI on **exact candidate HEAD**. Obtain one independent Codex review and fix P0/P1/P2 on the same HEAD; new findings and fixes require new CI/re-review.
- Do not use CI, PR commands, local scripts or a connection string in any way that can write to the hosted Supabase project.
- Submit evidence A–H: baseline/changed files; migrations and current-history reconciliation; local integration SQL outputs; security results; identity/golden results; H10 proposal; CI + review; remaining human gates.

## Non-goals and stop conditions

**Not E1:** E2 ingestion job execution/public API, durable publication engine, actual embedding/upsert into hosted Supabase, GC/deletion execution, production migration, DSN rotation, paid model evaluation, public search/agent, HNSW/IVFFlat, legal source fetch.

**Stop / BLOCKED** if an E1 test needs a hosted database, creating a privileged role on hosted DB, installing an unapproved package, changing provider billing, or activating an endpoint. Preserve evidence and request a separate owner decision.

## Draft review and merge gates

- [ ] E1-01 identity contract + golden tests reconciled.
- [ ] E1-02 migrations and local up/down/up validated.
- [ ] E1-03 least privilege, RLS, namespace and `flat` provisioning validated locally.
- [ ] E1-04 H10 recovery/capacity *plan* documented (remote readiness may remain pending).
- [ ] Exact-HEAD CI and independent reviewer PASS, no open material findings.
- [ ] Owner reviews and explicitly approves **merge separately**.
- [ ] Owner later independently authorizes any hosted migration, grants/role/DSN rotation, provisioning, backup setup or deploy.

**The documentation-only kickoff PR may begin with the ratification and this work order; mark feature/CI gates as pending until corresponding implementation exists.**
