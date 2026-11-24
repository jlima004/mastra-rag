# H9C — Official source acquisition attempt and offline token-grid calibration

**Prepared:** 2026-11-23. **Baseline:** `master@242f529a5662cfd5b21e29465197f28d8d49ac9e` (H9B merged, CI/deploy/health confirmed). **Authorization:** owner approved progressing with controlled, read-only official-source acquisition and freezing provenance plus token-grid calibration, but **not** production ingestion, new host allowlists, paid calls, SQL/remote writes or automatic merge/deploy.

**Current state (R1 in progress, 2026-11-24):** `H9C_OPERATOR_ATTEMPTS_RECORDED / ARCHIVE_SECURITY_R1_IMPLEMENTED_CANDIDATE / EXACT_HEAD_CI_AND_CODEX_PENDING / OFFICIAL_CORPUS_UNFROZEN / PAID_EXECUTION_BLOCKED`. Original PR #36 R0 had **three blocking Codex P2s** on output confinement and partial writes; neither prior green CI nor a subsequent successful operator HTTP response makes the source corpus accepted.

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
- **WSL operator results (2026-11-23):** `br-planalto-lei-13709-2018` returned `FETCH_TIMEOUT` (transport root cause not proven); both ANPD DOU sources returned `EXTRACT_UNSUPPORTED_HTML` using the pre-R1 parser-before-archive code. In the latter cases, fetching and decoding advanced to extraction, **but no raw evidence was preserved**, and there is no proof the responses contained the correct legal texts. The WSL process used Node v24.22.3; CI uses Node 22, with **no causal attribution** to this difference.
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

**Operator attempts above were unsuccessful; do not repeat them until R1 exact-HEAD CI, security review and human approval.** The R1 implementation uses `openH9CPrivateArchiveDirectory()` from `private-archive.ts`: the real checkout root is derived from its own module location, not `process.cwd()`; the output must be an absolute canonical **private mode-0700** directory outside the checkout, with trusted ancestor chain (root-owned sticky `/tmp` is supported). A Linux directory fd is opened **before** network access; writes use `/proc/self/fd/<fd>/...` and revalidate the pinned inode/path, preventing changes to the pathname from redirecting evidence into a symlink target. R1 is **Linux/WSL only**, fails closed on unsupported platforms, and does not attempt to defeat an attacker with the same trusted user privileges.

On a successful manifest-allowlisted 200/HTTPS response, **raw bytes are retained in private quarantine even if deterministic HTML parsing fails**. Extraction classification is separately recorded as `unreviewed-parsed` or `unsupported` with a fixed error code and null normalized hash on failure. The archive publishes raw and receipt via exclusive **hard links** from fsynced private staging files; **the receipt is last and is the commit marker**. A failed operation rolls back only inode-matched artifacts created by that attempt. Original bytes, the source URL/charset, SHA-256 and parser status are kept in the private receipt; the CLI prints limited hashes/status, not raw source HTML or exceptions. Both `officialLegalTextAccepted` and `snapshotSemanticallyReviewed` are **always false**. Full current consolidated legal text still requires independent review. These are implementation claims to be verified by exact-HEAD CI and Codex; not proof of successful government-site acquisition.

The current HTML extractor is explicitly a restricted fixture parser, not a proven real Planalto/DOU extractor; **R1 quarantines unsupported responses without promoting them to legal text**. An upstream `FETCH_TIMEOUT`, DNS/SSRF rejection, charset sniffing conflict or non-200 response still fails closed without a raw snapshot. A full HTML parser or revised extractor must receive its own package/version/security review and golden extraction comparison.

## 4. H9C offline token-grid implementation

The new `token-grid.ts` adds a **separate** renderer for the installed `js-tiktoken@1.0.21` local `cl100k_base` tokenizer. Profiles:

- Legal-structure: 256, 512, 1024 **model tokens**; no overlap, context headers included in the full input.
- Recursive comparator: 400 **model tokens**, 60-token **body overlap**.
- Scalar-safe UTF-16 source offsets; deterministic article/locator grouping, greedy children, binary-search split and exact `cl100k_base` measurement. Fail closed on per-profile over-cap, malformed/inconsistent normalized hashes and job caps. No network/provider access.
- Explicit algorithm version `legal-structure-token-greedy@2` (R2) or `recursive-token-window@1` and tokenization policy `cl100k_base/js-tiktoken@1.0.21` in the profile hash. The historical byte-proxy chunker and its `rag:chunkset-rendered:v2` identity formula are **unchanged**; new profile IDs yield distinct rendered chunk-set and chunk IDs. The new result is marked `provenance: synthetic-only-unverified-source` and `paidAdmissionApproved: false`.

Run `npm run rag:h9:grid:synthetic` to emit **aggregate-only** measurement receipts from the invented synthetic LGPD fixture. The result includes p50/p95/max, chunk count, over-target, locator intersections, body offset reconstruction, batch/retry-inclusive token envelope and estimated USD microcents using the current H11 offline quote. A synthetic output is **not** a measurement of current law, not evidence of retrieval quality, not provider-reported billing and not a published chunk/index.

## 5. Remaining approval gates

- [x] R1 exact-HEAD CI **196/196 PASS** on `6c79ac2505`; three original archive P2 threads corrected and resolved.
- [ ] **R2 exact-HEAD** CI, independent Codex review of header/body Unicode regressions and *new* structural profile version, independent security gate and human merge/deploy authorization. Prior R1 green CI is not transferable.
- [ ] Successful operator HTTPS acquisition for all **three** manifesto URLs with exact raw/normalized SHA and private frozen bytes, or explicit owner adjudication of a narrower/changed corpus.
- [ ] Review true redirects, hostname/IP/TLS, charset, copyrights, anchors, revoked/amended norms, official effective dates, extraction fidelity; approve parser dependency if needed.
- [ ] Independently validate snapshot completeness and correct legal locators; do not treat a single hash as proof of legally operative content.
- [ ] Run the new four-profile grid on the **same frozen approved official corpus**, with per-profile identity/goldens, evidence reproducibility, full-body article/inciso offsets, overlap and H11 budget projections; then ratify selected profile.
- [ ] H12 retention/erasure, E2 atomic durable reservations, direct OpenAI project billing and project-scoped secret route, first bounded paid smoke **remain blocked**.

### R1 security remediation and test matrix (2026-11-24)

- **P2-01 checkout exclusion:** derive repository root from `import.meta.url` inside `private-archive.ts`; deny writes under it even when CLI is invoked from a different cwd. Synthetic regression exercises this condition.
- **P2-02 directory substitution:** open a pinned Linux directory handle before network await, require 0700 owner-only output and trustworthy ancestors, create all staging/final files through `/proc/self/fd/<fd>` rather than re-resolving an attacker-swapped name, and fail if the pinned directory path/inode changed. Regression renames the original private directory and replaces its former name with a world-readable symlink; no evidence is emitted to the decoy.
- **P2-03 incomplete artifacts:** stage and fsync full raw+JSON files, verify byte counts, hard-link each exclusive final artifact and publish the receipt last. Any failure removes only current-attempt inode-matched stages/final links. Synthetic disk-full and receipt-collision tests verify no truncated final evidence or deletion of old receipts.
- **Parser separation:** `source-quarantine.ts` classifies valid fetched responses independently; unsupported real HTML (or a non-legal interstitial) may be preserved only as **unreviewed private bytes** with `normalizedSha256: null`, explicit parse error code and acceptance flags false. Parser failures are not retried via alternate hosts.
- **Test scope:** all new regression fixtures are synthetic and offline. No evidence of a successful real-site fetch or semantically complete legal extraction is claimed. Subsequent live retry requires distinct operator authorization after independent review.

### R2 Unicode header-capacity remediation (2026-11-24)

Codex identified a **new** P2 on R1 HEAD `6c79ac2505`, separate from the three resolved archival P2s: `selectHeader()` measured `'x'` rather than the actual next Unicode scalar, so an overlong breadcrumb/caput could pass admission for ASCII but fail on a subsequent multítoken scalar such as `🧪`.

- Header choices remain ordered: **breadcrumb + caput**, **breadcrumb**, **article locator**. The first non-whitespace Unicode scalar **from the actual source span**, including any leading whitespace, is now measured with the complete header and separator; no fabricated ASCII exemplar is used.
- The token-window renderer **reselects the header independently at every subsequent UTF-16 scalar-aligned window start**. This allows safe downgrade when the first window fits a rich header but the next starts with a higher-cost emoji. Header contents are context only; source bytes, article locators, UTF-16 offsets, `legalUnitIds` and exact counts must stay intact.
- R2 explicitly versions the structural algorithm as `legal-structure-token-greedy@2`. This changes **structural** profile IDs, rendered chunk-set IDs and chunk identities, rather than silently reusing the R0/R1 `@1` identity; recursive `recursive-token-window@1` and legacy byte proxy remain unchanged. No production profile migrated or enabled.
- Three new synthetic offline regressions seek **actual cl100k_base near-capacity boundaries**: first-scalar emoji fallback; later-window `x` → `🧪` downgrade; and old-vs-new profile identity with recursive preservation. All keep the original legal-source acquisition and paid gates blocked.

**R2 candidate ≠ approval:** exact new HEAD CI, Codex review and original P2 thread closure remain required. No additional live Planalto/DOU request or paid OpenAI call was authorized or executed.

**H9C is not COMPLETE:** this PR is still an offline tooling milestone with official-source acquisition blocked; source snapshots, legal QA, ingress and paid execution remain unapproved.
