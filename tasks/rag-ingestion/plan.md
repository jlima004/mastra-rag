# RAG ingestion — incremental implementation plan

> **Latest owner authority (2026-11-17):** [H5/H6/H10 hosted operational ratification](../../docs/decisions/RAG-E1-H5-H6-H10-owner-ratification.md) supersedes the pending decision status in earlier historical sections. **Single Supabase migration ledger, minimal server-only `rag_app`, independent security review, and numeric H10 capacity caps are RATIFIED DIRECTIONS**, not hosted execution approval. Pinned CLI version, role/SQL operator package, security disposition, organization/disk measurements and capacity enforcement remain open. H10 [NO_BACKUP_MVP](../../docs/decisions/RAG-H10-mvp-no-backup.md) remains in force.

> **Current H10 policy (owner, 2026-11-17):** [No backups in the MVP](../../docs/decisions/RAG-H10-mvp-no-backup.md). Historical H10 backup/restore conditions in older checkpoints below are superseded. Capacity sizing/enforcement and the independent hosted authorization gates remain required.

> **Current operational checkpoint (2026-11-17):** [H5/H6/H10 hosted adjudication proposal](../../docs/decisions/RAG-E1-H5-H6-H10-hosted-adjudication.md), based on read-only live Supabase state and post-merge PR #14 `master` `9b62857a`. Single-ledger historian, role procedure, security advisor disposition and H10 capacity limits are **proposals awaiting human ratification**; none authorizes hosted writes. The [H10 no-backup MVP](../../docs/decisions/RAG-H10-mvp-no-backup.md) decision remains settled.

Status: **E1_LOCAL_IMPLEMENTATION_AUTHORIZED / HOSTED_OPERATIONS_GATED** (2026-11-17). Stage A historical baseline `15fe15cdffd51133be32c704eee0cc88f51b9d45`; E1 approved implementation base `8030b63e24aed4dab8d558b892846fc0b75d3278`.

Normative design: [`docs/specs/SPEC-rag-ingestion.md`](../../docs/specs/SPEC-rag-ingestion.md). Decisions: [`docs/architecture/ADR-rag-ingestion.md`](../../docs/architecture/ADR-rag-ingestion.md). [Stage A partial ratification](../../docs/decisions/RAG07-stage-a-ratification.md). Checklist: [`todo.md`](todo.md).

PR numbers after #7 are **provisional**: GitHub assigns numbers to issues and PRs from one sequence, and steps may be merged or split during review. Steps are identified by letter (A–G); the number in parentheses is only the expected one.

## RAG-E1 documentation-only adjudication checkpoint (2026-11-17)

**State: ADJUDICATION_OPEN / DESIGN_RECONCILIATION_REQUIRED.** Proposal and read-only GitHub/Supabase evidence: [RAG-E1 adjudication proposal](../../docs/decisions/RAG-E1-adjudication-proposal.md). Step D PR #10 was merged into `master` as `0075155cb6da360487ea59dee47c7bb3fd3449c4` (CI SUCCESS 105/105). E1 H4/H5/H6/H10 are **not yet ratified**.

Before a separate implementation PR may start: (1) reconcile Step C rendered v2 identity, catalog uniqueness, v2 ingest idempotency and raw-only normalized no-op; (2) confirm H5 migration historian/applier against existing Supabase migration `20261113233720`; (3) ratify `rag_app`/RLS/namespace security boundaries and review existing `rls_auto_enable()` advisory; (4) approve storage/backup/restore and residual risk on Free, or a paid alternative. Then exact-HEAD CI, independent review, and human adjudication.

This Draft PR is documentation only. **No DDL, Supabase/Turso writes, credentials, provisioning, paid API calls, new dependency, merge or deploy is authorized.** E1 implementation / production application approvals remain separate.

## Owner decision — E1 local development authorized (2026-11-17)

After PR #11 merged into `master` @ `8030b63e24aed4dab8d558b892846fc0b75d3278` (post-merge CI SUCCESS), the owner **ratified directions** H4/H5/H6 and H10's conditional operational policy. Authority: [owner ratification](../../docs/decisions/RAG-E1-owner-ratification.md). Detailed local implementation plan: [E1 work order](step-e1-local-work-order.md).

**Historical E1-local authorization:** a separate Draft PR was allowed for locally tested catalog SQL, role/RLS, operator provisioning and reconciliation. No hosted DDL, remote role/DSN changes or paid embeddings were authorized by that decision. The previous H10 backup prerequisite is superseded by [H10 no-backup MVP](../../docs/decisions/RAG-H10-mvp-no-backup.md); storage capacity and H7/H11/H12 gates remain open.

The preceding adjudication checkpoint section is historical: its directions were subsequently ratified **for local E1 implementation only**, not for hosted operations.

## Owner H10 MVP no-backup override (2026-11-17)

- **Decided:** no backups (hosted, external, scheduled or pre-migration) for the MVP; no real restore test or RPO/RTO guarantee required as an H10 gate.
- **Risks:** permanent loss of catalog, pointer/history and vector data is possible; rebuild from official sources is not yet demonstrated or guaranteed.
- **Still pending:** actual corpus capacity budget and enforcement, H5 single migration historian/applier, H6 hosted runtime role and security review, H7/H11/H12 and separate authorization for remote writes and live ingestion.
- **Evidence:** PR #13 merged as `248c0ba096c55e8e432ab0bfbfb3a49e2c2a8f28` with CI SUCCESS; its synthetic local restore drill remains a fixture test, not a production backup.
- **Authority:** [H10 MVP decision](../../docs/decisions/RAG-H10-mvp-no-backup.md). Supersedes older backup-related gate language below, not other decisions.

## E1 local operator package — PR #17 (2026-11-17)

The [operator package work order](../../docs/rag/e1-operator-package.md) stages the CLI-generated H5 migration and foundation-history mapping, H6 local privilege and event-trigger regressions, and H10 pure projected capacity checks. **All work is local/CI only.** Actual hosted role, migration, space, DSN or ingest execution is not approved. The H10 [no-backup MVP decision](../../docs/decisions/RAG-H10-mvp-no-backup.md) remains in force. Numeric H10 limits are ratified but live enforcement and organization/disk measurements remain open.

## E1 hosted-execution preparation (2026-11-17)

[Current operator readiness and execution stop/go](../../docs/rag/e1-hosted-execution-readiness.md) reconciles the **hosted read-only** H5 migration history and foundation SHA, H6 absent `rag_app` and unchanged security WARNs, and H10 unknown Free organization/disk/WAL metrics. It includes a read-only preflight SQL and a local-only evidence validator. **This checkpoint does not approve** remote CLI authenticated rehearsal, `db push`, `migration repair`, role/grant/credential changes, paid calls or ingestion. Future privileged operations must be independently approved. H10 **NO_BACKUP_MVP** is unchanged.

## E1 H5 — authenticated remote migration history (read-only gate)

[Current CLI historian operator runbook](../../docs/rag/e1-h5-remote-cli-readonly-gate.md) records owner authorization for `supabase migration list --remote=lmocjhpajhxegzobydau` using CLI **3.1.0** only. The connected Supabase **MCP** read verified the existing foundation version `20261113233720`, but an actual authenticated **CLI** remote listing is still pending because the operator's local CLI session is not available through the connected tools. Operator script and offline CI mock enforce target/hash and no-write scope. This gate authorizes no `db push`, `migration repair`, roles, credentials, vector provisioning, H6 security modification or E2 ingestion. **NO_BACKUP_MVP** remains binding.

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
| B | (#8) | Source manifest, document contracts, deterministic IDs, validation | **H1/H2 accepted; start only after PR #7 merge** | No |
| C | (#9) | Fetch, extraction, normalization and chunking (offline) | B merged; H9 authorizes dependency evaluation, **not installation**; package-specific owner review required | No (fixture-based tests only; no live fetch in CI) |
| D | (#10) | Embedding provider interface and OpenAI adapter | C merged, H3 model baseline; **H11 before any paid/manual provider call** | No in CI (fake provider); live smoke only after H11 |
| E1 | (#11a) | Catalog migration SQL, roles/grants, space provisioning script (reviewed, not applied by CI) | D merged, H4, H5, H6, H10 | Owner applies after merge |
| E2 | (#11b) | Ingestion orchestration, publication, GC/delete, operator routes (synchronous MVP) | E1 merged and applied, H7, H12 | Yes — against Supabase with `rag_app` |
| F | (#12) | Retrieval service, operator route and retrieval evaluation baseline | E2 merged, H8, H11 | Yes — first paid embeddings of the corpus, owner-approved |
| G | later | Follow-ups: agent + generation eval, HNSW if triggered, hybrid search, reranking, PDF, reader access | F merged | Per step |

---

## Step A — Specification (PR #7)

- **Scope:** `docs/specs/SPEC-rag-ingestion.md`, `docs/architecture/ADR-rag-ingestion.md`, this plan, `todo.md`, README roadmap section.
- **Dependencies:** none.
- **Tests:** existing CI; relative links in the new documents resolve.
- **Approval criteria:** partial Stage A ratification is recorded; remaining H4–H8/H10–H12 gates stay pending. PR #7 requires a new CI, independent review and separate human merge authorization; no production or runtime implementation in this step.

## Step B — Contracts and validation (expected #8)

**Implementation scope:** pure Node/TypeScript contract library in `src/mastra/rag/contracts/`, reviewed manifest and official-source evidence at [`docs/rag/sources-mvp.md`](../../docs/rag/sources-mvp.md). No fetcher, agent, embeddings or PostgreSQL client. Step C owns DNS pinning, redirect validation, streaming fetch and actual source content verification. DOU/Planalto network access is explicitly **not demonstrated** by Step B.

- **Scope:**
  - `src/mastra/rag/contracts/` (or the location agreed in review): `SourceManifestEntry`, `FetchedDocument`, error-code enum, limits (SPEC §6, §7.3, §7.4).
  - Corpus manifest with the LGPD entry and the verified list of CD/ANPD resolutions (official URLs and license notes).
  - Deterministic ID functions (SPEC §6.4) using `node:crypto` only, plus canonical JSON.
  - Validation of manifest entries, host allowlist, URL shape, media-type sniffing and size limits (pure functions).
- **Dependencies:** H1/H2 accepted; PR #7 must be merged. H9 permits evaluation, but does **not** approve adding `zod` or any other runtime dependency; default to pure functions unless a specific package is separately approved.
- **Tests (offline):** golden ID values from SPEC §6.4; newline injection rejected; allowlist and private-host rejection; sniffing (HTML vs. PDF/ZIP magic bytes); limits at boundary values.
- **Approval criteria:** golden values match the SPEC; no network, DB or secret access; tests added to the `npm run test` glob.

## Step C — Fetch, extraction, normalization, chunking (PR #9 Draft)

**Scope clarification, 2026-11-16:** The owner authorized offline Step C only.
The native HTTPS implementation is *not registered* in the running application;
the test transport injects mocked DNS and HTTP. A dependency-free restricted
fixture parser and UTF-8 byte-budget chunker are implementation prototypes,
not proof of production HTML correctness or cl100k_base token counts.
The official LGPD snapshot, live URL availability and H9 approval for exact
parser/tokenizer packages remain acceptance blockers. See
[`docs/rag/step-c-offline.md`](../../docs/rag/step-c-offline.md).


- **Scope:**
  - Fetcher with HTTPS, allowlist, manual redirects (≤ 3, each re-validated), DNS/IP private-range rejection, timeouts and streaming byte cap (SPEC §7).
  - `planalto-html@1` extractor: charset detection/decoding, removal of revoked wording, amendment annotations as metadata, structure tree and legal locators (SPEC §7.1).
  - `legal-text@1` normalizer and stored-text offsets (SPEC §7.2).
  - Structure-aware chunker and recursive baseline (SPEC §8) with token counting.
  - Committed fixtures: a small synthetic HTML with revoked text, and a snapshot of the LGPD HTML (official act — no copyright) for deterministic tests.
- **Dependencies:** B merged; H9 approval for an HTML parser and (optionally) a tokenizer or `@mastra/rag@2.8.0`.
- **Tests (offline):** revoked text never appears in chunks; every chunk ≤ hard cap; deterministic output (same input → same chunk IDs); locators for `Art. 5º, II`, `Art. 55-J`, `parágrafo único`; offsets reproduce the body substring; chunk statistics report (count, token distribution) for the LGPD snapshot.
- **Approval criteria:** chunk statistics documented in the PR; no live fetch in CI; fetcher SSRF tests pass.

## Step D — Embeddings (PR #10 Draft, offline-only implementation)

**H11 is still PENDING.** The current PR implements and tests the
interface, lazy OpenAI model-router adapter and budgeted fake-provider
batch execution, without authorizing any paid embedding call. It requires
an explicit paid-call opt-in at the adapter boundary, which must remain
disabled until a separate owner decision on the billing account, hard
provider spend cap and evaluation budget. The preflight token envelope
uses UTF-8 bytes + 8 per input; it is NOT a verified cl100k_base count,
so a real tokenizer approved under H9 is required before production
billing. No new packages are installed. The project must still start
without OPENAI_API_KEY. The [offline evidence note](../../docs/rag/step-d-offline.md)
separates what is demonstrated from future runtime and DB integration.


- **Scope:** `EmbeddingProvider` interface (SPEC §9.2); adapter over `ModelRouterEmbeddingModel` (`@mastra/core/llm`) for `openai/text-embedding-3-small`; batching, retries with backoff/jitter, `Retry-After`, per-job token budget, dimension/finite-value assertions; space registry type.
- **Dependencies:** C merged; H3 (model/provider); H11 (spend cap, budget values).
- **Tests:** fake provider for batching, retry caps (assert maximum call counts), budget refusal, dimension mismatch rejection, abort/timeout handling. No real API call in CI.
- **Optional manual check (owner):** a script that embeds two synthetic strings with the owner's key locally and prints only dimensions and token usage.
- **Approval criteria:** worst-case paid call count is bounded and tested; no key read at import time; runtime starts without `OPENAI_API_KEY`.

## Step E1 — Migration and provisioning (local-only Draft now authorized; hosted execution BLOCKED)

- **Scope:** `db/migrations/0001_rag_catalog.up.sql` / `.down.sql` from SPEC §10.2, with RLS policies (including SELECT+UPDATE on PgVector space tables so `ON CONFLICT DO UPDATE` works) and grants (SPEC §10.4); operator provisioning script that calls `createIndex({ indexName: 'chunks_te3s_1536_v1', dimension: 1536, metric: 'cosine', indexConfig: { type: 'flat' } })`. Non-transactional migration class documented for future `CREATE INDEX CONCURRENTLY` (HNSW).
- **Dependencies:** D merged; H4, H5, H6, H10.
- **Tests:** SQL reviewed; a local container applies up then down cleanly.
- **Owner actions after separately authorized hosted gates (not authorized by E1 merge):** reconcile the single Supabase migration ledger and reviewed SQL/target under H5; create and verify least-privilege `rag_app` under H6 **before** applying catalogue policies/grants; apply only the independently approved non-destructive migration; provision the `flat` PgVector space under its own approval; verify RLS, permissions, namespace and readiness (`NOT rolsuper`). Runtime DSN/credential changes require separate approval. **No logical dump, pre-migration backup or real restore is required or planned in the MVP** ([H10 owner decision](../../docs/decisions/RAG-H10-mvp-no-backup.md)); the storage-capacity ceiling and enforcement remain pending.
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
