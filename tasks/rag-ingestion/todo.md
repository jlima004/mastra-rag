# RAG ingestion — tracking checklist

Status legend: `[ ]` not done · `[x]` done. Stage A **partial ratification** recorded on 2026-11-16. Steps B–D offline now merged; E1 physical adjudication remains pending. PR numbers after #7 are provisional (see [`plan.md`](plan.md)).

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
- [x] PR #7 amended HEAD re-reviewed (CI + independent Codex) and merged by owner


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

- [x] Manifest entry for LGPD with official canonical reference and copyright note; live availability pending Step C
- [x] CD/ANPD candidates checked against ANPD's official regulation index: #15/#18 in manifest; amended #2 and corrected #19 documented as deferred; live DOU fetch pending Step C
- [x] Deterministic IDs + strict canonical JSON implemented; SPEC §6.4 golden regression assertions added (CI pending)
- [x] Manifest/URL/allowlist validation, unknown-ID and private-host syntax rejection tests added; DNS pinning deferred to Step C
- [x] Offline magic-byte, UTF-8 text, legacy-HTML sniffing and size-limit tests added; full charset detection deferred to Step C
- [x] Sanitized fixed error-code catalogue added
- [x] PR #8 CI green (60/60), final Codex review no findings, human merge + deploy confirmed

## Step C — Fetch, extraction, normalization, chunking (expected #9)

- [x] Inert native HTTPS fetcher implemented with reviewed manifest allowlist, manual redirects ≤ 3, DNS IPv4 pinning/public-only filtering, timeouts and 5 MiB streaming cap; **only mocked transport executed in tests**
- [x] Experimental restricted-HTML fixture extractor with UTF-8/Windows-1252 charset, revoked markup removal, amendment annotations and legal hierarchy; **official Planalto/DOU HTML parser validation still pending H9**
- [x] Legal locators (`lgpd:art5:inc2`, `lgpd:art55-j`, `parunico`) have synthetic regression tests
- [x] NFC normalizer + exact UTF-16 offsets reproduce all emitted body substrings in synthetic tests
- [x] Structural + recursive byte-budget-proxy baseline implemented and tested for deterministic chunk IDs and overlap; **actual token-count calibration pending H9**
- [ ] Official LGPD source snapshot, current text review, provenance and measured `cl100k_base` token statistics (blocked: verified source access and H9 tokenizer). Synthetic fixture committed; byte-proxy stats are not model token statistics.
- [x] RAG09 R1–R3 remediations reviewed by Codex with no final findings; PR #9 merged into master and deploy confirmed
- [x] RAG09 CI post-merge 85/85 tests; Codex final review without findings; human merge and deploy complete

## Step D — Embeddings (PR #10 merged; offline-only)

- [x] `EmbeddingProvider` interface and immutable MVP space registry type
- [x] Lazy `ModelRouterEmbeddingModel` adapter for `openai/text-embedding-3-small`; explicit paid-call gate, injection-only tests
- [x] Batching ≤128, **global** job retries (≤4 attempts; at most 3 retries), backoff + jitter, `Retry-After`, signal abortion
- [x] Per-job + supplied daily token budget, worst-case call/reservation bound; conservative **UTF-8 byte-plus-eight proxy**, not calibrated model-token counts
- [x] Exact dimensions, finite values, reported usage and vector-count validation **before any future upsert**
- [x] No OpenAI key at import, no server registration; missing-key startup requires CI smoke
- [ ] H11: owner-ratified account, provider-side hard spend cap, daily/token budgets, paid authorization
- [ ] H9: approved tokenizer for validated preflight accounting; no package installed in this PR
- [x] PR #10 exact-head CI full PASS (105/105), independent Codex re-review no material findings, human merge @ `0075155`. **No live embedding, DDL or production ingestion authorized**.

## RAG-E1 — Documentation-only adjudication checkpoint (2026-11-17)

Reference: [E1 decision proposal](../../docs/decisions/RAG-E1-adjudication-proposal.md). Authorized: record/review decisions only; H4/H5/H6/H10 remain PENDING.

- [x] GitHub baseline verified: Step D PR #10 merged as `0075155`; CI SUCCESS 105/105
- [x] Supabase read-only evidence obtained: Free, São Paulo, PostgreSQL 17, `rag` schema with no tables, pgvector installed, migration baseline `20261113233720`, no `rag_app`
- [x] Existing `public.rls_auto_enable()` security-advisor warnings recorded for separate authorized investigation; no grants changed
- [x] Proposals E1-P2-01/02/03 documented (rendered identity, v2 ingestion idempotency, no-op semantics)
- [ ] Exact-head CI and independent Codex review of documentation-only Draft PR; address P0/P1/P2
- [ ] Owner H4 decision: physical identity uniqueness, RLS, indexes/constraints and effective v2 provenance
- [ ] Owner H5 decision: migration paths/history, owner applier, backups and rollback
- [ ] Owner H6 decision: `rag_app` privilege/role policy, safe treatment of security advisory
- [ ] Owner H10 decision: actual storage estimate and backup/isolated restore with RPO/RTO, or separately approved paid plan
- [ ] Separate explicit owner authorization for an E1 implementation PR; no DDL/upsert/secret changes from this checkpoint

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
