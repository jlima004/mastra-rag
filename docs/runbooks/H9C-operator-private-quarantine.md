# H9C — Operator runbook: private official-source quarantine and triage

**Date:** 2026-11-24. **Baseline:** `master@78eba30a7213c9667a0e1493ca9fa194f00dc570` (PR #36 merged, healthcheck live). **Scope:** user-authorized **read-only** WSL acquisition of the three existing manifest entries, local private evidence inspection and human legal provenance gate. This runbook and the inspector are staged in a **separate Draft PR**. Do not merge/deploy automatically.

## Status and permissions

- **Owner authorization:** repeat controlled acquisition of existing Planalto LGPD and two DOU/ANPD sources in WSL, diagnose failing fetch/extraction, compare with government-issued text, and perform official-corpus calibration **only after source verification**.
- **No authorization:** changing the three-source manifest, adding hosts or redirect allowances, bypassing web controls, storing raw page data in GitHub/CI, changing production Supabase/vector tables, accepting law automatically, calling paid OpenAI APIs, or merging/deploying this inspection Draft.
- Current manifest URLs: `br-planalto-lei-13709-2018` (original Planalto LGPD page), `br-anpd-res-15-2024` (in.gov.br DOU), `br-anpd-res-18-2024` (in.gov.br DOU). **Do not replace original Planalto with compiled LGPD** without separate canonical-identity decision.
- Previous pre-R1 operator results were `FETCH_TIMEOUT` (Planalto) and `EXTRACT_UNSUPPORTED_HTML` (both DOU entries). They provided no frozen raw evidence. R1/R2 work merged in PR #36, but there has been no recorded post-R1 operator re-fetch.
- The separate specialized security review of the archive path has no independent completion receipt; that is an **assurance debt**, even though code review, 199/199 tests and the user's deployment were successful.

## 1. Local WSL preparation

From the owner's WSL checkout (not a cloud shell):

```bash
cd ~/Projetos/mastra-rag
git fetch origin
git switch feat/h9c-operator-quarantine-inspection
git pull --ff-only origin feat/h9c-operator-quarantine-inspection
npm ci
umask 077
mkdir -p -m 700 /tmp/h9c-official-private
chmod 700 /tmp/h9c-official-private
```

The directory **must remain private mode 0700 outside the repository**. Never paste source HTML, DOU body, file paths with secrets, `.env` values, raw response headers or network proxy credentials into GitHub/ChatGPT. This step does **not** run a provider API.

## 2. One controlled fetch per source, no bypass/retry loop

Run **each** command separately, preserving only the operator's sanitized JSON response or uppercase fixed error code:

```bash
npm run rag:h9:acquire:operator -- br-anpd-res-15-2024 /tmp/h9c-official-private
npm run rag:h9:acquire:operator -- br-anpd-res-18-2024 /tmp/h9c-official-private
npm run rag:h9:acquire:operator -- br-planalto-lei-13709-2018 /tmp/h9c-official-private
```

On **HTTP 200** accepted by existing pinned HTTPS checks, the implementation writes an exclusive private `*.source.html` and a `*.receipt.json` containing source ID, canonical/final URL, charset, raw SHA-256 and parse status. Crucially, a valid response that the restricted HTML parser cannot handle is still **archived as `extractionStatus: unsupported`**; this does **not** show that the payload is the official act rather than a portal interstitial.

If `FETCH_TIMEOUT` repeats for Planalto, do not use alternate mirrors/hosts or HTTP fallback. The existing fetcher conflates several transport exceptions with `FETCH_TIMEOUT`; it does **not** prove whether the cause was TCP, TLS, time-to-first-byte or overall timeout. A *separate*, DNS-only observation (no document fetch) is:

```bash
node --input-type=module -e 'import {lookup} from "node:dns/promises"; const h="www.planalto.gov.br"; try { const a=await lookup(h,{all:true}); console.log("PLANALTO_DNS_OK",a.length,"ipv4",a.filter(x=>x.family===4).length,"ipv6",a.filter(x=>x.family===6).length) } catch { console.log("PLANALTO_DNS_FAILED") }'
```

This only distinguishes DNS success/failure. A correct HTTPS connection or legal-source availability is **not** implied by DNS success. Root-cause remediation of persistent timeout should be a separate narrowly reviewed transport diagnostic, not a silent extension of allowed IP families, retry window or hosts.

## 3. Offline quarantine inspection — do not print raw page contents

```bash
npm run rag:h9:inspect:operator -- /tmp/h9c-official-private
```

The new inspector verifies private file permissions and SHA-256, matches the receipt's source and canonical/final URL to the **unchanged manifest**, and returns only an aggregate diagnostic receipt with `sourceStatus`, `extractionStatus` and boolean HTML/legal-marker/challenge indicators. **No source HTML, URL, document title, raw page header or filesystem path is printed.** Share only this JSON and the three fixed operator command results.

The inspector is a *diagnostic*, not a parser replacement or legal verifier. It may flag a CAPTCHA or an access page, but absence of such a flag never proves valid legal text. If it returns `H9C_INSPECTION_FAILED`, preserve the private directory and return only that error, without uploading the private files. A malformed/mismatched receipt fails closed; no automatic repair or override.

## 4. Human provenance and parsing decision

Read-only reference materials (not auto-added to the fetch allowlist):

- [ANPD regulations index](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/): at review time, both Resolutions 15/2024 and 18/2024 were marked **Vigente**.
- [ANPD official-resolution source PDF](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/processo_integra_-resolucao_cd_anpd_no_18_2024.pdf) for 18/2024 and [Ministry of Justice Digital Library DOU copy](https://bibliotecadigital.mj.gov.br/bitstream/1/12879/1/RES_ANPD_2024_15.pdf) for 15/2024 provide **cross-check candidates**. Their text/version/identity must be verified independently; they do **not** replace the authorized `in.gov.br` canonical pages.
- [Planalto compiled LGPD](https://planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm) contains legislative-change markup, including changes from **Lei nº 15.352/2026**; confirm consolidation, effective date and differences with the manifest's original LGPD URL. Do not silently change source ID/canonical identity.

Before marking a snapshot authoritative, explicitly check: expected official act header and full annex; article/inciso sequence; DOU edition/page/publication date; legal amendments, effective date/revocations/corrigenda; raw charset and decoded text; proof the raw response is not a challenge or error page; raw, decoded and normalized SHA-256 with extractor version; and independent cross-check against the official publication. If the HTML parser fails on actual official law, propose a **new separately reviewed parser/extractor** with retained raw snapshot. A 200 response or JSON receipt alone is never an acceptance.

## 5. Calibrate only the same legally accepted frozen corpus

After the source-review gate passes, use the already merged pinned `cl100k_base/js-tiktoken@1.0.21` and `legal-structure-token-greedy@2` implementation to run 256/512/1024 legal profiles and the recursive 400-token/60-overlap comparator. Do not run `npm run rag:h9:grid:synthetic` and label it as official calibration: that command intentionally measures invented fixtures.

The future official run needs a **separately reviewed read-only local driver** accepting validated frozen snapshots, preserving the exact profile and content hashes, and reporting full-input counts (including headers), p50/p95/max, legal locator/offset coverage, retry-inclusive H11 estimates and identity reproducibility. The existing `H9RenderedTokenSet.provenance` is explicitly `synthetic-only-unverified-source`; do not silently change this type or promote production usage. Keep H9C Issue #35 open until that evidence is ratified.

**Release classification:** `H9C_OPERATOR_RETRY_AUTHORIZED / PRIVATE_INSPECTION_DRAFT / OFFICIAL_CORPUS_UNFROZEN / H12_E2_PENDING / PAID_EXECUTION_BLOCKED`.

## Observed WSL acquisition outcomes — 2026-11-25

The operator executed the existing canonical manifest IDs from the local WSL Node v24.22.3 checkout. Results from the operator's **own sanitized output**:

| Manifest source | Raw SHA-256 | Bytes | Local stage | Legal acceptance |
| --- | --- | ---: | --- | --- |
| `br-anpd-res-15-2024` | `115ce3abf2408d2677a54606dd848a8126f38a550922d538f94ca41c28f6c7f2` | 114363 | `H9C_OPERATOR_BYTES_QUARANTINED_UNREVIEWED`, extractor `EXTRACT_UNSUPPORTED_HTML` | NO |
| `br-anpd-res-18-2024` | `08ddc82b4d643f55bbea4369bf9783144beaabefbccaeb4116fa1d0d5d97f601` | 100459 | `H9C_OPERATOR_BYTES_QUARANTINED_UNREVIEWED`, extractor `EXTRACT_UNSUPPORTED_HTML` | NO |
| `br-planalto-lei-13709-2018` | — | — | `FETCH_TIMEOUT` on **two operator attempts** | NO |

No actual raw HTML, private receipt files or response headers were uploaded to GitHub. Both DOU files must stay **private and immutable**, as frozen *unreviewed transport artifacts*; an HTTP 200 does not prove that they contain the legally correct resolutions. They have `normalizedSha256: null`. Do not needlessly fetch the DOU pages again.

The operator then exited fish and ran the DNS-only Planalto diagnostic in **Bash**, which returned `{ dns: 'OK', ipv4: 1, ipv6: 0 }`. The failure to run Bash `<<'JS'` syntax directly in fish was a shell-syntax issue, **not** a DNS failure. DNS success does not prove TLS or source-page availability; the existing transport can map multiple request exceptions into `FETCH_TIMEOUT`. Do not broaden DNS, IPv4, certificate or allowlist gates. If needed, use the following **fish-safe, DNS-only** equivalent without a heredoc:

```bash
node --input-type=module -e 'import { lookup } from "node:dns/promises"; try { const a = await lookup("www.planalto.gov.br", { all: true }); console.log({dns:"OK", ipv4:a.filter(x=>x.family===4).length, ipv6:a.filter(x=>x.family===6).length}); } catch { console.log({dns:"FAILED"}); }'
```

## Inspector security R2 (new findings on PR #37)

Codex reviewed exact R1 HEAD `62609583d4a7dfc0b80444ff1e3a55df2feee6a8` and identified **two blocking P2s**, despite 206/206 tests and 4/4 CI success:

1. A raw receipt `extractionErrorCode` could include an injected Authorization header, file path or HTML, which the inspector would print without filtering.
2. Directory inspection validated only leaf permissions and then re-resolved the directory path, permitting an attacker-writable ancestor to be replaced between validation and reads.

The R2 candidate **restricts `extractionErrorCode` to known `assessH9CQuarantinedResponse` failure codes**, rejecting any arbitrary string. All enumeration and source/receipt reads now **reuse `openH9CPrivateArchiveDirectory`'s verified Linux directory fd**, trusted ancestor chain and inode/path stability checks, `O_NOFOLLOW`, and owner-only file/mode/size checks. Synthetic regressions exercise injected credentials, swapped ancestor/leaf paths, world-writable nonsticky ancestor, symlink evidence and in-place source modification. **These implementation notes are not a security approval**: exact R2 HEAD CI, Codex code/security re-review and human merge gate remain pending.

**Next operator command (after R2 review):** `npm run rag:h9:inspect:operator -- /tmp/h9c-official-private`. Do not paste raw HTML or private receipts here; share the sanitized JSON result only. No further government-site fetch is required to inspect the two already quarantined DOU artifacts.

**Current gate:** `DOU_TWO_QUARANTINED_UNREVIEWED / PLANALTO_DNS_OK_FETCH_TIMEOUT / R2_INSPECTOR_SECURITY_REVIEW_PENDING / OFFICIAL_CORPUS_UNFROZEN / PAID_EXECUTION_BLOCKED`.

## 6. E2-MVP retention and erasure candidate

The H12 policy is experimental and awaits owner ratification. Published documents stay in the corpus. Manual garbage collection considers superseded and failed builds after seven days. The collector protects the current pointer, the previous pointer while its rollback window remains open, active jobs, and ambiguous attempts pending reconciliation. The operator can run a dry-run through the internal `collectIngestionGarbage(pool)` entrypoint. Review the returned document, chunk-set and space IDs. Pass `{ dryRun: false }` to apply the collection. Each build is revalidated under the same PostgreSQL document lock used by ingest and publication. Run another pass for a retry-required outcome. The next pass reevaluates durable state, including transactions whose commit acknowledgement was lost.

Use the internal `deleteIngestedDocument(pool, documentId)` or `deleteIngestedSource(pool, sourceId)` operation for an authorized erasure. The first commit sets tombstones, removes publications, and cancels active claims. The second operation deletes and verifies the vectors in namespace `public` and removes the derived catalog text. A failed purge leaves the tombstone and `rag.document.purge_pending_at` in place. Re-run with the same ID until each affected document has a committed `purged_at`. Reconcile conflicting projection metadata or an unsupported space before retrying. A deleted source blocks first-time ingestion as well as republication. Job, reservation and attempt rows remain available for reconciliation, together with document/version identifiers, hashes, and minimum provenance.

On the disposable PostgreSQL 17 fixture, the same operations are available through the local entrypoint.

```bash
npm run rag:e2:local -- gc
npm run rag:e2:local -- gc --apply
npm run rag:e2:local -- delete-document "$SYNTHETIC_DOCUMENT_ID"
npm run rag:e2:local -- delete-source "$SYNTHETIC_SOURCE_ID"
```

The local entrypoint checks the database name, role, PostgreSQL version and disposable fixture marker.

### Private files and external content

1. For an authorized erasure, identify the exact source ID, document ID, raw SHA-256 and affected versions. Use the existing private archive inspector and descriptor checks to match receipts and payloads in the approved archive. Check the owner-controlled archive directory and file modes before acting.
2. Inventory the matched `*.source.html` and `*.receipt.json` pairs and any private exports or evidence that reproduce their text. Check the private H9C quarantine/evidence roots and E2 evidence directory, then other approved operator export locations recorded for the document. Validate the parent directory, owner and exact file before removing it. Remove the authorized copies by their verified names, avoiding wildcard deletion and paths outside the approved directories. Check file absence in the same directories and record a sanitized completion or pending status.
3. Track coverage of local archives, exports, application logs and external systems individually. Database purge confirms removal of vectors and derived catalog text in this space. Provider-side data and external copies require their own operator verification. Mastra/Turso threads and traces currently have no RAG agent content. When those features begin quoting source content, inventory the affected IDs, traces and retained copies and use the corresponding storage/observability deletion procedure.

The E2-MVP rehearsal uses synthetic fixtures for destructive tests. Keep the real experimental snapshots available as private evidence during this delivery. External backup remains outside MVP scope under H10.
