# RAG09 — Step C offline prototype and remaining gates

Status: **DRAFT / EXPERIMENTAL / NO PRODUCTION INGESTION** (2026-11-16).

The Step C implementation is isolated under
[src/mastra/rag/processing/](../../src/mastra/rag/processing/). It is NOT
registered in new Mastra({ ... }), a route, a tool, a workflow or a scheduler.
Consequently the normal production bootstrap has no path to call the new
network-capable fetcher, even if this code is later deployed.

## What is implemented and testable offline

| Capability | Implementation | Evidence boundary |
| --- | --- | --- |
| HTTPS fetch | Built-in node:https; reviewed exact source ID; pinned public IPv4 on each hop; TLS/SNI validation; 10 s socket/60 s total timeout; manual max-3 redirects and 5 MiB byte cap | **Mock DNS and HTTP only** in CI; no live source was requested |
| Charset | Declared header vs HTML meta reconciliation; UTF-8 and Windows-1252 | Synthetic fixtures, not vendor HTML integration |
| Extraction | Restricted deterministic HTML text tokenizer; suppresses script/style/iframes/nav/footer/revoked s/strike/del; amendment text retained as metadata | NOT a full HTML5 parser; unsupported entities and malformed tags fail closed |
| Legal units | Article, chapter/section, paragraph, Roman-numeral inciso and alínea; stable law locators | Tests with **fictional** articles and sections, not an official corpus |
| Normalization | Unicode NFC, whitespace collapse, stable block boundaries; SHA-256; exact UTF-16 body offsets | Reconstructed through String.slice in tests |
| Chunking | Structural chunker with caput context and recursive baseline with overlap; deterministic profile/chunk-set/chunk IDs | **UTF-8 byte budgets**, NOT model tokens; experimental configuration differs from SPEC §6.4 golden token-based profile |

No new dependencies, runtime endpoints, DB tables/indexes, secret values,
embeddings, Supabase or Turso mutations were added.

## Security limits

The fetcher requires an ID present in the immutable reviewed manifest. It
resolves and validates every redirect host against the same syntactic policy;
DNS answers are pinned at the TCP/TLS connection with normal server-name
certificate verification. IPv6 resolution fails closed; do not weaken this
without a documented resolver/IP policy review. No real fetch is executed in CI.

The initial parser intentionally supports a restricted HTML subset without
adding H9-gated dependencies. It must not be relied on for current legal text
from the Planalto/DOU sites. Unexpected HTML shapes or entities must be
investigated before considering live ingestion.

## Deliberately unfulfilled Step C gates

1. **Official LGPD snapshot:** no fake or synthetic file may be represented as
   an official snapshot. The site may challenge bots; DOU was previously
   inaccessible to automated fetch. Obtain the authoritative current source
   through an allowed operator workflow, validate amendments, provenance,
   charset, normalized hash, and freeze the exact tested snapshot.
2. **H9 dependency approval:** select exact versions of a maintained HTML
   parser and a cl100k_base-compatible tokenizer, with license, maintenance,
   advisory, bundle and lockfile review. No package may be installed by
   inference from this document alone.
3. **Token-based calibration:** run the 256/512/1024-token grid against a
   reviewed legal corpus; document chunk count, model-token p50/p95/max and
   clipping rate. The synthetic byte-budget stats in CI are **not** token
   statistics or a quality benchmark.
4. **Live network acceptance:** validate official URLs, HTTP status,
   redirects, current consolidated legal text and actual DNS/IP behavior
   under a separately authorized operator call. No bypass of bot challenges
   or TLS and no live calls in CI.
5. **Owner merge gate:** current PR must have a green CI and independent
   review with no open P0/P1/P2; it must remain Draft until owner approval.

Until those gates are completed, classify as **STEP_C_OFFLINE_PROTOTYPE**,
not a fully validated legal ingestion pipeline or STEP_C_COMPLETE.

## Synthetic fixture

[synthetic-lgpd.html](../../src/mastra/rag/processing/fixtures/synthetic-lgpd.html)
contains invented articles solely for deterministic security/regression tests.
It has no legal authority, no real LGPD text and must never be published as
grounding material. No copyrighted government portal HTML was bundled.
