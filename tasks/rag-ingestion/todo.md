# RAG ingestion — tracking checklist

Status legend: `[ ]` not done · `[x]` done. Stage A **partial ratification** recorded on 2026-11-16; no offline implementation started. PR numbers after #7 are provisional (see [`plan.md`](plan.md)).

## Step A — Specification (PR #7)

- [x] SPEC drafted: `docs/specs/SPEC-rag-ingestion.md`
- [x] ADR drafted with D1–D6 as `PROPOSED`: `docs/architecture/ADR-rag-ingestion.md`
- [x] Plan and checklist drafted
- [x] README roadmap section updated
- [x] CI green on the PR head (`638d206`)
- [x] Independent adversarial review findings resolved (namespace, GC, sync execution, deletion, model switch, evidence table)
- [x] Codex review on `40bc6c2` (3× P2) addressed in R2; re-review on `638d206` reported no major issues

## Human decision gates

- [x] D4–D6 architectural **principles** accepted (not their physical schema, SQL, live APIs, retention or operational grants)
- [x] [Stage A partial decision](../../docs/decisions/RAG07-stage-a-ratification.md) recorded; H4–H8 and H10–H12 remain pending
- [ ] PR #7 amended HEAD re-reviewed (CI + independent Codex) and merged by owner


- [x] H1 Corpus / use case accepted for MVP: LGPD + selected CD/ANPD resolutions (exact official sources pending Step B)
- [x] H2 Initial formats accepted: HTML + Markdown/TXT; PDF phase 2; no OCR
- [x] H3 Model baseline accepted: `openai/text-embedding-3-small` @1536; **account/billing and paid use remain pending H11**
- [ ] H4 Data model ratified (proposed: PgVector space tables + app catalog, exact search first)
- [ ] H5 Migration location, tooling and applier ratified (proposed: `db/migrations/`, owner applies)
- [ ] H6 Least-privilege `rag_app` role and DSN rotation approved
- [ ] H7 MVP access model ratified (proposed: operator-only)
- [ ] H8 Mastra environment and Turso regions verified; latency accepted or region plan decided
- [x] H9 Dependency *evaluation* conditionally accepted; actual parser/tokenizer/`zod` package installations require separate version/security review and owner approval
- [ ] H10 Supabase plan, backup/PITR and storage budget confirmed
- [ ] H11 Embedding spend cap and evaluation budget set
- [ ] H12 Retention and GC windows ratified (proposed: 7-day grace; immediate purge on erasure)

## Step B — Contracts and validation (expected #8)

- [ ] Manifest entry for LGPD with verified URL and license note
- [ ] CD/ANPD resolution list verified against official sources
- [ ] Deterministic ID functions + canonical JSON; golden values from SPEC §6.4 pass
- [ ] Manifest/URL/allowlist validation; private-host rejection tests
- [ ] Media-type sniffing and size-limit tests
- [ ] Fixed error-code catalogue
- [ ] CI green, review, human merge

## Step C — Fetch, extraction, normalization, chunking (expected #9)

- [ ] Fetcher: HTTPS, allowlist, manual redirects ≤ 3, private IP rejection, timeouts, byte cap
- [ ] Planalto extractor: charset, revoked text removal, amendment metadata, structure tree
- [ ] Legal locators (`lgpd:art5:inc2`, `lgpd:art55-j`, `parunico`) tested
- [ ] Normalizer + offsets reproduce body substrings
- [ ] Structure-aware chunker + recursive baseline; determinism test
- [ ] LGPD snapshot fixture committed; chunk statistics in PR description
- [ ] CI green, review, human merge

## Step D — Embeddings (expected #10)

- [ ] `EmbeddingProvider` interface and space registry type
- [ ] `ModelRouterEmbeddingModel` adapter for `openai/text-embedding-3-small`
- [ ] Batching, retries (max 4), backoff + jitter, `Retry-After`
- [ ] Per-job token budget; worst-case paid-call bound tested
- [ ] Dimension and finite-value assertions before upsert
- [ ] Runtime starts without `OPENAI_API_KEY`
- [ ] CI green, review, human merge

## Step E1 — Migration and provisioning (expected #11a)

- [ ] Migration up/down SQL reviewed (catalog, indexes, RLS including space-table UPDATE, grants)
- [ ] Provisioning script with `indexConfig: { type: 'flat' }`
- [ ] Non-transactional migration class noted for future HNSW
- [ ] CI green, review, human merge
- [ ] Owner: logical dump of `rag` taken
- [ ] Owner: migration applied
- [ ] Owner: `rag_app` created, runtime DSN rotated, readiness probe green (`NOT rolsuper`)
- [ ] Owner: space `chunks_te3s_1536_v1` provisioned

## Step E2 — Ingestion orchestration (expected #11b)

- [ ] Runtime PgVector with constructor `disableInit: true`; PgVector not registered in `new Mastra({ vectors })`
- [ ] Namespace-required adapter wrapper (SPEC §9.4)
- [ ] Publication transaction, visibility rule, GC and delete (§11.4.1, §11.5)
- [ ] Synchronous operator ingestion route (`401` anonymous)
- [ ] Local `pgvector/pgvector:pg17` CI service; all SPEC §11.4 scenarios tested (including content reversion)
- [ ] Log capture: no chunk text, query text or secrets
- [ ] CI green, review, human merge

## Step F — Retrieval and evaluation baseline (expected #12)

- [ ] Retrieval service + operator route; scope derived from principal
- [ ] Empty-result behaviour tested
- [ ] Gold set v1 (~40 queries) human-reviewed; holdout frozen
- [ ] Metric functions tested against hand-computed fixtures
- [ ] Owner-approved first ingestion of the corpus
- [ ] Calibration grid executed; baseline report committed
- [ ] Latency p50/p95 measured from the deployed environment
- [ ] Recall@5 target ratified or adjusted by the owner
- [ ] CI green, review, human merge
