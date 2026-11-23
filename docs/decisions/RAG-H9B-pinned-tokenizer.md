# H9B — Exact cl100k_base tokenizer integration (synthetic-only gate)

**Date:** 2026-11-23. **Baseline:** `master@ac3ef85eb81a014398419dee684a36d86acb5a99` (PR #33 H9A offline merged, deployed and health-checked by owner).

**Scope:** owner instructed to advance H9B after H9A. This Draft installs and exercises a pinned local tokenizer **offline**. No production chunking profile/IDs, hosted schema, provider usage, billed routing, credentials, remote fetch, ingestion or deployment changes are permitted by this step.

**Current state:** `H9B_PINNED_DEPENDENCY_CANDIDATE / CI_SECURITY_REVIEW_PENDING / OFFICIAL_CORPUS_UNVERIFIED / TOKEN_GRID_NOT_CALIBRATED / PAID_EXECUTION_BLOCKED`.

## 1. Dependency selection and technical evidence

| Control | Evidence and disposition |
| --- | --- |
| Package and version | **`js-tiktoken@1.0.21`**, pinned exactly in package.json and lockfile. Version confirmed on [npm](https://www.npmjs.com/package/js-tiktoken). |
| License/implementation | Publisher-declared **MIT**; pure JavaScript BPE; unlike the alternative `tiktoken@1.0.22` (WASM), no WASM binary-loading problem is introduced. License/maintenance risk still subject to independent review. |
| Transitives | One direct dependency: `base64-js@^1.5.1`; existing lockfile version **1.5.1** with its preexisting integrity. `base64-js` promoted from dev-only to production because the new package needs it. |
| Integrity | `js-tiktoken` tarball SRI **`sha512-biOj/6M5qdgx5TKjDnFT1ymSpM5tbd3ylwDtrQvFQSu0Z7bBYko2dF+W/aUkXUPuk6IVpRxk/3Q2sHOzGlS36g==`**, cross-checked from [independent published lockfile](https://huggingface.co/spaces/rajesh-huggingface/fitcircle-backend/blob/main/package-lock.json) and [another published lockfile](https://www.lmstudio.ai/variablechange/rag-v2/files/package-lock.json). **Not independently fetched from npm registry in the operator environment.** GitHub CI `npm ci` must validate fetched content against the pinned SRI before this gate passes. |
| Tokenizer mapping | OpenAI `text-embedding-3-small` uses `cl100k_base`. Only `js-tiktoken/lite` and local `js-tiktoken/ranks/cl100k_base` imported; **no CDN fetch, no OpenAI API call**. |
| Independent golden | [OpenAI tiktoken test](https://github.com/openai/tiktoken/blob/main/tests/test_encoding.py) asserts `hello world → [15339, 1917]` (two tokens); test suite also checks `Hello, world! → 4` and pt-BR Unicode acceptance. |
| Known security evidence | Public [Snyk](https://security.snyk.io/package/npm/js-tiktoken) and [Aikido](https://intel.aikido.dev/packages/npm/js-tiktoken) package indexes show no known direct advisories on this version at inspection time. **Not an independent full security audit.** Initial candidate-head CI `npm ci` reported **6 moderate severity advisories in the complete dependency tree**, with affected paths not yet adjudicated. The revised CI now runs `npm audit --omit=dev --audit-level=high` to gate high/critical production vulnerabilities. This **does not** clear moderate vulnerabilities, dev dependencies, tampering checks or full supply-chain/security review. |
| Bundle/platform | NPM published unpacked package size approximately 21 MB ([public metadata](https://www.pkgpulse.com/packages/js-tiktoken)); selective rank import limits runtime graph relative to full imports, but does **not** prove the production build size. Node 22/Mastra production build and package install must pass CI; actual Mastra Cloud hosted compatibility remains unverified until a separately approved deployment. |

## 2. Changes in this candidate

- `src/mastra/rag/processing/cl100k-counter.ts`: lazy local `Tiktoken` from the pinned rank-only `cl100k_base` import, fixed error code and no raw-text/third-party exception propagation.
- `cl100k-counter.test.ts`: independent OpenAI golden counts, pt-BR/Unicode coverage, frozen financial/authorization labels, and audit of exact **synthetic** Step C chunk inputs (headers included).
- `scripts/h9-audit-synthetic.ts` and `npm run rag:h9:synthetic`: deterministic aggregate-only receipt, including fixed synthetic fixture SHA256, current byte-proxy pipeline profile ID, rendered chunk-set ID, token distribution, thresholds and under/over-count vs Step D's byte+8 planning proxy. No source text or provider secrets.
- CI runs this local command after unit tests with **no provider key**. Package/lockfile pins are part of this change.
- **Explicitly untouched:** `src/mastra/rag/processing/chunk.ts` (still `utf8-byte-proxy@1`), rendered-ID formula, Step D live planner and `allowPaidCalls=false` default, H11 quote/budgets, Supabase/Turso data, Mastra registered routes.

**Critical limitation:** the H9A audit return type intentionally remains `counterTrust: injected-unverified`, `evidenceClass: synthetic-fixture-only`, `liveAdmissionApproved: false`. The new pinned counter supplies local real `cl100k_base` tokenization, but the **report is not independent verification of actual provider usage or official legal-source correctness**. No caller can infer live-use admission from this record.

## 3. Official LGPD/ANPD discovery, not official corpus acceptance

Read-only external research on 2026-11-23 found these authoritative candidates:

1. [Planalto, Lei 13.709/2018, compiled text](https://planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm). The existing reviewed manifest points to [original LGPD page](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm); **do not silently change** its canonical identity or merge those two documents.
2. [ANPD — official regulatory acts index](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/), including Resolução CD/ANPD nº 15/2024 (security incident reporting). This portal is NOT on the existing MVP manifest host allowlist; do not extend it or substitute a mirror without independent review. Actual DOU canonical publication still needs selection.

**None** of these links is accepted as a byte-for-byte, frozen, legally accurate snapshot yet. Host/path allowlist, redirects, TLS, charset, raw hash, consolidated/revoked wording, amendments, effective date, extraction fidelity, licensing and version identity all need an independently audited operator fetch/snapshot receipt. No source HTML from these pages is bundled into the PR. CI runs only the invented synthetic fixture.

## 4. Remaining H9 measured calibration (H9C gate)

- [ ] CI `npm ci` verifies SRI and pinned dependency under Node 22; run all tests, typecheck, synthetic audit and Mastra build/auth smoke.
- [ ] Independent Codex/security review for exact HEAD: supply chain, lockfile delta, startup/bundle, exception/redaction, fixture claims, missing owner authorization assumptions.
- [ ] Reconcile results of the new high/critical production gate `npm audit --omit=dev --audit-level=high` on revised exact HEAD; independently triage the 6 reported moderate advisories and compare their paths against the pre-H9B baseline. Full dependency and tarball security review remains separate; public advisory summaries are insufficient.
- [ ] Human approval of merge/deploy. Until then, this remains Draft.
- [ ] Explicitly approve and capture/verify official corpus snapshots as described above.
- [ ] New **versioned** true token-based chunkers, with 256/512/1024 structural profile grid and 400/60 recursive comparator; re-render same official corpus, measure count/p50/p95/max, clipping, legal locator/offset coverage and H11 retry-inclusive token/cost envelopes.
- [ ] Resolve H12 retention and E2 durable atomic token/$ reservations; prove direct OpenAI API project billing and project-scoped key custody before separately authorizing a bounded paid call. H11 provider USD 2/month cap does not replace app admission.

**Next decision:** after exact-HEAD CI, security review and evidence receipt, the owner decides whether to merge this isolated offline H9B tokenizer integration. Official-corpus and live-use gates remain separate.
