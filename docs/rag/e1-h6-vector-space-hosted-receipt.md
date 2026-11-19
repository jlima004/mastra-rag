# E1/H6 — Hosted flat vector space provisioning: execution receipt

> **Operation date:** 2026-11-18 (owner-authorized); independently verified after hosted SQL execution.
> **Operational status:** `E1_H6_VECTOR_SPACE_PROVISIONING = COMPLETE / VERIFIED` for the physical schema, ACL and registry conditions below. **Implementation-method divergence requires independent review** (§4).

## 1. Target, authorization and method

- Owner explicitly instructed `Execute E1_H6_VECTOR_SPACE_PROVISIONING`. Target verified through the project-scoped Supabase connector: `mastra-rag` / `lmocjhpajhxegzobydau`, Alquem.io Free, PostgreSQL 17.11, region `sa-east-1`.
- Baseline: `master` `c6480b83e4439cfe0cb79b78737d726a18640d7c` (PR #27 merged/deployed), H5 catalog and H6 R1/R2 already independently VERIFIED.
- The operator **did not invoke the Mastra JavaScript `PgVector.createIndex()` method**. It reviewed exact schema/index/namespace implementation at pinned upstream tag [`@mastra/pg@1.35.0`](https://github.com/mastra-ai/mastra/blob/%40mastra/pg%401.35.0/stores/pg/src/vector/index.ts) and executed an **equivalent SQL layout** using the project-scoped Supabase SQL connector. This difference is disclosed, not disguised as a library call.
- A single explicit PostgreSQL transaction contained fail-closed preconditions, table creation, unique index, namespace RLS policies, minimum grants, operator-only registry insertion, internal verification, and COMMIT. `lock_timeout=5s` and `statement_timeout=20s` were `SET LOCAL`, not persistent changes. The connector returned without errors; independent fresh SELECTs observed the committed state.
- No passwords, tokens, DSNs, SCRAM verifiers, embeddings, text or other private data were transmitted in the SQL operation. No privileged role/credential was modified, and no application runtime was connected.
- H5 ledger remains exactly `20261113233720`, `20261117213614`. The H6 operator-owned DDL is **not** represented by a new migration version. Do not insert a fabricated history row or replay H5. See §4 for architecture review.

## 2. Recorded operator DDL shape (audit excerpt; not a replay script)

These statements summarize the material DDL and grant effects. The **full invocation also had restrictive preflight/postflight DO guards** against wrong ledger, role, catalog, pre-existing space and security drift. This excerpt is not a deployable migration and must **not** be executed again:

```sql
CREATE TABLE rag.chunks_te3s_1536_v1 (
  id SERIAL PRIMARY KEY,
  vector_id TEXT NOT NULL,
  embedding extensions.vector(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  namespace VARCHAR(255) NOT NULL DEFAULT 'default'
);
CREATE UNIQUE INDEX chunks_te3s_1536_v1_namespace_vector_id_idx
  ON rag.chunks_te3s_1536_v1 (namespace, vector_id);
ALTER TABLE rag.chunks_te3s_1536_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY rag_vector_select ON rag.chunks_te3s_1536_v1
  FOR SELECT TO rag_app USING (namespace = 'public');
CREATE POLICY rag_vector_insert ON rag.chunks_te3s_1536_v1
  FOR INSERT TO rag_app WITH CHECK (namespace = 'public');
CREATE POLICY rag_vector_update ON rag.chunks_te3s_1536_v1
  FOR UPDATE TO rag_app USING (namespace = 'public')
  WITH CHECK (namespace = 'public');
REVOKE ALL ON TABLE rag.chunks_te3s_1536_v1
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE rag.chunks_te3s_1536_v1_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON rag.chunks_te3s_1536_v1 TO rag_app;
GRANT USAGE ON SEQUENCE rag.chunks_te3s_1536_v1_id_seq TO rag_app;
INSERT INTO rag.embedding_space
  (space_id, provider, embedding_model, embedding_version, dimension, metric, vector_type, status)
VALUES
  ('chunks_te3s_1536_v1','openai','text-embedding-3-small',1,1536,'cosine','vector','building');
```

The selected `flat` type means **no ANN (HNSW/IVFFlat) index**; the verified indexes are the `id` btree primary key and btree unique `(namespace, vector_id)`. The namespace column's default is `default` because this is the pinned library's table layout; `rag_app` policies **only permit namespace `public`**. A future runtime must explicitly pass `namespace:'public'`; the default is deliberately not granted. This contract is not yet exercised in hosted runtime because DSN/E2 are gated.

## 3. Fresh independent postflight — PASS

| Control | Observed |
| --- | --- |
| Role and project | PostgreSQL 17; `rag_app` LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS with zero memberships; target ledger unchanged |
| Catalog | **10** `rag` tables (previous 9 + vector), all RLS enabled, all owned by `postgres` |
| Vector relation | `rag.chunks_te3s_1536_v1`; `id integer` serial, `vector_id text`, `embedding vector(1536)`, `metadata jsonb DEFAULT '{}'`, `namespace varchar(255) DEFAULT 'default'` |
| Vector indexes | Exactly primary key btree + unique btree `(namespace, vector_id)`, **no ANN** |
| Vector RLS | Exactly 3 scoped policies (`SELECT`, `INSERT`, `UPDATE`) for `rag_app`, `namespace = 'public'` in USING/WITH CHECK |
| `rag_app` table privilege | SELECT=true, INSERT=true, UPDATE=true; DELETE=false, TRUNCATE=false, REFERENCES=false, TRIGGER=false |
| `rag_app` sequence privilege | USAGE=true; SELECT=false, UPDATE=false |
| Schema privileges | `rag` USAGE=true, CREATE=false; no table ownership or bypass |
| Excluded Supabase roles | `anon`, `authenticated`, `service_role`: no `rag` USAGE or vector table SELECT |
| Catalog registry | Exactly one `embedding_space` row for `chunks_te3s_1536_v1`, OpenAI `text-embedding-3-small` v1, 1536, cosine/vector, status `building` |
| Data | **0 vector rows**, other eight source/document/chunk/job tables **0 rows**, no `public.chunks_*` table |
| H6-S1 | Revoked `anon`/`authenticated` EXECUTE on `public.rls_auto_enable()` unchanged; `ensure_rls` trigger enabled |
| Provider security | Security Advisor `lints=[]` (zero findings) |
| Migration history | Exactly the two H5 migration versions, no repair |

**Proof boundary:** independent PostgreSQL catalog introspection, ACL checks and SELECT-only row counts verify the structural and grant state. No privileged session or real app DSN was used to test a hosted vector upsert, deletion or alternate namespace mutation. Prior disposable PostgreSQL 17 tests cover the basic `PgVector`/namespace upsert behavior, but a fresh hosted runtime integration is an E2/DSN gate, not a result claimed here.

## 4. Adjudication note — mechanism and stricter grants

Earlier operator documentation proposed `PgVector.createIndex({indexConfig:{type:'flat'}})` as the privileged hosted mechanism. Execution used a **single atomic SQL transaction** modeling its pinned table and unique-index output instead, in order to make RLS+grants atomic with table creation. The existing project ratified a **single Supabase migration ledger** for versioned H5 migrations, while the H6 vector table was identified as a **separate privileged operator action**. No new ledger entry was created here. The reviewer should explicitly adjudicate whether this operator-SQL implementation and absence of a new migration version are consistent with the intended H6 exception, or whether an ADR is needed. **Do not 'fix' by replaying DDL, modifying migration history or dropping the table.**

Another intentional tightening: the old **disposable-only** fixture `db/local/0002_e1_space_role_policies.sql` granted DELETE and created a delete policy, whereas the ratified H6-D1 minimum vector grants were `SELECT/INSERT/UPDATE`. Hosted execution **did not grant DELETE**. This PR aligns the disposable fixture to the hosted minimum and adds a negative test. DELETE/GC requires a separately reviewed H12 gate; no broader privileges are silently added.

## 5. Other gates

- This receipt PR changes documentation and **disposable-only tests**; **no new hosted DDL**, application DSN, runtime endpoint, or E2 ingestion.
- `E1_H6_VECTOR_SPACE_PROVISIONING`: physical/ACL postflight VERIFIED; architecture method recorded for independent review; publication requires exact-HEAD CI, independent Codex review, and human merge/deploy approval.
- Next separate gates: H7/H11/H12 decisions, runtime server-only `rag_app` DSN, `disableInit: true`, explicit namespace for query/upsert, provider-spend cap, E2 admission and ingestion. No embedding calls or live data writes yet.
- H10 remains canceled for the Supabase Free MVP. `NO_BACKUP_MVP` is unchanged; no backup or restore was performed.
