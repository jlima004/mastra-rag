# RAG08 — Official-source evidence and MVP manifest (Step B)

**Status:** Offline contract and reference verification, **not** a fetch/ingestion approval. Reviewed 2026-11-16.

The in-repository [manifest](../../src/mastra/rag/contracts/manifest.ts) lists only immutable,
exact HTTPS references from official publications. Step B never requests their content,
performs DNS resolution or creates a local HTML cache. Live content and amendments
are verified later in Step C before a legal-text snapshot is allowed to become current.

## Experimental subset (2026-11-26)

The [H9C-MVP decision](../decisions/RAG-H9C-official-source-and-token-grid.md#h9c-mvp--ratified-scope-and-calibration-2026-11-26) records offline admission of the two exact DOU snapshots for Resolutions 15/2024 and 18/2024. The [experimental manifest](../../src/mastra/rag/processing/mvp-corpus.ts) records the acquisition dates and digests. LGPD remains in the fixed manifest for future work. The owner deferred the independent legal comparison for this experimental subset. Production activation and paid execution require separate approval.

## Sources included in the fixed manifest

| ID | Official act | Canonical reference in manifest | Reference evidence | Caveat |
| --- | --- | --- | --- | --- |
| `br-planalto-lei-13709-2018` | Lei nº 13.709/2018 (LGPD) | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm | Planalto official law reference | Automated access may trigger a challenge/redirect; Step C must check current consolidated wording |
| `br-anpd-res-15-2024` | Resolução CD/ANPD nº 15/2024 (security incidents) | https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024 | [ANPD regulations index](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/) links directly to the DOU act | DOU HTTP fetch returned 502 in the research client; treat as unverified reachability |
| `br-anpd-res-18-2024` | Resolução CD/ANPD nº 18/2024 (data protection officer) | https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-18-de-16-de-julho-de-2024-572632074 | [ANPD regulations index](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/) links directly to the DOU act | DOU HTTP fetch returned 502 in the research client; treat as unverified reachability |

## Verified candidates deferred from the active manifest

| Act | Official reference | Why deferred |
| --- | --- | --- |
| Resolução CD/ANPD nº 2/2022 (small organizations) | [ANPD consolidated reference](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022) | ANPD identifies amendments made by Resolution 15/2024. The original DOU HTML is not automatically the operative consolidated text. Define an amendment-aware representation in Step C before indexing. |
| Resolução CD/ANPD nº 19/2024 (international transfers) | [ANPD consolidated reference](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024) | ANPD identifies a [DOU correction of 18 Aug 2025](https://www.in.gov.br/web/dou/-/retificacao-648877873). An original-only copy would quote superseded text. Require an authoritative corrected snapshot before activation. |

The active catalogue is intentionally limited to **one law and two ANPD resolutions**
while source availability, consolidated wording, and amendment representation remain unverified.
This satisfies the Stage A MVP scope of a selected subset; it does not assert every candidate is ingested.

## Rights and provenance

Brazilian Law 9.610/1998, art. 8º, IV excludes the **text of official acts** from
copyright protection; see the [official legislative reference](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-publicacaooriginal-1-pl.html).
This statement does **not** extend to guides, commentary, page layout, third-party
compilations or potentially copyrighted illustrations. Raw external source HTML
is not copied into the Step B repository, and no license claim is made for
third-party portal presentation. The manifest stores only citations and metadata.

## Step C prerequisites before calling any source "ingested"

1. Confirm official URL, HTTP status, content type, final URL, charset and access policy using an authorized operator fetch. Do not solve CAPTCHA or bypass government access controls.
2. Revalidate every redirect's host/path and DNS-resolved public address at connection time, including DNS rebinding prevention; Step B URL validation is **syntactic only**.
3. Reconcile amendments, revocations and retifications against current official publications; snapshot immutable, legally reusable normalized text and preserve the source, fetch date and hash.
4. Use offline fixtures for CI, with no external HTTP calls. Fail closed on inaccessible, suspicious or semantically ambiguous sources; avoid silently swapping in an unreviewed host.
5. An extractor for DOU HTML (`dou-html@1`) was added to the **contract** but has no implementation in Step B. Parser dependencies remain subject to H9 package-specific approval.

**No legal-advice claim:** the eventual system is informational and must cite governing provisions.
