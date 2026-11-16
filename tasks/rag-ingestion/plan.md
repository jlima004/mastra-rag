# RAG ingestion — incremental implementation plan

Status: **PROPOSED — HUMAN_ADJUDICATION_PENDING**. Baseline `15fe15cdffd51133be32c704eee0cc88f51b9d45` (2026-11-16).

Normative design: [`docs/specs/SPEC-rag-ingestion.md`](../../docs/specs/SPEC-rag-ingestion.md). Decisions: [`docs/architecture/ADR-rag-ingestion.md`](../../docs/architecture/ADR-rag-ingestion.md). Checklist: [`todo.md`](todo.md).

PR numbers after #7 are **provisional**: GitHub assigns numbers to issues and PRs from one sequence, and steps may be merged or split during review. Steps are identified by letter (A–G); the number in parentheses is only the expected one.

## Rules that apply to every step

- No step starts before the decisions it depends on are ratified (column "Gate").
- Each PR: CI green (`npm run test`, `npm run typecheck`, `npm run build`, auth smoke tests), one independent review on the candidate HEAD, material P0–P2 findings resolved, human merge. No agent merges or deploys.
- No secret in Git, PR text or logs. TLS verification is never relaxed.
- Database objects are created only by the project owner after reviewing the SQL (step E). CI integration tests use a disposable local `pgvector/pgvector:pg17` container, never Supabase.
- New runtime dependencies are introduced only in the step that needs them, with the justification in the PR description and owner approval.
- The runtime must keep starting without Supabase or embedding secrets (existing CI smoke behaviour).

## Overview

| Step | Expected PR | Title | Gate (ratified decisions) | Touches live services? |
| --- | --- | --- | --- | --- |
| A | #7 | Specification and architecture decisions (this PR) | — | No |
| B | (#8) | Source manifest, document contracts, deterministic IDs, validation | H1, H2 | No |
| C | (#9) | Fetch, extraction, normalization and chunking (offline) | B merged, H9 (HTML parser, tokenizer; undici Agent if required for DNS pinning) | No (fixtures only; a manual fetch script is optional) |
| D | (#10) | Embedding provider interface and OpenAI adapter | C merged, H3, H11 | No in CI (fake provider); optional manual smoke with owner's key |
| E1 | (#11a) | Catalog migration SQL, roles/grants, space provisioning script (reviewed, not applied by CI) | D merged, H4, H5, H6, H10 | Owner applies after merge |
| E2 | (#11b) | Ingestion orchestration, publication, GC/delete, operator routes (synchronous MVP) | E1 merged and applied, H7, H12 | Yes — against Supabase with `rag_app` |
| F | (#12) | Retrieval service, operator route and retrieval evaluation baseline | E2 merged, H8, H11 | Yes — first paid embeddings of the corpus, owner-approved |
| G | later | Follow-ups: agent + generation eval, HNSW if triggered, hybrid search, reranking, PDF, reader access | F merged | Per step |

---

## Step A — Specification (PR #7)

- **Scope:** `docs/specs/SPEC-rag-ingestion.md`, `docs/architecture/ADR-rag-ingestion.md`, this plan, `todo.md`, README roadmap section.
- **Dependencies:** none.
- **Tests:** existing CI; relative links in the new documents resolve.
- **Approval criteria:** owner ratifies or amends H1–H12; ADR status stays `PROPOSED` until then (ratification may be recorded in a follow-up commit that changes individual decisions to `ACCEPTED`).

## Step B — Contracts and validation (expected #8)

- **Scope:**
  - `src/mastra/rag/contracts/` (or the location agreed in review): `SourceManifestEntry`, `FetchedDocument`, error-code enum, limits (SPEC §6, §7.3, §7.4).
  - Corpus manifest with the LGPD entry and the verified list of CD/ANPD resolutions (official URLs and license notes).
  - Deterministic ID functions (SPEC §6.4) using `node:crypto` only, plus canonical JSON.
  - Validation of manifest entries, host allowlist, URL shape, media-type sniffing and size limits (pure functions).
- **Dependencies:** H1 (corpus), H2 (formats). `zod` as a direct dependency only if approved (H9); otherwise hand-written validators.
- **Tests (offline):** golden ID values from SPEC §6.4; newline injection rejected; allowlist and private-host rejection; sniffing (HTML vs. PDF/ZIP magic bytes); limits at boundary values.
- **Approval criteria:** golden values match the SPEC; no network, DB or secret access; tests added to the `npm run test` glob.

## Step C — Fetch, extraction, normalization, chunking (expected #9)

- **Scope:**
  - Fetcher with HTTPS, allowlist, manual redirects (≤ 3, each re-validated), DNS/IP private-range rejection, timeouts and streaming byte cap (SPEC §7).
  - `planalto-html@1` extractor: charset detection/decoding, removal of revoked wording, amendment annotations as metadata, structure tree and legal locators (SPEC §7.1).
  - `legal-text@1` normalizer and stored-text offsets (SPEC §7.2).
  - Structure-aware chunker and recursive baseline (SPEC §8) with token counting.
  - Committed fixtures: a small synthetic HTML with revoked text, and a snapshot of the LGPD HTML (official act — no copyright) for deterministic tests.
- **Dependencies:** B merged; H9 approval for an HTML parser and (optionally) a tokenizer or `@mastra/rag@2.8.0`.
- **Tests (offline):** revoked text never appears in chunks; every chunk ≤ hard cap; deterministic output (same input → same chunk IDs); locators for `Art. 5º, II`, `Art. 55-J`, `parágrafo único`; offsets reproduce the body substring; chunk statistics report (count, token distribution) for the LGPD snapshot.
- **Approval criteria:** chunk statistics documented in the PR; no live fetch in CI; fetcher SSRF tests pass.

## Step D — Embeddings (expected #10)

- **Scope:** `EmbeddingProvider` interface (SPEC §9.2); adapter over `ModelRouterEmbeddingModel` (`@mastra/core/llm`) for `openai/text-embedding-3-small`; batching, retries with backoff/jitter, `Retry-After`, per-job token budget, dimension/finite-value assertions; space registry type.
- **Dependencies:** C merged; H3 (model/provider); H11 (spend cap, budget values).
- **Tests:** fake provider for batching, retry caps (assert maximum call counts), budget refusal, dimension mismatch rejection, abort/timeout handling. No real API call in CI.
- **Optional manual check (owner):** a script that embeds two synthetic strings with the owner's key locally and prints only dimensions and token usage.
- **Approval criteria:** worst-case paid call count is bounded and tested; no key read at import time; runtime starts without `OPENAI_API_KEY`.

## Step E1 — Migration and provisioning (expected #11a)

- **Scope:** `db/migrations/0001_rag_catalog.up.sql` / `.down.sql` from SPEC §10.2, with RLS policies (including SELECT+UPDATE on PgVector space tables so `ON CONFLICT DO UPDATE` works) and grants (SPEC §10.4); operator provisioning script that calls `createIndex({ indexName: 'chunks_te3s_1536_v1', dimension: 1536, metric: 'cosine', indexConfig: { type: 'flat' } })`. Non-transactional migration class documented for future `CREATE INDEX CONCURRENTLY` (HNSW).
- **Dependencies:** D merged; H4, H5, H6, H10.
- **Tests:** SQL reviewed; a local container applies up then down cleanly.
- **Owner actions after merge:** logical dump of `rag`; apply migration; create `rag_app` and rotate the runtime DSN; run provisioning; confirm readiness (`NOT rolsuper`).
- **Approval criteria:** SQL reviewed line by line; down script reviewed; no application code changes required to boot.

## Step E2 — Ingestion orchestration (expected #11b)

- **Scope:** Runtime PgVector with constructor option `disableInit: true`; catalog repository with schema-qualified SQL; publication transaction (SPEC §11.2); visibility rule (SPEC §11.3); GC and delete (SPEC §11.4.1, §11.5); **synchronous** operator route `POST /internal/rag/ingestion-jobs` (SPEC §6.2.1) — plain service, not a Mastra background worker; PgVector is **not** registered in `new Mastra({ vectors })`; namespace-required adapter wrapper (SPEC §9.4); reconciler report.
- **Dependencies:** E1 merged and applied; H7, H12.
- **Tests:** CI service container `pgvector/pgvector:pg17`; every SPEC §11.4 scenario; crash-during-embedding resume; concurrent publication; dimension mismatch; deletion vs in-flight; content reversion; namespace omission rejected at type/test level; log capture asserts no text/secrets/query text; anonymous `401`.
- **Approval criteria:** SPEC §16 criteria 2–6 and 8 pass against the local container.

## Step F — Retrieval and quality baseline (expected #12)

- **Scope:** retrieval service (SPEC §12.3) and operator route; gold set `eval/retrieval/gold-v1.jsonl` (~40 queries, human-reviewed, holdout frozen); evaluation runner computing Recall@K, MRR, nDCG@10, Hit@K, Precision@K at the legal-unit level; calibration grid (SPEC §13.4); baseline report.
- **Dependencies:** E merged and applied; H7 (access model); H11 (evaluation budget). First ingestion of the corpus into Supabase is an owner-approved operation.
- **Tests:** metric functions with hand-computed fixtures; retrieval visibility tests (local container); empty-result behaviour; scope filters derived from the principal, not the body.
- **Approval criteria:** reproducible baseline report committed; latency p50/p95 measured from the deployed environment (no SLO promised beforehand); owner ratifies (or adjusts) the proposed Recall@5 target.

## Step G — Later milestones (not planned in detail)

- RAG agent with citation-only answers and generation evaluation (Mastra scorers); prompt-injection eval set.
- HNSW index when the SPEC §10.6 trigger fires, with recall comparison against exact search.
- Hybrid search (PostgreSQL FTS `portuguese` + reciprocal rank fusion) and reranking, adopted only on metric improvement.
- Digital PDF support (ANPD guides, IRPF Q&A as second benchmark).
- Reader/demo access with a corrected custom `authorizeUser`, rate limiting and a public demo plan.
- GraphRAG edges from legal cross-references.
