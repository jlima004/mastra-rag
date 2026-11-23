# H9 — Tokenizer calibration: offline preparation and dependency gate

**Prepared:** 2026-11-23. **Baseline:** master at 824f07b0932b16a94f28ea7002927698e42f70ad (H11 offline merged; CI/deploy reported successful).

**State:** H9_OFFLINE_ASSAY_DRAFT / EXACT_TOKENIZER_DEPENDENCY_NOT_APPROVED / OFFICIAL_CORPUS_UNVERIFIED / H9_CALIBRATION_NOT_RUN / PAID_EXECUTION_BLOCKED.

## 1. Authorization and boundaries

The owner directed progress on H9. The already ratified Stage A dependency policy authorizes **evaluation**, not implicit installation: exact parser/tokenizer packages require separate version, license, maintenance, security, bundle and owner approval. This Draft adds **no new dependency or lockfile update**, performs **no paid OpenAI API call**, no live government fetch, and does not alter hosted DB, provider settings, routes, credentials or deployments.

H11 financial consent and owner-UI evidence of the enforced USD 2/month provider limit do **not** independently enable paid requests. H9, H12, direct billing-route verification, and the E2 durable atomic reservation ledger remain execution gates.

## 2. Technical baseline

- The OpenAI [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings) and [token-count Help article](https://help.openai.com/en/articles/8984337-how-can-i-tell-how-many-tokens-a-string-will-have-before-i-try-to-embed-it) specify **cl100k_base** for third-generation embedding models, including text-embedding-3-small.
- Step C structural and recursive chunkers use the explicitly experimental **utf8-byte-proxy@1**, with 512-byte and 400-byte configurations, not model-token limits. Step D computes **UTF-8 bytes plus eight** for each full embedding input, not a demonstrated tokenizer count or billing maximum.
- Step C's versioned pipeline profile and rendered chunk-set ID v2 must not silently change. Its synthetic legal HTML fixture is invented, never an authoritative LGPD snapshot.
- The SPEC proposes legal-structure 512 tokens/hard cap 1024 and recursive baseline 400 tokens/60 overlap. A measured 256/512/1024 quality grid requires **actual re-chunking** and comparison on the same reviewed official source, not only running a counter on existing byte chunks.
- A local tokenizer count cannot prove provider billed usage or persistent concurrency-safe spending enforcement.

## 3. H9A: this Draft's offline-only implementation

**src/mastra/rag/processing/token-calibration.ts** takes an injected, *unverified* counter that declares cl100k_base and samples of the exact **OfflineChunk.content** (legal context header, separator and body together). It produces aggregate-only total, nearest-rank p50/p95/max, counts over 256/512/1024 and the provider 8191-token per-input ceiling, along with UTF-8-bytes-plus-eight differences. It rejects malformed IDs, duplicates, invalid Unicode, empty content, overlarge inputs, malformed counts and throwing counters without revealing raw values.

**The report always states:** evidenceClass = synthetic-fixture-only, counterTrust = injected-unverified, liveAdmissionApproved = false. It is not a certificate of actual tokenization, not a new chunker, not an approval to make paid calls, and not a simulation of the 256/512/1024 re-chunking grid.

**token-calibration.test.ts** covers full-content measurement, synthetic grid edges, percentiles, byte-proxy underestimation, provider limits, malformed inputs, exceptions and permanently disabled admission.

No previous pipeline profile, chunk identity, Step D estimate, H11 quote, SQL, external URL or production code path is changed.

## 4. Package-specific evaluation (proposal, not installed)

| Candidate | Relevant evidence | Remaining review |
| --- | --- | --- |
| **js-tiktoken@1.0.21** (preferred evaluation) | [npm](https://www.npmjs.com/package/js-tiktoken) lists MIT license, pure JS, cl100k_base rank-only import and one direct dependency (base64-js) | Exact version and integrity, transitive lockfile and audit, maintenance/advisories, bundle size, CPU/memory, no CDN or runtime fetch |
| **tiktoken@1.0.22** (fallback) | [npm](https://www.npmjs.com/package/tiktoken) describes MIT JS/WASM bindings | Verify WASM file packaging, runtime compatibility in Mastra Cloud, size/startup and complete security review |

Sources checked 2026-11-23. Public security indexes reported no known **direct** issues at the time; this is not a security sign-off or proof of absence of vulnerabilities. **Neither candidate is installed, benchmarked or package-specifically authorized.** Avoid importing all tokenizer ranks when a single cl100k_base rank is sufficient.

## 5. Required H9B calibration evidence

1. **Dependency approval:** owner separately ratifies an exact package/version after reviewing license, integrity, transitive dependencies, static risk, npm audit, output-size impact, Node 22 and Mastra Cloud packaging. Pin in package + lockfile only in that separately authorized Draft.
2. **Official source:** capture and verify the current authoritative Planalto LGPD and selected ANPD/DOU acts via an approved operator method. Record source URL, effective charset, amendment/revocation handling, retrieval date, raw/normalized SHA256 and provenance. Never claim the synthetic fixture is real law; fail closed when sources are inaccessible.
3. **Re-chunking grid:** run deterministic, truly token-based 256/512/1024 legal-structure profiles plus the 400-token/60-overlap recursive comparator. Measure real tokenizer p50/p95/max, count, clipping, locator coverage, offset fidelity, overlap and H11 worst-case retry cost for the **same** legally verified corpus. The H9A report alone does not run this grid.
4. **Version integrity:** changing from utf8-byte-proxy@1 to a token-based pipeline changes the pipeline profile hash, rendered chunk-set ID and chunk IDs. Add independent golden values and avoid reusing legacy IDs or bypassing persistence schema approval.
5. **Provider reconciliation:** before any first bounded paid smoke, H9 must be complete, H12 resolved, the intended OpenAI API billing project and private key route verified, and E2 atomic reservations tested. Compare provider-reported usage against offline tokenizer counts only under separate paid-smoke authorization. No CI live API usage.

## 6. H9 gate checklist

- [x] Pure offline audit seam and synthetic tests prepared; no provider access, dependency or runtime change.
- [ ] Current Draft exact-HEAD CI, independent Codex review and human release decision.
- [ ] Owner explicitly authorizes a package-specific tokenizer installation in separate H9B Draft.
- [ ] Verified official legal corpus snapshot / parser suitability.
- [ ] Real cl100k_base counts and token-based re-chunking grid measured and independently reproducible.
- [ ] H9 signed off for E2. H12, billable-route proof, atomic ledger, and first paid smoke remain separate.

**Next owner decision:** whether to authorize evaluation and conditional installation of js-tiktoken@1.0.21 in a **new H9B Draft**, only after package-specific security and integrity review. No merge, deploy or paid execution follows automatically.
