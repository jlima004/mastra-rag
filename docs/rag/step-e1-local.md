# RAG-E1 — Local catalog implementation and operational boundaries

**State:** E1 local-only candidate; **NOT** hosted-migration ready. Baseline: `master` at `8030b63e24aed4dab8d558b892846fc0b75d3278`. Human direction ratification: [E1 decision](../decisions/RAG-E1-owner-ratification.md).

## Identity contract reconciled (E1-P2-01/02/03)

- Step B `chunkSetId(versionId, profileId)` and historical `rag:job:v1` retain their original functions and golden fixtures.
- Step C exposes **both** `baseChunkSetId` and authoritative `chunkSetId` (render-aware v2), plus `normalizedSha256`, `headerMetadataSha256` and `renderingIdentityVersion` on the offline set. Vector `chunk.id` continues to derive from the rendered ID.
- The E1 candidate DDL stores rendered `chunk_set_id` as primary key and does **not** use `UNIQUE(version_id, pipeline_profile_id)`. Title and charset differences can produce distinct rendered sets.
- `renderedIngestionIdempotencyKey(documentId, renderedChunkSetId, spaceId)` uses `rag:job:v2` and an independently computed SHA-256 golden. E2 must persist the job **after deterministic rendering, before embedding/upsert**, and re-check concurrency under the appropriate DB lock.
- `assessRenderedPublication()` models the same-render no-op/freshness and newer-wins/tie cases as a **pure evaluator** only. It does not query the DB, acquire locks, or publish. Same normalized text with a distinct raw version/rendered ID **is not** an automatic no-op; content reversion can republish an old verified build later.
- UTF-8 byte-budget proxy and Step D byte+8 reservations are not measured model tokens. DDL records `total_byte_budget` and nullable measured token fields separately; no billable usage authorized.

## E1 files and isolated test command

- `db/migrations/0001_rag_catalog.up.sql` and `.down.sql`: reviewed candidates; no application in hosted Supabase, no `CASCADE` rollback.
- `db/local/0000_e1_disposable_setup.sql`: disposable roles/schema/pgvector fixture, **never for hosted projects**.
- `scripts/provision-e1-space-local.ts`: local-only, hard-guarded operator `PgVector.createIndex({indexConfig:{type:'flat'}})`.
- `db/local/0002_e1_space_role_policies.sql`: local-only namespace `public` SELECT/INSERT/UPDATE/DELETE policies and explicit sequence/table GRANT after space creation.
- `db/local/0003_e1_positive_proofs.sql`: real PostgreSQL fixture assertions (same raw version/profile different rendered identities, role/RLS and PgVector upsert).
- `scripts/test-e1-local.sh`: refuses non-`pgvector/pgvector:pg17` containers and wrong database; executes catalog `up → down → up`, space provisioning, positive and negative RLS/role tests.
- `.github/workflows/ci.yml`: separate disposable Postgres service job, no Supabase credentials/DSN.

**Local test boundary:** pass `E1_LOCAL_TEST_CONTAINER` as the Docker container ID of a disposable `pgvector/pgvector:pg17` started with `POSTGRES_DB=rag_e1`, mapped port `54329:5432`, and a disposable password `e1-local-ci-only`. Then run `bash scripts/test-e1-local.sh`. Never pass a cloud connection URI. The CI defines this disposable service. This is not a recipe for modifying the hosted project.

## Migration history reconciliation (H5 — owner application still pending)

The existing hosted Supabase project has migration `20261113233720_enable_pgvector_create_private_rag_schema` recorded. E1 migration `0001_rag_catalog` is a **repository-local candidate version**, not a claim to be the next Supabase migration ID or that the remote DB is ready. Before any hosted application:

1. Record immutable hosted migration history and the existing schema ownership/extension status again.
2. Approve a **single** migration applier and history convention (manual owner-reviewed SQL vs Supabase CLI history, not both). Choose/freeze a new Supabase migration identifier or a documented operator ledger before modifying the hosted database. Never mark the pre-existing migration as unapplied.
3. Review the exact final SQL line by line and a pre-application logical backup; prove it can be restored in a **disposable** instance.
4. Give separate explicit owner authorization for role setup, catalog DDL and flat space provisioning. Each requires its own evidence.
5. Re-run RLS/grant/security advisors and no-secret startup checks **after** a separately approved application. Never deploy or rotate DSNs from this PR.

In particular, `rag_app` is created with LOGIN **only in the disposable local fixture**. Real login/password/rotation procedures must be separately approved; neither a credential nor an operator provisioner with a hosted target appears here.

## H10 — Storage and recovery plan (NOT executed)

The Supabase organization currently uses Free. Automatic daily backups and PITR are not assumed to be available. Hosted database size previously observed was around 11 MB; it is **not a corpus sizing benchmark**.

For capacity planning, let `n` be total distinct rendered chunks in the **current active** space, with `d = 1536` float32 components; vector data alone consumes roughly `4*d*n = 6,144 n` bytes, **excluding** vector header/row/index/TOAST overhead. For example, at **2,000 chunks as a hypothetical scenario** the raw float values alone would be ~12.3 MB, not an actual corpus measurement. Catalog normalized text, chunk text, indexes, old/retiring spaces, PG/WAL overhead and future growth must be measured separately using representative documents. Draft a minimum storage headroom ceiling before persistent ingestion.

Before any remote persistence: obtain actual LGPD/ANPD corpus estimate (Step C official source still unverified), approve a project-specific storage cap, define external encrypted logical backup destination, access control, key management and scheduled execution; demonstrate a **real restore in isolated infrastructure**, and record owner-accepted backup frequency, RPO, RTO and failure alert procedure. Do **not** claim backup/restore PASS on paper alone. If Free cannot meet approved recovery constraints, separately request plan/cost authorization.

## Security review required before hosted operations

- Runtime `rag_app`: no superuser, no `BYPASSRLS`, DDL, role/database creation or schema ownership; `rag` not exposed via Data API; never grant `anon` or `authenticated` USAGE.
- The existing `public.rls_auto_enable()` SECURITY DEFINER execute-grant advisors require separate operator security review. This E1 PR does not revoke grants, alter the `ensure_rls` event trigger or claim an exploitable RPC path.
- The app keeps PgVector out of `new Mastra({vectors})` and uses `disableInit:true` on runtime factory. No live endpoints and no external provider calls have been added.
- Do not store source legal text, query text, tokens or credentials in logs. Synthetic strings appear only in offline tests.

**Not approved:** remote DDL / grants / provision / DSN rotation; live ingestion; official legal fetch; paid embeddings; changing billing; deploy; E1 merge. Each needs an independent owner gate.
