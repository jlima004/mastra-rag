# H9C — Official source acquisition attempt and offline token-grid calibration

**Prepared:** 2026-11-23. **Baseline:** `master@242f529a5662cfd5b21e29465197f28d8d49ac9e` (H9B merged, CI/deploy/health confirmed). **Authorization:** owner approved progressing with controlled, read-only official-source acquisition and freezing provenance plus token-grid calibration, but **not** production ingestion, new host allowlists, paid calls, SQL/remote writes or automatic merge/deploy.

**Current state:** `H9C_OFFICIAL_REFERENCES_FOUND / DOU_HTTP_502 / RAW_OFFICIAL_BYTES_NOT_ACQUIRED / SNAPSHOT_NOT_FROZEN / TOKEN_GRID_SYNTHETIC_ONLY / PAID_EXECUTION_BLOCKED`.

## 1. Exact source set, unchanged manifest

The present candidate H9C set is **only the existing three entries in** `src/mastra/rag/contracts/manifest.ts`. There is no implicit addition of legal acts, no source/URL substitution, and no change to the approved host/path policy.

| Existing source ID | Canonical manifest URL | Evidence and remaining risk |
| --- | --- | --- |
| `br-planalto-lei-13709-2018` | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm | Official source page readable through web extraction, but source raw bytes, HTTP response/redirect chain, effective charset and normalized extraction unverified. |
| `br-anpd-res-15-2024` | https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024 | ANPD regulatory index lists nº 15/2024 as **Vigente**; canonical DOU fetch through research tool returned **HTTP 502**. Cannot freeze. |
| `br-anpd-res-18-2024` | https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-18-de-16-de-julho-de-2024-572632074 | ANPD regulatory index lists nº 18/2024 as **Vigente**; canonical DOU fetch through research tool returned **HTTP 502**. Cannot freeze. |

**Additional official reference — not a replacement:** the Planalto [LGPD compiled page](https://planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm) is readable through the research tool and contains amendments marked **Lei nº 15.352/2026** (including Art. 5º and Art. 55). A compiled text and the manifest's original URL are distinct references; verify their relationship, consolidation/revoked provisions, canonical identity and legal effective date before any corpus acceptance. Do **not** silently replace the current LGPD URL or source ID.

ANPD's [official regulations index](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/) also lists other acts/retifications (e.g. nº 2/2022 and nº 19/2024), intentionally outside the active MVP manifest. `gov.br` is outside the reviewed source allowlist; no automatic ingestion or allowlist expansion is authorized.

## 2. Acquisition evidence and blockers, 2026-11-23

- Public web search/reader successfully obtained **text-extraction views** of original Planalto LGPD, compiled Planalto LGPD and the official ANPD index. These are secondary *retrieval evidence*, **not raw-source snapshots**. The web extraction displayed corrupted accent characters for parts of Planalto: cannot infer correct charset or a canonical normalized hash from this.
- Direct raw-byte acquisition from the execution container for the manifest's Planalto URL **failed at DNS resolution**. No HTTP status/header, remote IP, TLS or bytes were observed in that direct attempt. This environment limitation is **not** a claim that the Planalto site itself was down.
- Both canonical `in.gov.br` resolutions returned **HTTP 502 from the research client**; not a reliable original response body or raw publication snapshot. Do not bypass a challenge, use unofficial mirrors or silently substitute a `gov.br` HTML/PDF representation.
- **No authentic raw SHA-256, normalized SHA-256, effective charset, final raw HTTP URL/redirect chain, frozen artifact or legal amendment-adjudication result exists yet.** No placeholder hashes will be invented and no page-reader text will be labeled as official bytes.
- Operator-script dependency is the pre-existing allowlisted, DNS-pinned, IPv4/TLS-verified `fetchApprovedSourceById`. It rejects disallowed redirects/addresses, unexpected response status/types and oversized responses. When it fails, the acquisition is blocked: **no fallback through an unapproved host.**

## 3. Safe operator-only snapshot procedure

The new `scripts/h9c-fetch-operator.ts` is **not called by CI, build, a hosted route or a scheduler**. It can be invoked only by an operator in an environment with allowed outbound HTTPS/DNS:

```bash
mkdir -m 700 -p /tmp/h9c-official-private
npm run rag:h9:acquire:operator -- br-planalto-lei-13709-2018 /tmp/h9c-official-private
npm run rag:h9:acquire:operator -- br-anpd-res-15-2024 /tmp/h9c-official-private
npm run rag:h9:acquire:operator -- br-anpd-res-18-2024 /tmp/h9c-official-private
```

**Do not infer that these commands were run successfully.** On successful acquisition and deterministic decoding/extraction/normalization, each writes an immutable, exclusive, mode-0600 raw HTML file and JSON receipt to an existing private mode-0700 directory **outside the repo**. It never overwrites existing evidence and never logs HTML, source body, secrets or raw parsing exceptions. The receipt contains raw/decoded/normalized SHA-256, charset, URL, timestamp and parser/source identity, explicitly marked `officialLegalTextAccepted: false` and `snapshotSemanticallyReviewed: false`. A successful network download or deterministic parser result still **does not** establish legally accurate current consolidated text; that requires independent amendment/revocation/retification review.

The current HTML extractor is explicitly a restricted fixture parser, not a proven real Planalto/DOU extractor; the operator script may fail closed on true portal HTML. A full HTML parser or revised extractor must receive its own package/version/security review and golden extraction comparison.

## 4. H9C offline token-grid implementation

The new `token-grid.ts` adds a **separate** renderer for the installed `js-tiktoken@1.0.21` local `cl100k_base` tokenizer. Profiles:

- Legal-structure: 256, 512, 1024 **model tokens**; no overlap, context headers included in the full input.
- Recursive comparator: 400 **model tokens**, 60-token **body overlap**.
- Scalar-safe UTF-16 source offsets; deterministic article/locator grouping, greedy children, binary-search split and exact `cl100k_base` measurement. Fail closed on per-profile over-cap, malformed/inconsistent normalized hashes and job caps. No network/provider access.
- Explicit algorithm version `legal-structure-token-greedy@1` or `recursive-token-window@1` and tokenization policy `cl100k_base/js-tiktoken@1.0.21` in the profile hash. The historical byte-proxy chunker and its `rag:chunkset-rendered:v2` identity formula are **unchanged**; new profile IDs yield distinct rendered chunk-set and chunk IDs. The new result is marked `provenance: synthetic-only-unverified-source` and `paidAdmissionApproved: false`.

Run `npm run rag:h9:grid:synthetic` to emit **aggregate-only** measurement receipts from the invented synthetic LGPD fixture. The result includes p50/p95/max, chunk count, over-target, locator intersections, body offset reconstruction, batch/retry-inclusive token envelope and estimated USD microcents using the current H11 offline quote. A synthetic output is **not** a measurement of current law, not evidence of retrieval quality, not provider-reported billing and not a published chunk/index.

## 5. Remaining approval gates

- [ ] Exact-HEAD CI all jobs, independent Codex review, owner merge/deploy authorization.
- [ ] Successful operator HTTPS acquisition for all **three** manifesto URLs with exact raw/normalized SHA and private frozen bytes, or explicit owner adjudication of a narrower/changed corpus.
- [ ] Review true redirects, hostname/IP/TLS, charset, copyrights, anchors, revoked/amended norms, official effective dates, extraction fidelity; approve parser dependency if needed.
- [ ] Independently validate snapshot completeness and correct legal locators; do not treat a single hash as proof of legally operative content.
- [ ] Run the new four-profile grid on the **same frozen approved official corpus**, with per-profile identity/goldens, evidence reproducibility, full-body article/inciso offsets, overlap and H11 budget projections; then ratify selected profile.
- [ ] H12 retention/erasure, E2 atomic durable reservations, direct OpenAI project billing and project-scoped secret route, first bounded paid smoke **remain blocked**.

**H9C is not COMPLETE:** this PR is intentionally an offline tooling milestone and documented official-source acquisition blocker, not a legal corpus acceptance, ingestion or paid-execution release.
