# SPEC: RAG document ingestion, indexing and retrieval

> **H10 owner decision (2026-11-17):** [No backups in the MVP](../decisions/RAG-H10-mvp-no-backup.md). This supersedes the historical H10 backup and restore obligations in this SPEC, without changing the remaining storage-capacity, migration, least-privilege, paid-provider and live-ingestion gates. PR #13 completed the synthetic local restoration CI; it is not a hosted backup. Historic Stage A language below does not represent the current H10 policy.

> **E1 decision update (2026-11-17):** [Owner ratified H4/H5/H6 directions and H10's conditional Free/backup policy](../decisions/RAG-E1-owner-ratification.md) **for local E1 development only**. The original Stage A table and candidate §10/§11 physical details below remain historical/unratified at the SQL level. The E1-P2-01/02/03 reconciliation still blocks freezing DDL. No remote migration, role/DSN change, hosted provisioning, paid calls or ingestion is authorized.

| Field | Value |
| --- | --- |
| Status | **PARTIAL STAGE_A RATIFICATION** — only H1/H2, H3 baseline, H9 dependency review and D4–D6 principles accepted; remaining gates pending |
| Date | 2026-11-16 |
| Baseline | `master` @ `15fe15cdffd51133be32c704eee0cc88f51b9d45` |
| Decisions | [`docs/architecture/ADR-rag-ingestion.md`](../architecture/ADR-rag-ingestion.md) (D1–D6, evidence IDs `E1`–`E20`) |
| Plan | [`tasks/rag-ingestion/plan.md`](../../tasks/rag-ingestion/plan.md), checklist [`tasks/rag-ingestion/todo.md`](../../tasks/rag-ingestion/todo.md) |

The key words MUST, MUST NOT, SHOULD and MAY are normative **once this specification is ratified**. Until then they describe the proposal. Values marked *(calibrate)* are starting hypotheses that the evaluation in §13 must confirm or replace. Values marked *(unverified)* still need evidence.

This document specifies behaviour. The [owner's Stage A decision](../decisions/RAG07-stage-a-ratification.md) authorizes only offline contract preparation after PR #7 approval/merge; it does **not** authorize dependencies, DDL, migrations, secrets, paid embeddings, live ingestion or deployment. Unratified sections remain proposals.

---

## 1. Problem and objectives

Small and medium Brazilian organizations and their data-protection officers (encarregados) repeatedly ask operational questions about the LGPD — "which legal basis applies?", "when must an incident be reported?", "what rights can a data subject exercise?" — and need answers that cite the exact legal provision. Generic chatbots answer without verifiable citations and mix revoked wording with current law.

Objectives:

1. **O1** — Ingest a public, legally reusable pt-BR regulatory corpus reproducibly, with provenance and versioning.
2. **O2** — Retrieve the governing legal units for a natural-language question with measurable quality (§13).
3. **O3** — Never expose a partially indexed or superseded document version as current.
4. **O4** — Bound cost, retries and blast radius; keep secrets and personal data out of logs.
5. **O5** — Remain demonstrable on Mastra Cloud and evolvable towards hybrid search, reranking, GraphRAG and customer-owned documents.

## 2. MVP use case

**LGPD compliance assistant (retrieval layer).** Given a pt-BR question, return the most relevant legal units of the LGPD and selected CD/ANPD resolutions, each with citation (law, article, paragraph/inciso), canonical URL, version and score. Answer generation by an agent is a later milestone.

### 2.1 Initial corpus *(H1)*

| `source_id` | Document | Format | Rights |
| --- | --- | --- | --- |
| `br-planalto-lei-13709-2018` | Lei 13.709/2018 (LGPD), consolidated text on Planalto | HTML | Official act — no copyright (ADR E18) |
| `br-anpd-res-*` | Up to ~5 CD/ANPD resolutions (exact list chosen and verified during the contracts PR against official sources, e.g. DOU / in.gov.br) | HTML | Official acts — no copyright |

ANPD guides (digital PDF, CC BY-ND), court/ANPD sanction decisions (may contain personal data) and the IRPF Q&A are **out of the MVP**.

### 2.2 Synthetic examples used throughout

All hashes below are real SHA-256 values computed over the **synthetic** inputs shown; they are illustrative fixtures, not production data.

```text
tenant_id      = public
source_id      = br-planalto-lei-13709-2018
canonical_uri  = https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
raw v1 (synthetic) = <html><body><p>SYNTHETIC FIXTURE v1 - Art. 7o O tratamento de dados pessoais somente podera ser realizado...</p></body></html>
raw v2 (synthetic) = same string with "v1" replaced by "v2"
space_id       = chunks_te3s_1536_v1
```

## 3. Scope

In scope (across the planned PRs): source manifest; fetch from allowlisted hosts; HTML/Markdown/TXT validation, extraction and normalization; structure-aware legal chunking with a recursive baseline; embeddings through a provider-neutral interface; Supabase catalog tables; PgVector space tables; atomic publication; garbage collection; operator-authenticated ingestion and retrieval routes; offline retrieval evaluation.

## 4. Non-goals (MVP)

- OCR, scanned documents, images, archives (ZIP etc.), digital PDF (phase 2).
- Public uploads, arbitrary URLs supplied by callers, private/customer documents, multi-tenant onboarding.
- RAG agent, answer generation, chat UI, reranking, hybrid search, GraphRAG (designed for, not built).
- Moving Mastra runtime state out of Turso, or RAG domain data into Turso.
- Registering PgVector with `new Mastra({ vectors })` (would expose built-in `/vector/*` routes, ADR E14).
- Approximate (HNSW/IVFFlat) vector indexes before the trigger in §10.6.
- Legal advice. The product cites; it does not advise.

## 5. Requirements

### 5.1 Functional

| ID | Requirement |
| --- | --- |
| FR-1 | Sources MUST be declared in a version-controlled manifest; ingestion requests reference `source_id`s, never raw URLs. |
| FR-2 | Each fetch MUST record `canonical_uri`, final URL, HTTP status, declared and sniffed media type, byte size, `content_sha256`, `fetched_at`. |
| FR-3 | Identical raw content for a document MUST NOT create a second version or a second set of embeddings. |
| FR-4 | Extraction MUST drop revoked wording (e.g. `<strike>`/`<s>`/`<del>` content on Planalto pages) and keep amendment annotations as metadata, not as legal text. |
| FR-5 | Chunking MUST be deterministic for a given normalized text and `pipeline_profile_id`. |
| FR-6 | Every chunk MUST carry a legal locator (`legal_unit_ids`), heading path, and character offsets into the stored normalized text. |
| FR-7 | Embeddings MUST be written only to the space table matching (`provider`, `model`, `dimension`, `metric`, `vectorType`, `embeddingVersion`). |
| FR-8 | A new version MUST become visible to retrieval only through an atomic publication step after its build is verified complete. |
| FR-9 | Retrieval MUST return only chunks of published chunk sets of non-deleted documents and sources in the active space. |
| FR-10 | Deleting a source MUST make its documents invisible immediately and purge vectors and chunk text within the retention window (§11.5). |
| FR-11 | Changing the embedding model MUST create a new space and reindex without overwriting vectors of the existing space. |
| FR-12 | An offline evaluation MUST compute Recall@K, MRR, nDCG@10 and Hit@K from a versioned gold set. |

### 5.2 Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 | Ingestion and retrieval routes MUST require authentication; MVP access is operator-only. |
| NFR-2 | Logs, errors and API responses MUST NOT contain DSNs, API keys, tokens, raw driver errors, chunk text or query text. |
| NFR-3 | TLS verification to Supabase MUST remain as implemented in PR #5; it MUST NOT be disabled. |
| NFR-4 | Paid embedding calls MUST be bounded per job (token budget) and per batch (max attempts). |
| NFR-5 | The runtime database role MUST NOT be a superuser and MUST NOT execute DDL (PgVector constructor option `disableInit: true`). |
| NFR-6 | Pure pipeline stages (validation → chunking) MUST be testable offline in CI without secrets or network. |
| NFR-7 | Retrieval latency SHOULD be measured (p50/p95) per environment before any SLO is promised. |
| NFR-8 | All RAG domain data MUST live in Supabase schema `rag`; Turso MUST hold only Mastra runtime state. |

## 6. Input contracts

### 6.1 Source manifest entry

```ts
type SourceManifestEntry = {
  sourceId: string;            // ^[a-z0-9][a-z0-9-]{2,79}$, immutable
  tenantId: 'public';          // MVP: single public tenant
  kind: 'http';                // MVP: allowlisted HTTPS fetch only
  canonicalUri: string;        // https://, host in allowlist, no credentials/fragment
  expectedMediaTypes: Array<'text/html' | 'text/markdown' | 'text/plain'>;
  extractor: 'planalto-html@1' | 'dou-html@1' | 'markdown@1' | 'plaintext@1';
  title: string;
  license: { kind: 'official-act-br' | 'cc-by-4.0' | 'other'; reference: string };
  language: 'pt-BR';
};
```

Host allowlist (MVP): `www.planalto.gov.br` (paths under `/ccivil_03/`) and `www.in.gov.br` (DOU acts under `/en/web/dou/-/`). The manifest uses exact, reviewed official references, not arbitrary caller URLs. Step B performs **offline syntactic validation only**; the URLs and authoritative source references are documented in [sources-mvp.md](../../docs/rag/sources-mvp.md). DOU returned HTTP 502 to the research client and Planalto may challenge automated access, so Step C MUST confirm real network reachability, redirects, charset and legal-text freshness before ingestion. `dou-html@1` is a proposed extractor identifier, NOT an implemented parser. Do not expand the allowlist to all of `www.gov.br` or `in.gov.br` without explicit security review.

### 6.2 Ingestion request (operator route, later PR)

```http
POST /internal/rag/ingestion-jobs
Authorization: Bearer <operator token>
Content-Type: application/json

{ "sourceIds": ["br-planalto-lei-13709-2018"], "spaceId": "chunks_te3s_1536_v1" }
```

Response `200` with the terminal outcome for each source:

```json
{ "results": [{ "sourceId": "…", "jobId": "…", "idempotencyKey": "…",
  "status": "succeeded" | "no_op" | "deduplicated" | "failed",
  "errorCode": null }] }
```

Unknown `sourceId` or `spaceId` → `400` with a fixed error code; no echo of input beyond the identifiers.

### 6.2.1 Execution model (MVP)

Ingestion runs **synchronously inside the authenticated operator request** (or an equivalent operator CLI that uses the same library). There is no background worker, no deferred `202`, and no Mastra workflow run for ingestion in the MVP. Reasons:

- Mastra in-process workers do not survive process crashes, and a crash during a workflow step can leave the run stuck in `running` without automatic retry (ADR E15b).
- The MVP corpus is a handful of documents; a synchronous run finishes in seconds to a few minutes.
- Durability comes from the catalog and PgVector state (resume-only-missing), not from a job queue.

A durable worker/workflow model (with PubSub, crash recovery and GC scheduling) is a later option and must be designed against the installed workers docs before adoption.

### 6.2.2 Idempotency after fetch

The idempotency key depends on `content_sha256`, so it is computed **after** fetching. A `rag.ingestion_job` row is inserted immediately after hashing, before any embedding call:

- insert succeeds → this request owns the job and continues;
- conflict on `idempotency_key` when the current publication for `(document_id, space_id)` already points at the chunk set that this content would produce → `deduplicated` / `no_op`, **no paid calls**, but still advance the publication freshness watermark under the publication lock (§11.2.1);
- conflict when the content hash matches an earlier version that is **not** currently published (content reverted) → see §11.4 "Content reversion"; the request continues as a republication of that version without re-embedding if vectors still exist;
- conflict with a job in `failed` and `attempt < MAX_JOB_ATTEMPTS` → reclaim (`attempt + 1`) and continue; at the cap the job stays `failed` until an operator explicitly resets it.

### 6.3 Fetched document (internal)

```ts
type FetchedDocument = {
  sourceId: string;
  documentId: string;          // §6.4
  canonicalUri: string;
  finalUri: string;            // after validated redirects
  httpStatus: 200;
  declaredMediaType: string;
  sniffedMediaType: 'text/html' | 'text/markdown' | 'text/plain';
  charset: string;             // detected; decoded with TextDecoder
  byteSize: number;            // ≤ MAX_RAW_BYTES
  contentSha256: string;       // over the raw bytes
  fetchedAt: string;           // ISO-8601 UTC
  bytes: Uint8Array;           // never logged, never persisted raw in MVP
};
```

### 6.4 Deterministic identifiers

All identifiers are lowercase hex SHA-256 over UTF-8 strings whose components are joined by `\n` and prefixed with a domain tag. Components MUST NOT contain `\n` (validated). Canonical JSON = keys sorted recursively, no insignificant whitespace.

| Identifier | Definition | Synthetic example |
| --- | --- | --- |
| `document_id` | `sha256("rag:document:v1\n" + tenant_id + "\n" + source_id + "\n" + canonical_uri)` | `0576788e68201edab1001d5dba38f3112b9997c0a0e8b8ba1dc5d583d1daf9d9` |
| `content_sha256` | `sha256(raw bytes)` | v1 `34bc8050…c40b01`, v2 `d4cb4c6d…118dc4` |
| `version_id` | `sha256("rag:version:v1\n" + document_id + "\n" + content_sha256)` | v1 `bde5cd017a33d52b0a7df051d5a482aa724bbc83fb11db74ff934befdab3cc4d`, v2 `72a30295fc37503c0ebb1cd837d7dffa26093abab7d752a91db6b67a4fd57ce3` |
| `pipeline_profile_id` | `sha256("rag:profile:v1\n" + canonicalJson(profile))` | `f6386d1544823c2fd720bc32bfe464b3db63f2fd977d83a113858f0253bfb6e4` for the profile below |
| `chunk_set_id` | `sha256("rag:chunkset:v1\n" + version_id + "\n" + pipeline_profile_id)` | v1 `1c06cde7975bca1af7bb6af4af9842e4a956741afcc526cb17bff97316866aed`, v2 `3e1c44dd7f5ff54453f001ac36680ac896599ad69eb4414139ba491cc117b9b0` |
| `chunk_id` (= PgVector `vector_id`) | `sha256("rag:chunk:v1\n" + chunk_set_id + "\n" + decimalOrdinal)` where `decimalOrdinal` is the base-10 representation of the zero-based ordinal with no padding (e.g. `"0"`, `"7"`, `"12"`) | v1 ordinal 7 `527045310342c432257b099e1e632e21e8d47d0d6a20d41591cae6b44983d4ed`; v2 ordinal 7 `9f15780fe2d77547071c457af7d16df0478aac0304eb9ee4bab765d610d5b035` |
| `idempotency_key` (ingest job) | `sha256("rag:job:v1\ningest\n" + document_id + "\n" + content_sha256 + "\n" + pipeline_profile_id + "\n" + space_id)` | v1 `fb7c0b88b541872fa9a19e33b7980cf217c1b13735af8934aa7f970b0a59a74c` |

Profile used for the examples:

```json
{"chunker":{"contextHeader":"breadcrumb+caput","maxTokens":512,"overlapTokens":0,"strategy":"legal-structure","tokenizer":"cl100k_base"},"extractor":"planalto-html@1","normalizer":"legal-text@1"}
```

Because `chunk_id` includes `chunk_set_id`, the same ordinal in v1 and v2 yields different IDs, and identical text in two documents never shares a vector row (PgVector upsert is `ON CONFLICT … DO UPDATE`, ADR E4).

**Step C offline rendered-identity refinement (RAG09 R1/R2, PROPOSED; no migration):** The §6.4 canonical `chunkSetId(versionId, profileId)` and its golden examples remain unchanged as the **base chunk-set identity**. The offline renderer must additionally bind the actual normalized output, because identical raw source bytes can be decoded differently under different HTTP charsets. Structure-aware rendering also binds external `source.title` metadata that appears in context headers; the reusable `pipeline_profile_id` and raw document-version identity are not changed:

- `base_chunk_set_id = chunkSetId(version_id, pipeline_profile_id)` (unchanged Step B function).
- `normalized_sha256 = sha256(normalized_text)` (asserted against the normalizer output).
- For structure-aware chunks: `header_metadata_sha256 = sha256(canonicalJson({sourceTitle: source.title}))`; for recursive chunks (without title headers), use `null`.
- `rendered_chunk_set_id = sha256("rag:chunkset-rendered:v2\n" + base_chunk_set_id + "\n" + normalized_sha256 + "\n" + (header_metadata_sha256 ?? "-"))`.
- `chunk_id = chunkId(rendered_chunk_set_id, ordinal)` for **both** strategies.

The newline characters between components are the same actual LF separators used by the Step B canonical ID functions and the rendering code's `join('\n')`. An independently computed synthetic golden assertion for v2 appears in `processing.test.ts`. This guards against both title-only source metadata changes and charset-dependent normalized-text changes without reusing vector IDs for different rendered chunk contents. The *future persistent ingestion idempotency key must also bind the effective rendered chunk-set ID*, otherwise a title/charset-only change can be incorrectly skipped. These changes do not modify Step B golden IDs or authorize a production migration. Before H4/H5 ratification, reconcile the persistent identity and idempotency specifications with this proposed v2 rendered formula. The offline `utf8-byte-proxy@1` budget remains experimental, not model token counts.

### 6.5 Required metadata

Catalog (authoritative): all fields in §10. Vector row metadata (PgVector `metadata` JSONB) is an **allowlist**:

```json
{
  "schema": 1,
  "source_id": "br-planalto-lei-13709-2018",
  "document_id": "0576788e…f9d9",
  "version_id": "bde5cd01…cc4d",
  "chunk_set_id": "1c06cde7…6aed",
  "chunk_id": "52704531…d4ed",
  "ordinal": 7,
  "legal_unit_ids": ["lgpd:art7"]
}
```

Chunk text, titles and URLs are **not** copied into vector metadata; they are read from the catalog during validation (§12.3). `namespace` = `tenant_id`.

## 7. Processing pipeline

```text
manifest ─► fetch ─► validate ─► extract ─► normalize ─► chunk ─► embed ─► upsert ─► verify ─► publish ─► GC
             │         │            │           │           │        │        │          │         │
             └─ job lease, attempt counters and status in rag.ingestion_job / rag.index_build ───────┘
```

| Stage | Input → Output | Key rules |
| --- | --- | --- |
| Fetch | manifest entry → `FetchedDocument` | HTTPS only; host allowlist (exact host + path-prefix where listed); `redirect: 'manual'`, ≤ 3 hops, each re-validated (HTTPS→HTTP forbidden); resolve DNS once, reject private/loopback/link-local/CGNAT/IPv6 ULA, and connect to that pinned address (DNS-rebinding defence — may need `undici` Agent or `node:https`; approve under H9 if a package is required); TLS verification never disabled; connect+total timeout; stream with byte cap |
| Validate | bytes → accepted bytes | Sniff media type from content, ignore mismatching declared type; reject archives, PDFs, binaries (MVP); decode charset (Planalto pages may use a legacy single-byte charset — detect from header/meta, decode with `TextDecoder`); after decoding, the result MUST be valid Unicode scalar values (replace or fail on unpaired surrogates); UTF-8 validity is checked only when the sniffed charset is UTF-8 |
| Extract | bytes → structured blocks | HTML parsed (never executed); drop `script`, `style`, `iframe`, navigation; drop revoked wording (`strike`/`s`/`del`); capture amendment annotations such as "(Redação dada pela Lei nº 13.853, de 2019)" as block metadata |
| Normalize | blocks → normalized text + structure tree | Unicode NFC; collapse whitespace inside blocks; keep block boundaries as `\n\n`; normalize ordinal markers (`Art. 7º`, `Art. 7o` → locator `art7`); store full normalized text and its `normalized_sha256` |
| Chunk | normalized text + tree → chunks | §8 |
| Embed | chunks → vectors | §9 |
| Upsert | vectors → space table | PgVector `upsert` with `ids = chunk_id`, **`namespace = tenant_id` (mandatory — ADR E9b)**, metadata allowlist; batches ≤ 128 chunks *(calibrate)* |
| Verify | build → verified | filter-only `query({ filter: { chunk_set_id }, topK: chunk_count + 1, namespace: tenant_id })` returns exactly the expected set of `chunk_id`s (ADR: filter-only query applies `LIMIT topK`, `pg.js:1011-1041`) |
| Publish | verified build → published | §11.2, single catalog transaction |
| GC | superseded/failed builds → purged | `deleteVectors({ filter, namespace: tenant_id })` after grace period; purge catalog rows per §11.5 |

### 7.1 Structure and hierarchy

The extractor builds a tree `Lei › Capítulo › Seção › Subseção › Art. › (caput | § | inciso | alínea)`. Each node has a locator built from the law code and the path, e.g.:

| Text | Locator |
| --- | --- |
| Art. 7º, caput | `lgpd:art7` |
| Art. 5º, II | `lgpd:art5:inc2` |
| Art. 18, § 3º | `lgpd:art18:par3` |
| Art. 55-J, XIII | `lgpd:art55-j:inc13` |
| Art. 1º, parágrafo único | `lgpd:art1:parunico` |

`legal_unit_ids` on a chunk lists the article locator plus any paragraph/inciso locators it contains; evaluation uses the article-level prefix by default (§13.2).

### 7.2 Location in the original

Each chunk stores `char_start`/`char_end` into the stored normalized text of its chunk set (exact substring of the body, excluding the context header), the heading path, and a citation URL `canonical_uri + "#art" + n` when the source provides anchors *(verify for Planalto during extraction PR)*. Offsets refer to normalized text because raw bytes are not persisted in the MVP; `content_sha256` and `fetched_at` tie the normalized text to the fetched source.

### 7.3 Limits

| Limit | Value | Justification |
| --- | --- | --- |
| `MAX_RAW_BYTES` | 5 MiB | LGPD converts to ~110 KB of text (ADR E19); 5 MiB leaves >10× headroom for HTML markup while bounding memory |
| `MAX_NORMALIZED_CHARS` | 1,000,000 | ~10× the LGPD; stored in the catalog |
| `MAX_CHUNKS_PER_VERSION` | 2,000 | LGPD expected in the low hundreds at 512 tokens *(calibrate)* |
| `HARD_MAX_CHUNK_TOKENS` | 1,024 | §8.2 |
| `MAX_TOKENS_PER_JOB` | 2,000,000 | ≈ $0.04 at te3-small; refuse if `chunk_set.total_tokens` exceeds this (so `MAX_CHUNKS_PER_VERSION × HARD_MAX_CHUNK_TOKENS` cannot silently exceed the budget — a chunk set that would exceed it fails at chunking with `CHUNK_BUDGET_EXCEEDED`) |
| `MAX_JOB_ATTEMPTS` | 4 | Single global attempt budget for the whole job (not per batch); the DDL `CHECK (attempt BETWEEN 0 AND 10)` leaves headroom for operator resets |
| Fetch timeout | 10 s connect, 60 s total | Government hosts can be slow or unreachable (ADR E19) |
| Parse timeout | 10 s per document | Guards against pathological HTML |
| Concurrency | ≤ 1 active ingest per `(document_id, space_id)` | E2 serializes claims and writes with a transaction lock and keeps a durable fence. Admission across distinct documents shares the H11 ledger (§11.6) |

### 7.4 Errors and retries

| Class | Examples | Behaviour |
| --- | --- | --- |
| Recoverable | network timeout, DNS failure, HTTP 429/5xx, provider 429/5xx, DB connection reset, lease expiry | Retry with exponential backoff + full jitter (base 1 s, cap 30 s), honour `Retry-After`, **max 4 attempts per operation**; resume from the last durable step |
| Permanent | HTTP 4xx (except 408/429), host not allowlisted, redirect to disallowed host, size/parse limit exceeded, unsupported media type, invalid charset, zero chunks, dimension mismatch, missing space, budget exceeded | Fail the job immediately with a fixed error code; no retry |
| Integrity | verification count mismatch, unexpected `chunk_id` in space table | Fail the build, do not publish, schedule GC, alert |

Errors are persisted as fixed codes (`FETCH_TIMEOUT`, `MEDIA_TYPE_REJECTED`, `EMBED_RATE_LIMITED`, `VERIFY_MISMATCH`, …) — never raw messages.

## 8. Chunking

### 8.1 Strategy *(D2, calibrate)*

1. One chunk per article when `tokens(header + article) ≤ maxTokens`.
2. Otherwise group consecutive children (`§`, incisos, alíneas) greedily up to `maxTokens`, repeating the context header in every chunk.
3. A single child larger than `maxTokens` is split at sentence boundaries; nothing may exceed `HARD_MAX_CHUNK_TOKENS`.
4. If `tokens(header)` alone exceeds `maxTokens`, truncate the repeated caput from the header first (keep the breadcrumb), then if still over the hard cap fail the chunk set with `CHUNK_HEADER_TOO_LARGE`.
5. Text outside articles (preamble, ementa, signatures) becomes chunks with locator `lgpd:preambulo` etc., or is dropped when it carries no normative content (signatures, publication notes).

Context header template (`contextHeader = breadcrumb+caput`):

```text
LGPD (Lei 13.709/2018) › Capítulo II › Seção I › Art. 7º
Art. 7º O tratamento de dados pessoais somente poderá ser realizado nas seguintes hipóteses:
---
IX - quando necessário para atender aos interesses legítimos do controlador ou de terceiro, …
X - para a proteção do crédito, …
```

`chunk.content` is the exact embedding input (header + body); `char_start`/`char_end` locate only the body.

### 8.2 Sizes

`maxTokens = 512`, `HARD_MAX_CHUNK_TOKENS = 1024`, `overlapTokens = 0` (the header provides context). Baseline: recursive, 400 tokens, 60 overlap. Justification and sources: ADR D2. Tokens are counted with the embedding model's tokenizer (`cl100k_base` for te3-small); if the tokenizer dependency is not approved, the chunker MUST use a conservative character proxy measured on the corpus and verified against the provider's reported token usage.

### 8.3 Example (synthetic)

| ordinal | chunk_id (prefix) | legal_unit_ids | tokens | body offsets |
| --- | --- | --- | --- | --- |
| 6 | … | `["lgpd:art6"]` | 498 | 10412–12280 |
| 7 | `52704531` | `["lgpd:art7"]` (caput + I–VIII) | 455 | 12281–13690 |
| 8 | … | `["lgpd:art7","lgpd:art7:inc9","lgpd:art7:inc10"]` | 230 | 13691–14102 |

(Offsets and token counts are illustrative.)

## 9. Embeddings

### 9.1 Spaces

```ts
type EmbeddingSpace = {
  spaceId: string;               // ^chunks_[a-z0-9_]{1,33}$ ; equals the PgVector indexName
  provider: 'openai' | 'google';
  embeddingModel: string;        // e.g. 'text-embedding-3-small'
  embeddingVersion: number;      // bump on any change that alters produced vectors
  dimension: number;             // ≤ 2000 for vectorType 'vector'
  metric: 'cosine';
  vectorType: 'vector';
  status: 'building' | 'active' | 'retiring' | 'retired';
};
```

MVP space *(H3)*: `chunks_te3s_1536_v1` = OpenAI `text-embedding-3-small`, 1536, cosine, `vector`, version 1.

### 9.2 Provider interface

```ts
interface EmbeddingProvider {
  readonly spaceId: string;
  readonly dimension: number;
  readonly maxInputsPerCall: number;   // ≤ provider limit; MVP 128 (calibrate)
  readonly maxInputTokens: number;     // 8191 for te3-small (router metadata, ADR E12)
  /** Provider-specific options forwarded to doEmbed (e.g. Google outputDimensionality). */
  readonly providerOptions?: Readonly<Record<string, unknown>>;
  embed(inputs: readonly string[], options: { signal: AbortSignal; purpose: 'document' | 'query' }):
    Promise<{ vectors: number[][]; usage: { tokens: number } }>;
}
```

The MVP implementation wraps `ModelRouterEmbeddingModel` for `'openai/text-embedding-3-small'` and its `doEmbed({ values, providerOptions })` (ADR E12), requiring `OPENAI_API_KEY` as a server-side secret on Mastra Cloud *(H3, not configured in this PR)*. Construction MUST be **lazy** (first embed call): the constructor throws when the key is missing, and the server MUST still start without it. The adapter MUST assert `vectors.length === inputs.length`, every vector length `=== dimension`, every value finite, before any upsert. The `purpose` parameter exists for providers with asymmetric task types; it is ignored by OpenAI. The Gemini fallback space MUST set `providerOptions.google.outputDimensionality = 1536` because the router default for `gemini-embedding-001` is 768 (ADR E12).

### 9.3 Cost controls

- Pre-compute total tokens of a chunk set; refuse to start if above `MAX_TOKENS_PER_JOB` or the remaining daily budget.
- Resume: before embedding, list `chunk_id`s already present for the chunk set with `query({ filter: { chunk_set_id }, topK: chunk_count + 1, namespace: tenant_id })` and embed only missing ones.
- Retries are budgeted at the **job** level (`MAX_JOB_ATTEMPTS = 4`), not per batch. A recoverable batch failure increments the job attempt; exceeding the budget fails the job. Worst-case paid embedding calls for one job ≈ `MAX_JOB_ATTEMPTS × ceil(chunks / batch)` when every attempt re-embeds from an empty space; with resume-only-missing the practical bound is closer to `ceil(chunks / batch) + MAX_JOB_ATTEMPTS`.
- A provider-side hard spend limit is required before enabling ingestion in production *(H11)*.

### 9.4 Namespace contract (mandatory)

Every call into PgVector (`upsert`, `query`, `deleteVectors`, `updateVector`, `deleteVector`) MUST pass `namespace: tenant_id` explicitly. Omitting it silently defaults to `"default"` and misses every row written under `public` (ADR E9b). The adapter wrapper MUST make `namespace` a required parameter so a forgotten argument is a type error.

### E1 checkpoint addendum — **PROPOSED, NOT RATIFIED** (2026-11-17)

The owner authorized a documentation-only adjudication checkpoint; see [RAG-E1 adjudication proposal](../decisions/RAG-E1-adjudication-proposal.md). H4/H5/H6/H10 remain **PENDING**. No DDL, runtime role, credential, hosted write, real embedding or deployment is authorized by this addendum.

- **E1-P2-01:** §10.2 `UNIQUE(version_id, pipeline_profile_id)` is incompatible with Step C's rendering identity refinement in §6.4. Proposed physical key: rendered chunk-set ID v2, with base ID, normalized hash, and rendering-header metadata/hash explicitly verifiable. Step B goldens and Step C rendered-hash formula remain unchanged.
- **E1-P2-02:** §6.2 and §6.4 `rag:job:v1` do not bind the effective rendered input. Proposed v2: `sha256("rag:job:v2\ningest\n" + document_id + "\n" + rendered_chunk_set_id + "\n" + space_id)`; it is inserted **after deterministic rendering and before any embedding/upsert**. Keep v1 golden as historical. The existing immediately-after-fetch row insertion becomes an **unratified proposal to revise**, not the implementation target.
- **E1-P2-03:** §11.4 raw-changed/normalized-equal no-op is inconsistent with rendered v2 identity (which includes base identity derived from raw version). Proposed conservative MVP: only the identical **rendered chunk-set ID** is an embedding no-op; otherwise create distinct version/render/provenance, and defer any cross-version vector reuse until separately specified.
- **H9/H11:** Step C UTF-8 byte proxy and Step D byte+8 reservation do not establish measured tokenizer counts or actual provider billing. Persisted token-count fields and paid ingestion remain gated pending calibration and spending approval.

Existing DDL §10.2, ingestion pseudocode §6.2 and scenario table §11.4 remain **historical proposals** and contain these known unresolved conflicts. Do **not** execute or treat them as frozen contracts. The E1 implementation must update them and add deterministic, concurrency/reversion, role/RLS and local Postgres tests after adjudication.

## 10. Logical data model (Supabase schema `rag`)

### 10.1 Entities and relations

```text
source 1─* document 1─* document_version 1─* chunk_set 1─* chunk
                                                  │
embedding_space 1─* index_build *─1 chunk_set ────┘
document 1─* document_publication *─1 embedding_space   (pointer → chunk_set / index_build)
ingestion_job *─1 document, *─1 embedding_space
rag.<space_id> (PgVector table) rows ≙ chunk × embedding_space   (no FK; projection)
```

Normalization rationale:

- `document_version` (raw content identity) and `chunk_set` (version × pipeline profile) are separate so that re-chunking with a new profile does not create a fake new version, and the same version can be re-chunked from stored normalized text.
- No physical `embedding` table: vectors live only in PgVector space tables; `index_build` tracks progress per (chunk set, space). This avoids a second copy of vectors.
- `document_publication` is a small pointer table, so publication is a single-row upsert rather than rewriting N vector rows.

### 10.2 Proposed DDL — **PROPOSED, NOT EXECUTED**

```sql
-- PROPOSED – NOT EXECUTED. Review in the persistence PR. All objects schema-qualified (PgVector changes search_path, ADR E5).

CREATE TABLE rag.embedding_space (
  space_id          text PRIMARY KEY CHECK (space_id ~ '^chunks_[a-z0-9_]{1,33}$'),
  provider          text NOT NULL,
  embedding_model   text NOT NULL,
  embedding_version int  NOT NULL CHECK (embedding_version >= 1),
  dimension         int  NOT NULL CHECK (dimension BETWEEN 1 AND 2000),
  metric            text NOT NULL DEFAULT 'cosine' CHECK (metric = 'cosine'),
  vector_type       text NOT NULL DEFAULT 'vector' CHECK (vector_type = 'vector'),
  status            text NOT NULL DEFAULT 'building'
                    CHECK (status IN ('building','active','retiring','retired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, embedding_model, embedding_version, dimension, metric, vector_type)
);
-- At most one active space for retrieval.
CREATE UNIQUE INDEX embedding_space_one_active ON rag.embedding_space ((true)) WHERE status = 'active';

CREATE TABLE rag.source (
  tenant_id     text NOT NULL DEFAULT 'public',
  source_id     text NOT NULL CHECK (source_id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  kind          text NOT NULL CHECK (kind IN ('http')),
  canonical_uri text NOT NULL,
  license_kind  text NOT NULL,
  license_ref   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, source_id)
);

CREATE TABLE rag.document (
  document_id   text PRIMARY KEY CHECK (document_id ~ '^[0-9a-f]{64}$'),
  tenant_id     text NOT NULL,
  source_id     text NOT NULL,
  canonical_uri text NOT NULL,
  title         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  FOREIGN KEY (tenant_id, source_id) REFERENCES rag.source (tenant_id, source_id),
  UNIQUE (tenant_id, source_id, canonical_uri)
);

CREATE TABLE rag.document_version (
  version_id          text PRIMARY KEY CHECK (version_id ~ '^[0-9a-f]{64}$'),
  document_id         text NOT NULL REFERENCES rag.document ON DELETE CASCADE,
  content_sha256      text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  final_uri           text NOT NULL,
  media_type          text NOT NULL,
  charset             text NOT NULL,
  byte_size           int  NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  fetched_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, content_sha256)
);

CREATE TABLE rag.chunk_set (
  chunk_set_id        text PRIMARY KEY CHECK (chunk_set_id ~ '^[0-9a-f]{64}$'),
  version_id          text NOT NULL REFERENCES rag.document_version ON DELETE CASCADE,
  document_id         text NOT NULL REFERENCES rag.document ON DELETE CASCADE,  -- denormalized for publication FK integrity
  pipeline_profile_id text NOT NULL CHECK (pipeline_profile_id ~ '^[0-9a-f]{64}$'),
  pipeline_profile    jsonb NOT NULL,
  normalized_text     text NOT NULL CHECK (length(normalized_text) <= 1000000),
  normalized_sha256   text NOT NULL,
  chunk_count         int  NOT NULL CHECK (chunk_count BETWEEN 1 AND 2000),
  total_tokens        int  NOT NULL CHECK (total_tokens >= 0 AND total_tokens <= 2000000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, pipeline_profile_id),
  UNIQUE (document_id, chunk_set_id)   -- FK target for document_publication.document_id + chunk_set_id
);

CREATE TABLE rag.chunk (
  chunk_id        text PRIMARY KEY CHECK (chunk_id ~ '^[0-9a-f]{64}$'),
  chunk_set_id    text NOT NULL REFERENCES rag.chunk_set ON DELETE CASCADE,
  ordinal         int  NOT NULL CHECK (ordinal >= 0),
  content         text NOT NULL,                       -- exact embedding input (header + body)
  content_sha256  text NOT NULL,
  token_count     int  NOT NULL CHECK (token_count BETWEEN 1 AND 1024),
  char_start      int  NOT NULL CHECK (char_start >= 0),
  char_end        int  NOT NULL CHECK (char_end > char_start),
  heading_path    text[] NOT NULL,
  legal_unit_ids  text[] NOT NULL CHECK (cardinality(legal_unit_ids) >= 1),
  UNIQUE (chunk_set_id, ordinal)
);

CREATE TABLE rag.index_build (
  chunk_set_id  text NOT NULL REFERENCES rag.chunk_set ON DELETE CASCADE,
  space_id      text NOT NULL REFERENCES rag.embedding_space,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','embedding','verified','published','superseded','failed','purged')),
  embedded_count int NOT NULL DEFAULT 0,
  tokens_billed  int NOT NULL DEFAULT 0,
  error_code    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_set_id, space_id)
);

CREATE TABLE rag.document_publication (
  document_id            text NOT NULL REFERENCES rag.document ON DELETE CASCADE,
  space_id               text NOT NULL REFERENCES rag.embedding_space,
  chunk_set_id           text NOT NULL,
  previous_chunk_set_id  text,
  version_fetched_at     timestamptz NOT NULL,
  published_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, space_id),
  FOREIGN KEY (chunk_set_id, space_id) REFERENCES rag.index_build (chunk_set_id, space_id),
  FOREIGN KEY (document_id, chunk_set_id) REFERENCES rag.chunk_set (document_id, chunk_set_id),
  FOREIGN KEY (previous_chunk_set_id, space_id) REFERENCES rag.index_build (chunk_set_id, space_id)
);

CREATE TABLE rag.ingestion_job (
  job_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  kind             text NOT NULL CHECK (kind IN ('ingest','reindex','delete','gc')),
  tenant_id        text NOT NULL,
  source_id        text,                              -- NULL for gc sweeps
  document_id      text REFERENCES rag.document,
  space_id         text REFERENCES rag.embedding_space, -- NULL for delete across all spaces
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','succeeded','no_op','failed','cancelled')),
  stage            text,
  attempt          int  NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 10),
  lease_owner      text,
  lease_expires_at timestamptz,
  error_code       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL)),
  CHECK (kind <> 'ingest' OR (source_id IS NOT NULL AND space_id IS NOT NULL AND document_id IS NOT NULL)),
  UNIQUE (idempotency_key)
);
-- Idempotency keys for non-ingest kinds:
--   reindex: sha256("rag:job:v1\nreindex\n" + document_id + "\n" + chunk_set_id + "\n" + space_id)
--   delete:  sha256("rag:job:v1\ndelete\n" + tenant_id + "\n" + coalesce(source_id,'') + "\n" + coalesce(document_id,'') + "\n" + coalesce(space_id,''))
--   gc:      sha256("rag:job:v1\ngc\n" + space_id + "\n" + chunk_set_id)

CREATE INDEX document_live_idx        ON rag.document (tenant_id, source_id) WHERE deleted_at IS NULL;
CREATE INDEX chunk_set_version_idx    ON rag.chunk_set (version_id);
CREATE INDEX index_build_status_idx   ON rag.index_build (space_id, status);
CREATE INDEX publication_space_idx    ON rag.document_publication (space_id, chunk_set_id);
CREATE INDEX ingestion_job_claim_idx  ON rag.ingestion_job (status, lease_expires_at)
  WHERE status IN ('queued','running');
```

Design notes:

- `text` + `CHECK` instead of enum types, to keep forward-only migrations simple.
- `version_fetched_at` on the publication supports the "newer content wins" rule (§11.2).
- The partial unique index on `embedding_space` guarantees a single active retrieval space.
- No app table has both `vector_id` and `embedding` columns (ADR D4 consequence).
- RLS: enable on every table with explicit policies for the runtime role, as defense in depth; the `anon`/`authenticated` roles keep no `USAGE` on `rag` (existing probe).

### 10.3 PgVector space tables

Created by an operator provisioning step (not by the runtime), using the public API:

```ts
// PROPOSED – run by an operator with an elevated role, after migration review.
await vector.createIndex({
  indexName: 'chunks_te3s_1536_v1',
  dimension: 1536,
  metric: 'cosine',
  indexConfig: { type: 'flat' },     // NOT the IVFFlat default (ADR E2)
});
```

This yields `rag.chunks_te3s_1536_v1 (id serial, vector_id text, embedding extensions.vector(1536), metadata jsonb, namespace varchar)` with a unique index on `(namespace, vector_id)` (ADR E1). The runtime constructs PgVector with the constructor option `disableInit: true` (ADR E7), so it never executes DDL. Prefer the constructor option over the process-wide `MASTRA_DISABLE_STORAGE_INIT` environment variable, which can also affect other Mastra storage code.

### 10.4 Roles and privileges *(H6)* — PROPOSED

- `rag_app` (runtime): `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`; `USAGE` on `rag` and `extensions`; `SELECT, INSERT, UPDATE, DELETE` on catalog and space tables; `USAGE` on space-table sequences; no `CREATE` on `rag`.
- Migration/provisioning: performed by the project owner with the existing elevated role.
- The Supabase session pooler username format `rag_app.<project_ref>` is compatible with the existing DSN validation in `supabase-config.ts` *(verify when the role exists)*.
- The readiness probe SHOULD additionally assert `NOT rolsuper` for the connected role once `rag_app` is in place.

### 10.5 Migrations and rollback *(H5)*

- Location: `db/migrations/NNNN_<name>.up.sql` and `NNNN_<name>.down.sql` (no Supabase CLI configuration exists in the repo today).
- Forward-only in production; down scripts are reviewed but run only by the owner during an incident.
- Applied manually by the owner after review, in a transaction, with a pre-migration logical dump of `rag`.
- Rollback of the vector layer = drop the space table (`deleteIndex`) and rebuild from the catalog; rollback of catalog changes = down script + restore from dump if needed.

### 10.6 Vector index policy

| Phase | Index | Trigger |
| --- | --- | --- |
| MVP | None (`flat`, exact scan, perfect recall — ADR E17) | Default |
| Growth | HNSW, `m = 16`, `ef_construction = 64` set explicitly (PgVector defaults are 8/32, ADR E3), built with `CREATE INDEX CONCURRENTLY "<space>_vector_idx"` in a reviewed migration | Measured p95 retrieval latency above the agreed SLO, **or** > ~50k vectors in the active space *(hypothesis to benchmark)* |
| Not planned | IVFFlat | Requires training on existing data and offers no benefit at this scale |

Before adopting HNSW, recall MUST be compared with exact search on the evaluation set.

## 11. Idempotency, updates and publication

### 11.1 Build lifecycle

```text
index_build: pending → embedding → verified → published → superseded → purged
                          └──────────► failed ──────────────────────────► purged
```

### 11.2 Publication transaction — PROPOSED

```sql
-- PROPOSED – NOT EXECUTED
-- Parameters: $1 document_id, $2 space_id, $3 chunk_set_id, $4 version_fetched_at, $5 tenant_id
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rag:doc:' || $1, 0));

SELECT 1 FROM rag.document d
  JOIN rag.source s USING (tenant_id, source_id)
 WHERE d.document_id = $1 AND d.deleted_at IS NULL AND s.deleted_at IS NULL
 FOR SHARE OF d, s;
-- Abort with DOCUMENT_DELETED if no row.

SELECT 1 FROM rag.index_build
 WHERE chunk_set_id = $3 AND space_id = $2 AND status = 'verified'
 FOR UPDATE;
-- Abort with BUILD_NOT_VERIFIED if no row.

-- Newer content wins. Equal fetched_at: prefer the lexicographically greater chunk_set_id
-- (deterministic, rare). Abort with STALE_VERSION (mark this build 'superseded') when the
-- current publication is strictly newer, or equal-and-greater.
SELECT version_fetched_at, chunk_set_id
  INTO STRICT /* optional */ current_fetched_at, current_chunk_set_id
  FROM rag.document_publication
 WHERE document_id = $1 AND space_id = $2;
-- If found and (current_fetched_at > $4
--    OR (current_fetched_at = $4 AND current_chunk_set_id > $3)):
--   UPDATE rag.index_build SET status = 'superseded' …; COMMIT; return STALE_VERSION.

INSERT INTO rag.document_publication
  (document_id, space_id, chunk_set_id, previous_chunk_set_id, version_fetched_at)
VALUES ($1, $2, $3, current_chunk_set_id, $4)
ON CONFLICT (document_id, space_id) DO UPDATE
  SET previous_chunk_set_id = rag.document_publication.chunk_set_id,
      chunk_set_id = EXCLUDED.chunk_set_id,
      version_fetched_at = EXCLUDED.version_fetched_at,
      published_at = now()
  WHERE rag.document_publication.chunk_set_id IS DISTINCT FROM EXCLUDED.chunk_set_id;

UPDATE rag.index_build SET status = 'published', updated_at = now()
 WHERE chunk_set_id = $3 AND space_id = $2;

UPDATE rag.index_build SET status = 'superseded', updated_at = now()
 WHERE space_id = $2 AND status = 'published' AND chunk_set_id <> $3
   AND chunk_set_id IN (
     SELECT cs.chunk_set_id FROM rag.chunk_set cs
     JOIN rag.document_version dv USING (version_id) WHERE dv.document_id = $1);
COMMIT;
```

`hashtextextended` is a built-in Postgres hashing function (present since PG11; lightly documented). A hash collision only serializes two unrelated documents; it does not corrupt state. Transaction-level advisory locks are released at commit/rollback and are safe with pooled connections; session-level locks MUST NOT be used.

### 11.2.1 Freshness watermark on same-content observations

When a fetch observes content whose chunk set is **already** the published pointer for `(document_id, space_id)`, the request is still a no-op for embeddings, but it MUST take the same advisory lock and update `document_publication.version_fetched_at` to this observation's `fetched_at` whenever the new value is strictly greater. Without that advance, a slow concurrent build of older content (fetched earlier, finishing later) can pass the newer-wins check against a stale watermark and overwrite a fresher observation of the current content.

The required same-pointer branch must be explicit in the eventual transaction: **under the per-document publication advisory lock**, if the observed `$3` equals the current publication pointer, run `UPDATE rag.document_publication SET version_fetched_at = GREATEST(version_fetched_at, $4) WHERE document_id = $1 AND space_id = $2 AND chunk_set_id = $3`; do not change `chunk_set_id`, `previous_chunk_set_id`, `published_at` or bill another embedding call. This branch is distinct from the pointer-changing `ON CONFLICT ... WHERE ... IS DISTINCT FROM` shown above. Re-check deletion status before the update. A later-finishing, older observation must fail the freshness check using the advanced watermark. The query is **illustrative, not migration-ready SQL**.

Pointer rollback (operator restoring `previous_chunk_set_id`) MUST run through the same transaction shape: take the lock, set the pointer, set the restored build back to `published` and the displaced one to `superseded`. Restoring a purged chunk set is rejected (`previous_chunk_set_id` MUST reference a build that still has vectors).

### 11.3 Visibility rule

Retrieval accepts a vector row only if its `chunk_set_id` equals `document_publication.chunk_set_id` for its document in the active space, and neither document nor source is deleted. MVP enforcement (§12.3): metadata filter `chunk_set_id $in <published set for the requested scope>` **plus** catalog validation of every returned candidate. The `$in` list is bounded by the number of published documents (tens in the MVP). **Escape-hatch trigger:** when the list exceeds 500 entries or the filter dominates query latency, switch to option C (custom SQL joining the space table with `document_publication`).

### 11.4 Scenario contract

| Scenario | Behaviour | Example (synthetic IDs) |
| --- | --- | --- |
| First processing | Create source/document/version/chunk set/chunks; build `pending → embedding → verified`; publish | v1 → `chunk_set 1c06cde7…`, publication points to it; job `fb7c0b88…` `succeeded` |
| Same content again (already published) | Fetch and hash repeat (cheap); same `idempotency_key`; publication already points at the matching chunk set → `deduplicated` / `no_op`; **no embedding call**; advance `version_fetched_at` under the publication lock (§11.2.1) | Re-run with v1 bytes while v1 is published → key `fb7c0b88…`, 0 tokens billed, watermark moves forward |
| Content reversion (v1 → v2 → v1 bytes) | Same `content_sha256` / `version_id` as the earlier v1; publication currently points at v2. Request is **not** treated as a no-op: if the v1 chunk set still has a non-purged build in this space, republish it (no re-embed); otherwise rebuild. `fetched_at` of this request becomes the new `version_fetched_at`, so newer-wins accepts the reversion | After v2 is live, re-fetch of v1 bytes → publication flips back to `chunk_set 1c06cde7…` |
| Same content, new pipeline profile | Same `version_id`, new `chunk_set_id`, new build, publish replaces pointer | Profile with `maxTokens: 256` → new chunk set, new chunk IDs |
| Document updated | New `content_sha256` → new version, chunk set and build; old chunk set remains visible until publication flips | v2 → `chunk_set 3e1c44dd…`; until publish, queries see v1 only |
| Partial modification | Treated as an update: whole document re-chunked and re-embedded (cost per document < $0.001 at MVP size) | Only Art. 48 changed → all chunks of v2 embedded |
| Raw change, same normalized text | New version recorded; if `normalized_sha256` and profile equal the published chunk set's, the job ends `no_op` without embedding or publication | Page footer timestamp changed |
| Source deleted | See §11.4.1 | Source `br-planalto-lei-13709-2018` removed from manifest and deleted by operator |
| Embedding model change | See §11.4.2 | `chunks_te3s_1536_v1` → `chunks_gem001_1536_v1` |
| Failure mid-processing | Build stays `embedding`/`failed`; partial vectors exist but are invisible (§11.3); the next operator request with `attempt < MAX_JOB_ATTEMPTS` resumes by embedding only missing chunk IDs | Crash after 3 of 5 batches → retry embeds batches 4–5 |
| Concurrent runs, same content (already published) | Both may fetch; second insert conflicts; publication check → `deduplicated` | Two operator requests within 1 s |
| Concurrent runs, different content | Both builds may complete; publication serialized by advisory lock; newer `fetched_at` wins; loser build → `superseded` | v1 and v2 race |
| Retry after timeout | Embedding/upsert of a batch is idempotent (deterministic `vector_id`, `ON CONFLICT DO UPDATE`); the operator re-invokes the request; `attempt` increments toward `MAX_JOB_ATTEMPTS` | Embedding call timed out after provider accepted it → re-sent once, same vectors overwrite |

### 11.4.1 Source / document deletion

1. Take `pg_advisory_xact_lock` for every affected `document_id`.
2. In one transaction: set `source.deleted_at` / `document.deleted_at`, delete `document_publication` rows for those documents (immediate invisibility), set in-flight `ingestion_job` rows to `cancelled`.
3. For each affected `(document_id, space_id)`, call `deleteVectors({ indexName: space_id, filter: { document_id }, namespace: tenant_id })` (ADR E9b).
4. Purge chunk text per §11.5.
5. Final sweep: after any concurrent ingest that held a lease has exited (its next batch MUST re-check `deleted_at` under `SELECT … FOR SHARE` and abort with `DOCUMENT_DELETED`), repeat step 3 once.

Publish (§11.2) already `FOR SHARE`s the document and source rows, so a delete concurrent with publish either waits for the lock or causes publish to abort.

### 11.4.2 Embedding-model switch (blue/green space)

1. Create the new space (`status = 'building'`). Retrieval continues to use the unique `active` space.
2. While the new space is `building`, every successful ingest/publish for a document MUST also ensure a publication exists in the new space for the **same** `chunk_set_id` (or re-embed that chunk set into the new space). Updates published only in the old space MUST NOT leave the new space stale.
3. Run `reindex` over every document that has a publication in the active space, targeting the new space (no refetch; reuse `rag.chunk`).
4. **Cutover fence (required):** acquire a process-wide cutover advisory lock (`hashtextextended('rag:space-cutover', 0)`) that ingestion also takes (briefly) before any publish while a space is `building`. Under that lock: (a) refuse new publishes that would change the old space without mirroring into the new one; (b) re-check parity — for every document published in the old space, the new space has a publication with the **same** `chunk_set_id`; (c) in **one** transaction, run the two ordered status updates (the partial unique index on `status = 'active'` is not deferrable): `UPDATE … SET status = 'retiring' WHERE space_id = old AND status = 'active'`; then `UPDATE … SET status = 'active' WHERE space_id = new AND status = 'building'`; abort the whole transaction if either row count ≠ 1 so there is never a committed interval with zero active spaces.
5. After the GC grace period, `deleteIndex` the retiring space and set it to `retired`. Retrieval during `retiring` still serves the old space until step 4 commits; after the flip, only the new `active` space is queried.

### 11.5 Garbage collection and retention *(H12 candidate)*

- Published documents remain in the corpus until explicit deletion. Superseded and failed builds have a seven-day grace period. The manual GC defaults to dry-run. Applying GC acquires the publication document lock, rechecks current and recent previous pointers, active jobs and unreconciled attempts, and verifies that the selected projection is gone before marking it purged.
- Every projection for a chunk set must be purged before deleting its chunk rows and clearing its normalized text and rendered header. Version hashes, source/document identifiers, set identities and the financial ledger remain as provenance. An unsupported projection space leaves purge pending.
- Explicit document or source deletion commits a tombstone, removes publication pointers and fences active claims before attempting purge without a grace period. A purge failure leaves a durable pending marker. Replaying the operator action confirms or retries the purge. Source tombstones also prevent creation of new documents for that source.
- Snapshots and exports remain in private custody outside PostgreSQL. See the [operator runbook](../runbooks/H9C-operator-private-quarantine.md#6-e2-mvp-retention-and-erasure-candidate) for manual archive handling and future treatment of Turso threads, traces and provider data. External backup remains out of scope under H10. This experimental retention policy requires owner ratification.

### 11.6 E2-MVP local execution

The local CLI admits the descriptor-validated frozen corpus and runs S512 through the internal ingestion service and a deterministic fake provider. It uses the E1-provisioned cosine PgVector table and namespace `public`. The server adds no ingestion or erasure endpoint. Existing E1 schema and compatibility paths remain applicable.

The measured preflight counts the entire rendered input, including breadcrumbs and separators, using the installed `cl100k_base/js-tiktoken@1.0.21`. The server re-counts each immutable input and hashes the ordered ID/text batch before reservation. S512 caps inputs at 512 measured tokens within the global 1,024-token cap and the provider's limit. The catalog stores actual UTF-8 bytes and measured tokens separately. The widened entry envelope is 98,304 bytes for measured S512 rows, derived from 32,768 UTF-16 code units at at most three UTF-8 bytes per well-formed code unit. The existing two-million per-document byte and global job token ceilings remain in force. The historical Step D envelope retains its UTF-8-bytes-plus-eight unit.

PostgreSQL reserves the initial missing batches plus three times the largest batch under one billing-scope transaction lock. The active reservation holds the maximum of the admitted envelope and committed exposure. A start is committed before dispatch. The ledger keeps actual provider-reported usage separately from measured input and unknown exposure. Known transient failures can retry with persisted backoff and `Retry-After`, up to three retries across the job. Crashes at an uncertain attempt prevent automatic dispatch. Confirmed overage preserves the reported value and blocks new dispatches within the budget scope until operator reconciliation. On closure, only unspent margin is released. A reservation crossing the UTC date boundary cannot start another call. The application-side controls do not prove provider billing or exactly-once charging.

The source/document transaction locks and claim fence are checked at write boundaries. No transaction stays open during provider I/O. E2 writes to the existing PgVector table on the same transaction client as the fenced catalog update. The pinned library's public upsert acquires a separate connection, so E2 uses the provisioned table, vector type and deterministic uniqueness contract directly for these writes. A complete build requires the exact expected chunk and vector IDs, dimensions, namespace, metadata and successful ledger batches. Publication re-runs the rendered-set comparison under the lock and commits the pointer, job and build status together.

For an unexpired job, wait for the owning process. For an expired job with committed vectors, replay the same input and inspect the durable outcomes. An unresolved start, terminal failure, or expired UTC reservation needs operator inspection. The disposable CLI's `cancel-expired-job <job-id>` fences an expired job and closes its reservation while retaining attempted exposure. With authoritative evidence of a settled attempt, `reconcile-attempt <attempt-id> <confirmed-tokens>` records the confirmed charge as database owner. Do not use reconciliation to guess a zero charge. Cancelled, terminal and purged identities are held for operator adjudication. The MVP does not readmit the same terminal job or allocate a fresh reservation generation automatically. Claims revalidate dispatch immediately before I/O. A provider request already in flight can still finish after cancellation, in which case only ledger accounting may proceed.

The [canonical E2 migration](../../supabase/migrations/20261127135647_rag_durable_ingestion.sql) follows E1 catalog, flat space and namespace policies. A future authorized hosted operation must confirm the target, compare applied history and candidate hash using the pinned Supabase CLI, check for duplicate active claims and verify the vector table, role and policy prerequisites. Apply the reviewed migration through the H5 operator workflow and verify RLS, namespace DELETE, protected readiness and the empty ledger before enabling any ingestion. The [local down script](../../db/local/0005_e2_durable_ingestion.down.sql) refuses rollback once E2 evidence or payload changes exist. H11-OPS must separately verify direct OpenAI billing, effective endpoint, scoped key custody and provider-limit semantics before the first bounded paid smoke.

## 12. Retrieval contract

### 12.1 Request (operator route in the retrieval PR; tool for the agent later)

```ts
type RetrievalRequest = {
  query: string;               // 1..1000 chars, trimmed
  topK?: number;               // default 5, max 20
  sourceIds?: string[];        // optional narrowing; intersected with what the caller may read
  documentIds?: string[];      // optional narrowing
  minScore?: number;           // default none; set only after calibration
};
```

`tenant_id` is never accepted from the request; it is derived from the authenticated principal (MVP: `public`).

### 12.2 Response

```ts
type RetrievalResponse = {
  spaceId: string;             // e.g. chunks_te3s_1536_v1
  results: Array<{
    chunkId: string;
    score: number;             // cosine similarity = 1 − cosine distance, in [−1, 1]
    rank: number;
    text: string;              // chunk body (header stripped) from rag.chunk
    citation: {
      sourceId: string; documentId: string; versionId: string;
      title: string; legalUnitIds: string[]; headingPath: string[];
      url: string; fetchedAt: string;
    };
  }>;
  status: 'ok' | 'empty';
};
```

### 12.3 Algorithm

1. Load the active space; embed the query with that space's provider (`purpose: 'query'`), assert dimension.
2. Resolve the allowed published `chunk_set_id`s for the caller's scope (and optional `sourceIds`/`documentIds`).
3. `vector.query({ indexName: spaceId, queryVector, topK: min(2 × topK, 40), namespace: tenantId, filter: { chunk_set_id: { $in: allowed } } })` — `namespace` is mandatory (ADR E9b).
4. Validate candidates against the catalog in one SQL query (chunk ∈ published set, document/source not deleted), load text and citation fields.
5. Drop invalid candidates (count them in metrics), keep the first `topK`, assign ranks. If more than half of the candidates were invalidated (publication flipped during the query), re-resolve the allowed set and re-query **once**.
6. If none remain → `status: 'empty'`, `results: []` — the caller (later, the agent) must answer "not found in the indexed corpus" rather than guessing.

Scores are comparable only within one space. No absolute threshold is meaningful before calibration; `minScore` stays unset in the MVP.

### 12.4 Future extensions

- **Hybrid search:** a `tsvector` column on `rag.chunk` with the `portuguese` text search configuration (and `unaccent` if available on Supabase — *unverified*), fused with vector results by reciprocal rank fusion. Useful for exact terms ("encarregado", "art. 18").
- **Reranking:** retrieve 20–30, rerank, keep 5; adopt only if nDCG@10 improves on the gold set.
- **GraphRAG:** extract cross-references ("nos termos do art. 7º") into a `rag.legal_reference` edge table keyed by legal unit locators.

## 13. Evaluation

### 13.1 Retrieval vs. generation

- **Retrieval evaluation** (this initiative): deterministic, no LLM judge, cheap; runs on every chunking, embedding or index change.
- **Generation evaluation** (agent milestone): faithfulness, answer relevancy, context precision/recall with Mastra scorers; LLM-judged; run before releases.

### 13.2 Metrics

| Metric | Role | Why |
| --- | --- | --- |
| Recall@5 | Primary | A RAG answer fails silently when the governing unit never reaches the context window |
| MRR | Secondary | Rewards putting the governing unit first; matters if `topK` is reduced |
| nDCG@10 | Secondary | Supports graded relevance (2 = governing article, 1 = supporting) |
| Hit@1 / Hit@5 | Reporting | Easy to communicate in a demo |
| Precision@5 | Reported, not gated | Naturally low with 1–2 gold units per query |

Relevance is computed at the **legal-unit level**: a result is relevant if any of its `legal_unit_ids` (article prefix by default) is in the gold set; multiple chunks of the same unit are deduplicated before ranking. Out-of-scope queries are scored separately (rate of `empty` or of top score below a calibrated threshold).

### 13.3 Gold set v1

~40 queries, versioned in git (`eval/retrieval/gold-v1.jsonl`, created in the retrieval PR), with a frozen 10-query holdout. Mix: ~35% direct factoid, ~30% colloquial/paraphrased pt-BR, ~20% multi-article, ~15% out of scope. Each label is reviewed by a human against the official text.

Illustrative entries (synthetic queries; labels to be re-validated against the official text when the set is built):

```jsonl
{"id":"q001","query":"Quais são as hipóteses legais que permitem tratar dados pessoais?","gold":{"lgpd:art7":2},"type":"factoid"}
{"id":"q002","query":"O que a lei considera dado pessoal sensível?","gold":{"lgpd:art5":2,"lgpd:art11":1},"type":"factoid"}
{"id":"q003","query":"posso usar dados de saúde do cliente sem pedir consentimento?","gold":{"lgpd:art11":2},"type":"colloquial"}
{"id":"q004","query":"Quais direitos o titular pode exigir do controlador?","gold":{"lgpd:art18":2},"type":"factoid"}
{"id":"q005","query":"Quando a empresa precisa avisar a ANPD sobre vazamento de dados?","gold":{"lgpd:art48":2},"type":"colloquial"}
{"id":"q006","query":"Posso transferir dados de clientes para um servidor fora do Brasil?","gold":{"lgpd:art33":2},"type":"colloquial"}
{"id":"q007","query":"Quais sanções a ANPD pode aplicar e como elas são graduadas?","gold":{"lgpd:art52":2},"type":"multi"}
{"id":"q008","query":"Qual a alíquota máxima do imposto de renda de pessoa física?","gold":{},"type":"out_of_scope"}
```

### 13.4 Calibration protocol

1. Fix the gold set and the embedding space.
2. Run the grid: strategy {recursive 400/60, structure-aware} × maxTokens {256, 512, 1024} × overlap {0, 15%} (structure-aware uses header instead of overlap; overlap variants apply to the recursive baseline).
3. Report all metrics at K ∈ {3, 5, 10}, chunk count, total tokens, embedding cost and p50/p95 query latency per configuration.
4. Choose the configuration with the best Recall@5; tie-break on MRR, then on cost.
5. Record the baseline in `eval/retrieval/reports/` and gate later changes on "no Recall@5 regression beyond the run-to-run noise measured on the holdout".

No target value is promised before the first benchmark. A proposed acceptance target (Recall@5 ≥ 0.80 on the non-out-of-scope queries) is a **hypothesis for the owner to ratify** after the baseline exists.

## 14. Security

| Risk | Control |
| --- | --- |
| Indirect prompt injection in document text | Retrieved text is data: delimited, attributed, never executed; the future agent gets no mutating tools; provenance shown; ingestion heuristics may flag but are not the control |
| Malicious content / SSRF | Manifest-only sources, host allowlist, HTTPS, manual redirects with re-validation, private-range rejection, byte/time/parse caps, media-type sniffing, HTML parsed never executed, no archives/PDF in MVP |
| Personal data | Corpus limited to laws and resolutions; sanction decisions excluded; PII pattern scan (CPF, e-mail) flags documents for review; chunk text never logged |
| Credentials | `OPENAI_API_KEY`, DSN and tokens only as Mastra Cloud server-side secrets; never logged; least-privilege `rag_app`; rotation runbook; provider spend cap |
| Built-in vector routes | PgVector not registered in `new Mastra({ vectors })` (ADR E14) |
| Authorization | Operator token for ingestion and retrieval in the MVP. Any future role split MUST use a custom `authorizeUser` that re-checks token membership (ADR E15), default-deny path matching on normalized paths, and tests for `constructor`/`__proto__` tokens |
| Tenant/source isolation | Metadata filters are not a security boundary; allowed scope derived server-side; future tenants → separate namespaces plus RLS on a non-`BYPASSRLS` role, or separate tables |
| Metadata/log exposure | Metadata allowlist (§6.5); fixed error codes; no query text in logs (operator queries may contain personal data); PgVector logs `deleteFilter` at debug → production log level `info` or higher |
| Query text to embedding provider | Operator queries leave Brazil for the embedding API (§14.1); acceptable for MVP public-corpus demos; requires an LGPD transfer basis before any end-user product |
| Cost / retry amplification | Per-job token budget, max 4 attempts, backoff with jitter, `Retry-After`, resume-only-missing, provider hard limit |
| Network failures / timeouts | Bounded timeouts; `statement_timeout` and `idle_in_transaction_session_timeout` on `rag_app` *(H6)*; leases |
| Duplicate ingestion | Idempotency key uniqueness, version uniqueness, advisory lock on publish |
| Deletion / retention | §11.5; Mastra observability is not configured today; if enabled later, hide inputs/outputs of embedding and retrieval spans (the default sensitive-data filter matches keys, not free text) |
| Backup / restore (H10) | **No backups in MVP by owner decision.** Neither pre-migration dump nor restore/RPO/RTO guarantee is required. Derived vectors may be rebuilt only if sources and future tooling permit; catalog state may be permanently lost. Preserve non-destructive migration guards and capacity limits; revisit durability beyond MVP. |

### 14.1 Residency and latency

| Component | Region | Status |
| --- | --- | --- |
| Supabase (catalog + vectors) | São Paulo | Known |
| Mastra Platform compute | `pdx` default; `iad`/`sfo`/`ams` offered; no South America (ADR E16) | Actual environment region **to be verified by the operator** |
| Turso (environment-scoped) | Follows environment (`pdx` → `sjc`) | **To be verified** |
| Observability ingest (if enabled) | US (Iowa) for `us` environments | — |
| Embedding provider | OpenAI processing location not stated for this account | **Unverified** |

Consequences: every Supabase round trip from a US runtime crosses continents (estimated, not measured); ingestion must batch writes, and retrieval should use at most three DB round trips (published-set lookup, vector query, catalog validation — candidates for merging under option C). Content of the public corpus leaves Brazil (embedding API, runtime). This is low risk for public official texts but requires an LGPD international-transfer basis before any customer documents are ingested.

## 15. Observability

- Per job: `job_id`, `source_id`, `document_id`, stage, attempt, durations per stage, chunk count, tokens billed, error code. No text, no URLs with query strings, no secrets.
- Per retrieval: space, `topK`, candidate count, invalid-candidate count, empty flag, latency (embedding / vector query / validation).
- Counters: jobs by status, builds by status, GC backlog, budget consumed.
- Reconciler report (operator route or script): published documents per space, vector count per published chunk set vs. `chunk_count`.

## 16. Acceptance criteria (for the implementation phase)

1. Offline unit tests cover ID derivation (golden values of §6.4), validation limits, extraction of revoked text, chunking determinism and locators, metric computation.
2. Ingesting the same source twice bills tokens once and produces one version, one chunk set and one publication.
3. Killing the process during embedding leaves the previous publication served; a retry completes without re-embedding finished batches.
4. Retrieval never returns a chunk from an unpublished, superseded or deleted chunk set (integration test with a local pgvector container).
5. A dimension mismatch is rejected before any write.
6. Deleting a source makes it invisible within one transaction and purges vectors in the follow-up job.
7. The evaluation report for the baseline configuration exists and is reproducible from the committed gold set.
8. No secret or chunk text appears in logs captured during integration tests.
9. CI remains green (`npm run test`, `typecheck`, `build`, auth smoke tests) and the runtime starts without Supabase/OpenAI secrets.

## 17. Dependencies and risks

| Item | Type | Note |
| --- | --- | --- |
| `@mastra/pg@1.35.0` behaviour (E1–E11) | Dependency | Pin; re-verify cited lines on upgrade |
| HTML parser package | New runtime dependency *(H9)* | Needed for extraction (Node has no DOM) |
| Tokenizer (`js-tiktoken`) or `@mastra/rag@2.8.0` | New runtime dependency *(H9)* | Or character proxy (§8.2) |
| `zod` as a direct dependency | Possibly *(H9)* | Present transitively today |
| OpenAI account and key | External *(H3, H11)* | Spend cap required |
| Planalto availability | Operational | Direct fetch timed out once from the author's network (E19) |
| Cross-continent latency | Operational | §14.1 |
| Supabase plan limits / backups | Operational *(H10)* | Storage of vectors + normalized text |
| PgVector session `search_path` | Technical | App SQL fully schema-qualified |
| PgVector constructor connects eagerly (E8) | Technical | Keep construction lazy, as today |

## 18. Pending decisions

H1 and H2 are accepted for MVP. H3 is accepted **only as a model/evaluation baseline**; the provider account and any paid calls remain gated by H11. H9 is conditional permission to evaluate dependencies, **not** to install any specific package. The D4–D6 design **principles** are accepted, but not the final physical model, DDL, retention policy, production authorization or retrieval API. D2 chunking numbers remain calibration hypotheses. See [Stage A decision](../decisions/RAG07-stage-a-ratification.md) and ADR table.

Offline Step B contracts can be prepared after this PR is merged with the normal CI/review/human gate. Step C follows Step B and per-dependency approval; offline mock-only Step D may be prepared without external calls. **Paid embeddings require H11.** Persistence and live ingestion (E–F) MUST NOT start before the remaining H4, H5, H6, H7, **H10 capacity**, H11 and H12 gates are addressed. **H10 backup/restore is explicitly waived for the MVP**; hosted actions still require separate human authorization. H8 SHOULD be resolved before hosted retrieval benchmarking.
