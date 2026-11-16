# ADR: RAG ingestion, embeddings, storage and retrieval (D1–D6)

| Field | Value |
| --- | --- |
| Status | **PROPOSED** — every decision below is `HUMAN_ADJUDICATION_PENDING` |
| Date | 2026-11-16 |
| Baseline | `master` @ `15fe15cdffd51133be32c704eee0cc88f51b9d45` |
| Scope | Architecture only. No code, dependency, DDL, migration, secret or deployment change. |
| Normative companion | [`docs/specs/SPEC-rag-ingestion.md`](../specs/SPEC-rag-ingestion.md) |
| Implementation plan | [`tasks/rag-ingestion/plan.md`](../../tasks/rag-ingestion/plan.md) |

A recommendation in this document is not an approved decision. Implementation must not start until the project owner ratifies D1–D6 (see the "Human decisions" section).

## Context

The repository currently contains infrastructure only (PRs #1–#6):

- `src/mastra/storage/supabase-vector.ts` lazily builds a `PgVector` (`@mastra/pg@1.35.0`) bound to the private schema `rag`, with verified per-pool TLS and `max: 2` connections.
- `src/mastra/storage/runtime-storage.ts` binds Mastra runtime state to Turso through `LibSQLStore` (`@mastra/libsql@1.30.0`); durability was proven in PR #6.
- `src/mastra/security/server-auth.ts` configures `SimpleAuth` with one operator token (`role: 'admin'`).
- Supabase PostgreSQL 17 in São Paulo, pgvector 0.8.2 in schema `extensions`, `rag` not reachable by `anon`/`authenticated` (`src/mastra/storage/supabase-probe.ts`).

There is no corpus, ingestion pipeline, embedding model, vector index or agent.

## Evidence base

Code citations refer to the installed packages in `node_modules` at the baseline. Abbreviation: `pg.js` = `node_modules/@mastra/pg/dist/index.js` (1.35.0).

| ID | Verified fact | Evidence |
| --- | --- | --- |
| E1 | `PgVector.createIndex` creates `"rag"."<indexName>"` with `id SERIAL PK, vector_id TEXT, embedding extensions.vector(N), metadata JSONB, namespace VARCHAR(255)`; uniqueness is a unique index on `(namespace, vector_id)` | `pg.js:1368-1375`, `pg.js:854-866` |
| E2 | When no `indexConfig` is given the ANN index defaults to **IVFFlat**, with `lists` computed once from the row count at build time; `type: 'flat'` creates no ANN index | `pg.js:1429-1434`, `pg.js:1500-1532` |
| E3 | PgVector's HNSW defaults are `m = 8, ef_construction = 32`, below pgvector's own defaults (16/64) | `pg.js:1510-1518`; [pgvector README](https://github.com/pgvector/pgvector) |
| E4 | `upsert` runs `BEGIN → optional DELETE (deleteFilter) → INSERT … ON CONFLICT (namespace, vector_id) DO UPDATE → COMMIT`; missing ids become random UUIDs | `pg.js:1143-1216`, `pg.js:1169` |
| E5 | pgvector is detected in `extensions` (`detectVectorExtensionSchema`); `installVectorExtension` returns without `CREATE EXTENSION` when it is present; the type is qualified as `extensions.vector`; a **session-level** `SET search_path TO "extensions","rag","public"` is issued on pooled connections | `pg.js:696-736`, `pg.js:1548-1572`, `pg.js:769-777` |
| E6 | A different `dimension` passed to `createIndex` for an existing table is a no-op (`CREATE TABLE IF NOT EXISTS` plus index cache); the mismatch only surfaces at `upsert` as a `MastraError` | `pg.js:1265`, `pg.js:1368-1378`, `pg.js:1218-1240` |
| E7 | With the constructor option `disableInit: true`, `createIndex` performs no DDL, and the data paths only need DDL if the namespace migration is missing (they then fail with `MIGRATION_REQUIRED` instead of altering the table) | `pg.js:1316`, `pg.js:902-935` |
| E8 | The `PgVector` constructor starts a cache warm-up that calls `listIndexes()` (a DB connection) immediately | `pg.js:661-679` |
| E9 | `query` returns cosine score `1 − (embedding <=> q)`, applies `minScore` as `score > minScore`, filters only on `namespace` + metadata JSONB; with HNSW it falls back to an exact scan when the indexed path returns fewer than `topK` rows, and without an ANN index (`flat`) the scan is always exact | `pg.js:782-799`, `pg.js:1070-1118` |
| E9b | Every PgVector data method (`upsert`, `query`, `deleteVectors`, …) uses `namespace = "default"` when the argument is omitted, so a call without the namespace silently misses rows written under another namespace | `pg.js:591`, `pg.js:995`, `pg.js:1972-1974` |
| E10 | Metadata filters support `$eq $ne $gt $gte $lt $lte $in $nin $all $elemMatch $exists $regex $contains $size $and $or $not $nor`, translated to `metadata->>'key'` expressions | `pg.js:168-410` |
| E11 | `PgVector.pool` is public; there is no public transaction API spanning multiple PgVector calls | `node_modules/@mastra/pg/dist/vector/index.d.ts:93`; `node_modules/@mastra/pg/dist/docs/references/integrations-vectors-pg.md` |
| E12 | `ModelRouterEmbeddingModel` (exported from `@mastra/core/llm`) accepts `"openai/text-embedding-3-small"` (router metadata: 1536 dims, 8,191 max input tokens), `"google/gemini-embedding-001"` (router default 768 dims, 2,048 tokens; other sizes via `providerOptions.google.outputDimensionality`) and others; reads `OPENAI_API_KEY` / `GOOGLE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`; **its constructor throws when the key is missing**; exposes `doEmbed({ values, providerOptions })` with `maxEmbeddingsPerCall` 2048. The `ai` package (`embedMany`) is **not** installed | `node_modules/@mastra/core/dist/llm/index.d.ts:119`; `node_modules/@mastra/core/dist/llm-MMTo8KU3.js:9257-9286`, `:9377-9416`; `ls node_modules/ai` → absent |
| E13 | `@mastra/rag@2.8.0` (not installed) declares peer `@mastra/core >=1.83.0-0 <2.0.0-0` | `npm view @mastra/rag version peerDependencies` (2026-11-16) |
| E14 | Built-in server routes `/vector/:vectorName/{upsert,create-index,query,indexes}` operate on vectors registered in `new Mastra({ vectors })` | `node_modules/@mastra/server/dist/vector-Bz-glead.js:25-34`, `:120-266` |
| E15 | `SimpleAuth` is documented in core as intended "for development/testing"; it looks tokens up in a plain object, also accepts the `X-Playground-Access` header and a session cookie, and its default `authorizeUser` re-checks membership; a custom `authorizeUser` replaces that check | `node_modules/@mastra/core/dist/provider-BZHIYlnJ.js:383-411` |
| E15b | Mastra workers run in-process by default; in-process mode does not survive process crashes, and a crash during a workflow step can leave the run in `running` without automatic retry | `node_modules/@mastra/pg/dist/docs/references/docs-deployment-workers.md:60-77`, `:386-395` |
| E16 | Mastra Platform regions: `us` (`pdx` default, `iad`, `sfo`) and `eu` (`ams`); no South America region; environment-scoped Turso follows the environment (`pdx`→`sjc`, `iad`→`iad`) | [Mastra regions](https://mastra.ai/docs/mastra-platform/regions) (2026-11-16) |
| E17 | pgvector can index `vector` up to 2,000 dimensions and `halfvec` up to 4,000; exact search has perfect recall; filtering is applied after ANN scans; iterative index scans exist since 0.8 | [pgvector README](https://github.com/pgvector/pgvector) (2026-11-16) |
| E18 | Lei 9.610/1998 art. 8º, IV: texts of laws, decrees, regulations and other official acts are not protected by copyright | [planalto.gov.br/l9610](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm) (2026-11-16) |
| E19 | The LGPD page on Planalto is HTML that keeps revoked wording inline next to current wording; a converted copy is ~110 KB / ~17k words with ~80 distinct article headings. A direct `curl` from the author's network timed out after 30 s with 0 bytes, while a remote fetch succeeded | [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) (2026-11-16) |
| E20 | OpenAI pricing: `text-embedding-3-small` $0.02 / 1M tokens, `text-embedding-3-large` $0.13 / 1M tokens | [OpenAI pricing](https://platform.openai.com/docs/pricing) (2026-11-16) |

Additional provider evidence (prices, limits, data policies) is listed in D3.

---

## D1 — Use case and corpus

### Alternatives

| Criterion | A. LGPD + ANPD regulation (pt-BR) | B. Open-source technical docs / runbooks (Kubernetes pt-BR, Supabase, PostgreSQL) | C. Vendor support KBs / product manuals | D. Receita Federal "Perguntas e Respostas IRPF" |
| --- | --- | --- | --- | --- |
| Concrete pain | SMBs and DPOs (encarregados) need fast, cited answers to operational LGPD questions (legal basis, incident reporting, data-subject rights) without a lawyer for every question | Engineers searching docs; already well served by vendor search and generic assistants | Ticket deflection; real value only with private KBs | Seasonal taxpayer/accountant questions |
| Product/SaaS potential | High: "LGPD compliance copilot" that later ingests a customer's own policies | Medium; crowded | High, but needs private data | Medium, seasonal |
| Data availability | Public HTML (Planalto, DOU/in.gov.br); ANPD guides as digital PDFs | Markdown/MDX/SGML in git | Usually scraped HTML | One large digital PDF (745 Q&As in 2026 edition) |
| Rights | Law and resolution texts: no copyright (E18). ANPD guides: gov.br site license CC BY-ND 3.0 — quote verbatim with attribution; treat as phase 2 | CC BY 4.0 (Kubernetes website), Apache-2.0 (Supabase), PostgreSQL License | Usually proprietary or unclear | Interpretive material; gov.br CC BY-ND — status as "official act" unclear |
| Authentication / isolation | None for a public corpus; tenant isolation becomes necessary when customers upload policies | None | Mandatory in any real product | None |
| Extraction complexity | Medium: HTML with inline revoked text (`<strike>`), legacy charset, amendment annotations (E19) | Low (Markdown in git) | Medium–high (scraping) | Medium (PDF text layer, Q&A regex) |
| Periodic update | Low churn; diff by content hash per source | Excellent (git commits) | Varies | Yearly |
| Objective evaluation | Excellent: stable legal unit IDs (`lgpd:art7`, `lgpd:art5:inc2`) give deterministic ground truth | Good (file path + heading anchor) | Weak | Excellent (numbered Q&As) |
| GraphRAG potential | High: dense cross-references ("nos termos do art. 7º"), resolution → law links | Medium (hyperlinks) | Low | Medium (answers cite legislation) |
| Portuguese | Native | Partial (Kubernetes pt-BR only) | Varies | Native |

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

**Option A: an LGPD compliance assistant over Lei 13.709/2018 plus selected ANPD Board (CD/ANPD) resolutions.** It solves a verifiable business problem, the core texts are free of copyright, it is native pt-BR, small enough for cheap iteration, and its article hierarchy gives an objective ground truth for retrieval evaluation and a natural graph for later GraphRAG work.

- Option D is retained as a **secondary benchmark** candidate (after PDF support exists).
- Option B is the **fallback** if the owner prefers to avoid legal content.
- The product must state that answers are informational, cite the legal unit, and are not legal advice.

### Initial formats

| Format | MVP | Rationale |
| --- | --- | --- |
| HTML (Planalto, DOU/in.gov.br) | **Yes** | Primary publication format of the chosen corpus |
| Markdown / plain text | **Yes** | Needed for deterministic fixtures and tests; near-zero extraction cost |
| Digital PDF (ANPD guides, IRPF Q&A) | **No — phase 2** | Requires a PDF parser dependency and per-file "has text layer" checks; guides also carry CC BY-ND obligations |
| Scanned PDF / images (OCR) | **No** | No demonstrated need; out of scope |
| Private / uploaded documents | **No** | Requires tenant isolation and a real identity provider |

### Consequences and reversibility

- The pipeline contracts (source manifest, IDs, versions, chunk locators) are corpus-agnostic; only the extractor and the structure-aware chunker are LGPD-specific. Switching to option B replaces those two components. **Reversibility: high.**
- Source availability is an operational risk (E19): ingestion must tolerate slow or unreachable government hosts with bounded timeouts and retries.

---

## D2 — Document processing and chunking

### Pipeline

`Source manifest → Fetch → Validation → Extraction → Normalization → Chunking → Embeddings → Vector index → Publication`

Contracts, limits and error taxonomy are normative in the SPEC (§6–§8).

### Chunking alternatives

| Strategy | Strengths | Weaknesses | Fit for legal text |
| --- | --- | --- | --- |
| 1. Fixed size (characters/tokens) | Simple, predictable | Splits articles, paragraphs and items mid-sentence; chunks lose the legal unit needed for citation | Poor |
| 2. Recursive (paragraph → line → sentence separators) | Strong general baseline: Chroma's 2024 study found `RecursiveCharacterTextSplitter` at ~200–400 tokens consistently high-performing ([Chroma](https://research.trychroma.com/evaluating-chunking)) | Unaware of the Art./§/inciso hierarchy | **Baseline** for comparison |
| 3. Structure-aware (legal hierarchy) | Each chunk is a citable legal unit with a stable locator; supports article-level ground truth and graph edges | Uneven sizes (long articles such as Art. 5 and Art. 55-J have many incisos); needs a custom parser | **Primary** |

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

Structure-aware legal chunking, implemented in application code (no new dependency is required for the chunker itself):

1. Unit = one article (`Art. Nº`, including lettered forms such as `55-J`).
2. If the article fits within `maxTokens`, emit it whole.
3. Otherwise split at `§` and inciso boundaries, grouping consecutive siblings up to `maxTokens`; never split inside an inciso or alínea unless that single unit exceeds the hard cap, in which case fall back to sentence boundaries.
4. Prefix every chunk with a context header: `breadcrumb` (law › chapter › section › article) and, for split articles, the article **caput**. The header replaces overlap (`overlapTokens = 0`), because an inciso without its caput is not interpretable.

**Starting values and why:** `maxTokens = 512`, hard cap `1024`, overlap `0` for structure-aware chunks; baseline recursive at `400` tokens with `60` overlap (15%).

- NVIDIA's evaluation found 256–512 tokens best for factoid questions and 512–1024 for analytical ones, with 15% overlap best among 10/15/20% ([NVIDIA](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)); Chroma found ~200–400 tokens strong. Our queries are predominantly factoid ("which article says…").
- Most LGPD articles are short; 512 keeps the majority whole while bounding long enumerations.
- The hard cap stays far below the 8,191-token input limit of `text-embedding-3-small` (router metadata, E12) and below the 2,048-token limit of the fallback `gemini-embedding-001`.

These are **starting hypotheses**, not tuned values. The calibration grid (SPEC §13.4) compares strategy ∈ {recursive, structure-aware} × maxTokens ∈ {256, 512, 1024} × overlap ∈ {0, 15%} with the retrieval metrics of D6, at the legal-unit level so that different chunkings remain comparable.

Token counts must be measured with the embedding model's tokenizer (`cl100k_base` for OpenAI `text-embedding-3-*`). Portuguese tokens-per-word is **unverified** and must be measured, not assumed.

### Consequences and reversibility

- Chunker configuration is hashed into a `pipeline_profile_id`; changing it produces a new chunk set and never mutates existing chunks. **Reversibility: high** (re-chunk from stored normalized text without refetching).
- A tokenizer library (e.g. `js-tiktoken`) or `@mastra/rag` (which depends on it, E13) would be a new runtime dependency and needs approval in the chunking PR.

---

## D3 — Embeddings

### Alternatives (provider docs accessed 2026-11-16)

| Model | Price / 1M tokens | Dimensions | Max input tokens | Portuguese / multilingual | API data policy | Mastra 1.83 integration |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI `text-embedding-3-small` | $0.02 (E20) | 1536 default, reducible via `dimensions` | 8,191 (E12) | Multilingual (MTEB avg. 62.3% per OpenAI); pt-BR score unverified | Not used for training by default; up to 30-day abuse-monitoring retention ([your data](https://platform.openai.com/docs/guides/your-data)) | Native model router (E12) |
| OpenAI `text-embedding-3-large` | $0.13 (E20) | 3072, reducible | 8,192 | MTEB avg. 64.6% per OpenAI | Same | Native model router |
| Google `gemini-embedding-001` | $0.15 (batch $0.075) | 128–3072 (768/1536/3072 recommended) | **2,048** | 100+ languages per Google | Paid tier: not used to improve products; **free tier is** ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | Native model router (E12) |
| Google `gemini-embedding-2` | $0.20 (batch $0.10) text | 128–3072 | 8,192 | 100+ languages | Same as above | Listed in provider registry; router metadata incomplete — **unverified** |
| Cohere `embed-v5.0` (fast / pro) | $0.08 / $0.12 (Cohere blog, 2026-09-30) | 256–2048 | 128k | Portuguese explicitly listed | 30-day log retention; opt-out controls | Not in model router — would need a new package |
| Voyage `voyage-4` family | $0.02–$0.12; 200M free tokens/model | 256–2048 | 32k | Provider states multilingual | **Trains on API data by default**; opt-out may void free tokens ([ToS](https://www.voyageai.com/tos)) | Separate package `@mastra/voyageai` (not installed) |
| Mistral `mistral-embed` | $0.10 | Fixed (unverified) | 8k | Not stated | Opt-out on paid plans | OpenAI-compatible router path (not tested) |

Language-specific (pt-BR) retrieval quality is **unverified for every model**: no provider page consulted reports a Portuguese retrieval score. The decision must be confirmed by the project's own evaluation set (D6).

### Cost estimates

Verified inputs: list prices above. Assumptions (unverified): one-time indexing, provider tokenizer counts, no batch discount for OpenAI embeddings, queries of 30 tokens.

| Volume | Tokens | te3-small | te3-large | gemini-embedding-001 | gemini-embedding-2 | Cohere v5 fast |
| --- | --- | --- | --- | --- | --- | --- |
| MVP corpus (LGPD + ~5 resolutions), estimate | ~0.1M | $0.002 | $0.013 | $0.015 | $0.02 | $0.008 |
| 1k docs × 3k tokens | 3M | $0.06 | $0.39 | $0.45 | $0.60 | $0.24 |
| 10k docs × 3k tokens | 30M | $0.60 | $3.90 | $4.50 | $6.00 | $2.40 |
| 100k docs × 3k tokens | 300M | $6.00 | $39.00 | $45.00 | $60.00 | $24.00 |
| 10k queries / month × 30 tokens | 0.3M / month | $0.006 | $0.039 | $0.045 | $0.06 | $0.024 |

The MVP corpus estimate assumes ~17k words for the LGPD (E19) and ~1.5–2 tokens per Portuguese word (unverified), plus a similar volume for the resolutions. Even at 10× this estimate, embedding cost is negligible; the dominant risk is **uncontrolled retries and re-indexing**, not list price. Storage: `vector(1536)` costs 4·1536 + 8 ≈ 6.2 KB per row before index overhead (E17); 50k chunks ≈ 300 MB, which matters on a Supabase Free plan (plan **unverified**).

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

- **MVP: `openai/text-embedding-3-small`, 1536 dimensions, cosine.** Native Mastra router support without new packages, indexable as `vector` (≤ 2,000 dims), 8,191 max input tokens (E12), lowest verified price, no training on API data by default.
- **Fallback: `google/gemini-embedding-001` at 1536 dimensions (paid tier only).** Also native; the router default is 768 dimensions, so the space must pass `providerOptions.google.outputDimensionality = 1536` (E12). It still requires a new embedding space — vectors from different models are never mixed.
- **Bake-off before ratification:** `gemini-embedding-2` and `text-embedding-3-large@1536` on the D6 evaluation set.
- **Rejected for the MVP:** Voyage (training on by default), Cohere and Mistral (no native router support; extra dependency).

### Versioning rule

Each **embedding space** = (`provider`, `embeddingModel`, `dimension`, `metric`, `vectorType`, `embeddingVersion`) and maps to exactly one PgVector table, e.g. `chunks_te3s_1536_v1`. A change to any field creates a new space and a new table; vectors of different spaces are never written to the same table, and a query vector is only compared with vectors of its own space. Dimension compatibility is enforced three times: by the column type (`vector(1536)`), by an adapter assertion before `upsert`, and by the space registry used for query embedding. `embeddingVersion` is bumped when anything that changes the produced vectors changes (for example input preprocessing or the `dimensions` request parameter).

### Provider abstraction

The application depends on a narrow `EmbeddingProvider` interface (SPEC §9.2), not on a provider SDK. The MVP implementation wraps `ModelRouterEmbeddingModel.doEmbed`, which needs no new dependency (E12). The embedder MUST be constructed lazily on first use so the process can start without `OPENAI_API_KEY` (the constructor throws when the key is missing, E12).

### Reversibility

High for the provider (add a space, backfill, flip, retire). Costs: one full re-embedding of the corpus per switch, temporarily doubled vector storage.

---

## D4 — Supabase / pgvector data model

### Alternatives

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. PgVector-owned vector tables + app-owned catalog** | PgVector creates/upserts/queries `rag.chunks_<space>`; app tables in `rag` own sources, documents, versions, chunk sets, chunks, publication and jobs | Reuses verified Mastra APIs (E1–E10); DDL for vectors is not hand-maintained; clean separation: catalog is the source of truth, vectors are a rebuildable projection | PgVector calls cannot join or share a transaction with catalog SQL (E11); retrieval must validate candidates against the catalog |
| B. Fully custom tables with a `vector` column | Bypass PgVector | Real FKs and joins; single-transaction publication | Reimplements upsert/query/index tuning; loses Mastra vector tooling; more custom SQL to secure |
| C. Hybrid | PgVector writes; retrieval is custom SQL joining PgVector's table with the catalog | Exact, atomic visibility in one query | Couples to PgVector's internal columns, which have changed before (namespace migration, `pg.js:854-935`) |

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

**Option A now, with option C as a documented escape hatch** when the active-set filter no longer scales (trigger in SPEC §11.3).

Key design points (full logical model and proposed DDL in SPEC §10):

- Entities: `source`, `document`, `document_version`, `chunk_set`, `chunk`, `embedding_space`, `index_build`, `document_publication`, `ingestion_job`. A separate `embedding` table is **not** created: vectors live only in the PgVector table of their space; `index_build` tracks per-space progress. This avoids duplicating PgVector's responsibility.
- Deterministic, domain-separated SHA-256 identifiers; chunk IDs include the chunk set, so identical text in two documents or versions never collides (a content-only ID would overwrite another version's row through `ON CONFLICT DO UPDATE`, E4).
- Vector metadata carries IDs only (`document_id`, `version_id`, `chunk_set_id`, `chunk_id`, `source_id`, `legal_unit_ids`), not chunk text; text is read from `rag.chunk` during the mandatory catalog validation. `namespace` = `tenant_id`.
- **Vector index type: exact search first.** Every space is created with `indexConfig: { type: 'flat' }` because the PgVector default would build an IVFFlat index trained on an empty table (E2). HNSW (`m = 16`, `ef_construction = 64`, explicit) is introduced only when measured p95 latency exceeds the SLO or a space passes ~50k vectors — a hypothesis to benchmark, not a measured threshold. IVFFlat is not planned.
- Provisioning: vector tables are created by an operator-run step that calls `createIndex` with an elevated role; the runtime uses a non-superuser role and `disableInit: true` so it never executes DDL (E7).
- Migrations: forward-only SQL files with reviewed down scripts, applied by a human in a later PR. **No DDL is executed in PR #7.**

### Consequences and reversibility

- Vectors are derived data: recovery from loss = re-run ingestion from the catalog / sources into a fresh space table. **Reversibility: high** for the vector layer, medium for catalog schema (migration + down script).
- App tables must never contain both `vector_id text` and an `embedding` column, otherwise `listIndexes()` would treat them as vector indexes (`pg.js:1602-1636`).
- All app SQL must schema-qualify objects (`rag.*`) because PgVector changes `search_path` on pooled sessions (E5).

---

## D5 — Idempotency and updates

### Alternatives

| Strategy | Description | Partial visibility risk | Cost |
| --- | --- | --- | --- |
| In-place replacement | `upsert` with `deleteFilter` on the document | Low for one document (single transaction, E4) but the catalog cannot be updated in the same transaction; old content lost on failure | Low |
| **Versioned build + atomic publication** | Write vectors of a new chunk set while invisible; flip a per-document publication pointer in one catalog transaction; garbage-collect superseded vectors later | None if retrieval only accepts published chunk sets | Temporary duplicate vectors |
| Full reindex (blue/green space) | Rebuild an entire space and switch | None | Re-embed everything; reserved for model changes |

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

**Versioned build + atomic publication** for document changes, **blue/green space reindex** for embedding-model changes. Retrieval accepts a candidate only if its `chunk_set_id` is the currently published one for its document in the active space. Every PgVector call MUST pass `namespace` explicitly (E9b). The scenario-by-scenario contract (first run, same content, content reversion, update, deletion with in-flight cancellation, model switch, failure, concurrency, timeout) with concrete IDs is normative in SPEC §11.

Partial modifications re-chunk and re-embed the whole document: per-document cost at MVP scale is a fraction of a cent (D3), and chunk-level vector reuse adds complexity that is not yet justified. Reuse keyed by `(space_id, chunk content hash)` is a recorded future optimization. MVP execution is synchronous in the operator request (see cross-cutting "Job execution").

### Reversibility

High: publication keeps `previous_chunk_set_id`, so a bad publication can be rolled back by flipping the pointer while superseded vectors are still within the GC grace period.

---

## D6 — Retrieval and evaluation

### Recommendation — `PROPOSED / HUMAN_ADJUDICATION_PENDING`

- **Contract** (SPEC §12): query text → query embedding in the active space → PgVector `query` with `namespace = tenant`, metadata filter restricted to published chunk sets (and optional source/document filters), `topK` default 5 (max 20), over-fetch, then catalog validation and provenance assembly. Scores are cosine similarities (E9); no absolute relevance threshold is assumed until calibrated. Empty results are a first-class outcome.
- **Filters are not a security boundary**: allowed tenants/sources are derived server-side from the authenticated principal, never from the request body.
- **Metrics:** Recall@5 (primary), MRR, nDCG@10, Hit@K; Precision@K reported but not gated. Relevance is judged at the **legal-unit level** (`lgpd:art7`), with chunks deduplicated per unit before ranking, so different chunking configurations are comparable.
- **Evaluation set v1:** ~40 pt-BR queries (factoid, paraphrased/colloquial, multi-article, out-of-scope), human-reviewed gold labels, versioned in git, with a frozen holdout.
- **Retrieval vs. generation evaluation:** retrieval eval is deterministic and LLM-free and runs on every chunking/embedding change; generation eval (faithfulness, answer relevancy, context precision — Mastra scorers) belongs to the later agent PR.
- **Future:** hybrid search (PostgreSQL full-text with the `portuguese` configuration + reciprocal rank fusion) and reranking only if they improve the evaluation metrics. No performance figure is promised before a benchmark is executed.

### Alternatives considered

- **`createVectorQueryTool` from `@mastra/rag` as the retrieval API:** rejected for the MVP because it cannot enforce the published-chunk-set validation and expects chunk text in metadata; it remains usable later behind the validated retrieval service.
- **Chunk-ID ground truth:** rejected; it ties the evaluation to one chunking configuration.

---

## Cross-cutting decisions

| Topic | Recommendation |
| --- | --- |
| Turso vs Supabase | Turso keeps Mastra runtime state (memory, workflow snapshots). All RAG domain data — catalog, chunks, publication, ingestion jobs — lives in Supabase `rag`, because job and publication state must be transactionally consistent with the catalog. No RAG data is written to Turso except Mastra-native workflow run state if the ingestion is implemented as a Mastra workflow. |
| Vector registration | Do **not** register the PgVector instance in `new Mastra({ vectors })`, so the built-in `/vector/*` routes (E14) cannot bypass the catalog and publication model. |
| Authorization | MVP ingestion and retrieval routes are operator-only. `SimpleAuth` is documented as development/testing-oriented (E15); a future reader token requires a custom `authorizeUser` that re-checks token membership, default-deny path rules, and tests for prototype-key tokens. |
| Job execution | MVP ingestion runs **synchronously in the request** (or as a CLI), not as a Mastra background worker. In-process workers do not survive crashes (E15b); a durable worker/workflow model is a later option once PubSub and crash recovery are designed. |
| Residency / latency | Supabase is in São Paulo; Mastra Platform has no South American region (E16). Every DB round trip likely crosses continents. Operator must confirm the environment and Turso regions; `iad` is the closest offered region. |

## Human decisions required

| ID | Decision | Recommendation |
| --- | --- | --- |
| H1 | Corpus / use case | LGPD + selected CD/ANPD resolutions (D1-A) |
| H2 | Initial formats | HTML + Markdown/TXT; digital PDF in phase 2; no OCR |
| H3 | Embedding model and provider account | `openai/text-embedding-3-small` @1536; fallback `gemini-embedding-001` @1536 paid tier |
| H4 | Data model | Option A (PgVector vectors + app catalog), exact search first |
| H5 | Migration location, tooling and who applies them | `db/migrations/` up/down SQL applied manually by the owner |
| H6 | Least-privilege runtime role and DSN rotation before ingestion | Create `rag_app` (no superuser, no CREATE) |
| H7 | Access model for the MVP | Operator-only ingestion and retrieval; reader/demo access later |
| H8 | Region verification and latency acceptance | Verify environment + Turso regions; consider `iad` for new environments |
| H9 | New runtime dependencies in later PRs | HTML parser, tokenizer, possibly `zod` as a direct dependency |
| H10 | Supabase plan, backup/PITR, storage budget | Confirm before the persistence PR |
| H11 | Monthly embedding spend cap and evaluation budget | Provider-side hard limit + per-job token budget |
| H12 | Retention / purge windows | 7-day GC grace for superseded vectors; immediate purge on erasure |

## References (accessed 2026-11-16)

- Mastra docs: <https://mastra.ai/docs>, PgVector: <https://mastra.ai/integrations/vectors/pg>, regions: <https://mastra.ai/docs/mastra-platform/regions>, chunking reference: <https://mastra.ai/reference/rag/chunk>, vector query tool: <https://mastra.ai/reference/tools/vector-query-tool>
- Installed docs: `node_modules/@mastra/pg/dist/docs/`, `node_modules/@mastra/core/dist/docs/references/reference-rag-*.md`
- Supabase AI & Vectors: <https://supabase.com/docs/guides/ai>, vector indexes: <https://supabase.com/docs/guides/ai/vector-indexes>, backups: <https://supabase.com/docs/guides/platform/backups>
- pgvector: <https://github.com/pgvector/pgvector>
- OpenAI: <https://platform.openai.com/docs/pricing>, <https://platform.openai.com/docs/guides/embeddings>, <https://platform.openai.com/docs/guides/your-data>
- Google: <https://ai.google.dev/gemini-api/docs/pricing>, <https://ai.google.dev/gemini-api/docs/embeddings>
- Cohere: <https://cohere.com/blog/embed-5>, <https://cohere.com/enterprise-data-commitments>
- Voyage: <https://docs.voyageai.com/docs/pricing>, <https://www.voyageai.com/tos>
- Mistral: <https://docs.mistral.ai/inference/pricing>
- Chroma chunking study: <https://research.trychroma.com/evaluating-chunking>
- NVIDIA chunking study: <https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/>
- LGPD: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm>; Lei 9.610/1998: <https://www.planalto.gov.br/ccivil_03/leis/l9610.htm>; ANPD publications: <https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes>
