# H9C-C2 — Versioned offline DOU extractor candidate

**Decision (2026-11-26).** Implement a dedicated, dependency-free DOU extractor and test its fidelity offline against the two selected H9C-C1 quarantine pairs. The candidate depends on [PR #37](https://github.com/jlima004/mastra-rag/pull/37) at `d5085df4cbdc44c71f28e89ba8dd2ad2d0f8475c`. Track remaining H9C work in [Issue #35](https://github.com/jlima004/mastra-rag/issues/35).

## Cause and scope

On both selected snapshots, the legacy extractor read a JavaScript comment's CDATA opener as HTML markup under `head/script`, at UTF-16 offset 7,221. H9C-C1 reproduced the rejection with synthetic control C2 and restored acceptance with C3 by removing the opener alone. Repeated interventions exposed seven similar rejection points and a tag-boundary rejection. This evidence applies to the two new hashes. The older snapshots' causes remain undetermined.

A raw-text fix in the shared parser would change both legacy extractors while leaving legal text boundaries unresolved. A generic parser would require separate dependency approval, security and resource review. The dedicated candidate narrows its accepted HTML to structures evidenced by the snapshots and synthetic controls. A relevant unsupported structure blocks a fidelity pass and triggers adjudication before grammar expansion or a consolidated library evaluation.

## Offline dispatch and identity

- The candidate processing revision is `dou-html@2`. The explicit offline entry point passes decoded text to `extractDouHtmlCandidate()` in `processing/dou-html.ts`. The operator driver is the entry point for private pair evaluation. It runs the legacy extractor as a control.
- `SourceExtractor`, `SourceManifestEntry` and manifest validation continue defining allowed source records. The two active ANPD entries retain `dou-html@1`. The candidate revision belongs to the offline profile identity contract. Registering it there confers no authorization to use it in the active manifest, fetcher, quarantine assessment, or legacy processor.
- The driver requires an archive directory, an existing DOU source ID, and exact raw and receipt SHA-256 values. It reads the selected pair through the PR #37 private descriptor and reuses the inspector, manifest and strict decoder. Verify the receipt's declared media type, source version, identity and decoded digest. Emit aggregate diagnostics only and leave all three approval flags false.
- `documentId` binds tenant, source and canonical URI. `documentVersionId` binds document identity and raw SHA-256. The processing revision enters the profile hash independently of the document or bytes. Base chunk set identity binds the document version and profile. Rendered identity also binds the normalized digest and applicable header metadata. Chunks derive from rendered set and ordinal. The two existing ingestion key formulas bind profile or rendered set respectively. These are deterministic offline calculations.
- Test an identical-byte fixture that normalizes to the same text via both extractors. Expect equal document, version and normalized identities, with distinct profile, base and rendered chunk sets, chunks, and idempotency keys. Test changed raw bytes separately. Preserve historical byte-proxy and token-grid profiles, rendering algorithms, locator rules and goldens.

## HTML subset and selection

Use forward-only contextual tokenization with bounded open-element state. Recognize ASCII-case-insensitive names, syntactic name boundaries, quoted attribute values and HTML void elements. Require balanced structure and reject ambiguous input. Decode structural attributes before matching class tokens and reject duplicate attributes. Interpret HTML comments separately from `script` and `style` bodies. Scan raw-text bodies to a contextual end tag, ignoring apparent markup, CDATA and JavaScript comments within them. Recognize ordinary escaped script data and reject the transition to double-escaped script data. Fail closed on an unclosed body and unsupported HTML comment forms. Treat executable markup and resource URLs as inert input bytes. See the [HTML Standard script data states](https://html.spec.whatwg.org/multipage/parsing.html#script-data-state).

Require one admissible `div` with the exact `texto-dou` class token in `article#materia`. The observed path in both snapshots is `article#materia > div > div.texto-dou > html`, with an explicit `head` followed by a `body` under the nested `html`. Recognize that envelope only inside the selected region. Discard its excluded head. Reject missing, duplicate or nested candidate regions and candidates inside excluded contexts. Check eligible text outside the selected region for conflicting legal markers. Excluded subtrees contribute no candidate or outside markers. Exclude ordinary editorial headings and breadcrumb copies from the act. Both snapshots contain one paragraph end tag with a class attribute in the editorial postlude. Admit that closing form only for the matching open paragraph after the selected body closes. Its attribute has no semantic role, and the report counts the recovery.

Associate the heading structurally with a unique, first nonempty `p.identifica` in the selected act body. Both snapshots have `p.ementa` as the following paragraph, with the act and annex in the same body. Report a missing or ambiguous association separately and block structural completeness. Collect the ementa, preamble, articles, paragraphs, incisos, alíneas, sections and annex in document order. Preserve supported explicit block boundaries and legal markers. Distinguish visible headings from structural titles expressed as paragraphs. Pass raw legal blocks with those text markers intact to `legal-text@1`. Both selected bodies contain direct paragraphs. Lists, tables, and embedded media in the selected content require adjudication. A numbered legal heading can associate the following eligible subtitle paragraph under the observed Portuguese convention. Save both blocks in source order and carry the paired label into descendant context.

The act and its annex restart legal classification separately. In both snapshots the annex reuses article numbers from the main act, which collides under the shared normalizer alone. The candidate prefixes annex locators with the annex scope, keeps the annex label in the hierarchy, and recomputes offsets into the combined document. The explicit signature and office pair has its own scope at the end of the act. A child stranded after a revoked article placeholder requires adjudication, because otherwise it could inherit the preceding article. A revoked placeholder cannot satisfy the header, ementa, or annex-heading roles. The shared normalizer still supplies text and legal unit classification for each scope.

Discard scripts, styles, templates, forms, navigation and explicitly scoped editorial blocks. Candidates in hidden or excluded subtrees cannot qualify. Keep exclusion counts by fixed category. Treat explicit structural strike/deletion markers under the candidate's exclusion rules. Retain wording that merely mentions a revocation and retain supported in-text amendment notes for the normalizer. Record the inherited normalization behavior for standalone revoked placeholders. Unsupported editorial notes, unresolved inline visibility within the selected scope, or evidence of omitted norm-bearing material require an incomplete result or rejection. External CSS and runtime visibility are outside the extractor's model. Browser-rendered text equivalence remains unverified.

## Transformations and resource bounds

Strict `decodeFetchedDocument()` verifies document identity, media, size, digest and charset consistency. It uses fatal UTF-8 or Windows-1252 decoding and rejects NUL and invalid Unicode. The candidate decodes the supported named entities and valid numeric Unicode scalars before accumulating text. Reject unknown entities and invalid numeric scalars. Preserve Unicode characters, adjacent inline text and document order. Collapse supported whitespace at block boundaries and let the existing normalizer apply NFC, normalized whitespace, block separation and legal marker classification. Normalized and chunk offsets are UTF-16 code unit offsets with scalar-safe boundaries. A block and normalized digest bind those actual intermediate outputs.

| Limit | Bound |
| --- | --- |
| Raw bytes | 5 MiB (existing `RAG_LIMITS.MAX_RAW_BYTES`) |
| Decoded input | 5,000,000 UTF-16 code units |
| Tag scan | 8,192 UTF-16 code units per tag |
| Attributes per tag | 128 |
| Structural iterations | 250,000 |
| Element count | 50,000 |
| Open element depth | 128 |
| Accumulated extracted text | 1,000,000 UTF-16 code units |
| Emitted blocks | 10,000 |
| Heading label per extracted block | 2,048 UTF-16 code units |
| Normalized text | 1,000,000 UTF-16 code units (existing limit) |
| Extraction elapsed time | 10 seconds, checked cooperatively |

Every scanner loop advances or rejects. Ignored raw text, comments and excluded regions still count toward input and work limits. Use a bounded stack and scan structural text without recursive recovery or repeated scans of whole suffixes. Fixed error codes and safe counters cross the report boundary. Locator metadata hashes use streaming canonical records and fixed-size heading digests to bound the effect of repeated context labels. Reject repeated locators for explicit articles, paragraphs, incisos, and alíneas. Ordinary continuations can share the locator of their legal unit. CPU, elapsed time and process memory are measured repeatedly on synthetic and real inputs. Cooperative time checks and measurements do not impose a process timeout or memory quota.

The threat model includes malformed HTML, fake candidate regions, misleading delayed end tags, hostile attributes and entities, explicit hiding/revocation, overlong input and nested structures, and private-path replacement. Use the existing descriptor and trusted-ancestor policy. Only allow fixed diagnostics in external output. Preserve the selected raw and receipt bytes and store any private review material separately using mode `0700` directories and `0600` files.

## Evidence and acceptance

Run one selected pair in a private local WSL session.

```bash
npm run rag:h9:evaluate:dou -- /absolute/private/archive SOURCE_ID RAW_SHA256 RECEIPT_SHA256 10
```

Each process performs one warm-up and the requested number of measured iterations, from 2 through 25. The driver reports candidate extraction and normalization plus equal-input repeatability and local byte-proxy identities. The four token-grid profiles are exercised only in synthetic contract tests.

Select only the exact H9C-C1 pairs below. Their raw and receipt contents remain in private quarantine. Historical hashes are a separate evidence set.

| Source | Bytes | Raw SHA-256 | Receipt SHA-256 |
| --- | ---: | --- | --- |
| `br-anpd-res-15-2024` | 114,363 | `06acf25cafdf7a235c5a2b2f9259a8238ec0d3e770de7a4f29321aa2e724370f` | `9f931731bcfdc98ef506d0e02ff5178b512016c1db4b076c90a88dd25efe486a` |
| `br-anpd-res-18-2024` | 100,459 | `b5941ce0f4a7c06b3fd04b87ea01572871386012982c6b3a03be9a3549eaa111` | `4d6c2d3b71405d022df5777fe423c958f8d4f5c30836bb5fb6cdb15143d107ec` |

| Gate | Required evidence |
| --- | --- |
| C2-G1 | Explicit offline dispatch, recognized candidate identity and inactive manifest |
| C2-G2 | Synthetic C2/C3 and T1–T6 regressions with closed structural/resource failures |
| C2-G3 | Both verified pairs, unique legal region and header association, no known structural loss or unresolved ambiguity |
| C2-G4 | Repeated stable output and documented limits, elapsed time, CPU and memory observations |
| C2-G5 | Unchanged goldens and legacy behavior, distinct candidate identity |
| C2-G6 | Independent review of the final candidate with material findings resolved |
| C2-G7 | `PENDING_HUMAN_LEGAL_VALIDATION` |
| C2-G8 | Stacked Draft, CI and Codex Review on its exact SHA, with material findings and threads resolved |

Record the separate specialized security review status. Adjudicate legal provenance, text and hierarchy, editorial boundaries, amendments, corrigenda and vigency against independent official references in the later human gate. Production activation needs explicit human approval of the extractor and verified corpus, resolution of the PR #37 dependency, and applicable reviewed calibration and downstream controls. The Planalto investigation remains suspended. H12, E2 and paid execution remain gated under their existing decisions.
